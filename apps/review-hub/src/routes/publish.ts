import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  MAX_SHARE_BYTES,
  MAX_SHARE_MANIFEST_BYTES,
  MAX_SHARE_OBJECTS,
  MAX_SHARE_OBJECT_BYTES,
  type ShareManifest,
  shareManifestSchema,
} from "@dev.fast/review-share-protocol";
import type { ShareBundle } from "@review/sharing/export.js";
import type { SharedReviewStore } from "@review/sharing/import.js";
import { Hono } from "hono";
import { z } from "zod";

import { constantTimeEqual, hashCapability, publisherAuth } from "../auth.js";
import type { HubStore } from "../db.js";
import type { ObjectStorage } from "../storage.js";

const createShareSchema = z.strictObject({
  requestId: z.string().min(1).max(256),
  manifest: z.strictObject({
    size: z.number().int().min(1).max(MAX_SHARE_MANIFEST_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

interface PublishRouteDeps {
  db: HubStore;
  storage: ObjectStorage;
  sharedStore?: SharedReviewStore;
  publicOrigin: string;
  hubToken?: string;
  signingSecret?: string;
  dev?: boolean;
}

export function createPublishRoutes(deps: PublishRouteDeps) {
  const router = new Hono();
  const signingSecret = deps.signingSecret || randomBytes(32).toString("hex");

  // Protect all /api/shares mutations with publisher bearer auth
  router.use("/api/shares/*", publisherAuth(deps.hubToken, deps.dev));
  router.use("/api/shares", publisherAuth(deps.hubToken, deps.dev));

  const generateManifestUpload = (id: string) => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const sig = createHmac("sha256", signingSecret)
      .update(`upload-manifest:${id}:${expiresAt}`)
      .digest("hex");

    const uploadUrl = `${deps.publicOrigin}/uploads/${id}/manifest?sig=${sig}&expires=${encodeURIComponent(expiresAt)}`;

    return {
      url: uploadUrl,
      headers: {
        "x-review-upload-sig": sig,
        "x-review-upload-expires": expiresAt,
      },
      expiresAt,
    };
  };

  // 1. Initiate Share
  router.post("/api/shares", async (c) => {
    const body = await c.req.json().catch(() => null);

    const parsed = createShareSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400,
      );
    }

    const { requestId, manifest } = parsed.data;

    // Check idempotency on requestId
    const existing = deps.db.getShareByRequestId(requestId);

    if (existing) {
      if (existing.status !== "pending") {
        return c.json(
          {
            error: {
              code: "INVALID_STATE",
              message: "Share is already completed or revoked.",
            },
          },
          409,
        );
      }

      return c.json({
        shareId: existing.id,
        upload: generateManifestUpload(existing.id),
      });
    }

    const shareId = randomUUID();

    deps.db.createPendingShare({
      id: shareId,
      requestId,
      manifestSha256: manifest.sha256,
    });

    return c.json({
      shareId,
      upload: generateManifestUpload(shareId),
    });
  });

  // 2. Upload manifest
  router.put("/uploads/:shareId/manifest", async (c) => {
    const shareId = c.req.param("shareId");
    const sig = c.req.query("sig") || c.req.header("x-review-upload-sig");

    const expires =
      c.req.query("expires") || c.req.header("x-review-upload-expires");

    const authHeader = c.req.header("authorization");

    let isAuthorized = false;

    // Check bearer token if provided
    if (authHeader && authHeader.startsWith("Bearer ") && deps.hubToken) {
      const token = authHeader.slice("Bearer ".length).trim();

      if (constantTimeEqual(token, deps.hubToken)) {
        isAuthorized = true;
      }
    }

    // Check signed upload token
    if (!isAuthorized && sig && expires) {
      const expectedSig = createHmac("sha256", signingSecret)
        .update(`upload-manifest:${shareId}:${expires}`)
        .digest("hex");

      if (sig === expectedSig && new Date(expires).getTime() >= Date.now()) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid upload authorization.",
          },
        },
        401,
      );
    }

    const share = deps.db.getShare(shareId);

    if (!share) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Share not found." } },
        404,
      );
    }

    if (share.status !== "pending") {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Share is no longer pending.",
          },
        },
        409,
      );
    }

    const arrayBuffer = await c.req.arrayBuffer();

    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.byteLength > MAX_SHARE_MANIFEST_BYTES) {
      return c.json(
        {
          error: { code: "OVERSIZE", message: "Manifest exceeds size limit." },
        },
        413,
      );
    }

    try {
      await deps.storage.writeObject(share.manifest_sha256, bytes);
    } catch {
      return c.json(
        {
          error: {
            code: "DIGEST_MISMATCH",
            message: "Manifest SHA256 mismatch.",
          },
        },
        400,
      );
    }

    const manifestText = new TextDecoder().decode(bytes);

    deps.db.updateManifest(shareId, manifestText);

    return c.body(null, 200);
  });

  // 3. Register Manifest & Get Object Upload URLs
  router.post("/api/shares/:shareId/manifest", async (c) => {
    const shareId = c.req.param("shareId");

    const share = deps.db.getShare(shareId);

    if (!share || !share.manifest_json) {
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Share or manifest not found." },
        },
        404,
      );
    }

    if (share.status !== "pending") {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Share is no longer pending.",
          },
        },
        409,
      );
    }

    let manifest: ShareManifest;

    try {
      manifest = shareManifestSchema.parse(JSON.parse(share.manifest_json));
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_MANIFEST",
            message: "Schema error in manifest.",
          },
        },
        400,
      );
    }

    // Check bounds
    if (manifest.objects.length > MAX_SHARE_OBJECTS) {
      return c.json(
        { error: { code: "LIMIT_EXCEEDED", message: "Too many objects." } },
        400,
      );
    }

    const totalBytes = manifest.objects.reduce((sum, o) => sum + o.size, 0);

    if (totalBytes > MAX_SHARE_BYTES) {
      return c.json(
        {
          error: {
            code: "LIMIT_EXCEEDED",
            message: "Total size exceeds limit.",
          },
        },
        400,
      );
    }

    const uploads: Record<
      string,
      { url: string; headers: Record<string, string>; expiresAt: string }
    > = {};

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    for (const object of manifest.objects) {
      const sig = createHmac("sha256", signingSecret)
        .update(`upload-object:${shareId}:${object.id}:${expiresAt}`)
        .digest("hex");

      uploads[object.id] = {
        url: `${deps.publicOrigin}/uploads/${shareId}/object/${object.id}?sig=${sig}&expires=${encodeURIComponent(expiresAt)}`,
        headers: {
          "x-review-upload-sig": sig,
          "x-review-upload-expires": expiresAt,
        },
        expiresAt,
      };
    }

    return c.json({
      registered: true,
      uploads,
    });
  });

  // 4. Upload object
  router.put("/uploads/:shareId/object/:objectId", async (c) => {
    const shareId = c.req.param("shareId");
    const objectId = c.req.param("objectId");
    const sig = c.req.query("sig") || c.req.header("x-review-upload-sig");

    const expires =
      c.req.query("expires") || c.req.header("x-review-upload-expires");

    const authHeader = c.req.header("authorization");

    let isAuthorized = false;

    // Check bearer token if provided
    if (authHeader && authHeader.startsWith("Bearer ") && deps.hubToken) {
      const token = authHeader.slice("Bearer ".length).trim();

      if (constantTimeEqual(token, deps.hubToken)) {
        isAuthorized = true;
      }
    }

    // Check signed upload token
    if (!isAuthorized && sig && expires) {
      const expectedSig = createHmac("sha256", signingSecret)
        .update(`upload-object:${shareId}:${objectId}:${expires}`)
        .digest("hex");

      if (sig === expectedSig && new Date(expires).getTime() >= Date.now()) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid upload authorization.",
          },
        },
        401,
      );
    }

    const share = deps.db.getShare(shareId);

    if (!share) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Share not found." } },
        404,
      );
    }

    if (share.status !== "pending") {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Share is no longer pending.",
          },
        },
        409,
      );
    }

    if (!share.manifest_json) {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: "Share manifest has not been uploaded.",
          },
        },
        400,
      );
    }

    let manifest: ShareManifest;

    try {
      manifest = JSON.parse(share.manifest_json);
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_MANIFEST",
            message: "Stored manifest is invalid JSON.",
          },
        },
        500,
      );
    }

    const declared = manifest.objects?.find((o) => o.id === objectId);

    if (!declared) {
      return c.json(
        {
          error: {
            code: "UNDECLARED_OBJECT",
            message: "Object ID was not declared in manifest.",
          },
        },
        400,
      );
    }

    const arrayBuffer = await c.req.arrayBuffer();

    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.byteLength > MAX_SHARE_OBJECT_BYTES) {
      return c.json(
        { error: { code: "OVERSIZE", message: "Object exceeds size limit." } },
        413,
      );
    }

    if (bytes.byteLength !== declared.size) {
      return c.json(
        {
          error: {
            code: "SIZE_MISMATCH",
            message: "Object size does not match declared size.",
          },
        },
        400,
      );
    }

    try {
      await deps.storage.writeObject(objectId, bytes);

      return c.body(null, 200);
    } catch {
      return c.json(
        {
          error: {
            code: "DIGEST_MISMATCH",
            message: "Object SHA256 mismatch.",
          },
        },
        400,
      );
    }
  });

  // 5. Complete Share
  router.post("/api/shares/:shareId/complete", async (c) => {
    const shareId = c.req.param("shareId");

    const share = deps.db.getShare(shareId);

    if (!share || !share.manifest_json) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Share not found." } },
        404,
      );
    }

    if (share.revoked_at || share.status === "revoked") {
      return c.json(
        { error: { code: "REVOKED", message: "Share has been revoked." } },
        404,
      );
    }

    if (share.status === "completed") {
      // Idempotent retry: mint fresh capability, replace hash, return link
      const capability = randomBytes(32).toString("base64url");
      const capHash = hashCapability(capability);
      const link = `${deps.publicOrigin}/s/${shareId}#${capability}`;

      deps.db.completeShare({
        id: shareId,
        capabilityHash: capHash,
      });

      return c.json({ shareId: share.id, url: link });
    }

    const manifest: ShareManifest = JSON.parse(share.manifest_json);

    // Verify all objects exist
    const objectsMap = new Map<string, Uint8Array>();

    for (const obj of manifest.objects) {
      const bytes = await deps.storage.readObject(obj.id);

      if (!bytes) {
        return c.json({ complete: false });
      }

      objectsMap.set(obj.id, bytes);
    }

    // Mint 256-bit capability
    const capability = randomBytes(32).toString("base64url");

    const capHash = hashCapability(capability);

    const link = `${deps.publicOrigin}/s/${shareId}#${capability}`;

    deps.db.completeShare({
      id: shareId,
      capabilityHash: capHash,
    });

    // Import into SharedReviewStore if mounted
    if (deps.sharedStore) {
      const bundle: ShareBundle = {
        manifest,
        objects: objectsMap,
        attribution: {
          login: "publisher",
          sharedAt: Date.now(),
        },
      };

      await deps.sharedStore
        .import(deps.publicOrigin, shareId, bundle)
        .catch((err) => {
          console.error("Failed to import bundle into SharedReviewStore:", err);
        });
    }

    return c.json({ shareId, url: link });
  });

  // 6. Recover link
  router.get("/api/shares/:shareId/link", (c) => {
    const shareId = c.req.param("shareId");

    const share = deps.db.getShare(shareId);

    if (!share || share.status !== "completed") {
      return c.json(
        { error: { code: "NOT_COMPLETED", message: "Share not completed." } },
        409,
      );
    }

    if (share.revoked_at) {
      return c.json(
        { error: { code: "REVOKED", message: "Share has been revoked." } },
        404,
      );
    }

    const capability = randomBytes(32).toString("base64url");
    const capHash = hashCapability(capability);
    const link = `${deps.publicOrigin}/s/${shareId}#${capability}`;

    deps.db.completeShare({
      id: shareId,
      capabilityHash: capHash,
    });

    return c.json({ shareId: share.id, url: link });
  });

  // 7. Revoke Share
  router.delete("/api/shares/:shareId", (c) => {
    const shareId = c.req.param("shareId");

    deps.db.revokeShare(shareId);

    return c.json({ revoked: true });
  });

  return router;
}

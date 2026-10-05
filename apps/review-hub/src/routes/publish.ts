import { randomBytes, randomUUID } from "node:crypto";

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

import { hashCapability, publisherAuth } from "../auth.js";
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
}

export function createPublishRoutes(deps: PublishRouteDeps) {
  const router = new Hono();

  // Protect all /api/shares mutations with publisher bearer auth
  router.use("/api/shares/*", publisherAuth(deps.hubToken));
  router.use("/api/shares", publisherAuth(deps.hubToken));

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
      const uploadUrl = `${deps.publicOrigin}/uploads/${existing.id}/manifest`;

      return c.json({
        shareId: existing.id,
        upload: {
          url: uploadUrl,
          headers: {},
          expiresAt: "2099-01-01T00:00:00Z",
        },
      });
    }

    const shareId = randomUUID();

    deps.db.createPendingShare({
      id: shareId,
      requestId,
      manifestSha256: manifest.sha256,
    });

    const uploadUrl = `${deps.publicOrigin}/uploads/${shareId}/manifest`;

    return c.json({
      shareId,
      upload: {
        url: uploadUrl,
        headers: {},
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
  });

  // 2. Upload manifest
  router.put("/uploads/:shareId/manifest", async (c) => {
    const shareId = c.req.param("shareId");

    const share = deps.db.getShare(shareId);

    if (!share) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Share not found." } },
        404,
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

    for (const object of manifest.objects) {
      uploads[object.id] = {
        url: `${deps.publicOrigin}/uploads/${shareId}/object/${object.id}`,
        headers: {},
        expiresAt: "2099-01-01T00:00:00Z",
      };
    }

    return c.json({
      registered: true,
      uploads,
    });
  });

  // 4. Upload object
  router.put("/uploads/:shareId/object/:objectId", async (c) => {
    const objectId = c.req.param("objectId");

    const arrayBuffer = await c.req.arrayBuffer();

    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.byteLength > MAX_SHARE_OBJECT_BYTES) {
      return c.json(
        { error: { code: "OVERSIZE", message: "Object exceeds size limit." } },
        413,
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

    if (share.status === "completed" && share.url) {
      return c.json({ shareId: share.id, url: share.url });
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
      capability,
      capabilityHash: capHash,
      url: link,
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

    if (!share || share.status !== "completed" || !share.url) {
      return c.json(
        { error: { code: "NOT_COMPLETED", message: "Share not completed." } },
        409,
      );
    }

    return c.json({ shareId: share.id, url: share.url });
  });

  // 7. Revoke Share
  router.delete("/api/shares/:shareId", (c) => {
    const shareId = c.req.param("shareId");

    deps.db.revokeShare(shareId);

    return c.json({ revoked: true });
  });

  return router;
}

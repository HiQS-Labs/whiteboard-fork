import { createHmac, randomBytes } from "node:crypto";

import type { Context } from "hono";
import { Hono } from "hono";

import { constantTimeEqual, hashCapability } from "../auth.js";
import type { HubStore } from "../db.js";
import type { ObjectStorage } from "../storage.js";

interface SharedRouteDeps {
  db: HubStore;
  storage: ObjectStorage;
  publicOrigin: string;
  signingSecret?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

export function createSharedRoutes(deps: SharedRouteDeps) {
  const router = new Hono();
  const signingSecret = deps.signingSecret || randomBytes(32).toString("hex");

  // Validate capability token
  const authenticateToken = (shareId: string, token?: string) => {
    const share = deps.db.getShare(shareId);

    if (!share || share.status !== "completed") {
      return null;
    }

    if (share.revoked_at) {
      return null;
    }

    if (!token) {
      return null;
    }

    if (
      share.capability_hash &&
      constantTimeEqual(share.capability_hash, hashCapability(token))
    ) {
      return share;
    }

    return null;
  };

  // Helper to authenticate via capability token or Basic auth
  const authenticateViewer = (c: Context, shareId: string) => {
    const token = c.req.header("x-review-share-token") || c.req.query("token");

    const tokenShare = authenticateToken(shareId, token);

    if (tokenShare) {
      return tokenShare;
    }

    if (deps.auth?.username && deps.auth?.password) {
      const authHeader = c.req.header("authorization");

      if (authHeader && authHeader.startsWith("Basic ")) {
        const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
          "utf-8",
        );

        const colonIndex = credentials.indexOf(":");

        if (colonIndex !== -1) {
          const user = credentials.slice(0, colonIndex);
          const pass = credentials.slice(colonIndex + 1);

          if (
            constantTimeEqual(user, deps.auth.username) &&
            constantTimeEqual(pass, deps.auth.password)
          ) {
            const share = deps.db.getShare(shareId);

            if (share && !share.revoked_at && share.status === "completed") {
              return share;
            }
          }
        }
      }
    }

    return null;
  };

  // 1. Get shared manifest and metadata
  router.get("/api/shared/:shareId", (c) => {
    const shareId = c.req.param("shareId");
    const share = authenticateViewer(c, shareId);

    if (!share || !share.manifest_json) {
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Share not found or revoked." },
        },
        404,
      );
    }

    return c.json({
      manifest: JSON.parse(share.manifest_json),
      sender: { login: "publisher" },
      sharedAt: share.created_at,
    });
  });

  // 2. Get object download URL
  router.get("/api/shared/:shareId/objects/:objectId", (c) => {
    const shareId = c.req.param("shareId");
    const objectId = c.req.param("objectId");
    const share = authenticateViewer(c, shareId);

    if (!share || !share.manifest_json) {
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Share not found or revoked." },
        },
        404,
      );
    }

    try {
      const m = JSON.parse(share.manifest_json);

      const objectBelongs =
        m.objects?.some((o: { id: string }) => o.id === objectId) ||
        m.snapshot === objectId ||
        m.presentation === objectId ||
        m.resources?.some((r: { object: string }) => r.object === objectId);

      if (!objectBelongs) {
        return c.json(
          {
            error: { code: "NOT_FOUND", message: "Object not found in share." },
          },
          404,
        );
      }
    } catch {
      return c.json(
        { error: { code: "INVALID_MANIFEST", message: "Invalid manifest." } },
        500,
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const sig = createHmac("sha256", signingSecret)
      .update(`${shareId}:${objectId}:${expiresAt}`)
      .digest("hex");

    return c.json({
      url: `${deps.publicOrigin}/objects/${objectId}?shareId=${shareId}&expires=${encodeURIComponent(expiresAt)}&sig=${sig}`,
      expiresAt,
    });
  });

  // 3. Serve object bytes
  router.get("/objects/:objectId", async (c) => {
    const objectId = c.req.param("objectId");
    const shareId = c.req.query("shareId") || c.req.header("x-review-share-id");
    const expires = c.req.query("expires");
    const sig = c.req.query("sig");

    if (!shareId) {
      return c.text("Unauthorized: share ID required", 401);
    }

    const share = deps.db.getShare(shareId);

    if (!share || share.revoked_at || share.status !== "completed") {
      return c.text("Unauthorized: share not found or revoked", 404);
    }

    if (!share.manifest_json) {
      return c.text("Object not found", 404);
    }

    try {
      const manifest = JSON.parse(share.manifest_json);

      const objectBelongs =
        manifest.objects?.some((o: { id: string }) => o.id === objectId) ||
        manifest.snapshot === objectId ||
        manifest.presentation === objectId ||
        manifest.resources?.some(
          (r: { object: string }) => r.object === objectId,
        );

      if (!objectBelongs) {
        return c.text("Object not found in this share", 404);
      }
    } catch {
      return c.text("Invalid manifest", 500);
    }

    let isAuthorized = false;

    // Check signed URL
    if (sig && expires) {
      const expectedSig = createHmac("sha256", signingSecret)
        .update(`${shareId}:${objectId}:${expires}`)
        .digest("hex");

      if (sig === expectedSig && new Date(expires).getTime() >= Date.now()) {
        isAuthorized = true;
      }
    }

    // Check capability or basic auth via authenticateViewer
    if (!isAuthorized && authenticateViewer(c, shareId) !== null) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return c.text(
        "Unauthorized: valid share capability or signed download URL required",
        401,
      );
    }

    const bytes = await deps.storage.readObject(objectId);

    if (!bytes) {
      return c.text("Object not found", 404);
    }

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, no-store",
      },
    });
  });

  return router;
}

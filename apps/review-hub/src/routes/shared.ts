import { Hono } from "hono";

import { hashCapability } from "../auth.js";
import type { HubStore } from "../db.js";
import type { ObjectStorage } from "../storage.js";

interface SharedRouteDeps {
  db: HubStore;
  storage: ObjectStorage;
  publicOrigin: string;
}

export function createSharedRoutes(deps: SharedRouteDeps) {
  const router = new Hono();

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

    if (share.capability && share.capability === token) {
      return share;
    }

    if (
      share.capability_hash &&
      share.capability_hash === hashCapability(token)
    ) {
      return share;
    }

    return null;
  };

  // 1. Get shared manifest and metadata
  router.get("/api/shared/:shareId", (c) => {
    const shareId = c.req.param("shareId");
    const token = c.req.header("x-review-share-token");

    const share = authenticateToken(shareId, token);

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
    const token = c.req.header("x-review-share-token");

    const share = authenticateToken(shareId, token);

    if (!share) {
      return c.json(
        {
          error: { code: "NOT_FOUND", message: "Share not found or revoked." },
        },
        404,
      );
    }

    return c.json({
      url: `${deps.publicOrigin}/objects/${objectId}`,
      expiresAt: "2099-01-01T00:00:00Z",
    });
  });

  // 3. Serve object bytes
  router.get("/objects/:objectId", async (c) => {
    const objectId = c.req.param("objectId");
    const bytes = await deps.storage.readObject(objectId);

    if (!bytes) {
      return c.text("Object not found", 404);
    }

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  return router;
}

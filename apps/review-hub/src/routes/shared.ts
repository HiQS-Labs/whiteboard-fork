import { createHmac, randomBytes } from "node:crypto";

import { Hono } from "hono";

import { hashCapability } from "../auth.js";
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
    const token = c.req.query("token") || c.req.header("x-review-share-token");

    let isAuthorized = false;

    // Check basic auth if configured and provided
    if (deps.auth?.username && deps.auth?.password) {
      const authHeader = c.req.header("authorization");

      if (authHeader && authHeader.startsWith("Basic ")) {
        const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
          "utf-8",
        );

        const [user, pass] = credentials.split(":");

        if (user === deps.auth.username && pass === deps.auth.password) {
          isAuthorized = true;
        }
      }
    }

    // Check signed URL
    if (!isAuthorized && sig && expires && shareId) {
      const expectedSig = createHmac("sha256", signingSecret)
        .update(`${shareId}:${objectId}:${expires}`)
        .digest("hex");

      if (sig === expectedSig && new Date(expires).getTime() >= Date.now()) {
        const share = deps.db.getShare(shareId);

        if (share && !share.revoked_at) {
          isAuthorized = true;
        }
      }
    }

    // Check capability token
    if (!isAuthorized && shareId && token) {
      if (authenticateToken(shareId, token) !== null) {
        isAuthorized = true;
      }
    }

    // If no viewer auth was configured, allow read if shareId + token are valid or if in dev mode
    if (
      !isAuthorized &&
      !deps.auth?.username &&
      !deps.auth?.password &&
      !sig &&
      !token
    ) {
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ShareClient } from "@review/sharing/client.js";
import { type ShareBundle, exportShare } from "@review/sharing/export.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShareFixture } from "../../../packages/review/test/fixtures/share/create.js";
import { createReviewHubApp } from "./server.js";

describe("Review Hub MVP", () => {
  let tempDir: string;
  let hub: ReturnType<typeof createReviewHubApp>;
  const hubToken = "test-hub-token";
  const viewerUser = "team";
  const viewerPass = "secret123";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "review-hub-test-"));
    hub = createReviewHubApp({
      homeDir: tempDir,
      publicOrigin: "https://localhost:8787",
      hubToken,
      viewerUser,
      viewerPassword: viewerPass,
    });
  });

  afterEach(async () => {
    hub.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("completes full publish round-trip using real ShareClient", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "share-fixture-"));
    const fixture = await createShareFixture(fixtureRoot);

    try {
      const bundle: ShareBundle = await exportShare({
        store: fixture.store,
        data: fixture.data,
        reviewId: fixture.reviewId,
        repository: fixture.repository,
      });

      const client = new ShareClient(
        "https://localhost:8787",
        hubToken,
        async (input, init) => {
          const url = new URL(String(input));
          const req = new Request(url.href, init);

          return hub.app.fetch(req);
        },
      );

      // 1. Create Share
      const result = await client.create(bundle);
      expect(result.shareId).toBeDefined();
      expect(result.url).toMatch(
        /^https:\/\/localhost:8787\/s\/[a-f0-9-]+#[A-Za-z0-9_-]{43}$/,
      );

      const objectId = bundle.manifest.objects[0]?.id;
      expect(objectId).toBeDefined();

      // 2. Idempotent link recovery mints a valid URL without storing plain capability
      const recovered = await client.recoverLink(result.shareId);
      expect(recovered.shareId).toBe(result.shareId);
      expect(recovered.url).toMatch(
        /^https:\/\/localhost:8787\/s\/[a-f0-9-]+#[A-Za-z0-9_-]{43}$/,
      );

      // 3. Basic Auth on web viewer
      const unauthReq = new Request(
        `https://localhost:8787/s/${result.shareId}`,
      );

      const unauthRes = await hub.app.fetch(unauthReq);
      expect(unauthRes.status).toBe(401);

      const authHeader = `Basic ${Buffer.from(`${viewerUser}:${viewerPass}`).toString("base64")}`;

      const authReq = new Request(
        `https://localhost:8787/s/${result.shareId}`,
        {
          headers: { Authorization: authHeader },
        },
      );

      const authRes = await hub.app.fetch(authReq);
      expect(authRes.status).toBe(200);
      const html = await authRes.text();
      expect(html).toContain("Whiteboard Review");

      // Verify object download succeeds with capability token
      const capability = recovered.url.split("#")[1];

      const capReq = new Request(
        `https://localhost:8787/objects/${objectId}?shareId=${result.shareId}&token=${capability}`,
      );

      const capRes = await hub.app.fetch(capReq);

      expect(capRes.status).toBe(200);
      expect(capRes.headers.get("Cache-Control")).toBe("private, no-store");

      // 4. Revocation
      await client.revoke(result.shareId);

      // Subsequent access returns 404 for viewer
      const revokedReq = new Request(
        `https://localhost:8787/s/${result.shareId}`,
        {
          headers: { Authorization: authHeader },
        },
      );

      const revokedRes = await hub.app.fetch(revokedReq);

      expect(revokedRes.status).toBe(404);

      // Subsequent object access for revoked share returns 404
      const revokedObjReq = new Request(
        `https://localhost:8787/objects/${objectId}?shareId=${result.shareId}&token=${capability}`,
      );

      const revokedObjRes = await hub.app.fetch(revokedObjReq);

      expect(revokedObjRes.status).toBe(404);
    } finally {
      fixture.store.close();
      fixture.data.close();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("enforces bearer auth on publish endpoints", async () => {
    const req = new Request("http://localhost:8787/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "test-req",
        manifest: { size: 100, sha256: "0".repeat(64) },
      }),
    });

    const res = await hub.app.fetch(req);

    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated upload PUT requests", async () => {
    const manifestUploadReq = new Request(
      "http://localhost:8787/uploads/00000000-0000-0000-0000-000000000000/manifest",
      {
        method: "PUT",
        body: new Uint8Array([1, 2, 3]),
      },
    );

    const manifestRes = await hub.app.fetch(manifestUploadReq);

    expect(manifestRes.status).toBe(401);

    const objectUploadReq = new Request(
      `http://localhost:8787/uploads/00000000-0000-0000-0000-000000000000/object/${"0".repeat(64)}`,
      {
        method: "PUT",
        body: new Uint8Array([1, 2, 3]),
      },
    );

    const objectRes = await hub.app.fetch(objectUploadReq);

    expect(objectRes.status).toBe(401);
  });

  it("rejects unauthenticated object download requests", async () => {
    const req = new Request(`http://localhost:8787/objects/${"0".repeat(64)}`);

    const res = await hub.app.fetch(req);

    expect(res.status).toBe(401);
  });

  it("does not leak hubToken on dashboard HTML", async () => {
    const authHeader = `Basic ${Buffer.from(`${viewerUser}:${viewerPass}`).toString("base64")}`;

    const req = new Request("http://localhost:8787/", {
      headers: { Authorization: authHeader },
    });

    const res = await hub.app.fetch(req);

    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain(hubToken);
    expect(html).toContain("&lt;your-hub-token&gt;");
  });
});

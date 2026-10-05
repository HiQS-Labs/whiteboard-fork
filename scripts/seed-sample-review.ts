import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ShareClient } from "@review/sharing/client.js";
import { exportShare } from "@review/sharing/export.js";
import { createShareFixture } from "../packages/review/test/fixtures/share/create.js";

async function main() {
  const hubUrl = process.env.REVIEW_HUB_URL || "http://localhost:8787";
  const hubToken = process.env.REVIEW_HUB_TOKEN || "test-hub-token";

  console.log(`Publishing sample review to ${hubUrl}...`);

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "seed-fixture-"));
  const fixture = await createShareFixture(fixtureRoot);

  const bundle = await exportShare({
    store: fixture.store,
    data: fixture.data,
    reviewId: fixture.reviewId,
    repository: fixture.repository,
  });

  const client = new ShareClient(hubUrl, hubToken);
  const result = await client.create(bundle);

  console.log("\nSuccess! Sample review created:");
  console.log(`Review ID:   ${result.shareId}`);
  console.log(`Review URL:  ${result.url}`);

  await rm(fixtureRoot, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Failed to seed sample review:", err);
  process.exit(1);
});

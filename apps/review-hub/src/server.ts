import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { SharedReviewStore } from "@review/sharing/import.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";

import { HubStore, openHubDatabase } from "./db.js";
import { createHubGitFetcher } from "./git.js";
import { createPublishRoutes } from "./routes/publish.js";
import { createReviewsApiRouter } from "./routes/reviews-api.js";
import { createSharedRoutes } from "./routes/shared.js";
import { createViewerRoutes } from "./routes/viewer.js";
import { ObjectStorage } from "./storage.js";

export interface ReviewHubOptions {
  homeDir?: string;
  port?: number;
  host?: string;
  publicOrigin?: string;
  hubToken?: string;
  githubToken?: string;
  viewerUser?: string;
  viewerPassword?: string;
}

export function createReviewHubApp(options: ReviewHubOptions = {}) {
  const homeDir =
    options.homeDir ??
    process.env.REVIEW_HUB_HOME ??
    path.join(homedir(), ".review-hub");

  const port = options.port ?? Number(process.env.REVIEW_HUB_PORT ?? 8787);

  const publicOrigin =
    options.publicOrigin ??
    process.env.REVIEW_HUB_ORIGIN ??
    `http://localhost:${port}`;

  const hubToken = options.hubToken ?? process.env.REVIEW_HUB_TOKEN;

  const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;

  const viewerUser = options.viewerUser ?? process.env.REVIEW_HUB_USER;

  const viewerPassword =
    options.viewerPassword ?? process.env.REVIEW_HUB_PASSWORD;

  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

  // 1. Initialize SQLite Database
  const dbSync = openHubDatabase(path.join(homeDir, "hub.db"));

  const db = new HubStore(dbSync);

  // 2. Initialize Object Storage
  const storage = new ObjectStorage(homeDir);

  storage
    .init()
    .catch((err) =>
      logger.error({ err }, "Failed to initialize object storage"),
    );

  // 3. Initialize SharedReviewStore with custom Git fetcher
  const gitFetcher = createHubGitFetcher(githubToken);

  const sharedStore = new SharedReviewStore(
    path.join(homeDir, "shared-reviews"),
    gitFetcher,
  );

  const app = new Hono();

  // Basic middleware
  app.use("*", cors());
  app.use("*", honoLogger());

  // Health check
  app.get("/healthz", (c) => c.json({ status: "ok", timestamp: Date.now() }));

  // 4. Mount Publish routes
  const publishRoutes = createPublishRoutes({
    db,
    storage,
    sharedStore,
    publicOrigin,
    hubToken,
  });

  app.route("/", publishRoutes);

  // 5. Mount Shared object download routes
  const sharedRoutes = createSharedRoutes({
    db,
    storage,
    publicOrigin,
  });

  app.route("/", sharedRoutes);

  // 6. Mount Viewer routes
  const viewerRoutes = createViewerRoutes({
    db,
    publicOrigin,
    hubToken,
    auth: { username: viewerUser, password: viewerPassword },
  });

  app.route("/", viewerRoutes);

  // 7. Mount /reviews-api read routes
  const reviewsApi = createReviewsApiRouter({
    reviewDbPath: path.join(homeDir, "review-api.db"),
    sharedStore,
    auth: { username: viewerUser, password: viewerPassword },
  });

  app.route("/reviews-api", reviewsApi.router);

  return {
    app,
    db,
    storage,
    sharedStore,
    close: () => {
      reviewsApi.close();
      dbSync.close();
    },
  };
}

export function startReviewHub(options: ReviewHubOptions = {}) {
  const hub = createReviewHubApp(options);

  const port = options.port ?? Number(process.env.REVIEW_HUB_PORT ?? 8787);

  const host = options.host ?? process.env.REVIEW_HUB_HOST ?? "127.0.0.1";

  const server = serve({
    fetch: hub.app.fetch,
    port,
    hostname: host,
  });

  return { server, hub };
}

if (
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    import.meta.url.endsWith(process.argv[1]))
) {
  const port = Number(process.env.REVIEW_HUB_PORT ?? 8787);

  startReviewHub({ port });
  console.log(`Review Hub listening on http://127.0.0.1:${port}`);
}

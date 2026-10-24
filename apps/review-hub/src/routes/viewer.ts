import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import type { SharedReviewStore } from "@review/sharing/import.js";
import { sharedReviewId } from "@review/sharing/import.js";
import { Hono } from "hono";
import { z } from "zod";

import { basicAuthMiddleware } from "../auth.js";
import type { HubStore } from "../db.js";

interface ViewerRouteDeps {
  db: HubStore;
  sharedStore: SharedReviewStore;
  publicOrigin: string;
  appVersion: string;
  /** Where the built canvas (`hub-entry` + assets + `.vite/manifest.json`) lives. */
  canvasDir?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

/** The hub's answer to `GET /s/:shareId/session`; mirrors `HubSessionState` in the canvas. */
type SessionState =
  | {
      stage: "ready";
      reviewId: string;
      version: number;
      title: string;
      /** The pinned head on GitHub, for the canvas's "Source tree" button. */
      sourceTreeUrl?: string;
    }
  | { stage: "pending"; reviewId: string; title: string; detail: string }
  | { stage: "error"; reviewId: string; title: string; error: string };

const SHARE_ID = /^[0-9a-f-]{36}$/i;

/** A failed checkout is retried on the next visit, but not on every poll. */
const RETRY_AFTER_MS = 30_000;

/**
 * Serves the Whiteboard review canvas — the same React app the Desktop
 * embeds, built standalone by `packages/review/app/hub.vite.config.ts` — for
 * a published share, plus the JSON the canvas polls until the share's pinned
 * repository is checked out.
 */
export function createViewerRoutes(deps: ViewerRouteDeps) {
  const router = new Hono();
  const canvasDir = deps.canvasDir ?? defaultCanvasDir();
  // Re-read per page load: a rebuilt bundle has new hashed names and the dev
  // server should pick them up without a restart.
  const canvas = () => loadCanvasManifest(canvasDir);
  const lastPrepare = new Map<string, number>();

  if (deps.auth?.username && deps.auth?.password) {
    const guard = basicAuthMiddleware(deps.auth.username, deps.auth.password);
    router.use("/s/*", guard);
    router.use("/s", guard);
    router.use("/hub/*", guard);
  }

  if (canvas())
    router.use(
      "/hub/*",
      serveStatic({
        root: path.relative(process.cwd(), canvasDir) || ".",
        rewriteRequestPath: (requestPath) => requestPath.replace(/^\/hub/, ""),
        onFound: (_path, c) => {
          c.header("cache-control", "public, max-age=31536000, immutable");
        },
      }),
    );

  router.get("/s/:shareId/session", async (c) => {
    const shareId = c.req.param("shareId");

    if (!SHARE_ID.test(shareId))
      return c.json({ error: "Invalid share id." }, 400);
    const share = deps.db.getShare(shareId);

    if (!share || share.status !== "completed" || share.revoked_at)
      return c.json({ error: "Review unavailable." }, 404);
    const reviewId = sharedReviewId(deps.publicOrigin, shareId);
    const title = shareTitle(share.manifest_json) ?? "Whiteboard Review";

    if (!deps.sharedStore.has(reviewId))
      return c.json<SessionState>({
        stage: "error",
        reviewId,
        title,
        error: "This share was not imported into the hub's review store.",
      });
    let status = deps.sharedStore.status(reviewId);

    if (status.stage === "error") {
      const last = lastPrepare.get(reviewId) ?? 0;

      if (Date.now() - last > RETRY_AFTER_MS) {
        lastPrepare.set(reviewId, Date.now());
        // Retry in the background; this and later polls report the state.
        deps.sharedStore.prepare(reviewId).catch(() => {});
        status = deps.sharedStore.status(reviewId);
      }
    }

    if (status.stage === "ready") {
      const { snapshot, manifest } = deps.sharedStore.get(reviewId);
      const cloneUrl = manifest.repository?.cloneUrl;

      return c.json<SessionState>({
        stage: "ready",
        reviewId,
        version: snapshot.version,
        title: snapshot.title,
        // The manifest only admits canonical `https://github.com/<owner>/<repo>.git`.
        sourceTreeUrl:
          cloneUrl && snapshot.pins
            ? `${cloneUrl.replace(/\.git$/, "")}/tree/${snapshot.pins.head}`
            : undefined,
      });
    }

    if (status.stage === "error")
      return c.json<SessionState>({
        stage: "error",
        reviewId,
        title,
        error: status.error ?? "The shared repository could not be prepared.",
      });

    return c.json<SessionState>({
      stage: "pending",
      reviewId,
      title,
      detail: `Preparing the review (${status.stage})…`,
    });
  });

  router.get("/s/:shareId", (c) => {
    const shareId = c.req.param("shareId");

    if (!SHARE_ID.test(shareId))
      return c.html(page("Invalid share", "<h1>Invalid share id</h1>"), 400);
    const share = deps.db.getShare(shareId);

    if (!share || share.status !== "completed" || share.revoked_at)
      return c.html(
        page(
          "Review unavailable",
          "<h1>Review unavailable</h1><p>This review has been revoked or is no longer available on this hub.</p>",
        ),
        404,
      );

    const bundle = canvas();

    if (!bundle)
      return c.html(
        page(
          "Canvas not built",
          "<h1>Canvas not built</h1><p>Run <code>pnpm --filter @dev.fast/review-canvas build:hub</code> and restart the hub.</p>",
        ),
        503,
      );
    const title = shareTitle(share.manifest_json) ?? "Whiteboard Review";

    const config = JSON.stringify({
      shareId,
      appVersion: deps.appVersion,
    }).replaceAll("<", "\\u003c");

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/hub/${bundle.css}?v=${bundle.version}">
  <style>
    /* Whiteboard Dark / Light editor backgrounds, so nothing shows through. */
    html, body { margin: 0; height: 100%; background: #0c0f15; color: #eef0f4; }
    @media (prefers-color-scheme: light) { html, body { background: #ffffff; color: #15181e; } }
    #review-hub-root { height: 100%; }
  </style>
</head>
<body>
  <div id="review-hub-root"></div>
  <script>window.__REVIEW_HUB__ = ${config};</script>
  <script type="module" src="/hub/${bundle.js}?v=${bundle.version}"></script>
</body>
</html>`);
  });

  return router;
}

interface CanvasManifest {
  dir: string;
  js: string;
  css: string;
  /** Cache-buster: the newest mtime of the entry files. Vite's CSS hash does
   * not track the scoped stylesheet's content, so the name alone is stale. */
  version: string;
}

/** The hub bundle next to the server (a packed deploy), else the workspace build. */
function defaultCanvasDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // dist/server.mjs → dist/canvas; src/routes/viewer.ts → dist/canvas
    path.resolve(here, "canvas"),
    path.resolve(here, "../../dist/canvas"),
    // The workspace build, from dist/ and from src/routes/.
    path.resolve(here, "../../../packages/review/app/dist/hub"),
    path.resolve(here, "../../../../packages/review/app/dist/hub"),
  ];

  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, ".vite/manifest.json")),
    ) ?? candidates[0]!
  );
}

const viteManifestSchema = z.record(
  z.string(),
  z.object({
    file: z.string(),
    isEntry: z.boolean().optional(),
    css: z.array(z.string()).optional(),
  }),
);

function loadCanvasManifest(dir: string): CanvasManifest | null {
  const file = path.join(dir, ".vite/manifest.json");

  if (!existsSync(file)) return null;

  const manifest = viteManifestSchema.parse(
    JSON.parse(readFileSync(file, "utf8")),
  );

  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);

  if (!entry?.css?.[0]) return null;

  const version = Math.max(
    ...[entry.file, entry.css[0]].map((asset) => {
      try {
        return statSync(path.join(dir, asset)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  ).toString(36);

  return { dir, js: entry.file, css: entry.css[0], version };
}

const shareTitleSchema = z.object({ title: z.string().min(1).optional() });

function shareTitle(
  manifestJson: string | null | undefined,
): string | undefined {
  if (!manifestJson) return undefined;

  try {
    return shareTitleSchema.parse(JSON.parse(manifestJson)).title;
  } catch {
    return undefined;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#16130f;color:#e8e1d6;text-align:center}h1{font-size:20px}p{opacity:.7}</style></head><body><div>${body}</div></body></html>`;
}

import { Hono } from "hono";

import { basicAuthMiddleware } from "../auth.js";
import type { HubStore } from "../db.js";

interface DashboardRouteDeps {
  db: HubStore;
  publicOrigin?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

function escapeHtmlServer(str: string | number | null | undefined): string {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The hub's front page: published reviews and the publish instructions. */
export function createDashboardRoutes(deps: DashboardRouteDeps) {
  const router = new Hono();

  if (deps.auth?.username && deps.auth?.password)
    router.use(
      "/",
      basicAuthMiddleware(deps.auth.username, deps.auth.password),
    );

  router.get("/", (c) => {
    const shares = deps.db.listCompletedShares(50);
    const origin = deps.publicOrigin || "http://localhost:8787";

    const reviewsHtml =
      shares.length === 0
        ? `<div class="empty">No reviews published yet. Use the CLI command below to publish your first review.</div>`
        : shares
            .map((s) => {
              let title = s.id;
              let repo = "";

              if (s.manifest_json) {
                try {
                  const m = JSON.parse(s.manifest_json);

                  if (m.title) title = m.title;

                  if (m.repository?.cloneUrl) repo = m.repository.cloneUrl;
                } catch {
                  // Fallback to ID
                }
              }

              const viewUrl = `/s/${encodeURIComponent(s.id)}`;
              const dateStr = new Date(s.created_at).toLocaleString();

              return `
                <div class="review-item">
                  <div>
                    <a class="review-title" href="${viewUrl}">${escapeHtmlServer(title)}</a>
                    <div class="review-meta">${escapeHtmlServer(dateStr)}${repo ? " &middot; " + escapeHtmlServer(repo) : ""}</div>
                  </div>
                  <a class="btn" href="${viewUrl}">Open Review &rarr;</a>
                </div>
              `;
            })
            .join("");

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiteboard Review Hub</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 16px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #30363d;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      font-size: 20px;
      margin: 0;
      font-weight: 600;
      color: #f0f6fc;
    }
    .badge {
      font-size: 12px;
      background: #238636;
      color: #fff;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0 12px;
      color: #f0f6fc;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .review-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #21262d;
    }
    .review-item:last-child {
      border-bottom: none;
    }
    .review-title {
      font-weight: 600;
      font-size: 15px;
      color: #58a6ff;
      text-decoration: none;
    }
    .review-title:hover {
      text-decoration: underline;
    }
    .review-meta {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
    }
    .btn {
      display: inline-block;
      background: #238636;
      color: #fff;
      padding: 6px 12px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
    }
    .btn:hover {
      background: #2ea043;
    }
    pre {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace;
      font-size: 13px;
      margin: 8px 0 0;
      color: #79c0ff;
    }
    .empty {
      text-align: center;
      padding: 32px;
      color: #8b949e;
      font-size: 14px;
    }
    footer {
      margin-top: 40px;
      border-top: 1px solid #30363d;
      padding-top: 16px;
      font-size: 12px;
      color: #8b949e;
      display: flex;
      justify-content: space-between;
    }
    footer a {
      color: #58a6ff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>Whiteboard Review Hub</h1>
        <span class="badge">Online</span>
      </div>
      <div style="font-size: 13px; color: #8b949e;">
        User: <strong>${deps.auth?.username || "authenticated"}</strong>
      </div>
    </header>

    <div class="section-title">Published Reviews</div>
    <div class="card">
      ${reviewsHtml}
    </div>

    <div class="section-title">Publish from Whiteboard CLI</div>
    <div class="card">
      <div style="font-size: 13px; color: #8b949e; margin-bottom: 8px;">
        To share a review from your terminal or CI runner to this hub:
      </div>
      <pre><code># 1. Set environment variables
export WHITEBOARD_SHARE_HUB="${origin}"
export WHITEBOARD_SHARE_TOKEN="&lt;your-hub-token&gt;"

# 2. Share the active review
pnpm review share</code></pre>
    </div>

    <footer>
      <div>Whiteboard Review Hub v0.1.0</div>
      <div>
        <a href="/healthz" target="_blank">Health Check (/healthz)</a>
      </div>
    </footer>
  </div>
</body>
</html>`);
  });

  return router;
}

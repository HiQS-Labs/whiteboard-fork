import { Hono } from "hono";

import { basicAuthMiddleware } from "../auth.js";
import type { HubStore } from "../db.js";

interface ViewerRouteDeps {
  db: HubStore;
  publicOrigin?: string;
  hubToken?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

export function createViewerRoutes(deps: ViewerRouteDeps) {
  const router = new Hono();

  // Basic auth guard for viewer if configured
  if (deps.auth?.username && deps.auth?.password) {
    router.use(
      "/s/*",
      basicAuthMiddleware(deps.auth.username, deps.auth.password),
    );
    router.use(
      "/s",
      basicAuthMiddleware(deps.auth.username, deps.auth.password),
    );
    router.use(
      "/",
      basicAuthMiddleware(deps.auth.username, deps.auth.password),
    );
  }

  // Root Dashboard
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

              const viewUrl = `/s/${encodeURIComponent(s.id)}${s.capability ? "#" + s.capability : ""}`;
              const dateStr = new Date(s.created_at).toLocaleString();

              return `
                <div class="review-item">
                  <div>
                    <a class="review-title" href="${viewUrl}">${title}</a>
                    <div class="review-meta">${dateStr}${repo ? " &middot; " + repo : ""}</div>
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
export WHITEBOARD_SHARE_TOKEN="${deps.hubToken || "&lt;your-hub-token&gt;"}"

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

  router.get("/s/:shareId", (c) => {
    const shareId = c.req.param("shareId");
    const share = deps.db.getShare(shareId);

    if (!share || share.status === "revoked" || share.revoked_at) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Review Unavailable</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0d1117; color: #c9d1d9; }
    .box { text-align: center; max-width: 480px; padding: 32px; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
    h1 { font-size: 20px; color: #f85149; margin-bottom: 8px; }
    p { font-size: 14px; color: #8b949e; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Review Unavailable</h1>
    <p>This review has been revoked or is no longer available on this hub.</p>
  </div>
</body>
</html>`,
        404,
      );
    }

    // Deliver viewer shell with capability extraction from window.location.hash
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiteboard Review</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #canvas-root { width: 100%; height: 100%; display: flex; flex-direction: column; }
    .header { height: 48px; border-bottom: 1px solid #30363d; display: flex; align-items: center; padding: 0 16px; background: #161b22; font-weight: 600; font-size: 14px; }
    .content { flex: 1; overflow: auto; padding: 24px; max-width: 900px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; color: #8b949e; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; background: #238636; color: #fff; margin-left: 8px; }
    pre { background: #161b22; border: 1px solid #30363d; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace; }
    .diff-block { margin-top: 16px; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    .diff-header { background: #161b22; padding: 8px 12px; font-size: 12px; font-family: monospace; border-bottom: 1px solid #30363d; color: #58a6ff; }
  </style>
</head>
<body>
  <div id="canvas-root">
    <div class="header">
      <span>Whiteboard Review Hub</span>
      <span class="badge">Verified Shared</span>
    </div>
    <div id="viewer-container" class="content">
      <div class="loading">Loading review...</div>
    </div>
  </div>
  <script>
    (async function() {
      const shareId = "${shareId}";
      const capability = window.location.hash ? window.location.hash.slice(1) : "";
      const container = document.getElementById("viewer-container");

      try {
        const res = await fetch("/api/shared/" + encodeURIComponent(shareId), {
          headers: capability ? { "x-review-share-token": capability } : {}
        });

        if (!res.ok) {
          container.innerHTML = '<div style="color:#f85149">Failed to load shared review metadata (' + res.status + '). Ensure valid capability token.</div>';
          return;
        }

        const data = await res.json();
        const manifest = data.manifest;

        let html = '<h1 style="font-size:24px;margin-bottom:8px">' + (manifest.title || 'Untitled Review') + '</h1>';
        html += '<div style="font-size:12px;color:#8b949e;margin-bottom:24px">Shared at ' + new Date(data.sharedAt).toLocaleString() + (manifest.repository ? ' &middot; Repository: ' + manifest.repository.cloneUrl : '') + '</div>';

        if (manifest.resources && manifest.resources.length > 0) {
          html += '<h2 style="font-size:16px;border-bottom:1px solid #30363d;padding-bottom:8px">Resources (' + manifest.resources.length + ')</h2><ul>';
          for (const r of manifest.resources) {
            html += '<li>' + r.kind + ': ' + r.id + ' (' + r.mimeType + ')</li>';
          }
          html += '</ul>';
        }

        html += '<h2 style="font-size:16px;border-bottom:1px solid #30363d;padding-bottom:8px;margin-top:24px">Review Envelope</h2>';
        html += '<pre><code>' + JSON.stringify(manifest, null, 2) + '</code></pre>';

        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div style="color:#f85149">Error loading review: ' + err.message + '</div>';
      }
    })();
  </script>
</body>
</html>`);
  });

  return router;
}

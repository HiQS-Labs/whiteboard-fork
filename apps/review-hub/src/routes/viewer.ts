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

              const viewUrl = `/s/${encodeURIComponent(s.id)}`;
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

  router.get("/s/:shareId", (c) => {
    const shareId = c.req.param("shareId");

    if (!/^[0-9a-f-]{36}$/i.test(shareId)) {
      return c.html(
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Invalid Share ID</title><style>body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0d1117; color: #f85149; }</style></head><body><h1>Invalid Share ID format</h1></body></html>`,
        400,
      );
    }

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

    // Deliver Option A rich web viewer shell with native GitHub-style diffs, tabs, and document rendering
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiteboard Review</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .back-btn {
      color: #8b949e;
      text-decoration: none;
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #21262d;
    }
    .back-btn:hover {
      background: #30363d;
      color: #f0f6fc;
    }
    .review-heading {
      font-size: 16px;
      font-weight: 600;
      color: #f0f6fc;
      margin: 0;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 500;
      background: #238636;
      color: #fff;
    }
    .pill-muted {
      background: #21262d;
      border: 1px solid #30363d;
      color: #8b949e;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .copy-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .copy-btn:hover {
      background: #30363d;
    }
    .nav-bar {
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .tabs {
      display: flex;
      gap: 8px;
    }
    .tab {
      padding: 10px 14px;
      color: #8b949e;
      cursor: pointer;
      font-weight: 500;
      font-size: 13px;
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .tab:hover {
      color: #c9d1d9;
    }
    .tab.active {
      color: #f0f6fc;
      border-bottom-color: #f78166;
    }
    .tab-badge {
      background: #30363d;
      color: #c9d1d9;
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
    }
    .view-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-group {
      display: flex;
      border: 1px solid #30363d;
      border-radius: 6px;
      overflow: hidden;
    }
    .btn-group button {
      background: #21262d;
      color: #8b949e;
      border: none;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      border-right: 1px solid #30363d;
    }
    .btn-group button:last-child {
      border-right: none;
    }
    .btn-group button.active {
      background: #1f6feb;
      color: #fff;
    }
    .main-body {
      flex: 1;
      overflow-y: auto;
      padding: 24px 20px;
    }
    .tab-content {
      max-width: 1040px;
      margin: 0 auto;
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    /* Document Tab */
    .doc-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .doc-section h1 { font-size: 22px; margin-top: 0; color: #f0f6fc; }
    .doc-section h2 { font-size: 18px; margin-top: 20px; color: #f0f6fc; border-bottom: 1px solid #30363d; padding-bottom: 6px; }
    .doc-section h3 { font-size: 15px; margin-top: 16px; color: #f0f6fc; }
    .doc-section p { margin: 10px 0; color: #c9d1d9; }
    .doc-section ul { padding-left: 24px; margin: 10px 0; }
    .doc-section li { margin: 4px 0; }
    /* Code Peek Card */
    .code-peek-card {
      margin: 16px 0;
      border: 1px solid #30363d;
      border-radius: 6px;
      overflow: hidden;
      background: #0d1117;
    }
    .code-peek-header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 8px 12px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: #58a6ff;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .code-peek-body {
      padding: 12px;
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
      line-height: 1.5;
      overflow-x: auto;
      color: #e6edf3;
    }
    /* Trace Quote Card */
    .trace-quote-card {
      background: #161b22;
      border-left: 4px solid #1f6feb;
      border-radius: 0 6px 6px 0;
      padding: 12px 16px;
      margin: 16px 0;
    }
    .trace-quote-label {
      font-size: 11px;
      font-weight: 600;
      color: #58a6ff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .trace-quote-text {
      font-size: 14px;
      color: #f0f6fc;
      font-style: italic;
    }
    /* Diff Views */
    .diff-container {
      margin-bottom: 24px;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      background: #0d1117;
    }
    .diff-file-header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
      font-weight: 600;
    }
    .diff-file-path {
      color: #f0f6fc;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .diff-stats-badge {
      font-size: 12px;
      display: flex;
      gap: 6px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .stat-add { color: #3fb950; }
    .stat-del { color: #f85149; }
    /* Diff Table */
    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace;
      font-size: 12px;
      line-height: 20px;
    }
    .diff-table td {
      padding: 0 8px;
      vertical-align: top;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .line-num {
      width: 44px;
      text-align: right;
      color: #484f58;
      user-select: none;
      border-right: 1px solid #21262d;
      padding-right: 8px;
      font-size: 11px;
    }
    .line-marker {
      width: 20px;
      text-align: center;
      user-select: none;
    }
    .line-add {
      background: rgba(46, 160, 67, 0.15);
      color: #e6edf3;
    }
    .line-add .line-marker {
      color: #3fb950;
      font-weight: bold;
    }
    .line-del {
      background: rgba(248, 81, 73, 0.15);
      color: #e6edf3;
    }
    .line-del .line-marker {
      color: #f85149;
      font-weight: bold;
    }
    .line-context {
      background: transparent;
      color: #c9d1d9;
    }
    .hunk-header {
      background: #161b22;
      color: #8b949e;
      font-size: 11px;
      padding: 4px 12px;
      border-top: 1px solid #21262d;
      border-bottom: 1px solid #21262d;
    }
    /* Split Diff Table */
    .split-col {
      width: 50%;
    }
    /* Visual 2D Architecture Map */
    .map-wrapper {
      display: flex;
      gap: 16px;
      height: calc(100vh - 145px);
      width: 100%;
    }
    .map-canvas-container {
      flex: 1;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 8px;
    }
    .map-svg {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
      user-select: none;
    }
    .map-svg:active {
      cursor: grabbing;
    }
    .map-inspector {
      width: 320px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .map-node-interactive {
      cursor: pointer;
      transition: filter 0.15s ease;
    }
    .map-node-interactive:hover {
      filter: brightness(1.2);
    }
    .map-node-selected > rect {
      stroke: #58a6ff !important;
      stroke-width: 2.5px !important;
      filter: drop-shadow(0 0 6px rgba(88, 166, 255, 0.4));
    }
    .map-zoom-badge {
      position: absolute;
      bottom: 12px;
      left: 12px;
      background: rgba(22, 27, 34, 0.85);
      backdrop-filter: blur(4px);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #30363d;
      font-size: 11px;
      color: #8b949e;
      font-family: ui-monospace, SFMono-Regular, monospace;
      pointer-events: none;
    }
    .map-instructions {
      position: absolute;
      top: 12px;
      left: 12px;
      background: rgba(22, 27, 34, 0.85);
      backdrop-filter: blur(4px);
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid #30363d;
      font-size: 11px;
      color: #8b949e;
      pointer-events: none;
    }
    .map-badge-add {
      background: rgba(46, 160, 67, 0.2);
      color: #3fb950;
      border: 1px solid rgba(46, 160, 67, 0.4);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .map-badge-del {
      background: rgba(248, 81, 73, 0.2);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.4);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .map-jump-btn {
      background: #238636;
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      text-decoration: none;
    }
    .map-jump-btn:hover {
      background: #2ea043;
    }
    /* Architecture Map Card Outline */
    .map-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .element-node {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      margin: 8px 0 8px 16px;
    }
    .element-title {
      font-weight: 600;
      font-size: 14px;
      color: #58a6ff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .element-type {
      font-size: 11px;
      background: #21262d;
      padding: 1px 6px;
      border-radius: 4px;
      color: #8b949e;
      text-transform: uppercase;
    }
    .element-meta {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    /* Loading & Error */
    .center-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 60vh;
      text-align: center;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #30363d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div class="header-left">
        <a class="back-btn" href="/">&larr; Hub</a>
        <h1 id="review-title" class="review-heading">Loading Review...</h1>
        <span class="pill">Verified Shared</span>
      </div>
      <div class="header-right">
        <span id="repo-pin" class="pill-muted"></span>
        <button class="copy-btn" onclick="copyShareUrl()">Copy Link</button>
      </div>
    </header>

    <div class="nav-bar">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('doc')">
          <span>📄 Document</span>
          <span id="doc-count" class="tab-badge">0</span>
        </div>
        <div class="tab" onclick="switchTab('diff')">
          <span>🔀 Changes</span>
          <span id="diff-count" class="tab-badge">0</span>
        </div>
        <div class="tab" onclick="switchTab('map')">
          <span>🗺️ Architecture</span>
          <span id="map-count" class="tab-badge">0</span>
        </div>
        <div class="tab" onclick="switchTab('traces')">
          <span>🤖 Traces</span>
          <span id="trace-count" class="tab-badge">0</span>
        </div>
        <div class="tab" onclick="switchTab('raw')">
          <span>📦 Raw</span>
        </div>
      </div>
      <div id="diff-controls" class="view-controls" style="display:none">
        <div class="btn-group">
          <button id="btn-unified" class="active" onclick="setDiffMode('unified')">Unified</button>
          <button id="btn-split" onclick="setDiffMode('split')">Split</button>
        </div>
      </div>
      <div id="map-controls" class="view-controls" style="display:none">
        <div class="btn-group">
          <button id="btn-map-graph" class="active" onclick="setMapMode('graph')">🗺️ Visual 2D</button>
          <button id="btn-map-outline" onclick="setMapMode('outline')">📋 Outline</button>
        </div>
        <div class="btn-group">
          <button onclick="zoomMap(1.2)" title="Zoom In">+</button>
          <button onclick="zoomMap(0.8)" title="Zoom Out">&minus;</button>
          <button onclick="fitMapToView()" title="Fit to View">Fit</button>
          <button onclick="resetMapZoom()" title="Reset Zoom">100%</button>
        </div>
      </div>
    </div>

    <div class="main-body">
      <div id="loading-state" class="center-state">
        <div class="spinner"></div>
        <div style="color: #8b949e;">Fetching review envelope and objects...</div>
      </div>

      <div id="error-state" class="center-state" style="display:none">
        <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
        <div id="error-message" style="color: #f85149; font-weight: 500;">Failed to load review</div>
      </div>

      <!-- Tab: Document -->
      <div id="tab-doc" class="tab-content"></div>

      <!-- Tab: Changes & Diffs -->
      <div id="tab-diff" class="tab-content"></div>

      <!-- Tab: Architecture Map -->
      <div id="tab-map" class="tab-content" style="max-width: 100%;"></div>

      <!-- Tab: Traces -->
      <div id="tab-traces" class="tab-content"></div>

      <!-- Tab: Raw -->
      <div id="tab-raw" class="tab-content"></div>
    </div>
  </div>

  <script>
    const shareId = ${JSON.stringify(shareId)};
    let capability = window.location.hash ? window.location.hash.slice(1) : "";
    let reviewData = null;
    let diffMode = "unified"; // "unified" | "split"
    let parsedDiffs = [];
    let mapMode = "graph"; // "graph" | "outline"
    let mapTransform = { x: 50, y: 50, scale: 1.0 };
    let isMapPanning = false;
    let mapPanStart = { x: 0, y: 0 };
    let activeMapData = null;
    let selectedNodePath = null;
    let mapNodeLookup = new Map();

    function getObjectUrl(objectId) {
      if (!objectId) return "";
      return "/objects/" + encodeURIComponent(objectId) + (shareId ? "?shareId=" + encodeURIComponent(shareId) : "");
    }

    function objectFetch(objectId) {
      const headers = {};
      if (capability) {
        headers["x-review-share-token"] = capability;
      }
      if (shareId) {
        headers["x-review-share-id"] = shareId;
      }
      return fetch(getObjectUrl(objectId), { headers });
    }

    async function getSignedObjectUrl(objectId) {
      const headers = capability ? { "x-review-share-token": capability } : {};
      const res = await fetch(
        "/api/shared/" + encodeURIComponent(shareId) + "/objects/" + encodeURIComponent(objectId),
        { headers },
      );
      if (!res.ok) return "";
      const data = await res.json();
      return data.url || "";
    }

    function switchTab(name) {
      document.querySelectorAll(".tab").forEach((t, i) => {
        const tabNames = ["doc", "diff", "map", "traces", "raw"];
        t.classList.toggle("active", tabNames[i] === name);
      });
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      const target = document.getElementById("tab-" + name);
      if (target) target.classList.add("active");

      document.getElementById("diff-controls").style.display = name === "diff" ? "flex" : "none";
      document.getElementById("map-controls").style.display = name === "map" ? "flex" : "none";

      if (name === "map" && mapMode === "graph") {
        setTimeout(fitMapToView, 60);
      }
    }

    function setMapMode(mode) {
      mapMode = mode;
      document.getElementById("btn-map-graph").classList.toggle("active", mode === "graph");
      document.getElementById("btn-map-outline").classList.toggle("active", mode === "outline");
      const graphView = document.getElementById("map-graph-view");
      const outlineView = document.getElementById("map-outline-view");

      if (graphView && outlineView) {
        graphView.style.display = mode === "graph" ? "flex" : "none";
        outlineView.style.display = mode === "outline" ? "block" : "none";
      }

      if (mode === "graph") {
        setTimeout(fitMapToView, 60);
      }
    }

    function jumpToFileDiff(filePath) {
      switchTab("diff");
      setTimeout(() => {
        const headers = Array.from(document.querySelectorAll(".diff-file-header"));
        const target = headers.find(el => el.textContent.includes(filePath));

        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          const card = target.closest(".diff-container");

          if (card) {
            card.style.boxShadow = "0 0 0 2px #58a6ff";
            setTimeout(() => {
              card.style.boxShadow = "";
            }, 2500);
          }
        }
      }, 120);
    }

    function setDiffMode(mode) {
      diffMode = mode;
      document.getElementById("btn-unified").classList.toggle("active", mode === "unified");
      document.getElementById("btn-split").classList.toggle("active", mode === "split");
      renderDiffs();
    }

    function copyShareUrl() {
      navigator.clipboard.writeText(window.location.href);
      const btn = document.querySelector(".copy-btn");
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = old, 2000);
    }

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function jsArg(v) {
      return escapeHtml(JSON.stringify(String(v == null ? "" : v)));
    }

    function renderMarkdown(md) {
      if (!md) return "";
      let html = escapeHtml(md);
      // Headers
      html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
      html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
      html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
      // Bold / Italic
      html = html.replace(/\\*\\*(.*?)\\*\\*/gim, "<strong>$1</strong>");
      html = html.replace(/\\*(.*?)\\*/gim, "<em>$1</em>");
      // Inline code
      html = html.replace(/\`([^\`]+)\`/gim, "<code style='background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace'>$1</code>");
      // Line breaks to paragraphs
      const paras = html.split(/\\n\\n+/);
      return paras.map(p => p.startsWith("<h") ? p : "<p>" + p.replace(/\\n/g, "<br>") + "</p>").join("");
    }

    async function loadReview() {
      try {
        const headers = capability ? { "x-review-share-token": capability } : {};
        const res = await fetch("/api/shared/" + encodeURIComponent(shareId), { headers });

        if (!res.ok) {
          throw new Error("HTTP " + res.status + ": Share not found or capability token invalid.");
        }

        const data = await res.json();
        const manifest = data.manifest;

        document.getElementById("review-title").textContent = manifest.title || "Untitled Review";
        if (window.location.hash) {
          capability = window.location.hash.slice(1);
        }

        // Fetch Snapshot Object
        let snapshot = null;
        if (manifest.snapshot) {
          const snapRes = await objectFetch(manifest.snapshot);
          if (snapRes.ok) snapshot = await snapRes.json();
        }

        // Fetch Presentation Object
        let presentation = null;
        if (manifest.presentation) {
          const presRes = await objectFetch(manifest.presentation);
          if (presRes.ok) presentation = await presRes.json();
        }

        // Fetch Traces Objects
        const traces = new Map();
        if (manifest.resources) {
          for (const r of manifest.resources) {
            if (r.kind === "trace") {
              const trRes = await objectFetch(r.object);
              if (trRes.ok) traces.set(r.id, await trRes.json());
            }
          }
        }

        // Repo Pin Info
        if (snapshot && snapshot.pins) {
          const shortBase = snapshot.pins.base ? snapshot.pins.base.slice(0, 7) : "";
          const shortHead = snapshot.pins.head ? snapshot.pins.head.slice(0, 7) : "";
          document.getElementById("repo-pin").textContent = shortBase + " &rarr; " + shortHead;
        } else if (manifest.repository) {
          document.getElementById("repo-pin").textContent = manifest.repository.cloneUrl || "";
        }

        reviewData = { manifest, snapshot, presentation, traces };

        // 1. Render Document
        await renderDocument(snapshot, traces, manifest);

        // 2. Render Diffs
        extractAndRenderDiffs(presentation);

        // 3. Render Architecture Map
        renderArchitectureMap(presentation);

        // 4. Render Traces
        renderTraces(traces);

        // 5. Render Raw
        document.getElementById("tab-raw").innerHTML =
          '<pre style="background:#161b22;padding:16px;border-radius:6px;overflow:auto;font-size:12px;border:1px solid #30363d"><code>' +
          escapeHtml(JSON.stringify({ manifest, snapshot, presentation }, null, 2)) +
          '</code></pre>';

        document.getElementById("loading-state").style.display = "none";
        document.getElementById("tab-doc").classList.add("active");

      } catch (err) {
        document.getElementById("loading-state").style.display = "none";
        document.getElementById("error-state").style.display = "flex";
        document.getElementById("error-message").textContent = err.message;
      }
    }

    async function renderDocument(snapshot, traces, manifest) {
      const container = document.getElementById("tab-doc");
      if (!snapshot || !snapshot.document) {
        container.innerHTML = '<div class="doc-section"><p>No document content available in this review.</p></div>';
        return;
      }

      document.getElementById("doc-count").textContent = snapshot.document.length;
      let html = "";

      for (const block of snapshot.document) {
        if (block.type === "markdown") {
          html += '<div class="doc-section">' + renderMarkdown(block.markdown) + '</div>';
        } else if (block.type === "code_peek") {
          html += \`
            <div class="code-peek-card">
              <div class="code-peek-header">
                <span>📄 \${escapeHtml(block.source || "Code snippet")}</span>
                <span style="color:#8b949e">Pinned Reference</span>
              </div>
              <pre class="code-peek-body"><code>// Pinned reference from repository\n// \${escapeHtml(block.source)}</code></pre>
            </div>
          \`;
        } else if (block.type === "trace_quote") {
          html += \`
            <div class="trace-quote-card">
              <div class="trace-quote-label">🤖 Agent Trace Quote</div>
              <div class="trace-quote-text">"\${escapeHtml(block.text)}"</div>
            </div>
          \`;
        } else if (block.type === "image") {
          const imgObj = manifest.resources?.find(r => r.id === block.assetId)?.object;
          if (imgObj) {
            const imageUrl = capability ? await getSignedObjectUrl(imgObj) : getObjectUrl(imgObj);
            if (imageUrl) {
              html += \`
                <div class="doc-section" style="text-align:center">
                  <img src="\${escapeHtml(imageUrl)}" alt="\${escapeHtml(block.alt || "")}" style="max-width:100%;border-radius:6px;border:1px solid #30363d">
                  \${block.alt ? '<div style="font-size:12px;color:#8b949e;margin-top:6px">' + escapeHtml(block.alt) + '</div>' : ''}
                </div>
              \`;
            }
          }
        } else if (block.type === "software_map") {
          html += \`
            <div class="doc-section" style="border-left: 3px solid #58a6ff;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="font-weight: 600; color: #58a6ff; font-size: 15px;">🗺️ Software Architecture Map</div>
                <button class="map-jump-btn" style="margin: 0; padding: 4px 10px;" onclick="switchTab('map')">
                  Open Interactive Map &rarr;
                </button>
              </div>
              <div style="font-size: 13px; color: #8b949e;">
                This review captures a structural C4 architecture model. View the 2D visual diagram, explore system relationships, and trace component diffs in the Architecture tab.
              </div>
            </div>
          \`;
        }
      }

      container.innerHTML = html;
    }

    function extractAndRenderDiffs(presentation) {
      parsedDiffs = [];
      let totalAdd = 0;
      let totalDel = 0;

      if (presentation && presentation.maps) {
        for (const mapId in presentation.maps) {
          const map = presentation.maps[mapId];
          if (map.unmappedByElementPath) {
            for (const elPath in map.unmappedByElementPath) {
              const el = map.unmappedByElementPath[elPath];
              if (el.files) {
                for (const f of el.files) {
                  totalAdd += f.additions || 0;
                  totalDel += f.deletions || 0;
                  parsedDiffs.push(f);
                }
              }
            }
          }
        }
      }

      document.getElementById("diff-count").textContent = parsedDiffs.length;
      renderDiffs();
    }

    function renderDiffs() {
      const container = document.getElementById("tab-diff");
      if (parsedDiffs.length === 0) {
        container.innerHTML = '<div class="doc-section"><p style="color:#8b949e;text-align:center;padding:24px">No file diffs recorded in this review bundle.</p></div>';
        return;
      }

      let html = "";
      for (const file of parsedDiffs) {
        html += \`
          <div class="diff-container">
            <div class="diff-file-header">
              <div class="diff-file-path">
                <span>📄 \${escapeHtml(file.file)}</span>
              </div>
              <div class="diff-stats-badge">
                <span class="stat-add">+\${file.additions || 0}</span>
                <span class="stat-del">-\${file.deletions || 0}</span>
              </div>
            </div>
            \${renderFileHunks(file.hunks)}
          </div>
        \`;
      }
      container.innerHTML = html;
    }

    function renderFileHunks(hunks) {
      if (!hunks || hunks.length === 0) return '<div style="padding:12px;color:#8b949e;font-size:12px">Binary or no changes</div>';

      if (diffMode === "split") {
        return renderSplitHunks(hunks);
      }
      return renderUnifiedHunks(hunks);
    }

    function renderUnifiedHunks(hunks) {
      let rows = "";
      for (const hunk of hunks) {
        rows += \`<tr><td colspan="4" class="hunk-header">@@ -\${hunk.startLine || 1} +\${hunk.startLine || 1} @@</td></tr>\`;
        for (const line of (hunk.lines || [])) {
          const isAdd = line.kind === "add";
          const isDel = line.kind === "remove";
          const rowClass = isAdd ? "line-add" : (isDel ? "line-del" : "line-context");
          const marker = isAdd ? "+" : (isDel ? "-" : " ");
          const oldNum = line.oldLine != null ? line.oldLine : "";
          const newNum = line.newLine != null ? line.newLine : "";

          rows += \`
            <tr class="\${rowClass}">
              <td class="line-num">\${oldNum}</td>
              <td class="line-num">\${newNum}</td>
              <td class="line-marker">\${marker}</td>
              <td>\${escapeHtml(line.text)}</td>
            </tr>
          \`;
        }
      }
      return '<table class="diff-table">' + rows + '</table>';
    }

    function renderSplitHunks(hunks) {
      let rows = "";
      for (const hunk of hunks) {
        rows += \`<tr><td colspan="6" class="hunk-header">@@ -\${hunk.startLine || 1} +\${hunk.startLine || 1} @@</td></tr>\`;
        for (const line of (hunk.lines || [])) {
          const isAdd = line.kind === "add";
          const isDel = line.kind === "remove";

          if (isDel) {
            rows += \`
              <tr>
                <td class="line-num line-del">\${line.oldLine || ""}</td>
                <td class="line-marker line-del">-</td>
                <td class="split-col line-del">\${escapeHtml(line.text)}</td>
                <td class="line-num"></td>
                <td class="line-marker"></td>
                <td class="split-col"></td>
              </tr>
            \`;
          } else if (isAdd) {
            rows += \`
              <tr>
                <td class="line-num"></td>
                <td class="line-marker"></td>
                <td class="split-col"></td>
                <td class="line-num line-add">\${line.newLine || ""}</td>
                <td class="line-marker line-add">+</td>
                <td class="split-col line-add">\${escapeHtml(line.text)}</td>
              </tr>
            \`;
          } else {
            rows += \`
              <tr class="line-context">
                <td class="line-num">\${line.oldLine || ""}</td>
                <td class="line-marker"> </td>
                <td class="split-col">\${escapeHtml(line.text)}</td>
                <td class="line-num">\${line.newLine || ""}</td>
                <td class="line-marker"> </td>
                <td class="split-col">\${escapeHtml(line.text)}</td>
              </tr>
            \`;
          }
        }
      }
      return '<table class="diff-table">' + rows + '</table>';
    }

    let mapBoundingBox = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
    let dragDistance = 0;
    let dragStartPos = { x: 0, y: 0 };

    const C4_THEMES = {
      softwareSystem: {
        bg: "#101623",
        border: "#1f6feb",
        headerBg: "#172338",
        headerText: "#58a6ff",
        badgeBg: "rgba(56, 139, 253, 0.2)",
        badgeText: "#58a6ff",
        icon: "🌐",
        label: "Software System"
      },
      container: {
        bg: "#141126",
        border: "#8957e5",
        headerBg: "#211a3b",
        headerText: "#bc8cff",
        badgeBg: "rgba(163, 113, 247, 0.2)",
        badgeText: "#d2a8ff",
        icon: "📦",
        label: "Container"
      },
      component: {
        bg: "#0c1b1f",
        border: "#39c5cf",
        headerBg: "#132d34",
        headerText: "#56d4dd",
        badgeBg: "rgba(57, 197, 207, 0.2)",
        badgeText: "#56d4dd",
        icon: "🧩",
        label: "Component"
      },
      codeElement: {
        bg: "#0d1a14",
        border: "#2ea043",
        headerBg: "#142a1f",
        headerText: "#3fb950",
        badgeBg: "rgba(46, 160, 67, 0.2)",
        badgeText: "#3fb950",
        icon: "📄",
        label: "Code Element"
      },
      dataStore: {
        bg: "#211b10",
        border: "#d29922",
        headerBg: "#332612",
        headerText: "#e3b341",
        badgeBg: "rgba(210, 153, 34, 0.2)",
        badgeText: "#e3b341",
        icon: "🗄️",
        label: "Data Store"
      },
      person: {
        bg: "#161b22",
        border: "#8b949e",
        headerBg: "#21262d",
        headerText: "#c9d1d9",
        badgeBg: "rgba(139, 148, 158, 0.2)",
        badgeText: "#c9d1d9",
        icon: "👤",
        label: "Person"
      }
    };

    function getC4Theme(type) {
      return C4_THEMES[type] || C4_THEMES.component;
    }

    function getNodeDiffStats(node) {
      let additions = 0;
      let deletions = 0;
      const files = new Set();

      if (node.sourceRanges && Array.isArray(node.sourceRanges)) {
        for (const sr of node.sourceRanges) {
          if (sr && sr.file) files.add(String(sr.file));
        }
      }

      if (node.coverage && Array.isArray(node.coverage.files)) {
        for (const f of node.coverage.files) {
          if (typeof f === "string") {
            files.add(f);
          } else if (f && typeof f.path === "string") {
            files.add(f.path);
          } else if (f && typeof f.file === "string") {
            files.add(f.file);
          }
        }
      }

      for (const diff of parsedDiffs) {
        const filePath = typeof diff === "string" ? diff : (diff.file || diff.newPath || diff.oldPath || "");

        if (filePath) {
          for (const f of files) {
            if (filePath.endsWith(f) || f.endsWith(filePath)) {
              additions += diff.additions || 0;
              deletions += diff.deletions || 0;
              break;
            }
          }
        }
      }

      return { additions, deletions, files: Array.from(files) };
    }

    function applyMapTransform() {
      const vp = document.getElementById("map-viewport");

      if (vp) {
        vp.setAttribute("transform", "translate(" + mapTransform.x + "," + mapTransform.y + ") scale(" + mapTransform.scale + ")");
      }

      const badge = document.getElementById("map-zoom-indicator");

      if (badge) {
        badge.textContent = Math.round(mapTransform.scale * 100) + "%";
      }
    }

    function zoomMap(factor) {
      const container = document.getElementById("map-canvas-container");
      const rect = container ? container.getBoundingClientRect() : { width: 800, height: 600 };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newScale = Math.max(0.1, Math.min(3.0, mapTransform.scale * factor));

      mapTransform.x = cx - (cx - mapTransform.x) * (newScale / mapTransform.scale);
      mapTransform.y = cy - (cy - mapTransform.y) * (newScale / mapTransform.scale);
      mapTransform.scale = newScale;
      applyMapTransform();
    }

    function resetMapZoom() {
      mapTransform = { x: 50, y: 50, scale: 1.0 };
      applyMapTransform();
    }

    function fitMapToView() {
      const container = document.getElementById("map-canvas-container");

      if (!container) return;

      const rect = container.getBoundingClientRect();
      const w = Math.max(200, (mapBoundingBox.maxX - mapBoundingBox.minX) + 80);
      const h = Math.max(200, (mapBoundingBox.maxY - mapBoundingBox.minY) + 80);
      const scaleX = (rect.width - 60) / w;
      const scaleY = (rect.height - 60) / h;
      const scale = Math.max(0.2, Math.min(1.2, Math.min(scaleX, scaleY)));

      mapTransform.scale = scale;
      mapTransform.x = (rect.width - (mapBoundingBox.maxX - mapBoundingBox.minX) * scale) / 2 - mapBoundingBox.minX * scale;
      mapTransform.y = (rect.height - (mapBoundingBox.maxY - mapBoundingBox.minY) * scale) / 2 - mapBoundingBox.minY * scale;
      applyMapTransform();
    }

    function computeMapLayout(map) {
      mapNodeLookup.clear();
      const elements = map.elements || [];
      const elementMap = new Map();
      const childrenMap = new Map();

      for (const el of elements) {
        elementMap.set(el.path, el);
        childrenMap.set(el.path, []);
      }

      const roots = [];

      for (const el of elements) {
        if (el.parentPath && elementMap.has(el.parentPath)) {
          childrenMap.get(el.parentPath).push(el.path);
        } else {
          roots.push(el.path);
        }
      }

      function computeDimensions(path) {
        const node = elementMap.get(path);
        const children = childrenMap.get(path) || [];

        if (children.length === 0) {
          node._w = 220;
          node._h = node.type === "codeElement" ? 54 : (node.type === "component" ? 64 : 60);
          return { w: node._w, h: node._h };
        }

        for (const childPath of children) {
          computeDimensions(childPath);
        }

        const cols = Math.min(2, children.length);
        const PAD_TOP = 46;
        const PAD_BOTTOM = 18;
        const PAD_LEFT = 16;
        const PAD_RIGHT = 16;
        const GAP_X = 20;
        const GAP_Y = 16;

        const rowCount = Math.ceil(children.length / cols);
        const rowHeights = new Array(rowCount).fill(0);
        const colWidths = new Array(cols).fill(0);

        for (let i = 0; i < children.length; i++) {
          const child = elementMap.get(children[i]);
          const r = Math.floor(i / cols);
          const c = i % cols;

          rowHeights[r] = Math.max(rowHeights[r], child._h);
          colWidths[c] = Math.max(colWidths[c], child._w);
        }

        for (let i = 0; i < children.length; i++) {
          const child = elementMap.get(children[i]);
          const r = Math.floor(i / cols);
          const c = i % cols;

          let relX = PAD_LEFT;

          for (let j = 0; j < c; j++) {
            relX += colWidths[j] + GAP_X;
          }

          let relY = PAD_TOP;

          for (let j = 0; j < r; j++) {
            relY += rowHeights[j] + GAP_Y;
          }

          child._relX = relX;
          child._relY = relY;
        }

        let innerW = 0;

        for (let c = 0; c < cols; c++) {
          innerW += colWidths[c];
        }

        if (cols > 1) {
          innerW += (cols - 1) * GAP_X;
        }

        let innerH = 0;

        for (let r = 0; r < rowCount; r++) {
          innerH += rowHeights[r];
        }

        if (rowCount > 1) {
          innerH += (rowCount - 1) * GAP_Y;
        }

        node._w = Math.max(260, PAD_LEFT + innerW + PAD_RIGHT);
        node._h = PAD_TOP + innerH + PAD_BOTTOM;
        return { w: node._w, h: node._h };
      }

      for (const rootPath of roots) {
        computeDimensions(rootPath);
      }

      let curX = 40;
      let curY = 40;
      let rowMaxH = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      function assignAbsoluteCoords(path, absX, absY) {
        const node = elementMap.get(path);
        node.absX = absX;
        node.absY = absY;
        mapNodeLookup.set(node.path, node);

        minX = Math.min(minX, absX);
        minY = Math.min(minY, absY);
        maxX = Math.max(maxX, absX + node._w);
        maxY = Math.max(maxY, absY + node._h);

        const children = childrenMap.get(path) || [];

        for (const childPath of children) {
          const child = elementMap.get(childPath);
          assignAbsoluteCoords(childPath, absX + child._relX, absY + child._relY);
        }
      }

      for (const rootPath of roots) {
        const rootNode = elementMap.get(rootPath);

        if (curX + rootNode._w > 1400 && curX > 40) {
          curX = 40;
          curY += rowMaxH + 50;
          rowMaxH = 0;
        }

        assignAbsoluteCoords(rootPath, curX, curY);
        curX += rootNode._w + 50;
        rowMaxH = Math.max(rowMaxH, rootNode._h);
      }

      if (minX === Infinity) {
        minX = 0;
        minY = 0;
        maxX = 800;
        maxY = 600;
      }

      mapBoundingBox = { minX, minY, maxX, maxY };
      return { elements, roots, childrenMap };
    }

    function renderSvgGraph(map, layout) {
      const { elements, childrenMap } = layout;
      let groupsSvg = "";
      let leavesSvg = "";
      let edgesSvg = "";

      for (const el of elements) {
        const children = childrenMap.get(el.path) || [];
        const isGroup = children.length > 0;
        const theme = getC4Theme(el.type);
        const diffStats = getNodeDiffStats(el);
        const hasDiff = diffStats.additions > 0 || diffStats.deletions > 0;

        let badgeSvg = "";

        if (hasDiff) {
          const addTxt = diffStats.additions > 0 ? "+" + diffStats.additions : "";
          const delTxt = diffStats.deletions > 0 ? "-" + diffStats.deletions : "";
          const txt = (addTxt + " " + delTxt).trim();
          const bw = txt.length * 6.5 + 10;
          const bx = el.absX + el._w - bw - 10;
          const by = el.absY + (isGroup ? 9 : 10);

          badgeSvg = \`
            <rect x="\${bx}" y="\${by}" width="\${bw}" height="18" rx="4" fill="rgba(46,160,67,0.25)" stroke="#3fb950" stroke-width="1" />
            <text x="\${bx + bw / 2}" y="\${by + 13}" fill="#3fb950" font-size="10" font-weight="600" text-anchor="middle" font-family="monospace">
              \${escapeHtml(txt)}
            </text>
          \`;
        }

        if (isGroup) {
          const typeBadgeW = el.type.length * 6 + 14;
          const typeBadgeX = hasDiff ? el.absX + el._w - typeBadgeW - 75 : el.absX + el._w - typeBadgeW - 10;

          groupsSvg += \`
            <g class="map-node-interactive" data-path="\${escapeHtml(el.path)}" onclick="handleNodeClick(event, \${jsArg(el.path)})">
              <rect x="\${el.absX}" y="\${el.absY}" width="\${el._w}" height="\${el._h}" rx="8" ry="8"
                    fill="\${theme.bg}" stroke="\${hasDiff ? '#3fb950' : theme.border}" stroke-width="\${hasDiff ? 2 : 1.5}" />
              <rect x="\${el.absX}" y="\${el.absY}" width="\${el._w}" height="36" rx="8" ry="8" fill="\${theme.headerBg}" />
              <rect x="\${el.absX}" y="\${el.absY + 28}" width="\${el._w}" height="8" fill="\${theme.headerBg}" />
              <text x="\${el.absX + 12}" y="\${el.absY + 22}" fill="\${theme.headerText}" font-weight="600" font-size="12" font-family="system-ui, sans-serif">
                \${theme.icon} \${escapeHtml(el.label || el.id)}
              </text>
              <rect x="\${typeBadgeX}" y="\${el.absY + 9}" width="\${typeBadgeW}" height="18" rx="4" fill="\${theme.badgeBg}" />
              <text x="\${typeBadgeX + typeBadgeW / 2}" y="\${el.absY + 22}" fill="\${theme.badgeText}" font-size="10" font-weight="600" text-anchor="middle">
                \${escapeHtml(el.type)}
              </text>
              \${badgeSvg}
            </g>
          \`;
        } else {
          let subText = el.technology || el.type;

          if (el.sourceRanges && el.sourceRanges.length > 0) {
            subText = el.sourceRanges[0].file + ":L" + el.sourceRanges[0].fromLine + "-L" + el.sourceRanges[0].toLine;
          }

          leavesSvg += \`
            <g class="map-node-interactive" data-path="\${escapeHtml(el.path)}" onclick="handleNodeClick(event, \${jsArg(el.path)})">
              <rect x="\${el.absX}" y="\${el.absY}" width="\${el._w}" height="\${el._h}" rx="6" ry="6"
                    fill="\${theme.bg}" stroke="\${hasDiff ? '#3fb950' : theme.border}" stroke-width="\${hasDiff ? 2 : 1.5}" />
              <text x="\${el.absX + 10}" y="\${el.absY + 22}" fill="#f0f6fc" font-weight="600" font-size="12" font-family="system-ui, sans-serif">
                \${theme.icon} \${escapeHtml(el.label || el.id)}
              </text>
              <text x="\${el.absX + 10}" y="\${el.absY + 40}" fill="#8b949e" font-size="11" font-family="ui-monospace, monospace">
                \${escapeHtml(subText)}
              </text>
              \${badgeSvg}
            </g>
          \`;
        }
      }

      for (const rel of (map.relationships || [])) {
        const src = mapNodeLookup.get(rel.sourcePath);
        const tgt = mapNodeLookup.get(rel.targetPath);

        if (!src || !tgt) continue;

        let startX, startY, endX, endY;

        if (tgt.absX > src.absX + src._w) {
          startX = src.absX + src._w;
          startY = src.absY + src._h / 2;
          endX = tgt.absX;
          endY = tgt.absY + tgt._h / 2;
        } else if (tgt.absX + tgt._w < src.absX) {
          startX = src.absX;
          startY = src.absY + src._h / 2;
          endX = tgt.absX + tgt._w;
          endY = tgt.absY + tgt._h / 2;
        } else if (tgt.absY > src.absY + src._h) {
          startX = src.absX + src._w / 2;
          startY = src.absY + src._h;
          endX = tgt.absX + tgt._w / 2;
          endY = tgt.absY;
        } else {
          startX = src.absX + src._w / 2;
          startY = src.absY;
          endX = tgt.absX + tgt._w / 2;
          endY = tgt.absY + tgt._h;
        }

        const dx = (endX - startX) * 0.5;
        const dy = (endY - startY) * 0.5;
        const d = "M " + startX + " " + startY + " C " + (startX + dx) + " " + startY + ", " + (endX - dx) + " " + endY + ", " + endX + " " + endY;

        let labelSvg = "";

        if (rel.label) {
          const mx = (startX + endX) / 2;
          const my = (startY + endY) / 2;
          const lw = rel.label.length * 6 + 12;

          labelSvg = \`
            <rect x="\${mx - lw / 2}" y="\${my - 9}" width="\${lw}" height="18" rx="4" fill="#161b22" stroke="#30363d" stroke-width="1" />
            <text x="\${mx}" y="\${my + 4}" fill="#8b949e" font-size="10" font-family="system-ui, sans-serif" text-anchor="middle">
              \${escapeHtml(rel.label)}
            </text>
          \`;
        }

        edgesSvg += \`
          <g class="map-edge">
            <path d="\${d}" fill="none" stroke="#484f58" stroke-width="1.8" marker-end="url(#arrowhead)" />
            \${labelSvg}
          </g>
        \`;
      }

      return \`
        <svg id="map-svg" class="map-svg" onclick="onMapCanvasClick(event)">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#6e7681" />
            </marker>
          </defs>
          <g id="map-viewport">
            <g id="map-layer-groups">\${groupsSvg}</g>
            <g id="map-layer-edges">\${edgesSvg}</g>
            <g id="map-layer-leaves">\${leavesSvg}</g>
          </g>
        </svg>
      \`;
    }

    function handleNodeClick(e, path) {
      if (dragDistance > 5) return;
      e.stopPropagation();
      selectMapNode(path);
    }

    function onMapCanvasClick(e) {
      if (dragDistance > 5) return;
      const svg = document.getElementById("map-svg");

      if (e.target === svg || e.target.id === "map-viewport") {
        selectMapNode(null);
      }
    }

    function selectMapNode(path) {
      selectedNodePath = path;
      document.querySelectorAll(".map-node-interactive").forEach(el => {
        el.classList.toggle("map-node-selected", el.getAttribute("data-path") === path);
      });
      renderInspector(path);
    }

    function renderInspector(path) {
      const panel = document.getElementById("map-inspector");

      if (!panel) return;

      if (!path || !mapNodeLookup.has(path)) {
        const elements = activeMapData ? (activeMapData.elements || []) : [];
        const relationships = activeMapData ? (activeMapData.relationships || []) : [];
        let sysCount = 0;
        let contCount = 0;
        let compCount = 0;
        let codeCount = 0;
        let diffCount = 0;

        for (const el of elements) {
          if (el.type === "softwareSystem") sysCount++;
          else if (el.type === "container") contCount++;
          else if (el.type === "component") compCount++;
          else if (el.type === "codeElement") codeCount++;

          const ds = getNodeDiffStats(el);

          if (ds.additions > 0 || ds.deletions > 0) diffCount++;
        }

        panel.innerHTML = \`
          <div style="font-weight: 600; font-size: 15px; color: #f0f6fc; margin-bottom: 8px;">
            Software Architecture Map
          </div>
          <div style="font-size: 12px; color: #8b949e; line-height: 1.5; margin-bottom: 16px;">
            Click any system, container, or component in the diagram to inspect its metadata, source file references, diff stats, and relationships.
          </div>
          <div style="border-top: 1px solid #30363d; padding-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Systems:</span> <strong style="color: #58a6ff;">\${sysCount}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Containers:</span> <strong style="color: #bc8cff;">\${contCount}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Components:</span> <strong style="color: #56d4dd;">\${compCount}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Code Elements:</span> <strong style="color: #3fb950;">\${codeCount}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Relationships:</span> <strong style="color: #f0f6fc;">\${relationships.length}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; color: #8b949e;">
              <span>Modified in Diff:</span> <strong style="color: #3fb950;">\${diffCount}</strong>
            </div>
          </div>
        \`;
        return;
      }

      const node = mapNodeLookup.get(path);
      const theme = getC4Theme(node.type);
      const diffStats = getNodeDiffStats(node);
      const relationships = activeMapData ? (activeMapData.relationships || []) : [];
      const inbound = relationships.filter(r => r.targetPath === path);
      const outbound = relationships.filter(r => r.sourcePath === path);

      panel.innerHTML = \`
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: \${theme.badgeBg}; color: \${theme.badgeText};">
            \${theme.icon} \${theme.label}
          </span>
          <button onclick="selectMapNode(null)" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px; padding: 0 4px;" title="Clear selection">&times;</button>
        </div>
        <div style="font-size: 16px; font-weight: 600; color: #f0f6fc; margin-bottom: 4px;">
          \${escapeHtml(node.label || node.id)}
        </div>
        <div style="font-family: monospace; font-size: 11px; color: #8b949e; word-break: break-all; margin-bottom: 12px;">
          \${escapeHtml(node.path)}
        </div>

        \${node.description ? \`
          <div style="font-size: 12px; color: #c9d1d9; margin-bottom: 12px; line-height: 1.4;">
            \${escapeHtml(node.description)}
          </div>
        \` : ""}

        <div style="border-top: 1px solid #30363d; padding-top: 12px; margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: 600; color: #f0f6fc; margin-bottom: 6px;">Diff Status</div>
          \${diffStats.additions > 0 || diffStats.deletions > 0 ? \`
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              \${diffStats.additions > 0 ? \`<span class="map-badge-add">+\${diffStats.additions} lines</span>\` : ""}
              \${diffStats.deletions > 0 ? \`<span class="map-badge-del">-\${diffStats.deletions} lines</span>\` : ""}
            </div>
            \${diffStats.files.length > 0 ? \`
              <button class="map-jump-btn" onclick="jumpToFileDiff(\${jsArg(diffStats.files[0])})">
                Jump to Diff &rarr;
              </button>
            \` : ""}
          \` : \`
            <div style="font-size: 12px; color: #8b949e;">No active diffs in this component.</div>
          \`}
        </div>

        \${(node.sourceRanges && node.sourceRanges.length > 0) || (node.coverage && node.coverage.files && node.coverage.files.length > 0) ? \`
          <div style="border-top: 1px solid #30363d; padding-top: 12px; margin-bottom: 12px;">
            <div style="font-size: 12px; font-weight: 600; color: #f0f6fc; margin-bottom: 6px;">Source Code</div>
            \${(node.sourceRanges || []).map(sr => \`
              <div style="font-family: monospace; font-size: 11px; margin-bottom: 4px;">
                <a href="#" onclick="jumpToFileDiff(\${jsArg(sr.file)}); return false;" style="color: #58a6ff; text-decoration: none;">
                  📄 \${escapeHtml(sr.file)}:L\${sr.fromLine}-L\${sr.toLine} &nearr;
                </a>
              </div>
            \`).join("")}
            \${(node.coverage?.files || []).map(f => {
              const filePath = typeof f === "string" ? f : (f && (f.path || f.file) ? (f.path || f.file) : "");
              if (!filePath) return "";
              return \`
                <div style="font-family: monospace; font-size: 11px; margin-bottom: 4px;">
                  <a href="#" onclick="jumpToFileDiff(\${jsArg(filePath)}); return false;" style="color: #58a6ff; text-decoration: none;">
                    📁 \${escapeHtml(filePath)} &nearr;
                  </a>
                </div>
              \`;
            }).join("")}
          </div>
        \` : ""}

        \${inbound.length > 0 || outbound.length > 0 ? \`
          <div style="border-top: 1px solid #30363d; padding-top: 12px;">
            <div style="font-size: 12px; font-weight: 600; color: #f0f6fc; margin-bottom: 6px;">Relationships</div>
            \${inbound.length > 0 ? \`
              <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">Called by:</div>
              \${inbound.map(r => \`
                <div style="font-size: 11px; margin-bottom: 4px; padding: 4px 6px; background: #0d1117; border-radius: 4px;">
                  <a href="#" onclick="selectMapNode(\${jsArg(r.sourcePath)}); return false;" style="color: #58a6ff; text-decoration: none;">
                    &larr; \${escapeHtml(r.sourcePath)}
                  </a>
                  \${r.label ? \`<span style="color: #8b949e;"> (\${escapeHtml(r.label)})</span>\` : ""}
                </div>
              \`).join("")}
            \` : ""}
            \${outbound.length > 0 ? \`
              <div style="font-size: 11px; color: #8b949e; margin-top: 6px; margin-bottom: 4px;">Calls:</div>
              \${outbound.map(r => \`
                <div style="font-size: 11px; margin-bottom: 4px; padding: 4px 6px; background: #0d1117; border-radius: 4px;">
                  <a href="#" onclick="selectMapNode(\${jsArg(r.targetPath)}); return false;" style="color: #58a6ff; text-decoration: none;">
                    &rarr; \${escapeHtml(r.targetPath)}
                  </a>
                  \${r.label ? \`<span style="color: #8b949e;"> (\${escapeHtml(r.label)})</span>\` : ""}
                </div>
              \`).join("")}
            \` : ""}
          </div>
        \` : ""}
      \`;
    }

    function setupMapPanZoom() {
      const container = document.getElementById("map-canvas-container");
      const svg = document.getElementById("map-svg");

      if (!container || !svg) return;

      container.addEventListener("mousedown", (e) => {
        dragDistance = 0;
        dragStartPos = { x: e.clientX, y: e.clientY };
        isMapPanning = true;
        mapPanStart = { x: e.clientX - mapTransform.x, y: e.clientY - mapTransform.y };
      });

      window.addEventListener("mousemove", (e) => {
        if (!isMapPanning) return;

        dragDistance = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
        mapTransform.x = e.clientX - mapPanStart.x;
        mapTransform.y = e.clientY - mapPanStart.y;
        applyMapTransform();
      });

      window.addEventListener("mouseup", () => {
        isMapPanning = false;
      });

      container.addEventListener("wheel", (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const rect = container.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const newScale = Math.max(0.1, Math.min(3.0, mapTransform.scale * factor));

        mapTransform.x = mx - (mx - mapTransform.x) * (newScale / mapTransform.scale);
        mapTransform.y = my - (my - mapTransform.y) * (newScale / mapTransform.scale);
        mapTransform.scale = newScale;
        applyMapTransform();
      }, { passive: false });

      container.addEventListener("dblclick", (e) => {
        if (e.target === svg || e.target.id === "map-viewport") {
          fitMapToView();
        }
      });
    }

    function renderOutlineView(map) {
      return \`
        <div class="map-card">
          <div style="font-weight: 600; font-size: 16px; color: #f0f6fc; margin-bottom: 4px;">
            Software Architecture Map Outline
          </div>
          <div style="font-size: 12px; color: #8b949e; margin-bottom: 16px;">
            Commit: <code style="font-family: monospace; color: #58a6ff;">\${map.commit ? map.commit.slice(0, 10) : "head"}</code>
          </div>
          <div style="border-top: 1px solid #30363d; padding-top: 12px;">
            \${(map.elements || []).map(el => {
              const diffStats = getNodeDiffStats(el);
              const hasDiff = diffStats.additions > 0 || diffStats.deletions > 0;

              return \`
                <div class="element-node">
                  <div class="element-title">
                    <span>\${escapeHtml(el.label || el.id)}</span>
                    <span class="element-type">\${escapeHtml(el.type)}</span>
                  </div>
                  <div class="element-meta">Path: \${escapeHtml(el.path)}</div>
                  \${hasDiff ? \`
                    <div style="margin-top: 4px;">
                      \${diffStats.additions > 0 ? \`<span class="map-badge-add">+\${diffStats.additions}</span> \` : ""}
                      \${diffStats.deletions > 0 ? \`<span class="map-badge-del">-\${diffStats.deletions}</span>\` : ""}
                    </div>
                  \` : ""}
                  \${el.sourceRanges ? el.sourceRanges.map(sr => \`
                    <div class="element-meta" style="color: #3fb950;">
                      &bull; Source: <a href="#" onclick="jumpToFileDiff(\${jsArg(sr.file)}); return false;" style="color: #58a6ff; text-decoration: none;">\${escapeHtml(sr.file)}:L\${sr.fromLine}-L\${sr.toLine}</a>
                    </div>
                  \`).join("") : ""}
                </div>
              \`;
            }).join("")}
          </div>
        </div>
      \`;
    }

    function renderArchitectureMap(presentation) {
      const container = document.getElementById("tab-map");

      if (!presentation || !presentation.maps) {
        container.innerHTML = '<div class="doc-section"><p style="color:#8b949e;text-align:center;padding:24px">No architecture map data available in this review.</p></div>';
        return;
      }

      const mapIds = Object.keys(presentation.maps);

      if (mapIds.length === 0) {
        container.innerHTML = '<div class="doc-section"><p style="color:#8b949e;text-align:center;padding:24px">No architecture map data available in this review.</p></div>';
        return;
      }

      document.getElementById("map-count").textContent = mapIds.length;
      const primaryMap = presentation.maps[mapIds[0]];
      activeMapData = primaryMap;

      const layout = computeMapLayout(primaryMap);
      const svgContent = renderSvgGraph(primaryMap, layout);
      const outlineContent = renderOutlineView(primaryMap);

      container.innerHTML = \`
        <div id="map-graph-view" class="map-wrapper" style="display: \${mapMode === 'graph' ? 'flex' : 'none'};">
          <div class="map-canvas-container" id="map-canvas-container">
            \${svgContent}
            <div class="map-zoom-badge" id="map-zoom-indicator">100%</div>
            <div class="map-instructions">Drag to Pan &bull; Scroll to Zoom &bull; Click Node to Inspect</div>
          </div>
          <div class="map-inspector" id="map-inspector"></div>
        </div>
        <div id="map-outline-view" style="display: \${mapMode === 'outline' ? 'block' : 'none'};">
          \${outlineContent}
        </div>
      \`;

      setupMapPanZoom();
      renderInspector(null);

      if (mapMode === "graph") {
        setTimeout(fitMapToView, 60);
      }
    }

    function renderTraces(traces) {
      const container = document.getElementById("tab-traces");
      document.getElementById("trace-count").textContent = traces.size;

      if (traces.size === 0) {
        container.innerHTML = '<div class="doc-section"><p style="color:#8b949e;text-align:center;padding:24px">No AI agent traces recorded with this review.</p></div>';
        return;
      }

      let html = "";
      for (const [id, trace] of traces) {
        html += \`
          <div class="doc-section">
            <div style="font-weight:600;font-size:16px;color:#f0f6fc;margin-bottom:4px">
              🤖 \${escapeHtml(trace.label || "Agent Conversation")}
            </div>
            <div style="font-size:12px;color:#8b949e;margin-bottom:16px">
              Provenance: \${escapeHtml(trace.provenance || "client_supplied")}
            </div>
            <div>
              \${(trace.events || []).map(ev => \`
                <div style="margin-bottom:12px;padding:12px;background:#0d1117;border-radius:6px;border:1px solid #30363d">
                  <div style="font-size:11px;font-weight:600;color:\${ev.role === 'user' ? '#79c0ff' : '#3fb950'};text-transform:uppercase;margin-bottom:4px">
                    \${escapeHtml(ev.role)}
                  </div>
                  <div style="color:#f0f6fc;font-size:13px;white-space:pre-wrap">\${escapeHtml(ev.text)}</div>
                </div>
              \`).join("")}
            </div>
          </div>
        \`;
      }
      container.innerHTML = html;
    }

    window.addEventListener("DOMContentLoaded", loadReview);
  </script>
</body>
</html>`);
  });

  return router;
}

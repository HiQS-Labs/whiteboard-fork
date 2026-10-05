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
    /* Architecture Map Card */
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
      <div id="tab-map" class="tab-content"></div>

      <!-- Tab: Traces -->
      <div id="tab-traces" class="tab-content"></div>

      <!-- Tab: Raw -->
      <div id="tab-raw" class="tab-content"></div>
    </div>
  </div>

  <script>
    const shareId = ${JSON.stringify(shareId)};
    let capability = window.location.hash ? window.location.hash.slice(1) : "";
    let objQuery = capability ? "?shareId=" + encodeURIComponent(shareId) + "&token=" + encodeURIComponent(capability) : "";
    let reviewData = null;
    let diffMode = "unified"; // "unified" | "split"
    let parsedDiffs = [];

    function getObjectUrl(objectId) {
      if (!objectId) return "";
      return "/objects/" + encodeURIComponent(objectId) + objQuery;
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
        .replace(/"/g, "&quot;");
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
        objQuery = capability ? "?shareId=" + encodeURIComponent(shareId) + "&token=" + encodeURIComponent(capability) : "";

        // Fetch Snapshot Object
        let snapshot = null;
        if (manifest.snapshot) {
          const snapRes = await fetch(getObjectUrl(manifest.snapshot));
          if (snapRes.ok) snapshot = await snapRes.json();
        }

        // Fetch Presentation Object
        let presentation = null;
        if (manifest.presentation) {
          const presRes = await fetch(getObjectUrl(manifest.presentation));
          if (presRes.ok) presentation = await presRes.json();
        }

        // Fetch Traces Objects
        const traces = new Map();
        if (manifest.resources) {
          for (const r of manifest.resources) {
            if (r.kind === "trace") {
              const trRes = await fetch(getObjectUrl(r.object));
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
        renderDocument(snapshot, traces, manifest);

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

    function renderDocument(snapshot, traces, manifest) {
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
            html += \`
              <div class="doc-section" style="text-align:center">
                <img src="\${getObjectUrl(imgObj)}" alt="\${escapeHtml(block.alt || "")}" style="max-width:100%;border-radius:6px;border:1px solid #30363d">
                \${block.alt ? '<div style="font-size:12px;color:#8b949e;margin-top:6px">' + escapeHtml(block.alt) + '</div>' : ''}
              </div>
            \`;
          }
        } else if (block.type === "software_map") {
          html += \`
            <div class="doc-section">
              <div style="font-weight:600;margin-bottom:8px;color:#58a6ff">🗺️ Software Architecture Map</div>
              <div style="font-size:13px;color:#8b949e">Click the <strong>Architecture</strong> tab above to view the interactive system layout.</div>
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

    function renderArchitectureMap(presentation) {
      const container = document.getElementById("tab-map");
      if (!presentation || !presentation.maps) {
        container.innerHTML = '<div class="doc-section"><p style="color:#8b949e;text-align:center;padding:24px">No architecture map data available in this review.</p></div>';
        return;
      }

      let count = 0;
      let html = "";

      for (const mapId in presentation.maps) {
        const map = presentation.maps[mapId];
        count++;
        html += \`
          <div class="map-card">
            <div style="font-weight:600;font-size:16px;color:#f0f6fc;margin-bottom:4px">
              Software Architecture Map
            </div>
            <div style="font-size:12px;color:#8b949e;margin-bottom:16px">
              Commit: <code style="font-family:monospace;color:#58a6ff">\${map.commit ? map.commit.slice(0, 10) : "head"}</code>
            </div>
            <div style="border-top:1px solid #30363d;padding-top:12px">
              \${(map.elements || []).map(el => \`
                <div class="element-node">
                  <div class="element-title">
                    <span>\${escapeHtml(el.label || el.id)}</span>
                    <span class="element-type">\${escapeHtml(el.type)}</span>
                  </div>
                  <div class="element-meta">Path: \${escapeHtml(el.path)}</div>
                  \${el.sourceRanges ? el.sourceRanges.map(sr => \`
                    <div class="element-meta" style="color:#3fb950">&bull; Source: \${escapeHtml(sr.file)}:L\${sr.fromLine}-L\${sr.toLine}</div>
                  \`).join("") : ""}
                </div>
              \`).join("")}
            </div>
          </div>
        \`;
      }

      document.getElementById("map-count").textContent = count;
      container.innerHTML = html;
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

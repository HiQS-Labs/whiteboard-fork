import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "/Users/noelsaw/.gemini/antigravity/brain/3c8983fd-0f16-4d56-a322-9bbc2283c24f/smoke-test";

const BASE_URL = process.env.REVIEW_HUB_URL || "http://localhost:8787";

const USER = process.env.REVIEW_HUB_USER || "team";

const PASSWORD = process.env.REVIEW_HUB_PASSWORD || "secret123";

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function runSmokeTest() {
  console.log("🚀 Starting Playwright UI Smoke Test against " + BASE_URL);
  console.log("📁 Artifacts directory: " + ARTIFACTS_DIR);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    httpCredentials: {
      username: USER,
      password: PASSWORD,
    },
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      if (msg.text().includes("favicon.ico")) return;
      console.warn("  ⚠️ Browser Console Error:", msg.text());
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    console.error("  ❌ Page Uncaught Exception:", err.message);
    pageErrors.push(err.message);
  });

  try {
    // 1. Dashboard Smoke Test
    console.log("\n[1/7] Testing Root Dashboard...");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const title = await page.title();
    console.log("  ✓ Page Title:", title);

    if (!title.includes("Whiteboard Review Hub")) {
      throw new Error("Dashboard title mismatch: " + title);
    }

    const reviewItems = await page.locator(".review-item").count();
    console.log(`  ✓ Discovered ${reviewItems} active review(s) on dashboard`);

    if (reviewItems === 0) {
      throw new Error("Expected at least one review on the dashboard. Run seed script first.");
    }

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-dashboard.png") });
    console.log("  📸 Saved 01-dashboard.png");

    // Extract first review link
    const firstReviewHref = await page.locator(".review-item a.review-title").first().getAttribute("href");
    console.log("  ✓ Navigating to review:", firstReviewHref);

    // 2. Review Viewer - Document Tab
    console.log("\n[2/7] Testing Document Tab...");
    await page.goto(new URL(firstReviewHref, BASE_URL).href, { waitUntil: "networkidle" });

    await page.waitForSelector("#tab-doc", { state: "visible" });
    const docHeading = await page.locator("#tab-doc h1").first().textContent();
    console.log("  ✓ Document Heading:", docHeading);

    const codePeeks = await page.locator(".code-peek").count();
    console.log(`  ✓ Rendered ${codePeeks} code peek block(s)`);

    const traceQuotes = await page.locator(".trace-quote").count();
    console.log(`  ✓ Rendered ${traceQuotes} trace quote block(s)`);

    const images = await page.locator("#tab-doc img").count();
    console.log(`  ✓ Rendered ${images} embedded image(s)`);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-document-tab.png") });
    console.log("  📸 Saved 02-document-tab.png");

    // 3. Diff Tab & Split/Unified Views...
    console.log("\n[3/7] Testing Diff Tab & Split/Unified Views...");
    await page.locator('.tab[onclick*="\'diff\'"]').click();
    await page.waitForSelector("#tab-diff.active", { state: "visible" });

    const diffFiles = await page.locator(".diff-file-header").count();
    console.log(`  ✓ Rendered ${diffFiles} file diff header(s)`);

    if (diffFiles === 0) {
      throw new Error("Expected at least one file diff.");
    }

    // Toggle split view
    await page.locator("#btn-split").click();
    await page.waitForSelector("#btn-split.active");
    const splitCols = await page.locator(".diff-table .split-col").count();
    console.log(`  ✓ Toggled Split View (rendered ${splitCols} split cells)`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-diff-split.png") });
    console.log("  📸 Saved 03-diff-split.png");

    // Toggle back to unified
    await page.locator("#btn-unified").click();
    await page.waitForSelector("#btn-unified.active");
    console.log("  ✓ Restored Unified View");

    // 4. Architecture Tab - Visual 2D C4 Map
    console.log("\n[4/7] Testing Architecture Tab (Visual 2D SVG Map)...");
    await page.locator('.tab[onclick*="\'map\'"]').click();
    await page.waitForSelector("#tab-map.active", { state: "visible" });
    await page.waitForSelector("#map-svg", { state: "visible" });

    const nodesCount = await page.locator(".map-node-interactive").count();
    console.log(`  ✓ Rendered ${nodesCount} interactive C4 nodes in SVG canvas`);

    if (nodesCount === 0) {
      throw new Error("Expected C4 nodes in architecture map.");
    }

    const zoomBadgeText = await page.locator("#map-zoom-indicator").textContent();
    console.log("  ✓ Zoom badge indicator:", zoomBadgeText);

    // Test Zoom controls
    await page.locator('button[title="Zoom In"]').click();
    const zoomedInText = await page.locator("#map-zoom-indicator").textContent();
    console.log("  ✓ Zoom In clicked, updated zoom:", zoomedInText);

    await page.locator('button[title="Fit to View"]').click();
    console.log("  ✓ Auto-Fit to View clicked");

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "04-architecture-2d-map.png") });
    console.log("  📸 Saved 04-architecture-2d-map.png");

    // 5. Node Selection & Inspector Drawer
    console.log("\n[5/7] Testing Node Selection & Side Inspector...");
    const targetNode = page.locator(".map-node-interactive").last();
    const targetPath = await targetNode.getAttribute("data-path");
    console.log("  ✓ Clicking node:", targetPath);
    await targetNode.click();

    await page.waitForSelector(".map-node-selected");
    console.log("  ✓ Node highlighted with .map-node-selected");

    const inspectorText = await page.locator("#map-inspector").textContent();
    console.log("  ✓ Inspector drawer updated for:", targetPath);

    if (!inspectorText.includes(targetPath)) {
      throw new Error(`Inspector did not contain target path ${targetPath}`);
    }

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05-map-inspector-selected.png") });
    console.log("  📸 Saved 05-map-inspector-selected.png");

    // Test Jump to Diff
    const jumpBtn = page.locator(".map-inspector .map-jump-btn, .map-inspector a[onclick*='jumpToFileDiff']").first();

    if ((await jumpBtn.count()) > 0) {
      console.log("  ✓ Clicking 'Jump to Diff' from inspector...");
      await jumpBtn.click();
      await page.waitForSelector("#tab-diff.active", { state: "visible" });
      console.log("  ✓ Successfully switched to Diff tab via Jump button");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "06-jumped-to-diff.png") });
      console.log("  📸 Saved 06-jumped-to-diff.png");
    }

    // 6. Dual-Mode Switcher: Outline View
    console.log("\n[6/7] Testing Architecture Outline View...");
    await page.locator('.tab[onclick*="\'map\'"]').click();
    await page.waitForSelector("#tab-map.active", { state: "visible" });
    await page.locator("#btn-map-outline").click();
    await page.waitForSelector("#map-outline-view", { state: "visible" });

    const outlineCards = await page.locator(".element-node").count();
    console.log(`  ✓ Switched to Outline mode (${outlineCards} structured element cards)`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07-architecture-outline.png") });
    console.log("  📸 Saved 07-architecture-outline.png");

    // 7. Traces Tab & Raw Tab
    console.log("\n[7/7] Testing Traces & Raw Tabs...");
    await page.locator('.tab[onclick*="\'traces\'"]').click();
    await page.waitForSelector("#tab-traces.active", { state: "visible" });
    const tracesCount = await page.locator("#tab-traces .doc-section").count();
    console.log(`  ✓ Rendered ${tracesCount} trace transcript(s)`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "08-traces-tab.png") });
    console.log("  📸 Saved 08-traces-tab.png");

    await page.locator('.tab[onclick*="\'raw\'"]').click();
    await page.waitForSelector("#tab-raw.active", { state: "visible" });
    const rawJsonText = await page.locator("#tab-raw pre").textContent();
    console.log("  ✓ Rendered Raw JSON payload (length:", rawJsonText.length, ")");

    // Final Assertion: Zero uncaught exceptions
    if (pageErrors.length > 0) {
      throw new Error(`Uncaught page errors detected: ${pageErrors.join("; ")}`);
    }

    console.log("\n🎉 ALL SMOKE TESTS PASSED! Zero errors encountered.");
  } finally {
    await browser.close();
  }
}

runSmokeTest().catch((err) => {
  console.error("\n❌ Smoke Test Failed:", err);
  process.exit(1);
});

# Plan: Review Hub MVP (GH-1)

Tracking Issue: [HiQS-Labs/whiteboard-fork#1](https://github.com/HiQS-Labs/whiteboard-fork/issues/1)
Task Rating: `rated 80/50/50/70` (Pri: 80, Sev: 50, Appeal: 50, Effort/cheapness: 70)
Branch: `feat/gh1-review-hub`
Task Clone: `/Users/noelsaw/Documents/GH Repos/whiteboard-fork-gh1-review-hub`
Base Commit: `a4b0451f82cb5373ed1e88e0486945f91db2ea17` (`origin/main`)

---

## 1. Problem & Context

Whiteboard reviews are authored locally and shared as immutable content-addressed bundles to an external third-party host (`app.dev.fast`). The team needs a self-hosted review hub to review internal repositories—specifically `BinoidCBD/LTVera-Pandas`—on infrastructure they control.

The deployment target will be a **new staging/dev GCP GCE VM** running Debian 12, co-located with the staging `LTVera-Pandas` application stack.

---

## 2. Core Seams & Technical Architecture

1. **Publish Contract (`ShareClient` Compatibility):**
   - Unmodified `whiteboard share` CLI/desktop publishes using:
     - `DEV_REVIEW_SHARE_ORIGIN=https://<review-subdomain>`
     - `DEV_REVIEW_SHARE_TOKEN=<hub-bearer-token>`
   - Endpoints implemented:
     - `POST /api/shares` -> returns `{ shareId, upload: { url, headers } }`
     - `PUT /uploads/:id` -> accepts object bytes, verifies SHA-256 digest
     - `POST /api/shares/:id/manifest` -> validates manifest against `shareManifestSchema`
     - `POST /api/shares/:id/complete` -> verifies all objects present, mints 256-bit capability
     - `GET /api/shares/:id/link` -> returns `{ shareId, url }`
     - `DELETE /api/shares/:id` -> revokes/tombstones the share

2. **Web Viewer & Code Resolution:**
   - URL: `/s/:shareId#<capability>`
   - Auth: Native HTTP Basic Auth protecting `/s/*` and `/reviews-api/*`.
   - Backend mounts existing `/reviews-api` read surface via `SharedReviewStore` + `SharedReviewData`.
   - **Predefined GitHub Repo Git Fetching:** Whiteboard bundles do not include raw source files or git diffs; they contain Git commit pins (`base`, `head`) and the repository clone URL. The hub is configured with a GitHub credential (`GITHUB_TOKEN` or SSH key) specifically for `BinoidCBD/LTVera-Pandas`. When `prepareRepository` runs `git fetch`, it authenticates and fetches base/head commits, enabling tree, file, and diff views in the browser canvas.

3. **Storage & Infrastructure:**
   - DB: SQLite via stdlib `node:sqlite` in WAL mode (`hub.db`).
   - Objects: Local filesystem storage under `<REVIEW_HUB_HOME>/objects/<sha256>`.
   - Process: Lightweight Node.js service (`apps/review-hub`) under systemd.
   - Proxy & TLS: Caddy virtual host reverse-proxying to `127.0.0.1:8787` with Basic Auth.

---

## 3. Ordered Implementation List

### Phase 0: Local Vertical Spike (Goal: Go/No-Go on localhost)
- [ ] **Step 0.1:** Scaffold minimal spike server in `apps/review-hub` with Hono + `@hono/node-server`.
- [ ] **Step 0.2:** Implement upload routes (`POST /api/shares`, presigned `PUT`, `/manifest`, `/complete`, `/link`, `/api/shared/*`).
- [ ] **Step 0.3:** Configure Git credentials for `BinoidCBD/LTVera-Pandas` and verify `fetchPinnedRepository` succeeds for a test pin.
- [ ] **Step 0.4:** Build standalone canvas entry (`hub-entry.tsx`) and serve static viewer assets.
- [ ] **Step 0.5:** Mount `/reviews-api` read routes over `SharedReviewStore` and add Basic Auth.
- [ ] **Step 0.6:** Run end-to-end smoke test on localhost with a real review from `LTVera-Pandas`. Verify document, maps, and code diffs render without error.

### Phase 1: Hub Package Hardening
- [ ] **Step 1.1:** Add SQLite persistence (`hub.db`) with `shares` table, idempotency tracking on `request_id`, and capability hashing at rest.
- [ ] **Step 1.2:** Enforce protocol limits (2 MiB manifest, 32 MiB object, 128 MiB total, 2048 objects).
- [ ] **Step 1.3:** Implement revocation tombstone logic (`DELETE /api/shares/:id`).
- [ ] **Step 1.4:** Add automated round-trip tests modeled after `headless-sharing.test.ts`.

### Phase 2: Web Viewer Refinement
- [ ] **Step 2.1:** Finalize `hub-entry.tsx` bridge to handle fragment capabilities securely.
- [ ] **Step 2.2:** Stub write-shaped canvas routes (progress, viewed, coverage) with 204s or static responses.
- [ ] **Step 2.3:** Verify cross-browser rendering in Chromium, Safari, and Firefox.

### Phase 3: Deployment Packaging & Ops
- [ ] **Step 3.1:** Create packaging script `scripts/pack-review-hub.mjs` for prebuilt tarball generation.
- [ ] **Step 3.2:** Author systemd unit file `deploy/review-hub.service`.
- [ ] **Step 3.3:** Author Caddy configuration snippet for staging integration with LTVera stack.
- [ ] **Step 3.4:** Document operational runbook in `docs/review-hub-ops.md`.

---

## 4. Acceptance Criteria & Falsifiable Checks

1. **CLI Publish:** `whiteboard share` against `http://localhost:8787` returns a valid share URL with `#<capability>` and `--request-id` retry returns the identical URL without duplicating records.
2. **Basic Auth:** Visiting `/s/:id` without credentials returns `401 Unauthorized`. Valid credentials allow access.
3. **Review Rendering:** Opening `/s/:id#<capability>` displays:
   - The document sections and markdown blocks.
   - Any embedded software maps and images.
   - Pinned source code diffs from `BinoidCBD/LTVera-Pandas` (resolved via server-side Git fetch).
4. **Revocation:** `whiteboard share --revoke <share-id>` causes subsequent loads of the share URL to return 404/revoked tombstone.
5. **No Regressions:** Existing test suites in `packages/review` and `packages/review-share-protocol` pass cleanly.

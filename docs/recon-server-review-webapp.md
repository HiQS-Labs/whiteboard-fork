# Recon Map — Server-based review web app (self-hosted share hub + web viewer)

Commit: a4b0451f (main) · Mode: grep+read (codebase-memory not installed for this repo; vendored `apps/review-desktop/code-oss` excluded) · Lanes: A (entry/call paths), B (state/data), C (contracts), D (build/ops) — all four ran, plus main-context verification of the load-bearing files.

## Subject and change class

**Subject:** an MVP server-based review web app hosted on a GCP GCE VM that reuses this repo's scripts, protocols, and components.

**Change class:** contract change + new surface — implement the *server side* of the already-published share protocol (client code exists, server does not), and host the existing canvas as a web viewer. No modification of the desktop app or core authoring stack is required for the MVP path.

## The seams — where a change here escapes this file

| Seam | Location | Crosses | Breaks if |
| --- | --- | --- | --- |
| Share publish HTTP contract | `packages/review/src/sharing/client.ts:181-277` (`POST /api/shares`, presigned PUT, `POST /api/shares/:id/manifest`, `/complete` poll, `/link`, `DELETE`) | Unmodified `whiteboard share` CLI + desktop publish flow, pointed via `DEV_REVIEW_SHARE_ORIGIN` + `DEV_REVIEW_SHARE_TOKEN` (`packages/review/src/sharing/auth.ts:5-41`) | Server response shapes drift from `@dev.fast/review-share-protocol` schemas / client expectations (412 tolerance, idempotent `requestId`, 409-on-link) |
| Share bundle format | `packages/review-share-protocol/src/index.ts:3-151` — `review-share/1`, sha256-content-addressed objects, limits (manifest 2 MiB / object 32 MiB / total 128 MiB / 2048 objects) | Published npm package `@dev.fast/review-share-protocol@0.1.2` (public registry consumers) | Manifest schema or digest-equals-ID invariant changes |
| Share link model | `packages/review-share-protocol/src/index.ts:153-176` — `<origin>/s/<shareId>#<capability>` (43-char base64url, 256-bit); anyone-with-link; revoke cuts future downloads only (`sharing/cli.ts:34`) | Link consumers (chat, tickets); desktop import trust rule (`sharing/host.ts:138-145` — recipient must be logged into the origin) | Link format or capability semantics change |
| HTTPS-only client | `packages/review/src/sharing/client.ts:104-122` — ShareClient refuses `http:` unless hostname is `localhost` | Every publisher (CLI/desktop/CI) talking to the VM | VM served over plain HTTP on a public IP |
| `/reviews-api` route table | `packages/review/src/review-api/http.ts:294-1639` (~50 routes); token auth `server/review-server-core.ts:48-112`; NDJSON `/watch` | Canvas app + CLI agents (`review-protocol/src/review-api-client.ts:78-167`, `x-review-token` header) | Route/auth changes break both consumers at once |
| Canvas runtime injection | `packages/review/app/src/desktop-entry.tsx` (vite entry, `desktop.vite.config.ts:97-101`); `bridge.config` consumed in `host/review-session.tsx:24`; `host/review-client.ts:78` falls back to `window.location.origin` | Desktop webview today; a standalone web host must provide its own `ReviewCanvasBridge` | Spike: what the bridge requires beyond `{serverUrl, reviewId, token, wasmUrl, theme}` |
| Headless server bind/auth | `packages/review/src/server/headless-host.ts:109` binds `127.0.0.1` only; per-instance 32-byte bearer token (`hono-http.ts:87-103`); CORS reflects any Origin (`hono-http.ts:51-81`, mounted globally in `review-server-core.ts:56-60`) | Anything that would expose the authoring API publicly | Exposed unmodified (reflect-any-origin CORS + single static token are not an internet auth model) |
| Storage formats | `~/.dev/review-api.db` via `node:sqlite` (`review-api/profile.ts:33`, `store.ts:404-410`); shared bundles as plain files `<home>/shared-reviews/<id>/{manifest.json, attribution.json, <objectId>}` (`sharing/import.ts:246-331, 685-705`) | Server persistence choices; multi-process WAL + `PRAGMA data_version` polling (`store.ts:414-465`) | Two writers on one profile without the file lock (`headless-host.ts:53-70`) |

## Call paths in

- **Authoring:** `cli.ts:25-41` → `cli-runner.ts:322-337` (`server start`) → `server/headless-host.ts:35-50` `runHeadlessServer` → `createWhiteboardCore` (`review-server-core.ts:130-162`) → `app.route("/reviews-api", api)` → `createReviewApi` routes. Agents reach the same API via `whiteboard api` / `whiteboard mcp` (`cli-runner.ts:949-977`; MCP registered by `packages/agent-plugins/*/.mcp.json`).
- **Publish:** `whiteboard share` (`sharing/cli.ts:13-69`) → local route `POST /sharing/publish` (`sharing/host.ts:186-316`) → `exportShare` (`sharing/export.ts:57-195`) → `ShareClient.create` → remote `POST /api/shares` + presigned uploads. Publish auth: saved login or `DEV_REVIEW_SHARE_TOKEN`.
- **View (today):** desktop `POST /sharing/import` (`sharing/host.ts:130-182`) → `ShareClient.download` → `SharedReviewStore` on disk → reads served through the *same* `/reviews-api` routes via `SharedReviewData` (`sharing/routes.ts:5-34` — "Snapshot-backed reads used by the same HTTP routes as local reviews") → canvas webview.
- **Canvas:** `desktop-entry.tsx` → `ReviewCanvasBridge.config` → session fetch with `x-review-token` (`host/review-session.tsx:56-60`) → `/reviews-api/{reviewId}{endpoint}` (`host/review-client.ts:11-28`). Proven to render in vanilla Chromium by the `.browser.test.tsx` suite (Playwright, `packages/review/app/vitest.config.ts`).

## State

- **Write path (authored docs):** single — all writes serialize through `ReviewStore.execute()` (`store.ts:246-249, 904-920`), `BEGIN IMMEDIATE` per command. Snapshots are append-only JSON rows in `versions`.
- **Read sites:** `/reviews-api` read routes (store reads + resources BLOBs); share export reads `store.read` + `store.resource`.
- **Shared bundles:** written only by the import pipeline (staging dir + atomic rename); read by `SharedReviewData` (`map()` from frozen `presentation` object, `resource()` from manifest). Pinned-commit fetches go to the *recipient's* git credentials from the GitHub `cloneUrl` (`sharing/repository.ts:50-96`) — code-bearing shares need repo access, not the server.
- **Derived state:** diff stats (`comparison_stats`), coverage (`review_coverage`) in the main DB; software maps stored as document resources (`local-data.ts:1690-1698`).

## Contracts

| Contract | Consumer | Breaking-if | Declared at |
| --- | --- | --- | --- |
| `review-share/1` manifest + object model | CLI publish, desktop import, hosted service (external) | schema/digest drift | `review-share-protocol/src/index.ts` (npm 0.1.2) |
| Share service REST (`/api/shares*`, `/api/shared/*`) | `ShareClient` | response-shape drift | `review/src/sharing/client.ts` (server side **absent from repo**) |
| Capability link `<origin>/s/:id#cap` | humans, desktop intake | format change | `review-share-protocol/src/index.ts:153-176` |
| `/reviews-api` + `x-review-token` + `/watch` NDJSON | canvas, CLI agents, MCP | route/auth drift | `review-protocol/src/contracts.ts`, `review-api/http.ts` |
| `ReviewCanvasBridge` / `ReviewRuntimeConfig` | any canvas host | bridge surface change | `review-protocol/src/contracts.ts:98`, `app/src/host/review-session.tsx` |
| Env: `DEV_REVIEW_SHARE_ORIGIN` / `TOKEN`, `DEV_REVIEW_HOME`, `DEV_REVIEW_SERVER_DIR`, `DEV_FAST_REVIEW_SERVER_*` | publishers, hosts | rename/semantic change | Lane C finding 13 |

## Build, failure and rollback today

- CLI = tsdown ESM bundle → npm tarball (`scripts/pack-review-cli.mjs`), release-gated by smoke that **proves headless Linux operation**: deletes `DISPLAY`/`WAYLAND_DISPLAY`, `whiteboard server start --json`, full authoring via `whiteboard api session_*` (`scripts/smoke-review-cli.mjs:78-199`).
- Runtime deps for a server: Node ≥24 <25 (`node:sqlite`), `hono` + `@hono/node-server`, `pino`, sharp **WASM** (no native modules needed on Linux); diffr binary optional (structural diffs only, `server/structural-diff.ts:29-51`).
- Tests: vitest; `headless-sharing.test.ts` is the executable spec for publish (idempotent retry, token isolation); `review-share-protocol` schema tests; canvas Playwright browser suite.
- Ops: **no deploy artifacts exist** (no Dockerfile/systemd/compose for any server; the only Dockerfile is e2e test infra). Net-new for GCE. Rollback on VM = redeploy previous git ref + restart; npm-side versions are immutable.
- Upstream `agent-server` branch is agent-harness work, not a web product — name is a red herring.

## Unknowns

| Unknown | Why it matters | What would settle it |
| --- | --- | --- |
| Hosted-service behaviors beyond client code (dup `requestId` semantics, 409-on-`/link` exact meaning, capability derivation, revoke tombstone) | Our server must satisfy unmodified clients | Implement to `client.ts` + `headless-sharing.test.ts` as executable spec; capture one live exchange against `app.dev.fast` (Phase 0) |
| Canvas standalone hosting surface (bridge callbacks, trusted-types/CSS scoping wrappers `desktop-trusted-types.ts`, `desktop-css-scope.ts`; whether read-mode needs any POST routes) | Decides "reuse canvas as web viewer" vs new read-only renderer | Phase 0 spike: thin standalone entry + serve a real shared bundle |
| Whether the canvas in shared/read mode calls write endpoints (viewed/coverage/activity) that `SharedReviewData` doesn't back | Viewer errors on open | Spike: mount `/reviews-api` over `SharedReviewStore`, click through, observe |
| TLS story on the GCE VM (domain vs IP) | `ShareClient` hard-refuses non-localhost HTTP; browsers need HTTPS for secure contexts | User decision (asked) |
| diffr availability on the VM | structural-diff lens availability only | `pnpm ensure:diffr` on VM in Phase 0 |

## Current-state radius, one line

Unmodified `whiteboard` CLI + desktop publish immutable content-addressed bundles to `app.dev.fast` and import them back through `SharedReviewStore`; agents author via local headless `/reviews-api` servers; the React canvas renders any review (local or shared) in a browser engine over plain HTTP+token — so an MVP server's blast radius is (a) one new implementation of the share-service contract, (b) one new host shell for the existing canvas, and (c) zero changes to the desktop app, CLI, or protocol packages.

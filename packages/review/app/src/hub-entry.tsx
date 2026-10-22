// The hub's browser entry: the same review canvas the Desktop embeds, mounted
// standalone against a published share. The shell at `/s/:shareId` loads this
// bundle; the share's readiness and review id come from `/s/:shareId/session`.
import { mountReviewCanvas } from "./desktop-entry";
import { createHubBridge } from "./hub/hub-bridge";
import { errorMessage, hubSessionStateSchema } from "./hub/hub-session";

import "./hub/hub.css";

const SESSION_POLL_MS = 1500;

// A lens or map routes its edges through libavoid; the package's exports map
// hides the wasm, so Vite bundles it by file path (as the browser tests do).
const libavoidWasmUrl = new URL(
  "../../../../node_modules/@mr_mint/elkjs-libavoid/dist/libavoid.wasm",
  import.meta.url,
).href;

declare global {
  interface Window {
    __REVIEW_HUB__?: { shareId: string; appVersion: string };
  }
}

async function main() {
  const config = window.__REVIEW_HUB__;
  const container = document.getElementById("review-hub-root");

  if (!config || !container) throw new Error("The hub shell is incomplete.");

  const handle = mountReviewCanvas(container, { kind: "loading" });

  const sessionUrl = new URL(
    `/s/${encodeURIComponent(config.shareId)}/session`,
    window.location.origin,
  );

  for (;;) {
    const response = await fetch(sessionUrl, { credentials: "same-origin" });

    if (!response.ok) {
      handle.update({
        kind: "error",
        message:
          response.status === 404
            ? "This review has been revoked or is no longer available on this hub."
            : `The hub could not open this review (${response.status}).`,
      });

      return;
    }

    const state = hubSessionStateSchema.parse(await response.json());
    document.title = state.title;

    if (state.stage === "error") {
      handle.update({ kind: "error", message: state.error });

      return;
    }

    if (state.stage === "ready") {
      const bridge = createHubBridge({
        reviewId: state.reviewId,
        version: state.version,
        wasmUrl: libavoidWasmUrl,
        appVersion: config.appVersion,
      });

      // No pinned `version`: a share is immutable, so following the live
      // stream shows the same content without the "older version" banner.
      handle.update({
        kind: "api",
        reviewId: state.reviewId,
        bridge,
        softwareMapEnabled: true,
        setTitle: (title) => {
          document.title = title;
        },
      });

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, SESSION_POLL_MS));
  }
}

void main().catch((cause: unknown) => {
  console.error(cause);
  const container = document.getElementById("review-hub-root");

  if (container) container.textContent = errorMessage(cause);
});

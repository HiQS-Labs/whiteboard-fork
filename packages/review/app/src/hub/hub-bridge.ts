import type {
  ReviewCanvasBridge,
  ReviewDiffLayout,
  ReviewSurfaceEvent,
  ReviewTheme,
} from "@dev.fast/review-protocol";

import { createWebDiffView } from "./web-diff-view";
import { createWebInlineEditors } from "./web-inline-editor";
import { createWebSourceTree } from "./web-source-tree";

export interface HubBridgeOptions {
  reviewId: string;
  version: number;
  wasmUrl: string;
  appVersion: string;
  /** The share's pinned head on GitHub, linked from the source tree panel. */
  sourceTreeUrl?: string;
}

const DIFF_LAYOUT_KEY = "review-hub:diff-layout";

/**
 * The canvas bridge for a browser tab on the hub. Requests go to the same
 * origin (the browser carries the viewer's Basic Auth), the editor and diff
 * surfaces are web fallbacks, "Source tree" browses the pinned head in a
 * panel (GitHub when it can't), and host verbs that only make sense in the Desktop (focus the window,
 * reveal a file) are acknowledged and ignored.
 */
export function createHubBridge(options: HubBridgeOptions): ReviewCanvasBridge {
  // Absolute against the bare origin: a relative URL would inherit any
  // `user:pass@` the address bar carries, which fetch refuses.
  const request: ReviewCanvasBridge["request"] = (url, init) =>
    fetch(new URL(url, window.location.origin), {
      ...init,
      credentials: "same-origin",
    });

  const surfaceListeners = new Set<(event: ReviewSurfaceEvent) => void>();
  const themeListeners = new Set<(theme: ReviewTheme) => void>();
  const layoutListeners = new Set<(layout: ReviewDiffLayout) => void>();
  const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = (): ReviewTheme => (darkScheme.matches ? "dark" : "light");

  darkScheme.addEventListener("change", () => {
    for (const listener of themeListeners) listener(theme());
  });

  let layout: ReviewDiffLayout = readLayout();

  const sources = {
    reviewId: options.reviewId,
    version: options.version,
    request: (url: string) => request(url),
  };

  const toggleSourceTree = createWebSourceTree({
    ...sources,
    sourceTreeUrl: options.sourceTreeUrl,
  });

  return {
    config: {
      serverUrl: window.location.origin,
      reviewId: options.reviewId,
      token: "",
      wasmUrl: options.wasmUrl,
      appVersion: options.appVersion,
      theme: theme(),
      host: "desktop",
    },
    inlineEditors: createWebInlineEditors(sources),
    diffView: createWebDiffView(sources),
    request,
    async post(verb) {
      switch (verb.name) {
        case "showReviewView":
          for (const listener of surfaceListeners)
            listener({ event: "showReviewView", view: verb.args.view });

          return { ok: true };
        case "authoringCapabilities":
          return { ok: true, result: {} };
        case "joinDiscord":
          window.open("https://discord.gg/wYvd2cpMQg", "_blank", "noopener");

          return { ok: true };
        case "openSourceTree":
          await toggleSourceTree();

          return { ok: true };
        default:
          // reveal, openDiff, focusWindow, captureScreenshot, openReview…:
          // Desktop-only surfaces with nothing to do here.
          return { ok: true };
      }
    },
    subscribe(listener) {
      surfaceListeners.add(listener);

      return { dispose: () => surfaceListeners.delete(listener) };
    },
    currentTheme: theme,
    onDidChangeTheme(listener) {
      themeListeners.add(listener);

      return { dispose: () => themeListeners.delete(listener) };
    },
    currentDiffLayout: () => layout,
    async setDiffLayout(next) {
      layout = next;

      try {
        window.localStorage.setItem(DIFF_LAYOUT_KEY, next);
      } catch {
        // Private mode: the choice lasts for this tab.
      }

      for (const listener of layoutListeners) listener(next);
    },
    onDidChangeDiffLayout(listener) {
      layoutListeners.add(listener);

      return { dispose: () => layoutListeners.delete(listener) };
    },
    notify({ kind, text }) {
      if (kind === "error") console.error(text);
      else console.info(text);
    },
    ready() {},
    reportDiagnostic(diagnostic) {
      (diagnostic.level === "error" ? console.error : console.warn)(
        `[${diagnostic.source}] ${diagnostic.message}`,
      );
    },
  };
}

function readLayout(): ReviewDiffLayout {
  try {
    const saved = window.localStorage.getItem(DIFF_LAYOUT_KEY);

    if (saved === "split" || saved === "unified") return saved;
  } catch {
    // Storage unavailable: fall through to the default.
  }

  return "unified";
}

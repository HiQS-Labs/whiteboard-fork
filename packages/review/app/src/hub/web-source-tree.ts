import { z } from "zod";

import {
  errorMessage,
  reviewFileBodySchema,
  reviewSourceQuery,
} from "./hub-session";
import { highlightLines, withFind } from "./web-inline-editor";

const treeEntriesSchema = z.array(
  z.object({ path: z.string(), kind: z.enum(["file", "directory"]) }),
);

export interface WebSourceTreeDeps {
  reviewId: string;
  version: number;
  request(url: string): Promise<Response>;
  /** The pinned head on GitHub: linked from the panel, and the fallback when the tree can't load. */
  sourceTreeUrl?: string;
}

/**
 * The hub's stand-in for the Desktop's source tree: a panel over the canvas
 * that browses the share's pinned head through `/reviews-api/:id/tree` and
 * `/file`. Directories load when expanded. Calling it again closes the panel.
 */
export function createWebSourceTree(deps: WebSourceTreeDeps) {
  let panel: HTMLElement | null = null;

  const api = (route: "tree" | "file", query: URLSearchParams) =>
    deps.request(
      `/reviews-api/${encodeURIComponent(deps.reviewId)}/${route}?${query}`,
    );

  const listDirectory = async (path?: string) => {
    const response = await api(
      "tree",
      reviewSourceQuery({ version: deps.version, side: "head", path }),
    );

    if (!response.ok)
      throw new Error(
        `Could not list ${path ?? "the repository"} (${response.status}).`,
      );

    return treeEntriesSchema
      .parse(await response.json())
      .sort((a, b) =>
        a.kind === b.kind
          ? a.path.localeCompare(b.path)
          : a.kind === "directory"
            ? -1
            : 1,
      );
  };

  const close = () => {
    panel?.remove();
    panel = null;
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  async function showFile(viewer: HTMLElement, path: string) {
    viewer.replaceChildren(status(`Loading ${path}…`));

    try {
      const response = await api(
        "file",
        reviewSourceQuery({
          version: deps.version,
          side: "head",
          file: path,
          binary: "describe",
        }),
      );

      if (!response.ok)
        throw new Error(`Could not read ${path} (${response.status}).`);
      const body = reviewFileBodySchema.parse(await response.json());

      if ("binary" in body) {
        viewer.replaceChildren(status(`${path} is a binary file.`));

        return;
      }

      const lines = body.text.split("\n");
      const spans = await highlightLines(lines, path);
      const pre = document.createElement("pre");
      pre.className = "hub-inline-editor__code hub-source-tree__code";

      for (const [index, line] of spans.entries()) {
        const row = document.createElement("div");
        row.className = "hub-inline-editor__line";
        const number = document.createElement("span");
        number.className = "hub-inline-editor__number";
        number.textContent = String(index + 1);
        const code = document.createElement("span");
        code.append(...withFind(line, null, document));
        row.append(number, code);
        pre.appendChild(row);
      }

      const heading = document.createElement("div");
      heading.className = "hub-source-tree__file-path";
      heading.textContent = path;
      viewer.replaceChildren(heading, pre);
    } catch (cause) {
      viewer.replaceChildren(status(errorMessage(cause)));
    }
  }

  function renderEntries(
    into: HTMLElement,
    entries: Awaited<ReturnType<typeof listDirectory>>,
    depth: number,
    viewer: HTMLElement,
  ) {
    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "hub-source-tree__item";
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.title = entry.path;

      if (entry.kind === "file") {
        row.textContent = name;
        row.addEventListener("click", () => {
          panel
            ?.querySelector(".hub-source-tree__item--active")
            ?.classList.remove("hub-source-tree__item--active");
          row.classList.add("hub-source-tree__item--active");
          void showFile(viewer, entry.path);
        });
        into.appendChild(row);
        continue;
      }

      const children = document.createElement("div");
      children.hidden = true;
      let loaded = false;
      row.textContent = `▸ ${name}`;
      row.addEventListener("click", async () => {
        children.hidden = !children.hidden;
        row.textContent = `${children.hidden ? "▸" : "▾"} ${name}`;

        if (loaded || children.hidden) return;
        loaded = true;

        try {
          renderEntries(
            children,
            await listDirectory(entry.path),
            depth + 1,
            viewer,
          );
        } catch (cause) {
          loaded = false;
          children.replaceChildren(status(errorMessage(cause)));
        }
      });
      into.append(row, children);
    }
  }

  return async function toggleSourceTree() {
    if (panel) {
      close();

      return;
    }

    let root: Awaited<ReturnType<typeof listDirectory>>;

    try {
      root = await listDirectory();
    } catch {
      // No browsable tree (no pins, or the checkout is gone): GitHub still has it.
      if (deps.sourceTreeUrl)
        window.open(deps.sourceTreeUrl, "_blank", "noopener");

      return;
    }

    panel = document.createElement("aside");
    panel.className = "hub-source-tree";
    panel.setAttribute("aria-label", "Source tree");

    const header = document.createElement("header");
    header.className = "hub-source-tree__header";
    const title = document.createElement("span");
    title.className = "hub-source-tree__title";
    title.textContent = "Source tree";
    header.appendChild(title);

    if (deps.sourceTreeUrl) {
      const github = document.createElement("a");
      github.href = deps.sourceTreeUrl;
      github.target = "_blank";
      github.rel = "noopener";
      github.textContent = "Open on GitHub ↗";
      header.appendChild(github);
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "hub-source-tree__close";
    closeButton.setAttribute("aria-label", "Close source tree");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", close);
    header.appendChild(closeButton);

    const tree = document.createElement("nav");
    tree.className = "hub-source-tree__tree";
    const viewer = document.createElement("div");
    viewer.className = "hub-source-tree__viewer";
    viewer.appendChild(status("Select a file."));
    renderEntries(tree, root, 0, viewer);

    const body = document.createElement("div");
    body.className = "hub-source-tree__body";
    body.append(tree, viewer);
    panel.append(header, body);
    // Inside the canvas root: the hub stylesheet is `@scope (.review-canvas-root)`.
    (
      document.querySelector(".review-canvas-root") ?? document.body
    ).appendChild(panel);
    document.addEventListener("keydown", onKey);
  };
}

function status(message: string) {
  const element = document.createElement("div");
  element.className = "hub-inline-editor__status";
  element.textContent = message;

  return element;
}

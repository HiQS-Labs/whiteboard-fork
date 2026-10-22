import type {
  ReviewCommitScope,
  ReviewDiffFileWire,
  ReviewDiffProgress,
  ReviewDiffViewFactory,
  ReviewDiffViewHandle,
  ReviewDiffViewSpec,
  ReviewDisposable,
} from "@dev.fast/review-protocol";

import {
  errorMessage,
  reviewDiffFileSchema,
  reviewFileBodySchema,
  reviewSourceQuery,
} from "./hub-session";

export interface WebDiffViewDeps {
  reviewId: string;
  version?: number;
  request(url: string): Promise<Response>;
}

/**
 * A browser-only stand-in for the Desktop's native multi-diff widget: lists
 * the changed files from `/reviews-api/:id/diff` and renders each file's
 * unified patch on demand.
 */
export function createWebDiffView(
  deps: WebDiffViewDeps,
): ReviewDiffViewFactory {
  const diffUrl = (query: URLSearchParams) =>
    `/reviews-api/${encodeURIComponent(deps.reviewId)}/diff?${query}`;

  const files = async (scope?: ReviewCommitScope) => {
    const response = await deps.request(
      diffUrl(
        reviewSourceQuery({
          version: deps.version,
          commit: scope?.commit,
        }),
      ),
    );

    if (!response.ok)
      throw new Error(`Could not list changed files (${response.status}).`);

    return reviewDiffFileSchema.array().parse(await response.json());
  };

  // The review API serves file contents per side, not patches: read both
  // sides and diff them here.
  const side = async (
    file: string,
    which: "base" | "head",
    scope?: ReviewCommitScope,
  ): Promise<string[]> => {
    const params = reviewSourceQuery({
      version: deps.version,
      commit: scope?.commit,
      side: which,
      file,
      binary: "describe",
    });

    const response = await deps.request(
      `/reviews-api/${encodeURIComponent(deps.reviewId)}/file?${params}`,
    );

    if (!response.ok)
      throw new Error(`Could not read ${file} (${response.status}).`);
    const body = reviewFileBodySchema.parse(await response.json());

    if ("binary" in body) throw new Error(`${file} is binary.`);
    const lines = body.text.split("\n");

    // A trailing newline is not an empty last line.
    if (lines.at(-1) === "") lines.pop();

    return lines;
  };

  const sides = async (
    file: ReviewDiffFileWire,
    scope?: ReviewCommitScope,
  ): Promise<{ base: string[]; head: string[] }> => {
    const [base, head] = await Promise.all([
      file.status === "added"
        ? []
        : side(file.previousPath ?? file.path, "base", scope),
      file.status === "deleted" ? [] : side(file.path, "head", scope),
    ]);

    return { base, head };
  };

  return {
    files,
    create: (spec) => new WebDiffView(spec, files, sides),
  };
}

class WebDiffView implements ReviewDiffViewHandle {
  private readonly root: HTMLElement;
  private readonly tree: HTMLElement | null;
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly sections = new Map<string, HTMLElement>();
  private progress?: ReviewDiffProgress;
  private disposed = false;

  constructor(
    private readonly spec: ReviewDiffViewSpec,
    list: (scope?: ReviewCommitScope) => Promise<ReviewDiffFileWire[]>,
    private readonly sides: (
      file: ReviewDiffFileWire,
      scope?: ReviewCommitScope,
    ) => Promise<{ base: string[]; head: string[] }>,
  ) {
    const doc = spec.container.ownerDocument;
    this.progress = spec.progress;
    this.root = doc.createElement("div");
    this.root.className = "hub-diff";
    this.root.tabIndex = 0;
    spec.container.appendChild(this.root);
    this.tree = spec.fileTreeContainer
      ? spec.fileTreeContainer.appendChild(doc.createElement("div"))
      : null;

    if (this.tree) this.tree.className = "hub-diff__tree";
    this.status("Loading changes…");

    void list(spec.scope)
      .then((files) => {
        if (this.disposed) return;
        this.render(this.inLens(files));
      })
      .catch((cause: unknown) => {
        if (this.disposed) return;
        const message = errorMessage(cause);
        this.status(message);

        for (const listener of this.errorListeners) listener(message);
      });
  }

  focus(): void {
    this.root.focus();
  }

  setProgress(progress: ReviewDiffProgress): void {
    this.progress = progress;

    for (const [path, section] of this.sections)
      section.classList.toggle("hub-diff__file--viewed", this.viewed(path));
  }

  revealFile(path: string): void {
    this.sections.get(path)?.scrollIntoView({ block: "start" });
  }

  onDidError(listener: (message: string) => void): ReviewDisposable {
    this.errorListeners.add(listener);

    return { dispose: () => this.errorListeners.delete(listener) };
  }

  dispose(): void {
    this.disposed = true;
    this.root.remove();
    this.tree?.remove();
  }

  /** A lens narrows the diff to the files its ranges name. */
  private inLens(files: ReviewDiffFileWire[]): ReviewDiffFileWire[] {
    const lens = this.spec.lens;

    if (!lens) return files;
    const named = new Set(lens.ranges.map((range) => range.file));

    return files.filter(
      (file) =>
        named.has(file.path) ||
        (file.previousPath !== undefined && named.has(file.previousPath)),
    );
  }

  private viewed(path: string): boolean {
    return (
      this.progress?.files.find((file) => file.path === path)?.state ===
      "viewed"
    );
  }

  private status(message: string) {
    this.root.replaceChildren();
    const status = this.root.ownerDocument.createElement("div");
    status.className = "hub-diff__status";
    status.textContent = message;
    this.root.appendChild(status);
  }

  private render(files: ReviewDiffFileWire[]) {
    const doc = this.root.ownerDocument;
    this.root.replaceChildren();
    this.tree?.replaceChildren();
    this.sections.clear();

    if (files.length === 0) {
      this.status("No changed files.");

      return;
    }

    for (const file of files) {
      const section = doc.createElement("section");
      section.className = "hub-diff__file";
      section.dataset.path = file.path;
      const header = doc.createElement("header");
      header.className = "hub-diff__header";
      const name = doc.createElement("span");
      name.className = "hub-diff__path";
      name.textContent =
        file.previousPath && file.previousPath !== file.path
          ? `${file.previousPath} → ${file.path}`
          : file.path;
      const stats = doc.createElement("span");
      stats.className = "hub-diff__stats";
      stats.textContent = file.binary
        ? "binary"
        : `+${file.additions} −${file.deletions}`;
      header.append(name, stats);

      if (this.spec.onToggleViewed) {
        const viewed = doc.createElement("label");
        viewed.className = "hub-diff__viewed";
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = this.viewed(file.path);
        box.addEventListener("change", () =>
          this.spec.onToggleViewed?.(file.path),
        );
        viewed.append(box, "Viewed");
        header.append(viewed);
      }

      const body = doc.createElement("div");
      body.className = "hub-diff__body";
      section.append(header, body);
      section.classList.toggle(
        "hub-diff__file--viewed",
        this.viewed(file.path),
      );
      this.root.appendChild(section);
      this.sections.set(file.path, section);

      if (this.tree) {
        const link = doc.createElement("a");
        link.className = "hub-diff__tree-item";
        link.href = "#";
        link.textContent = file.path;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.revealFile(file.path);
        });
        this.tree.appendChild(link);
      }

      if (file.binary) {
        body.textContent = "Binary file.";

        continue;
      }

      void this.sides(file, this.spec.scope)
        .then(({ base, head }) => {
          if (!this.disposed) renderDiff(body, base, head);
        })
        .catch((cause: unknown) => {
          body.textContent = errorMessage(cause);
        });
    }
  }
}

/** Lines beyond this are shown without a diff: the LCS table is quadratic. */
const MAX_DIFF_LINES = 4000;

type Op = { kind: "add" | "del" | "ctx"; text: string };

/** A line-level LCS diff: enough for a review's changed files. */
function diffLines(base: string[], head: string[]): Op[] {
  const n = base.length;
  const m = head.length;

  // table[i][j] = LCS length of base[i..] and head[j..]
  const table: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );

  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        base[i] === head[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (base[i] === head[j]) {
      ops.push({ kind: "ctx", text: base[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "del", text: base[i]! });
      i++;
    } else {
      ops.push({ kind: "add", text: head[j]! });
      j++;
    }
  }

  while (i < n) ops.push({ kind: "del", text: base[i++]! });

  while (j < m) ops.push({ kind: "add", text: head[j++]! });

  return ops;
}

const CONTEXT = 3;

/** Renders the changed hunks of a file with three lines of context and both
 * line numbers, like a unified patch. */
function renderDiff(into: HTMLElement, base: string[], head: string[]): void {
  const doc = into.ownerDocument;
  into.replaceChildren();

  if (base.length > MAX_DIFF_LINES || head.length > MAX_DIFF_LINES) {
    into.textContent = "This file is too large to diff in the browser.";

    return;
  }

  const ops = diffLines(base, head);
  const changed = ops.map((op) => op.kind !== "ctx");

  const shown = ops.map((_op, index) =>
    changed
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some(Boolean),
  );

  let baseLine = 1;
  let headLine = 1;
  let inHunk = false;

  for (const [index, op] of ops.entries()) {
    if (!shown[index]) {
      if (inHunk) {
        inHunk = false;
      }

      if (op.kind !== "add") baseLine++;

      if (op.kind !== "del") headLine++;

      continue;
    }

    if (!inHunk) {
      inHunk = true;
      const hunk = doc.createElement("div");
      hunk.className = "hub-diff__hunk";
      hunk.textContent = `@@ -${baseLine} +${headLine} @@`;
      into.appendChild(hunk);
    }

    const row = doc.createElement("div");
    row.className = `hub-diff__line hub-diff__line--${op.kind}`;
    const left = doc.createElement("span");
    left.className = "hub-diff__number";
    const right = doc.createElement("span");
    right.className = "hub-diff__number";
    const text = doc.createElement("span");
    text.className = "hub-diff__text";
    text.textContent = op.text;

    if (op.kind !== "add") left.textContent = String(baseLine++);

    if (op.kind !== "del") right.textContent = String(headLine++);
    row.append(left, right, text);
    into.appendChild(row);
  }

  if (ops.every((op) => op.kind === "ctx")) into.textContent = "No changes.";
}

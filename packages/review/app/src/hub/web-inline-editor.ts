import type {
  ReviewDisposable,
  ReviewFindQuery,
  ReviewInlineEditorFactory,
  ReviewInlineEditorHandle,
  ReviewInlineEditorRange,
  ReviewInlineEditorSpec,
} from "@dev.fast/review-protocol";
import { type ShjLanguage, tokenize } from "@speed-highlight/core";

import {
  errorMessage,
  reviewFileBodySchema,
  reviewSourceQuery,
} from "./hub-session";

/** Lines of surrounding context shown around each authored range. */
const CONTEXT_LINES = 3;

/** `capped` editors scroll past this many pixels. */
const CAPPED_HEIGHT = 360;

const LINE_HEIGHT = 20;

const LANGUAGE_BY_EXTENSION = new Map<string, ShjLanguage>([
  ["ts", "ts"],
  ["tsx", "ts"],
  ["mts", "ts"],
  ["cts", "ts"],
  ["js", "js"],
  ["jsx", "js"],
  ["mjs", "js"],
  ["cjs", "js"],
  ["json", "json"],
  ["css", "css"],
  ["html", "html"],
  ["md", "md"],
  ["py", "py"],
  ["rs", "rs"],
  ["go", "go"],
  ["java", "java"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["sql", "sql"],
]);

export interface WebInlineEditorDeps {
  reviewId: string;
  version?: number;
  request(url: string): Promise<Response>;
}

/**
 * A browser-only stand-in for the Desktop's Monaco inline editor: fetches the
 * pinned file over `/reviews-api/:id/file` and renders the authored ranges
 * (plus a little context) as highlighted, line-numbered text.
 */
export function createWebInlineEditors(
  deps: WebInlineEditorDeps,
): ReviewInlineEditorFactory {
  const fileText = async (
    spec: Pick<ReviewInlineEditorSpec, "path" | "side" | "pins">,
  ): Promise<string> => {
    const params = reviewSourceQuery({
      version: deps.version,
      pins: spec.pins,
      side: spec.side,
      file: spec.path,
      binary: "describe",
    });

    const response = await deps.request(
      `/reviews-api/${encodeURIComponent(deps.reviewId)}/file?${params}`,
    );

    if (!response.ok)
      throw new Error(`Could not read ${spec.path} (${response.status}).`);

    const body = reviewFileBodySchema.parse(await response.json());

    return "binary" in body
      ? "Binary file cannot be displayed as text."
      : body.text;
  };

  return {
    async find(spec, query) {
      const text = await fileText(spec);

      return { matchCount: countMatches(text, spec.ranges, query) };
    },
    create(spec) {
      return new WebInlineEditor(spec, fileText);
    },
  };
}

class WebInlineEditor implements ReviewInlineEditorHandle {
  height: number;
  private readonly root: HTMLElement;
  private readonly heightListeners = new Set<(height: number) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private text = "";
  private spans: Span[][] = [];
  private find: ReviewFindQuery | null = null;
  private disposed = false;

  constructor(
    private readonly spec: ReviewInlineEditorSpec,
    load: (spec: ReviewInlineEditorSpec) => Promise<string>,
  ) {
    this.root = spec.container.ownerDocument.createElement("div");
    this.root.className = "hub-inline-editor";
    this.root.dataset.path = spec.path;
    this.root.dataset.side = spec.side;
    this.root.tabIndex = 0;
    this.root.addEventListener("focus", () => spec.onDidFocus?.());
    spec.container.appendChild(this.root);
    this.height = Math.min(
      CAPPED_HEIGHT,
      LINE_HEIGHT *
        (visibleLines(spec.ranges, Number.MAX_SAFE_INTEGER).length + 1),
    );
    this.renderStatus("Loading…");

    void load(spec)
      .then(async (text) => {
        const spans = await highlightLines(text.split("\n"), spec.path);

        if (this.disposed) return;
        this.text = text;
        this.spans = spans;
        this.render();
      })
      .catch((cause: unknown) => {
        if (this.disposed) return;
        const message = errorMessage(cause);
        this.renderStatus(message);

        for (const listener of this.errorListeners) listener(message);
      });
  }

  setActive(active: boolean): void {
    this.root.classList.toggle("hub-inline-editor--active", active);
  }

  setCollapsed(collapsed: boolean): void {
    this.root.hidden = collapsed;
  }

  onDidChangeHeight(listener: (height: number) => void): ReviewDisposable {
    this.heightListeners.add(listener);

    return { dispose: () => this.heightListeners.delete(listener) };
  }

  onDidError(listener: (message: string) => void): ReviewDisposable {
    this.errorListeners.add(listener);

    return { dispose: () => this.errorListeners.delete(listener) };
  }

  async setFindQuery(query: ReviewFindQuery) {
    this.find = query;
    this.render();

    return { matchCount: countMatches(this.text, this.spec.ranges, query) };
  }

  revealFindMatch(index: number): void {
    const match = this.root.querySelectorAll("mark")[index];
    match?.scrollIntoView({ block: "nearest" });
  }

  clearActiveFindMatch(): void {}

  clearFind(): void {
    this.find = null;
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.root.remove();
  }

  private renderStatus(message: string) {
    this.root.replaceChildren();
    const status = this.root.ownerDocument.createElement("div");
    status.className = "hub-inline-editor__status";
    status.textContent = message;
    this.root.appendChild(status);
  }

  private render() {
    const doc = this.root.ownerDocument;
    const lines = this.text.split("\n");
    const shown = visibleLines(this.spec.ranges, lines.length);
    const pre = doc.createElement("pre");
    pre.className = "hub-inline-editor__code";

    if (this.spec.heightMode === "capped")
      pre.style.maxHeight = `${CAPPED_HEIGHT}px`;
    let previous = 0;

    for (const line of shown) {
      if (previous && line > previous + 1) {
        const gap = doc.createElement("div");
        gap.className = "hub-inline-editor__gap";
        gap.textContent = `⋯ ${line - previous - 1} lines`;
        pre.appendChild(gap);
      }

      previous = line;
      const row = doc.createElement("div");
      row.className = "hub-inline-editor__line";

      if (inAuthoredRange(this.spec.ranges, line))
        row.classList.add("hub-inline-editor__line--authored");
      const number = doc.createElement("span");
      number.className = "hub-inline-editor__number";
      number.textContent = String(line);
      const code = doc.createElement("span");
      code.className = "hub-inline-editor__text";
      code.append(...withFind(this.spans[line - 1] ?? [], this.find, doc));
      row.append(number, code);
      pre.appendChild(row);
    }

    this.root.replaceChildren(pre);

    const next =
      this.spec.heightMode === "capped"
        ? Math.min(CAPPED_HEIGHT, pre.scrollHeight)
        : pre.scrollHeight;

    if (next && next !== this.height) {
      this.height = next;

      for (const listener of this.heightListeners) listener(next);
    }
  }
}

function visibleLines(
  ranges: readonly ReviewInlineEditorRange[],
  total: number,
): number[] {
  const lines = new Set<number>();

  for (const range of ranges)
    for (
      let line = Math.max(1, range.startLine - CONTEXT_LINES);
      line <= Math.min(total, range.endLine + CONTEXT_LINES);
      line++
    )
      lines.add(line);

  return [...lines].sort((a, b) => a - b);
}

function inAuthoredRange(
  ranges: readonly ReviewInlineEditorRange[],
  line: number,
): boolean {
  return ranges.some(
    (range) => line >= range.startLine && line <= range.endLine,
  );
}

function countMatches(
  text: string,
  ranges: readonly ReviewInlineEditorRange[],
  query: ReviewFindQuery,
): number {
  const pattern = findPattern(query);

  if (!pattern) return 0;
  const lines = text.split("\n");
  let count = 0;

  for (const line of visibleLines(ranges, lines.length))
    count += (lines[line - 1] ?? "").match(pattern)?.length ?? 0;

  return count;
}

function findPattern(query: ReviewFindQuery): RegExp | null {
  if (!query.text) return null;

  try {
    const source = query.isRegex
      ? query.text
      : query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(
      query.wholeWord ? `\\b${source}\\b` : source,
      query.matchCase ? "g" : "gi",
    );
  } catch {
    return null;
  }
}

type Span = { text: string; type?: string };

/** Tokenizes the whole file once, then splits the tokens back into lines so
 * multi-line tokens (block comments, template strings) keep their colour. */
async function highlightLines(
  lines: string[],
  path: string,
): Promise<Span[][]> {
  const plain = () => lines.map((line) => [{ text: line }]);

  const language = LANGUAGE_BY_EXTENSION.get(
    path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
  );

  if (!language) return plain();
  const result: Span[][] = lines.map(() => []);
  let lineIndex = 0;

  try {
    await tokenize(lines.join("\n"), language, (text, type) => {
      for (const [partIndex, part] of text.split("\n").entries()) {
        if (partIndex > 0) lineIndex++;

        if (part && result[lineIndex])
          result[lineIndex].push({ text: part, type });
      }
    });
  } catch {
    return plain();
  }

  return result;
}

function withFind(
  spans: Span[],
  find: ReviewFindQuery | null,
  doc: Document,
): Node[] {
  const pattern = find ? findPattern(find) : null;
  const nodes: Node[] = [];

  for (const span of spans) {
    const node = span.type
      ? Object.assign(doc.createElement("span"), {
          className: `shj-syn-${span.type}`,
        })
      : doc.createDocumentFragment();

    if (!pattern) {
      node.textContent = span.text;
    } else {
      let last = 0;

      for (const match of span.text.matchAll(pattern)) {
        node.append(span.text.slice(last, match.index));
        const mark = doc.createElement("mark");
        mark.textContent = match[0];
        node.append(mark);
        last = match.index + match[0].length;

        if (!match[0]) break;
      }

      node.append(span.text.slice(last));
    }

    nodes.push(node);
  }

  return nodes;
}

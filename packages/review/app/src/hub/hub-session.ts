import type {
  ReviewDiffSide,
  ReviewSourcePins,
} from "@dev.fast/review-protocol";
import { z } from "zod";

/** What the hub shell hands the canvas before it mounts. */
export interface HubViewerConfig {
  shareId: string;
  reviewId: string;
  /** The immutable version the share was published at. */
  version: number;
  title: string;
  appVersion: string;
}

/** The hub's answer to `GET /s/:shareId/session`. */
export const hubSessionStateSchema = z.discriminatedUnion("stage", [
  z.object({
    stage: z.literal("ready"),
    reviewId: z.string(),
    version: z.number(),
    title: z.string(),
  }),
  z.object({
    stage: z.literal("pending"),
    reviewId: z.string(),
    title: z.string(),
    detail: z.string(),
  }),
  z.object({
    stage: z.literal("error"),
    reviewId: z.string(),
    title: z.string(),
    error: z.string(),
  }),
]);

export type HubSessionState = z.infer<typeof hubSessionStateSchema>;

/** `{ text }` for a text file, `{ binary: true }` for one the API will not render. */
export const reviewFileBodySchema = z.union([
  z.object({ text: z.string() }),
  z.object({ binary: z.literal(true) }),
]);

/** Mirrors the protocol's diff file summary (its schema is not exported). */
export const reviewDiffFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(["added", "modified", "deleted", "renamed", "unchanged"]),
  additions: z.number(),
  deletions: z.number(),
  binary: z.literal(true).optional(),
  patch: z.string().optional(),
});

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** The query the review API's source routes read, without undefined values. */
export function reviewSourceQuery(input: {
  version?: number;
  commit?: string;
  pins?: ReviewSourcePins;
  side?: ReviewDiffSide;
  file?: string;
  path?: string;
  binary?: "describe";
}): URLSearchParams {
  const entries: Array<[string, string | number | undefined]> = [
    ["version", input.version],
    ["commit", input.commit],
    ["repositoryId", input.pins?.repositoryId],
    ["base", input.pins?.base],
    ["head", input.pins?.head],
    ["side", input.side],
    ["file", input.file],
    ["path", input.path],
    ["binary", input.binary],
  ];

  const query = new URLSearchParams();

  for (const [key, value] of entries)
    if (value !== undefined) query.set(key, String(value));

  return query;
}

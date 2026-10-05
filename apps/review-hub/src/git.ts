import type { Pins } from "@review/review-api/document.js";
import { fetchPinnedRepository } from "@review/sharing/repository.js";

export function createHubGitFetcher(githubToken?: string) {
  return async function hubFetchRepository(
    root: string,
    url: string,
    pins: Pick<Pins, "base" | "head">,
    publishing = false,
  ) {
    let targetUrl = url;

    // Inject GitHub PAT if available and target is an HTTPS GitHub repo
    if (githubToken && targetUrl.startsWith("https://github.com/")) {
      const rest = targetUrl.slice("https://github.com/".length);
      targetUrl = `https://x-access-token:${githubToken}@github.com/${rest}`;
    }

    return fetchPinnedRepository(root, targetUrl, pins, publishing);
  };
}

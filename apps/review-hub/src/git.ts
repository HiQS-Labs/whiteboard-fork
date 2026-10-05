import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Pins } from "@review/review-api/document.js";
import { fetchPinnedRepository } from "@review/sharing/repository.js";

export function createHubGitFetcher(githubToken?: string) {
  return async function hubFetchRepository(
    root: string,
    url: string,
    pins: Pick<Pins, "base" | "head">,
    publishing = false,
  ) {
    if (!githubToken || !url.startsWith("https://github.com/")) {
      return fetchPinnedRepository(root, url, pins, publishing);
    }

    const askpassPath = path.join(tmpdir(), `git-askpass-${randomUUID()}.sh`);
    const escapedToken = githubToken.replace(/"/g, '\\"');
    const script = `#!/bin/sh\ncase "$1" in\n  *Username*) echo "x-access-token" ;;\n  *) echo "${escapedToken}" ;;\nesac\n`;

    writeFileSync(askpassPath, script, { mode: 0o700 });

    const prevAskpass = process.env.GIT_ASKPASS;

    process.env.GIT_ASKPASS = askpassPath;

    try {
      return await fetchPinnedRepository(root, url, pins, publishing);
    } finally {
      if (prevAskpass !== undefined) {
        process.env.GIT_ASKPASS = prevAskpass;
      } else {
        delete process.env.GIT_ASKPASS;
      }

      try {
        rmSync(askpassPath, { force: true });
      } catch {}
    }
  };
}

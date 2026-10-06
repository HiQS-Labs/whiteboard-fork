import { createReviewApi } from "@review/review-api/http.js";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import type { SharedReviewStore } from "@review/sharing/import.js";
import { Hono } from "hono";

import { basicAuthMiddleware } from "../auth.js";

interface ReviewsApiDeps {
  reviewDbPath: string;
  sharedStore: SharedReviewStore;
  auth?: {
    username?: string;
    password?: string;
  };
}

export function createReviewsApiRouter(deps: ReviewsApiDeps) {
  const router = new Hono();

  // Basic auth guard for viewer (rejects with 503 if credentials are incomplete)
  if (
    (deps.auth?.username && !deps.auth?.password) ||
    (!deps.auth?.username && deps.auth?.password)
  ) {
    router.use("*", async (c) =>
      c.text("Authentication configuration incomplete", 503),
    );
  } else if (deps.auth?.username && deps.auth?.password) {
    router.use(
      "*",
      basicAuthMiddleware(deps.auth.username, deps.auth.password),
    );
  }

  // Open the local store and data context
  const local = openLocalReviewStore(deps.reviewDbPath);
  deps.sharedStore.connect(local.store, local.data);

  // Mount existing review API with shared store
  const api = createReviewApi(
    local.store,
    local.data,
    undefined,
    deps.sharedStore,
  );

  router.route("/", api);

  return {
    router,
    close: () => {
      local.store.close();
      local.data.close();
    },
  };
}

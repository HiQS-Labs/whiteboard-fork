import { createHash } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";

export function hashCapability(capability: string): string {
  return createHash("sha256").update(capability).digest("hex");
}

export function publisherAuth(hubToken?: string): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!hubToken) {
      // If no token is configured, allow all publisher requests (dev mode)
      return next();
    }

    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Missing publisher bearer token.",
          },
        },
        401,
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();

    if (token !== hubToken) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Invalid publisher token." } },
        403,
      );
    }

    return next();
  };
}

export function basicAuthMiddleware(
  username?: string,
  password?: string,
): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!username || !password) {
      return next();
    }

    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="Review Hub"');

      return c.text("Unauthorized", 401);
    }

    const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
      "utf-8",
    );

    const [user, pass] = credentials.split(":");

    if (user !== username || pass !== password) {
      c.header("WWW-Authenticate", 'Basic realm="Review Hub"');

      return c.text("Unauthorized", 401);
    }

    return next();
  };
}

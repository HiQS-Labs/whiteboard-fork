import { createHash, timingSafeEqual } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";

export function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();

  return timingSafeEqual(hashA, hashB);
}

export function hashCapability(capability: string): string {
  return createHash("sha256").update(capability).digest("hex");
}

export function publisherAuth(
  hubToken?: string,
  devMode = false,
): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!hubToken) {
      if (devMode || process.env.NODE_ENV === "development") {
        return next();
      }

      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Publisher authentication not configured on review hub.",
          },
        },
        401,
      );
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

    if (!constantTimeEqual(token, hubToken)) {
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
    if ((username && !password) || (!username && password)) {
      return c.text("Authentication configuration incomplete", 503);
    }

    if (!username && !password) {
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

    const colonIndex = credentials.indexOf(":");

    if (colonIndex === -1) {
      c.header("WWW-Authenticate", 'Basic realm="Review Hub"');

      return c.text("Unauthorized", 401);
    }

    const user = credentials.slice(0, colonIndex);
    const pass = credentials.slice(colonIndex + 1);

    if (
      !constantTimeEqual(user, username!) ||
      !constantTimeEqual(pass, password!)
    ) {
      c.header("WWW-Authenticate", 'Basic realm="Review Hub"');

      return c.text("Unauthorized", 401);
    }

    return next();
  };
}

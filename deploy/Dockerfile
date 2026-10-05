# Multi-stage build for Review Hub
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

# Copy repo configuration and manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .oxlintrc.json ./
COPY packages/ ./packages/
COPY apps/review-hub/ ./apps/review-hub/

# Install dependencies and build review-hub
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dev.fast/review build:workspace-deps
RUN pnpm --filter @dev.fast/review-hub build

# Production runtime stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install git (required by SharedReviewStore to fetch commit diffs) and ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy built application and workspace packages
COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml /build/tsconfig.base.json ./
COPY --from=builder /build/packages/ ./packages/
COPY --from=builder /build/apps/review-hub/ ./apps/review-hub/

# Install production dependencies
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate && \
    pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV REVIEW_HUB_PORT=8787
ENV REVIEW_HUB_HOST=0.0.0.0
ENV REVIEW_HUB_HOME=/data
ENV REVIEW_HUB_ORIGIN=http://localhost:8787

VOLUME ["/data"]
EXPOSE 8787

WORKDIR /app/apps/review-hub
CMD ["node", "dist/server.mjs"]

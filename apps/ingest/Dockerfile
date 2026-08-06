# Built from the repo root so the pnpm workspace (and the shared packages the
# service imports) is available:  docker build -f apps/ingest/Dockerfile .
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/ingest ./apps/ingest

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rtanalytics/ingest... build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

USER node
CMD ["node", "apps/ingest/dist/server.js"]

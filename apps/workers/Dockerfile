# Build from the repo root: docker build -f apps/workers/Dockerfile .
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/workers ./apps/workers

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rtanalytics/workers... build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

USER node
CMD ["node", "apps/workers/dist/persist-worker.js"]

# Build from the repo root: docker build -f apps/dashboard-api/Dockerfile .
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard-api ./apps/dashboard-api

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rtanalytics/dashboard-api... build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo ./

USER node
CMD ["node", "apps/dashboard-api/dist/server.js"]

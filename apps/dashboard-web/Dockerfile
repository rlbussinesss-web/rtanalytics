# Build from the repo root: docker build -f apps/dashboard-web/Dockerfile .
#
# This image serves two things: the dashboard SPA, and the tracker script at
# /tracker.js — so the snippet customers paste into their site has a single
# stable public URL on the same host as the dashboard.
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard-web ./apps/dashboard-web
COPY apps/tracker ./apps/tracker

RUN pnpm install --frozen-lockfile

# Vite inlines these at build time, so they must be present in the build step
# (not at runtime) — Railway passes them as build args.
ARG VITE_DASHBOARD_API_URL
ARG VITE_DASHBOARD_API_WS_URL
ARG VITE_SITE_ID
ENV VITE_DASHBOARD_API_URL=$VITE_DASHBOARD_API_URL \
    VITE_DASHBOARD_API_WS_URL=$VITE_DASHBOARD_API_WS_URL \
    VITE_SITE_ID=$VITE_SITE_ID

RUN pnpm --filter @rtanalytics/tracker build
RUN pnpm --filter @rtanalytics/dashboard-web build

FROM nginx:alpine AS runtime
COPY --from=builder /repo/apps/dashboard-web/dist /usr/share/nginx/html
COPY --from=builder /repo/apps/tracker/dist/tracker.js /usr/share/nginx/html/tracker.js
COPY apps/dashboard-web/nginx.conf.template /etc/nginx/templates/default.conf.template

# nginx:alpine substitutes ${PORT} into the template on startup, which is how
# the container binds to whatever port the platform assigns.
ENV PORT=8080
EXPOSE 8080

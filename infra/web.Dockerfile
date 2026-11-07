# Front statique servi par Caddy, qui relaie aussi /api vers le conteneur de l'API.
#   docker build -f infra/web.Dockerfile .
ARG NODE_IMAGE=node:22-alpine
ARG CADDY_IMAGE=caddy:2.10-alpine
FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@examforge/web..."
RUN pnpm --filter "@examforge/web..." run build

FROM ${CADDY_IMAGE}
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80

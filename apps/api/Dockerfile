# Image de l'API. À construire depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile .
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@examforge/api..."
RUN pnpm --filter "@examforge/api..." run build
# Bundle autonome : dépendances de production + paquets du monorepo déjà compilés.
RUN pnpm --filter @examforge/api deploy --prod --legacy /out

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]

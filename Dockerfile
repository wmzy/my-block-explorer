# my-block-explorer — container images
#
# Two build targets:
#   docker build --target api .   → Node 22 API server (Hono + DuckDB), port 8201
#   docker build --target web .   → nginx serving the built SPA, port 80
#
# The SPA never proxies API traffic: browsers talk to the API directly (see
# docs/DEPLOYMENT.md — "Ports and service discovery"). The web image is
# therefore chain- and API-agnostic static hosting.

# ----------------------------------------------------------------- base --
FROM node:22-slim AS node-base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm version that produced pnpm-lock.yaml (lockfileVersion 9.0)
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# ------------------------------------------------- api: build the server --
FROM node-base AS api-build
# Toolchain for native postinstall scripts (better-sqlite3 runs node-gyp;
# the DuckDB bindings ship prebuilt binaries). Builder-only — the runtime
# stage copies the installed node_modules artifacts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:server

# ------------------------------------------ api: production dependencies --
FROM node-base AS api-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --------------------------------------------------------- api: runtime --
FROM node:22-slim AS api
ENV NODE_ENV=production \
    PORT=8201
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-build /app/dist/server ./dist/server
# Boot-time auto-migration reads ./drizzle/*.sql relative to the working dir
COPY drizzle ./drizzle
# DuckDB files live here (main DB + per-chain event DBs); bind-mount it
VOLUME /app/data
EXPOSE 8201
# node:22-slim ships no curl/wget — use Node's global fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT ?? 8201)+'/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["node", "dist/server/cli.js"]
# --no-open: there is no browser to launch inside a container (overridable)
CMD ["--no-open"]

# ------------------------------------------------ web: build the client --
FROM node-base AS web-build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:client

# --------------------------------------------------------- web: runtime --
FROM nginx:alpine AS web
COPY --from=web-build /app/dist/client /usr/share/nginx/html
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # Vite emits content-hashed filenames under /assets/
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # SPA fallback: client-side routes resolve to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX
EXPOSE 80

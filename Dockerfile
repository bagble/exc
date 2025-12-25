## Builder stage (Debian) - install build deps and build the app
FROM node:20-bullseye-slim AS builder
WORKDIR /usr/src/app

# Build-time dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    postgresql-client \
    python3 \
    python3-dev \
    build-essential \
    make \
    g++ \
    pkg-config \
    libssl-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --prefer-offline; else npm install --no-audit --prefer-offline; fi

# Copy source and build
COPY . .
## Provide safe build-time defaults for env vars referenced during build
ENV POSTGRESQL_HOST=127.0.0.1
ENV POSTGRESQL_PORT=5432
ENV POSTGRESQL_USER=postgres
ENV POSTGRESQL_PASSWORD=postgres
ENV POSTGRESQL_NAME=excdb
ENV POSTGRESQL_SSL=disable
ENV SALT='super-secret-salt-at-least-32-characters-long-0000'
ENV SERVER_KEY='super-secret-server-key-000000000000'

RUN npm run prepare || true
RUN npm run build

## Final stage (Alpine) - smaller runtime
FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

# Minimal runtime packages and tools for drizzle / postgres client
RUN apk add --no-cache ca-certificates libstdc++ postgresql-client python3

# Copy package manifests to install production deps in alpine
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./

# Install production deps (fallback to npm install if lock missing)
# Use a build deps layer that we remove afterwards to keep the image small
RUN apk add --no-cache --virtual .build-deps make g++ openssl-dev libffi \
  && if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --production --no-audit --no-fund; fi \
  && npm cache clean --force \
  && apk del .build-deps

# Install drizzle-kit, drizzle-orm, and typescript locally (needed for migrations and schema loading)
# Install these packages explicitly to ensure they're available at runtime
RUN npm install drizzle-kit drizzle-orm typescript --no-audit --no-fund --save

# Copy built app and entrypoint
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /usr/src/app/.env.example ./.env.example
# Ensure exchanges (configuration) is available at runtime
COPY --from=builder /usr/src/app/exchanges ./exchanges
# Include schema files needed by drizzle at runtime
COPY --from=builder /usr/src/app/src/lib/server/postgresql ./src/lib/server/postgresql

RUN chmod +x /usr/src/app/docker-entrypoint.sh || true
# Allow the node user to write generated files (e.g., drizzle.config.json) under /usr/src/app
RUN chown -R node:node /usr/src/app

EXPOSE 8000

# Ensure logs dir exists and writable
RUN mkdir -p /usr/src/app/logs && chown -R node:node /usr/src/app/logs

USER node

ENTRYPOINT ["/usr/src/app/docker-entrypoint.sh"]
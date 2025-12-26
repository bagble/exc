# Builder stage
FROM node:25.2.1-alpine AS builder
WORKDIR /usr/src/app

RUN apk add --no-cache \
    ca-certificates \
    postgresql-client \
    python3 \
    make \
    g++ \
    gcc \
    musl-dev \
    openssl-dev \
    pkgconfig

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --no-audit --prefer-offline; \
    else npm install --no-audit --prefer-offline; fi

COPY . .

ENV POSTGRESQL_HOST=127.0.0.1
ENV POSTGRESQL_PORT=5432
ENV POSTGRESQL_USER=postgres
ENV POSTGRESQL_PASSWORD=postgres
ENV POSTGRESQL_NAME=excdb
ENV POSTGRESQL_SSL=disable
ENV SALT='super-secret-salt-at-least-32-characters-long-0000'
ENV SERVER_KEY='super-secret-server-key-000000000000'

ENV NODE_ENV=production
RUN npm run prepare || true
RUN npm run build

## Runtime stage
FROM node:25.2.1-alpine AS runtime
WORKDIR /usr/src/app

RUN apk add --no-cache \
    ca-certificates \
    libstdc++ \
    postgresql-client \
    su-exec

COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./

# Install production deps
RUN apk add --no-cache --virtual .build-deps make g++ gcc musl-dev openssl-dev python3 \
  && if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
     else npm install --production --no-audit --no-fund; fi \
  && npm cache clean --force \
  && apk del .build-deps

RUN npm install drizzle-kit@0.31.8 --save-prod

COPY --from=builder --chown=node:node /usr/src/app/build ./build
COPY --from=builder --chown=node:node /usr/src/app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder --chown=node:node /usr/src/app/.env.example ./.env.example
COPY --from=builder --chown=node:node /usr/src/app/exchanges ./exchanges
COPY --from=builder --chown=node:node /usr/src/app/src/lib/server/postgresql ./src/lib/server/postgresql

RUN chmod +x /usr/src/app/docker-entrypoint.sh

EXPOSE 8000

RUN mkdir -p /usr/src/app/logs && chown -R node:node /usr/src/app/logs

ENTRYPOINT ["/usr/src/app/docker-entrypoint.sh"]
CMD ["node", "build"]

#!/bin/sh
set -e

echo "Waiting for Postgres at ${POSTGRESQL_HOST:-postgres}:${POSTGRESQL_PORT:-5432}..."
until pg_isready -h "${POSTGRESQL_HOST:-postgres}" -p "${POSTGRESQL_PORT:-5432}" -U "${POSTGRESQL_USER:-postgres}" >/dev/null 2>&1; do
  sleep 1
done

echo "Postgres is available. Preparing drizzle config and running drizzle push (auto-confirm)..."
# Create a drizzle.config.json from env vars if it doesn't exist
CONFIG_PATH="${DRIZZLE_CONFIG_PATH:-/usr/src/app/drizzle.config.json}"
CONFIG_DIR=$(dirname "$CONFIG_PATH")
if [ ! -w "$CONFIG_DIR" ]; then
  echo "Config directory $CONFIG_DIR not writable; falling back to /tmp/drizzle.config.json"
  CONFIG_PATH="/tmp/drizzle.config.json"
  CONFIG_DIR="/tmp"
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Generating $CONFIG_PATH from environment variables..."
  ENC_PW=$(node -e "console.log(encodeURIComponent(process.env.POSTGRESQL_PASSWORD||''))")
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_PATH" <<JSON
{
  "schema": "src/lib/server/postgresql/schemas.ts",
  "out": "./drizzle",
  "dialect": "postgresql",
  "dbCredentials": {
    "url": "postgres://${POSTGRESQL_USER}:${ENC_PW}@${POSTGRESQL_HOST}:${POSTGRESQL_PORT}/${POSTGRESQL_NAME}?sslmode=${POSTGRESQL_SSL:-disable}"
  },
  "verbose": true,
  "strict": true
}
JSON
  echo "Created $CONFIG_PATH"
fi
# Warn if exchanges config missing
if [ ! -f /usr/src/app/exchanges/EXC.json ]; then
  echo "Warning: /usr/src/app/exchanges/EXC.json not found in image. Mount your exchanges directory or include it in the image to avoid runtime errors."
fi

# Run drizzle push using npx (which uses local node_modules)
echo "Running drizzle-kit push..."
npx drizzle-kit push --force --config "$CONFIG_PATH" || {
  echo "Warning: drizzle-kit push failed; continuing startup..."
}

echo "Starting app..."
exec node build/index.js

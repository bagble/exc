#!/bin/sh
set -e

# Root 권한으로 실행 중이면 볼륨 권한 수정 후 node 유저로 전환
if [ "$(id -u)" = "0" ]; then
  echo "Running as root, fixing volume permissions..."
  
  # 디렉토리가 존재하고 마운트되어 있을 때만 chown 실행
  if [ -d /usr/src/app/logs ]; then
    echo "Fixing permissions for /usr/src/app/logs"
    chown -R node:node /usr/src/app/logs 2>/dev/null || echo "Could not change ownership of logs"
  fi
  
  if [ -d /var/lib/postgresql/data ]; then
    echo "Fixing permissions for /var/lib/postgresql/data"
    chown -R node:node /var/lib/postgresql/data 2>/dev/null || echo "Could not change ownership of pgdata"
  fi
  
  if [ -d /data/redis ]; then
    echo "Fixing permissions for /data/redis"
    chown -R node:node /data/redis 2>/dev/null || echo "Could not change ownership of redis-data"
  fi
  
  # /usr/src/app 권한 수정
  echo "Fixing permissions for /usr/src/app"
  chown -R node:node /usr/src/app 2>/dev/null || echo "Could not change ownership of /usr/src/app"
  
  echo "Switching to node user with su-exec..."
  
  # su-exec 확인 및 실행
  if command -v su-exec >/dev/null 2>&1; then
    exec su-exec node "$0" "$@"
  else
    echo "ERROR: su-exec not found! Falling back to su"
    exec su node -c "exec $0 $@"
  fi
fi

# 이하 node 유저로 실행
echo "Running as $(whoami) (UID: $(id -u))"

# EXC.json 자동 다운로드
EXC_FILE="/usr/src/app/exchanges/EXC.json"
DEFAULT_EXC_URL="https://raw.githubusercontent.com/bagble/runner/refs/heads/main/exchanges/EXC.json"

if [ ! -f "$EXC_FILE" ]; then
  echo "EXC.json not found. Downloading from GitHub..."
  mkdir -p /usr/src/app/exchanges
  
  EXC_URL="${EXC_CONFIG_URL:-$DEFAULT_EXC_URL}"
  
  if command -v wget >/dev/null 2>&1; then
    wget -q "$EXC_URL" -O "$EXC_FILE" || {
      echo "Error: Failed to download EXC.json from $EXC_URL"
      exit 1
    }
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$EXC_URL" -o "$EXC_FILE" || {
      echo "Error: Failed to download EXC.json from $EXC_URL"
      exit 1
    }
  else
    echo "Error: Neither wget nor curl available"
    exit 1
  fi
  
  echo "Successfully downloaded EXC.json from $EXC_URL"
else
  echo "EXC.json already exists at $EXC_FILE"
fi

echo "Waiting for Postgres at ${POSTGRESQL_HOST:-postgres}:${POSTGRESQL_PORT:-5432}..."
until pg_isready -h "${POSTGRESQL_HOST:-postgres}" -p "${POSTGRESQL_PORT:-5432}" -U "${POSTGRESQL_USER:-postgres}" >/dev/null 2>&1; do
  sleep 1
done

echo "Postgres is available. Preparing drizzle config..."
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

echo "Running drizzle-kit push..."
npx drizzle-kit push --force --config "$CONFIG_PATH" || {
  echo "Warning: drizzle-kit push failed; continuing startup..."
}

echo "Starting app..."
exec node build/index.js

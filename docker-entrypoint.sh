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
  # echo "Fixing permissions for /usr/src/app"
  # chown -R node:node /usr/src/app 2>/dev/null || echo "Could not change ownership of /usr/src/app"
  
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

echo "Postgres is available. Starting app..."
exec "$@"

#!/bin/bash
set -e

echo "Starting Augments MCP Server..."
echo "Environment: $ENV"
echo "Port: ${PORT:-8080}"
echo "Redis URL: ${REDIS_URL:-'Not set'}"
echo "GitHub Token: ${GITHUB_TOKEN:+Set}"
echo "Master API Key: ${MASTER_API_KEY:+Set}"
echo "Workers: ${WORKERS:-2}"

# Wait for Redis to be available
if [ -n "$REDIS_URL" ]; then
    echo "Waiting for Redis connection..."
    python -c "
import redis
import os
import time
import sys
try:
    r = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379'))
    for i in range(30):
        try:
            r.ping()
            print('Redis connected successfully!')
            break
        except:
            print(f'Redis connection attempt {i+1}/30...')
            time.sleep(1)
    else:
        print('Failed to connect to Redis after 30 attempts')
        sys.exit(1)
except Exception as e:
    print(f'Redis connection error: {e}')
    sys.exit(1)
"
fi

echo "Starting web server on port ${PORT:-8080}..."
exec python -m augments_mcp.web_server
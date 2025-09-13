#!/bin/bash
set -e

echo "=== Augments MCP Server Startup ==="
echo "Environment: $ENV"
echo "Port: ${PORT:-8080}"
echo "Redis URL: ${REDIS_URL:-'Not set'}"
echo "GitHub Token: ${GITHUB_TOKEN:+Set}"
echo "Master API Key: ${MASTER_API_KEY:+Set}"
echo "Workers: ${WORKERS:-2}"
echo "Python Path: $PYTHONPATH"
echo "Working Dir: $(pwd)"

# List Python packages for debugging
echo "=== Python Environment ==="
python -c "import sys; print(f'Python version: {sys.version}')"
echo "Installed packages:"
pip list | head -20

# Simple Redis test (non-blocking)
if [ -n "$REDIS_URL" ]; then
    echo "=== Testing Redis Connection ==="
    python -c "
import redis
import os
try:
    r = redis.from_url(os.getenv('REDIS_URL'), socket_timeout=5)
    r.ping()
    print('✓ Redis connection test passed')
except Exception as e:
    print(f'⚠ Redis connection test failed: {e}')
    print('Server will start anyway - Redis retry logic will handle this')
" || true  # Don't fail if Redis test fails
fi

echo "=== Starting FastAPI Server ==="
echo "Starting web server on port ${PORT:-8080}..."

# Direct Python execution with better error handling
python -c "
import sys
import os
sys.path.insert(0, '/app/src')
from augments_mcp.web_server import main
print('Calling main() function...')
main()
"
# Production-ready container optimized for Railway
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    git \
    curl \
    ca-certificates \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get autoremove -y \
    && apt-get clean

# Create non-root user
RUN groupadd -r -g 1000 augments && \
    useradd -r -g augments -u 1000 -m -s /bin/bash augments

# Set working directory
WORKDIR /app

# Copy all necessary files for installation
COPY pyproject.toml ./
COPY src/ ./src/
COPY frameworks/ ./frameworks/
COPY start.sh ./
COPY minimal_server.py ./

# Install dependencies with pip (more reliable on Railway)
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir .

# Make start script executable and change ownership
RUN chmod +x /app/start.sh && \
    mkdir -p /app/cache /app/logs && \
    chown -R augments:augments /app

# Switch to non-root user
USER augments

# Set Python path
ENV PYTHONPATH="/app/src:$PYTHONPATH"

# Production environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENV=production \
    AUGMENTS_CACHE_DIR=/app/cache \
    REDIS_POOL_SIZE=20 \
    WORKERS=2 \
    LOG_LEVEL=INFO \
    HOST=0.0.0.0 \
    REBUILD_TRIGGER=v2

# Railway handles healthchecks via railway.json
# No HEALTHCHECK needed in Dockerfile

# Expose port (Railway uses $PORT env var)
EXPOSE 8080

# Start the full MCP server directly
CMD ["python", "-m", "augments_mcp.web_server"]
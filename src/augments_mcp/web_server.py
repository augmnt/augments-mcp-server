"""
Web API Server for Augments MCP
Production-ready web server with rate limiting, authentication, and monitoring
"""

import os
import asyncio
import time
import hashlib
import secrets
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

import redis.asyncio as redis
import structlog
from fastapi import FastAPI, HTTPException, Request, Depends, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from prometheus_client import Counter, Histogram, generate_latest
from pydantic import BaseModel, Field
import uvicorn

from .registry.manager import FrameworkRegistryManager
from .registry.cache import DocumentationCache
from .providers.github import GitHubProvider
from .providers.website import WebsiteProvider
from .tools import (
    framework_discovery,
    documentation,
    context_enhancement,
    updates
)

# Configure logging
logger = structlog.get_logger(__name__)

# Metrics
REQUEST_COUNT = Counter('api_requests_total', 'Total API requests', ['method', 'endpoint', 'status'])
REQUEST_DURATION = Histogram('api_request_duration_seconds', 'API request duration')
RATE_LIMIT_EXCEEDED = Counter('rate_limit_exceeded_total', 'Rate limit exceeded count', ['endpoint'])

# Models
class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    request_id: Optional[str] = None

class SuccessResponse(BaseModel):
    success: bool = True
    data: Dict[str, Any]
    request_id: Optional[str] = None

class FrameworkRequest(BaseModel):
    framework: str = Field(..., description="Framework name")
    section: Optional[str] = Field(None, description="Specific section")
    use_cache: bool = Field(True, description="Use cached data if available")

class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query")
    framework: Optional[str] = Field(None, description="Limit to specific framework")
    limit: int = Field(10, ge=1, le=100, description="Maximum results")

class MultiFrameworkRequest(BaseModel):
    frameworks: List[str] = Field(..., description="List of frameworks")
    task_description: Optional[str] = Field(None, description="Task context")

class CodeAnalysisRequest(BaseModel):
    code: str = Field(..., description="Code to analyze")
    frameworks: List[str] = Field(..., description="Frameworks to check")

# Global instances
app: Optional[FastAPI] = None
redis_client: Optional[redis.Redis] = None
registry_manager: Optional[FrameworkRegistryManager] = None
doc_cache: Optional[DocumentationCache] = None
github_provider: Optional[GitHubProvider] = None
website_provider: Optional[WebsiteProvider] = None

# Rate limiting
def get_redis_url():
    """Get Redis URL from environment or default"""
    return os.getenv("REDIS_URL", "redis://localhost:6379")

# Create rate limiter with Redis backend for distributed rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=get_redis_url(),
    default_limits=["100 per minute", "1000 per hour"]
)

# API Key validation
API_KEY_HEADER = "X-API-Key"
MASTER_API_KEY = os.getenv("MASTER_API_KEY", None)

async def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    """Verify API key from header"""
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required"
        )
    
    # In production, validate against database or Redis
    # For now, check against master key or allow demo keys
    if MASTER_API_KEY and x_api_key == MASTER_API_KEY:
        return {"tier": "premium", "rate_limit_multiplier": 10}
    
    # Demo tier - lower rate limits
    if x_api_key.startswith("demo_"):
        return {"tier": "demo", "rate_limit_multiplier": 1}
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key"
    )

# Request ID middleware
async def add_request_id(request: Request, call_next):
    """Add unique request ID to each request"""
    request_id = f"{int(time.time() * 1000)}_{secrets.token_urlsafe(8)}"
    request.state.request_id = request_id
    
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    # Add metrics
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=request.url.path,
        status=response.status_code
    ).inc()
    REQUEST_DURATION.observe(duration)
    
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time"] = str(duration)
    
    return response

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    global redis_client, registry_manager, doc_cache, github_provider, website_provider
    
    logger.info("Starting Augments Web API Server")
    
    try:
        # Initialize Redis with retry logic
        redis_url = get_redis_url()
        logger.info(f"Connecting to Redis at: {redis_url}")
        
        for attempt in range(10):  # Try 10 times
            try:
                redis_client = await redis.from_url(
                    redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_timeout=5,
                    socket_connect_timeout=5
                )
                await redis_client.ping()
                logger.info("Connected to Redis successfully")
                break
            except Exception as e:
                logger.warning(f"Redis connection attempt {attempt + 1}/10 failed: {e}")
                if attempt == 9:  # Last attempt
                    raise
                await asyncio.sleep(2)  # Wait 2 seconds before retry
        
        # Initialize components with safe cache directory
        cache_dir = os.getenv("AUGMENTS_CACHE_DIR", "/app/cache")
        logger.info(f"Cache directory: {cache_dir}")
        
        try:
            os.makedirs(cache_dir, exist_ok=True, mode=0o755)
            logger.info(f"Cache directory created/verified: {cache_dir}")
        except Exception as e:
            logger.error(f"Failed to create cache directory {cache_dir}: {e}")
            # Fall back to /tmp if the specified directory fails
            cache_dir = "/tmp/augments-cache"
            os.makedirs(cache_dir, exist_ok=True, mode=0o755)
            logger.warning(f"Using fallback cache directory: {cache_dir}")
        
        registry_manager = FrameworkRegistryManager()
        await registry_manager.initialize()
        
        doc_cache = DocumentationCache(
            cache_dir=cache_dir,
            default_ttl=int(os.getenv("CACHE_TTL", "3600"))
        )
        await doc_cache.initialize()
        
        github_token = os.getenv("GITHUB_TOKEN")
        github_provider = GitHubProvider(github_token)
        website_provider = WebsiteProvider()
        
        logger.info("All components initialized successfully")
        
        yield
        
    finally:
        # Cleanup
        logger.info("Shutting down Augments Web API Server")
        if redis_client:
            await redis_client.close()
        if doc_cache:
            await doc_cache.close()

# Create FastAPI app
app = FastAPI(
    title="Augments MCP API",
    description="Framework documentation API for development tools",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Add middlewares
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mcp.augments.dev", "https://augments.dev"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["mcp.augments.dev", "*.augments.dev", "localhost"]
)

app.middleware("http")(add_request_id)

# Add rate limit exceeded handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Health check endpoints
@app.get("/")
async def root():
    """Root endpoint - simplest possible check"""
    return {"message": "Augments MCP Server is running"}

@app.get("/health")
async def health_check():
    """Basic health check - always responds if server is running"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat(), "server": "augments-mcp"}

@app.get("/health/detailed")
@limiter.limit("10 per minute")
async def detailed_health(request: Request):
    """Detailed health check with component status"""
    health_status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "components": {}
    }
    
    # Check Redis
    try:
        await redis_client.ping()
        health_status["components"]["redis"] = "healthy"
    except Exception as e:
        health_status["components"]["redis"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check cache
    if doc_cache:
        stats = await doc_cache.get_stats()
        health_status["components"]["cache"] = {
            "status": "healthy",
            "entries": stats.get("total_entries", 0)
        }
    else:
        health_status["components"]["cache"] = "unhealthy"
        health_status["status"] = "degraded"
    
    # Check registry
    if registry_manager:
        frameworks = await registry_manager.list_frameworks()
        health_status["components"]["registry"] = {
            "status": "healthy",
            "frameworks": len(frameworks)
        }
    else:
        health_status["components"]["registry"] = "unhealthy"
        health_status["status"] = "degraded"
    
    return health_status

# Metrics endpoint
@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

# New monitoring endpoints
@app.get("/api/v1/admin/protection-stats")
async def get_protection_stats(
    request: Request,
    api_tier: dict = Depends(get_api_tier)
):
    """Get protection and abuse statistics (admin only)"""
    # Only premium users can access admin stats
    if api_tier.get("tier") not in ["premium"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    try:
        stats = {}
        
        # Smart rate limiting stats
        if smart_limiter:
            stats["rate_limiting"] = await smart_limiter.get_stats() if hasattr(smart_limiter, 'get_stats') else {}
        
        # Edge cache stats
        if edge_cache:
            stats["edge_cache"] = await edge_cache.get_cache_stats()
        
        # CloudFlare protection stats
        if cloudflare_protection:
            stats["cloudflare"] = await cloudflare_protection.get_protection_stats(redis_client)
        
        # Request coalescing stats
        if request_coalescer:
            stats["coalescing"] = request_coalescer.get_stats()
        
        # Global coalescing stats
        from .middleware.request_coalescer import global_coalescer
        stats["global_coalescing"] = global_coalescer.get_stats()
        
        # Abuse detection stats
        if abuse_detector:
            stats["abuse_detection"] = await abuse_detector.get_abuse_stats()
        
        return {
            "success": True,
            "data": stats,
            "request_id": request.state.request_id
        }
        
    except Exception as e:
        logger.error("Error getting protection stats", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/admin/clear-cache")
async def clear_cache(
    request: Request,
    pattern: Optional[str] = None,
    api_tier: dict = Depends(get_api_tier)
):
    """Clear edge cache (admin only)"""
    if api_tier.get("tier") not in ["premium"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    try:
        cleared = 0
        if edge_cache:
            cleared = await edge_cache.clear_cache(pattern)
        
        return {
            "success": True,
            "data": {
                "cleared_entries": cleared,
                "pattern": pattern or "all"
            },
            "request_id": request.state.request_id
        }
        
    except Exception as e:
        logger.error("Error clearing cache", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# API endpoints
@app.get("/api/v1/frameworks", response_model=SuccessResponse)
@coalesce_endpoint(key_prefix="list_frameworks", key_params=["category"])
async def list_frameworks(
    request: Request,
    category: Optional[str] = None,
    api_tier: dict = Depends(get_api_tier)
):
    """List available frameworks"""
    try:
        frameworks = await framework_discovery.list_frameworks_impl(
            registry=registry_manager,
            category=category
        )
        
        return SuccessResponse(
            data={"frameworks": frameworks},
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error listing frameworks", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.get("/api/v1/frameworks/{framework}", response_model=SuccessResponse)
@coalesce_endpoint(key_prefix="framework_info", key_params=["framework"])
async def get_framework_info(
    request: Request,
    framework: str,
    api_tier: dict = Depends(get_api_tier)
):
    """Get detailed framework information"""
    try:
        info = await framework_discovery.get_framework_info_impl(
            registry=registry_manager,
            framework=framework
        )
        
        return SuccessResponse(
            data=info,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error getting framework info", framework=framework, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Framework '{framework}' not found"
        )

@app.post("/api/v1/frameworks/search", response_model=SuccessResponse)
async def search_frameworks(
    request: Request,
    search_req: SearchRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Search frameworks"""
    try:
        results = await framework_discovery.search_frameworks_impl(
            registry=registry_manager,
            query=search_req.query
        )
        
        return SuccessResponse(
            data={"results": results[:search_req.limit]},
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error searching frameworks", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/documentation", response_model=SuccessResponse)
@coalesce_endpoint(key_prefix="get_docs", key_params=["framework", "section"])
async def get_documentation(
    request: Request,
    doc_req: FrameworkRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Get framework documentation"""
    try:
        # Apply rate limit multiplier for premium users
        if api_key.get("tier") == "premium":
            # Premium users get higher limits
            pass
        
        docs = await documentation.get_framework_docs_impl(
            registry=registry_manager,
            cache=doc_cache,
            github_provider=github_provider,
            website_provider=website_provider,
            framework=doc_req.framework,
            section=doc_req.section,
            use_cache=doc_req.use_cache
        )
        
        return SuccessResponse(
            data=docs,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error getting documentation", framework=doc_req.framework, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/documentation/search", response_model=SuccessResponse)
async def search_documentation(
    request: Request,
    search_req: SearchRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Search within framework documentation"""
    try:
        if not search_req.framework:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Framework must be specified for documentation search"
            )
        
        results = await documentation.search_documentation_impl(
            cache=doc_cache,
            framework=search_req.framework,
            query=search_req.query,
            limit=search_req.limit
        )
        
        return SuccessResponse(
            data={"results": results},
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error searching documentation", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/context", response_model=SuccessResponse)
async def get_framework_context(
    request: Request,
    context_req: MultiFrameworkRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Get multi-framework context"""
    try:
        context = await context_enhancement.get_framework_context_impl(
            registry=registry_manager,
            cache=doc_cache,
            github_provider=github_provider,
            website_provider=website_provider,
            frameworks=context_req.frameworks,
            task_description=context_req.task_description
        )
        
        return SuccessResponse(
            data=context,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error getting framework context", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/analyze", response_model=SuccessResponse)
async def analyze_code(
    request: Request,
    analysis_req: CodeAnalysisRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Analyze code for framework compatibility"""
    try:
        # Limit code size for security
        if len(analysis_req.code) > 50000:  # 50KB limit
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Code size exceeds limit (50KB)"
            )
        
        analysis = await context_enhancement.analyze_code_compatibility_impl(
            registry=registry_manager,
            code=analysis_req.code,
            frameworks=analysis_req.frameworks
        )
        
        return SuccessResponse(
            data=analysis,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error analyzing code", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.get("/api/v1/cache/stats", response_model=SuccessResponse)
async def get_cache_stats(
    request: Request,
    api_tier: dict = Depends(get_api_tier)
):
    """Get cache statistics"""
    try:
        stats = await updates.get_cache_statistics_impl(cache=doc_cache)
        
        return SuccessResponse(
            data=stats,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error getting cache stats", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.post("/api/v1/cache/refresh", response_model=SuccessResponse)
async def refresh_cache(
    request: Request,
    cache_req: FrameworkRequest,
    api_tier: dict = Depends(get_api_tier)
):
    """Refresh framework cache (requires premium tier)"""
    try:
        # Only allow premium users to force refresh
        if api_tier.get("tier") not in ["premium"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cache refresh requires premium access"
            )
        
        result = await updates.refresh_framework_cache_impl(
            registry=registry_manager,
            cache=doc_cache,
            github_provider=github_provider,
            website_provider=website_provider,
            framework=cache_req.framework,
            force=True
        )
        
        return SuccessResponse(
            data=result,
            request_id=request.state.request_id
        )
    except Exception as e:
        logger.error("Error refreshing cache", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "request_id": getattr(request.state, "request_id", None)
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle general exceptions"""
    logger.error("Unhandled exception", error=str(exc), exc_info=True)
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal server error",
            "detail": str(exc) if os.getenv("DEBUG") else None,
            "request_id": getattr(request.state, "request_id", None)
        }
    )

# Main entry point
def main():
    """Run the web server"""
    port = int(os.getenv("PORT", "8080"))
    host = os.getenv("HOST", "0.0.0.0")
    workers = int(os.getenv("WORKERS", "4"))
    
    if os.getenv("ENV") == "production":
        # Production with Gunicorn
        import gunicorn.app.base
        
        class StandaloneApplication(gunicorn.app.base.BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()
            
            def load_config(self):
                for key, value in self.options.items():
                    self.cfg.set(key.lower(), value)
            
            def load(self):
                return self.application
        
        options = {
            "bind": f"{host}:{port}",
            "workers": workers,
            "worker_class": "uvicorn.workers.UvicornWorker",
            "accesslog": "-",
            "errorlog": "-",
            "timeout": 120,
            "preload_app": True,
        }
        
        StandaloneApplication(app, options).run()
    else:
        # Development with Uvicorn
        uvicorn.run(
            "augments_mcp.web_server:app",
            host=host,
            port=port,
            reload=True,
            log_level="info"
        )

if __name__ == "__main__":
    main()
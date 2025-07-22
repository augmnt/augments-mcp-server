"""Improved MCP Server with better initialization and fallback handling."""

import os
import asyncio
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
import structlog
from mcp.server.fastmcp import FastMCP, Context
from fastmcp.exceptions import ToolError
from dotenv import load_dotenv
from .registry.manager import FrameworkRegistryManager
from .registry.cache import DocumentationCache
from .providers.github import GitHubProvider
from .providers.website import WebsiteProvider
from .tools.documentation_improved import get_framework_docs_with_fallback

# Load environment variables
load_dotenv()

logger = structlog.get_logger(__name__)

# Global instances
registry_manager: Optional[FrameworkRegistryManager] = None
doc_cache: Optional[DocumentationCache] = None
github_provider: Optional[GitHubProvider] = None
website_provider: Optional[WebsiteProvider] = None

# Track initialization status
_initialization_status = {
    "registry_loaded": False,
    "cache_initialized": False,
    "providers_ready": False,
    "critical_frameworks_cached": False
}


async def _warm_critical_frameworks(
    frameworks: List[str],
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    max_concurrent: int = 3
) -> None:
    """Pre-warm cache for critical frameworks with controlled concurrency."""
    logger.info("Starting critical framework cache warming", frameworks=frameworks)
    
    # Create semaphore to limit concurrent requests
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def warm_framework(framework_name: str) -> None:
        async with semaphore:
            try:
                # Check if already cached
                cached_content = await cache.get(framework_name, "", "docs")
                if cached_content:
                    logger.debug("Framework already cached, skipping", framework=framework_name)
                    return
                
                logger.info("Pre-warming framework cache", framework=framework_name)
                
                # Use the improved docs function with fallbacks
                await get_framework_docs_with_fallback(
                    registry=registry,
                    cache=cache,
                    github_provider=github_provider,
                    website_provider=website_provider,
                    framework=framework_name,
                    section=None,
                    use_cache=True,
                    ctx=None
                )
                
                logger.info("Framework cache pre-warmed successfully", framework=framework_name)
                
            except Exception as e:
                logger.warning("Failed to pre-warm framework", 
                              framework=framework_name, error=str(e))
    
    # Warm frameworks concurrently
    tasks = [warm_framework(framework) for framework in frameworks]
    await asyncio.gather(*tasks, return_exceptions=True)
    
    _initialization_status["critical_frameworks_cached"] = True
    logger.info("Critical framework cache warming completed")


@asynccontextmanager
async def improved_app_lifespan(server: FastMCP):
    """Improved application lifecycle with better error handling and user feedback."""
    global registry_manager, doc_cache, github_provider, website_provider
    
    logger.info("Initializing Augments MCP Server")
    
    try:
        # Step 1: Initialize cache (most critical)
        try:
            cache_dir = os.getenv("AUGMENTS_CACHE_DIR", "~/.cache/augments-mcp-server")
            logger.info("Initializing cache", cache_dir=cache_dir)
            doc_cache = DocumentationCache(cache_dir)
            _initialization_status["cache_initialized"] = True
            logger.info("Documentation cache initialized successfully")
        except Exception as e:
            logger.error("Failed to initialize cache", error=str(e))
            # Continue without cache - tools will handle this gracefully
        
        # Step 2: Initialize registry manager
        try:
            frameworks_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frameworks")
            logger.info("Initializing registry manager", frameworks_dir=frameworks_dir)
            registry_manager = FrameworkRegistryManager(frameworks_dir)
            await registry_manager.initialize()
            _initialization_status["registry_loaded"] = True
            logger.info("Registry manager initialized", 
                       frameworks=registry_manager.get_framework_count())
        except Exception as e:
            logger.error("Failed to initialize registry", error=str(e))
            # Continue - some tools can still work
        
        # Step 3: Initialize providers
        try:
            logger.info("Initializing providers")
            github_provider = GitHubProvider()
            website_provider = WebsiteProvider()
            _initialization_status["providers_ready"] = True
            logger.info("Providers initialized successfully")
        except Exception as e:
            logger.error("Failed to initialize providers", error=str(e))
            # Continue - fallback content can still work
        
        # Step 4: Start background cache warming (don't block startup)
        if all(_initialization_status[key] for key in ["registry_loaded", "cache_initialized", "providers_ready"]):
            critical_frameworks = ["nextjs", "react", "tailwindcss", "fastapi", "typescript"]
            
            # Start warming task in background - only if all components are initialized
            if registry_manager and doc_cache and github_provider and website_provider:
                asyncio.create_task(_warm_critical_frameworks(
                    critical_frameworks, registry_manager, doc_cache, 
                    github_provider, website_provider, max_concurrent=2
                ))
            
            logger.info("Background cache warming started for critical frameworks")
        else:
            logger.warning("Skipping cache warming due to initialization issues")
        
        logger.info("Augments MCP Server startup completed", 
                   status=_initialization_status)
        
        yield {
            "registry": registry_manager,
            "cache": doc_cache,
            "github_provider": github_provider,
            "website_provider": website_provider,
            "status": _initialization_status
        }
        
    except Exception as e:
        logger.error("Critical failure during server initialization", error=str(e))
        # Reset globals to ensure tools know about the failure
        registry_manager = None
        doc_cache = None
        github_provider = None
        website_provider = None
        raise
        
    finally:
        # Cleanup
        logger.info("Shutting down Augments MCP Server")
        
        cleanup_tasks = []
        
        if registry_manager:
            cleanup_tasks.append(registry_manager.shutdown())
        
        if github_provider:
            cleanup_tasks.append(github_provider.close())
        
        if website_provider:
            cleanup_tasks.append(website_provider.close())
        
        # Run cleanup concurrently
        if cleanup_tasks:
            await asyncio.gather(*cleanup_tasks, return_exceptions=True)
        
        logger.info("Augments MCP Server shutdown completed")


# Initialize FastMCP server with improved lifespan
mcp = FastMCP("augments-mcp-server", lifespan=improved_app_lifespan)


@mcp.tool()
async def get_framework_docs(
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Retrieve framework documentation with graceful fallbacks.
    
    This improved version provides multiple fallback strategies and never
    returns "No documentation found" without helpful alternatives.
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        # Check if components are available
        if not all([registry_manager, doc_cache, github_provider, website_provider]):
            return _generate_service_unavailable_response(framework, section)
        
        # All components are verified to be non-None here
        return await get_framework_docs_with_fallback(
            registry_manager,  # type: ignore
            doc_cache,        # type: ignore
            github_provider,  # type: ignore
            website_provider, # type: ignore
            framework.strip(),
            section.strip() if section else None,
            use_cache,
            ctx
        )
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Documentation retrieval failed: {str(e)}"
        logger.error("Get framework docs failed", 
                    framework=framework, 
                    section=section, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return _generate_service_error_response(framework, str(e))


@mcp.tool()
async def get_server_status(ctx: Optional[Context] = None) -> Dict[str, Any]:
    """Get current server initialization status and health check.
    
    Returns:
        Server status including component health and cache statistics
    """
    try:
        if ctx:
            await ctx.info("Checking server status")
        
        status: Dict[str, Any] = {
            "server_health": "healthy" if registry_manager and doc_cache else "degraded",
            "initialization_status": _initialization_status.copy(),
            "components": {
                "registry_manager": registry_manager is not None,
                "doc_cache": doc_cache is not None,
                "github_provider": github_provider is not None,
                "website_provider": website_provider is not None
            }
        }
        
        # Add framework count if registry is available
        if registry_manager:
            framework_count = registry_manager.get_framework_count()
            status["framework_count"] = framework_count
        
        # Add cache stats if cache is available
        if doc_cache:
            try:
                cache_stats = doc_cache.get_stats()
                status["cache_stats"] = cache_stats
            except Exception as e:
                logger.warning("Failed to get cache stats", error=str(e))
        
        return status
        
    except Exception as e:
        logger.error("Failed to get server status", error=str(e))
        return {
            "server_health": "error",
            "error": str(e),
            "components": {
                "registry_manager": False,
                "doc_cache": False,
                "github_provider": False,
                "website_provider": False
            }
        }


def _generate_service_unavailable_response(framework: str, section: Optional[str]) -> str:
    """Generate response when core services are unavailable."""
    return f"""# Service Temporarily Unavailable

The Augments MCP Server is still initializing or experiencing issues.

## What's happening?
The documentation service components are not fully ready:
- Registry: {'✅' if registry_manager else '❌'}
- Cache: {'✅' if doc_cache else '❌'}  
- GitHub Provider: {'✅' if github_provider else '❌'}
- Website Provider: {'✅' if website_provider else '❌'}

## What you can do:
1. **Wait a moment** - The server may still be warming up
2. **Try again** - Services might be ready in a few seconds
3. **Check server status** - Use the get_server_status tool
4. **Ask general questions** - I can still help with general programming questions about {framework}

## Requested: {framework}
{f"Section: {section}" if section else "General documentation"}

*The server is designed to provide fallback content, but some components are not ready yet.*
"""


def _generate_service_error_response(framework: str, error: str) -> str:
    """Generate response when there's a service error."""
    return f"""# Service Error Occurred

An error occurred while retrieving documentation for {framework}.

## Error Details:
{error}

## What you can do:
1. **Try a different framework** - Other frameworks might work
2. **Ask specific questions** - I can still answer questions about {framework} using my training data
3. **Check server status** - Use get_server_status to see component health
4. **Report the issue** - This error has been logged for investigation

## Alternative Approach:
Instead of requesting documentation, try asking:
- "How do I get started with {framework}?"
- "Show me a basic {framework} example"  
- "What are the main concepts in {framework}?"

*The server provides multiple fallback strategies to ensure you always get helpful responses.*
"""


def main():
    """Main entry point."""
    mcp.run()


if __name__ == "__main__":
    main()
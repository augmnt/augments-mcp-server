"""
Augments MCP Server - Framework Documentation Provider

A comprehensive MCP server that provides real-time access to framework documentation
and context to enhance Claude Code's ability to generate accurate, up-to-date code.
"""

import os
import asyncio
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
import sys
import structlog
from mcp.server.fastmcp import FastMCP, Context
from fastmcp.exceptions import ToolError
from dotenv import load_dotenv
from .registry.manager import FrameworkRegistryManager
from .registry.cache import DocumentationCache
from .providers.github import GitHubProvider
from .providers.website import WebsiteProvider
from .tools.framework_discovery import (
    list_available_frameworks as list_frameworks_impl,
    search_frameworks as search_frameworks_impl,
    get_framework_info as get_framework_info_impl,
    get_registry_stats as get_registry_stats_impl
)
from .tools.documentation import (
    get_framework_docs as get_framework_docs_impl,
    get_framework_examples as get_framework_examples_impl,
    search_documentation as search_documentation_impl
)
from .tools.context_enhancement import (
    get_framework_context as get_framework_context_impl,
    analyze_code_compatibility as analyze_code_compatibility_impl
)
from .tools.updates import (
    check_framework_updates as check_framework_updates_impl,
    refresh_framework_cache as refresh_framework_cache_impl,
    get_cache_statistics as get_cache_statistics_impl
)

# Load environment variables from .env file
load_dotenv()

# Configure structured logging to use stderr
structlog.configure(
    processors=[
        structlog.dev.ConsoleRenderer()
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO level
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),  # Send to stderr
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Global instances
registry_manager: Optional[FrameworkRegistryManager] = None
doc_cache: Optional[DocumentationCache] = None
github_provider: Optional[GitHubProvider] = None
website_provider: Optional[WebsiteProvider] = None

def _ensure_initialized() -> tuple[FrameworkRegistryManager, DocumentationCache, GitHubProvider, WebsiteProvider]:
    """Ensure all global components are initialized and return them."""
    if registry_manager is None:
        raise ToolError("Registry manager not initialized")
    if doc_cache is None:
        raise ToolError("Documentation cache not initialized")
    if github_provider is None:
        raise ToolError("GitHub provider not initialized")
    if website_provider is None:
        raise ToolError("Website provider not initialized")
    return registry_manager, doc_cache, github_provider, website_provider


async def _auto_cache_popular_frameworks(
    frameworks: List[str],
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider
) -> None:
    """Auto-cache popular frameworks in the background."""
    logger.info("Starting auto-cache of popular frameworks", frameworks=frameworks)
    
    for framework in frameworks:
        try:
            # Check if already cached
            cached_content = await cache.get(framework, "", "docs")
            if cached_content:
                logger.debug("Framework already cached, skipping", framework=framework)
                continue
            
            logger.info("Auto-caching framework", framework=framework)
            
            # Cache main documentation
            await get_framework_docs_impl(
                registry=registry,
                cache=cache,
                github_provider=github_provider,
                website_provider=website_provider,
                framework=framework,
                section=None,
                use_cache=True,
                ctx=None
            )
            
            logger.info("Framework auto-cached successfully", framework=framework)
            
        except Exception as e:
            logger.warning("Failed to auto-cache framework", 
                          framework=framework, error=str(e))
    
    logger.info("Auto-cache of popular frameworks completed")


@asynccontextmanager
async def app_lifespan(server: FastMCP):
    """Manage application lifecycle with framework registry and cache initialization."""
    global registry_manager, doc_cache, github_provider, website_provider
    
    logger.info("Initializing Augments MCP Server")
    
    try:
        # Initialize cache
        cache_dir = os.getenv("AUGMENTS_CACHE_DIR", "~/.cache/augments-mcp-server")
        logger.info("Initializing cache", cache_dir=cache_dir)
        doc_cache = DocumentationCache(cache_dir)
        logger.info("Documentation cache initialized", cache_dir=cache_dir)
        
        # Initialize registry manager
        frameworks_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frameworks")
        logger.info("Initializing registry manager", frameworks_dir=frameworks_dir)
        registry_manager = FrameworkRegistryManager(frameworks_dir)
        await registry_manager.initialize()
        logger.info("Registry manager initialized")
        
        # Initialize providers
        logger.info("Initializing providers")
        github_provider = GitHubProvider()
        website_provider = WebsiteProvider()
        logger.info("Providers initialized")
        
        # Auto-cache popular frameworks in background
        popular_frameworks = ["nextjs", "react", "tailwindcss", "typescript", "shadcn-ui"]
        asyncio.create_task(_auto_cache_popular_frameworks(
            popular_frameworks, registry_manager, doc_cache, github_provider, website_provider
        ))
        
        logger.info("Augments MCP Server initialized successfully", 
                   frameworks=registry_manager.get_framework_count())
        
        yield {
            "registry": registry_manager,
            "cache": doc_cache,
            "github_provider": github_provider,
            "website_provider": website_provider
        }
        
    except Exception as e:
        logger.error("Failed to initialize Augments MCP Server", error=str(e))
        # Set global variables to None so tools can detect initialization failure
        registry_manager = None
        doc_cache = None
        github_provider = None
        website_provider = None
        raise
        
    finally:
        # Cleanup
        logger.info("Shutting down Augments MCP Server")
        
        if registry_manager:
            await registry_manager.shutdown()
        
        if github_provider:
            await github_provider.close()
        
        if website_provider:
            await website_provider.close()


# Initialize FastMCP server with web deployment configuration
mcp = FastMCP(
    "augments-mcp-server", 
    lifespan=app_lifespan,
    host="0.0.0.0",  # Bind to all interfaces for Railway
    port=8080,       # Match Railway configuration
)


# Framework Discovery Tools

@mcp.tool()
async def list_available_frameworks(
    category: Optional[str] = None,
    ctx: Optional[Context] = None
) -> List[Dict[str, Any]]:
    """List all available frameworks, optionally filtered by category.
    
    Args:
        category: Filter by category (web, backend, mobile, ai-ml, design, tools)
    
    Returns:
        List of framework information including name, category, and description
    """
    try:
        if ctx:
            await ctx.info("Listing frameworks" + (f" in category: {category}" if category else ""))
        
        logger.info("List frameworks called", registry_loaded=registry_manager is not None and registry_manager.is_loaded() if registry_manager else False)
        
        if registry_manager is None:
            raise ToolError("Registry manager not initialized")
        
        return await list_frameworks_impl(registry_manager, category)
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Failed to list frameworks: {str(e)}"
        logger.error("List frameworks failed", error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def search_frameworks(
    query: str,
    ctx: Optional[Context] = None
) -> List[Dict[str, Any]]:
    """Search for frameworks by name, keyword, or feature.
    
    Args:
        query: Search term to match against framework names and features
        
    Returns:
        Ranked list of matching frameworks with relevance scores
    """
    try:
        if not query or not query.strip():
            raise ToolError("Search query is required")
        
        if ctx:
            await ctx.info(f"Searching frameworks for: {query}")
        
        reg_mgr, _, _, _ = _ensure_initialized()
        
        return await search_frameworks_impl(reg_mgr, query.strip())
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Framework search failed: {str(e)}"
        logger.error("Framework search failed", query=query, error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def get_framework_info(
    framework: str,
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Get detailed information about a specific framework.
    
    Args:
        framework: Framework name
        
    Returns:
        Detailed framework information or error message
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        if ctx:
            await ctx.info(f"Getting info for framework: {framework}")
        
        if registry_manager is None:
            raise ToolError("Registry manager not initialized")
        
        result = await get_framework_info_impl(registry_manager, framework.strip())
        
        if result is None:
            raise ToolError(f"Framework '{framework}' not found")
        
        return result
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Failed to get framework info: {str(e)}"
        logger.error("Get framework info failed", framework=framework, error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


# Documentation Access Tools

@mcp.tool()
async def get_framework_docs(
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Retrieve comprehensive documentation for a specific framework.
    
    Args:
        framework: Framework name (e.g., 'react', 'tailwind', 'laravel')
        section: Specific documentation section (e.g., 'installation', 'configuration')
        use_cache: Whether to use cached content (default: True)
        
    Returns:
        Formatted documentation content with examples and best practices
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        reg_mgr, cache, gh_provider, web_provider = _ensure_initialized()
        
        return await get_framework_docs_impl(
            reg_mgr,
            cache,
            gh_provider,
            web_provider,
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
        raise ToolError(error_msg)


@mcp.tool()
async def get_framework_examples(
    framework: str,
    pattern: Optional[str] = None,
    ctx: Optional[Context] = None
) -> str:
    """Get code examples for specific patterns within a framework.
    
    Args:
        framework: Framework name
        pattern: Specific pattern (e.g., 'components', 'routing', 'authentication')
        
    Returns:
        Code examples with explanations and best practices
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        reg_mgr, cache, gh_provider, web_provider = _ensure_initialized()
        
        return await get_framework_examples_impl(
            reg_mgr,
            cache,
            gh_provider,
            web_provider,
            framework.strip(),
            pattern.strip() if pattern else None,
            ctx
        )
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Examples retrieval failed: {str(e)}"
        logger.error("Get framework examples failed", 
                    framework=framework, 
                    pattern=pattern, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def search_documentation(
    framework: str,
    query: str,
    limit: int = 10,
    ctx: Optional[Context] = None
) -> List[Dict[str, Any]]:
    """Search within a framework's cached documentation.
    
    Args:
        framework: Framework name to search within
        query: Search query
        limit: Maximum number of results (default: 10)
        
    Returns:
        List of search results with context
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        if not query or not query.strip():
            raise ToolError("Search query is required")
        
        if ctx:
            await ctx.info(f"Searching documentation for {framework}: {query}")
        
        reg_mgr, cache, gh_provider, web_provider = _ensure_initialized()
        
        results = await search_documentation_impl(
            reg_mgr,
            cache,
            gh_provider,
            web_provider,
            framework.strip(),
            query.strip(),
            max(1, min(limit, 50)),  # Limit between 1 and 50
            ctx
        )
        
        return results
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Documentation search failed: {str(e)}"
        logger.error("Search documentation failed", 
                    framework=framework, 
                    query=query, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


# Context Enhancement Tools

@mcp.tool()
async def get_framework_context(
    frameworks: List[str],
    task_description: str,
    ctx: Optional[Context] = None
) -> str:
    """Get relevant context for multiple frameworks based on the development task.
    
    Args:
        frameworks: List of framework names being used
        task_description: Description of what you're trying to build
        
    Returns:
        Curated context combining relevant documentation, patterns, and best practices
    """
    try:
        if not frameworks:
            return "Error: At least one framework is required"
        
        if not task_description or not task_description.strip():
            return "Error: Task description is required"
        
        # Clean framework names
        clean_frameworks = [f.strip() for f in frameworks if f.strip()]
        
        if not clean_frameworks:
            return "Error: No valid framework names provided"
        
        reg_mgr, cache, _, _ = _ensure_initialized()
        
        return await get_framework_context_impl(
            reg_mgr,
            cache,
            clean_frameworks,
            task_description.strip(),
            ctx
        )
        
    except Exception as e:
        error_msg = f"Context generation failed: {str(e)}"
        logger.error("Get framework context failed", 
                    frameworks=frameworks, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def analyze_code_compatibility(
    code: str,
    frameworks: List[str],
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Analyze code for framework compatibility and suggest improvements.
    
    Args:
        code: Code snippet to analyze
        frameworks: List of frameworks the code should work with
        
    Returns:
        Analysis results with compatibility issues and improvement suggestions
    """
    try:
        if not code or not code.strip():
            raise ToolError("Code snippet is required")
        
        if not frameworks:
            raise ToolError("At least one framework is required")
        
        # Clean framework names
        clean_frameworks = [f.strip() for f in frameworks if f.strip()]
        
        if not clean_frameworks:
            raise ToolError("No valid framework names provided")
        
        if registry_manager is None:
            raise ToolError("Registry manager not initialized")
        
        return await analyze_code_compatibility_impl(
            registry_manager,
            code.strip(),
            clean_frameworks,
            ctx
        )
        
    except Exception as e:
        error_msg = f"Code compatibility analysis failed: {str(e)}"
        logger.error("Analyze code compatibility failed", 
                    frameworks=frameworks, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


# Update and Cache Management Tools

@mcp.tool()
async def check_framework_updates(
    framework: str,
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Check if framework documentation has been updated since last cache.
    
    Args:
        framework: Framework name to check
        
    Returns:
        Update status with last modified dates and change summary
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        reg_mgr, cache, gh_provider, _ = _ensure_initialized()
        
        return await check_framework_updates_impl(
            reg_mgr,
            cache,
            gh_provider,
            framework.strip(),
            ctx
        )
        
    except Exception as e:
        error_msg = f"Update check failed: {str(e)}"
        logger.error("Check framework updates failed", 
                    framework=framework, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def refresh_framework_cache(
    framework: Optional[str] = None,
    force: bool = False,
    ctx: Optional[Context] = None
) -> str:
    """Refresh cached documentation for frameworks.
    
    Args:
        framework: Specific framework to refresh, or None for all
        force: Force refresh even if cache is still valid
        
    Returns:
        Status message with refresh results
    """
    try:
        clean_framework = framework.strip() if framework else None
        
        reg_mgr, cache, gh_provider, web_provider = _ensure_initialized()
        
        return await refresh_framework_cache_impl(
            reg_mgr,
            cache,
            gh_provider,
            web_provider,
            clean_framework,
            force,
            ctx
        )
        
    except Exception as e:
        error_msg = f"Cache refresh failed: {str(e)}"
        logger.error("Refresh framework cache failed", 
                    framework=framework, 
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


@mcp.tool()
async def get_cache_stats(
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Get detailed cache statistics and performance metrics.
    
    Returns:
        Comprehensive cache statistics
    """
    try:
        if ctx:
            await ctx.info("Retrieving cache statistics")
        
        reg_mgr, cache, _, _ = _ensure_initialized()
        
        stats = await get_cache_statistics_impl(reg_mgr, cache)
        
        if ctx:
            await ctx.debug("Cache statistics retrieved successfully")
        
        return stats
        
    except Exception as e:
        error_msg = f"Failed to get cache statistics: {str(e)}"
        logger.error("Get cache stats failed", error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


# Registry Management Tools

@mcp.tool()
async def get_registry_stats(
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Get statistics about the framework registry.
    
    Returns:
        Registry statistics including framework count and categories
    """
    try:
        if ctx:
            await ctx.info("Retrieving registry statistics")
        
        if registry_manager is None:
            raise ToolError("Registry manager not initialized")
            
        return await get_registry_stats_impl(registry_manager)
        
    except ToolError:
        raise
    except Exception as e:
        error_msg = f"Failed to get registry statistics: {str(e)}"
        logger.error("Get registry stats failed", error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


def main():
    """Main entry point."""
    import sys
    import os
    
    # Configure uvicorn to use wsproto instead of deprecated websockets
    os.environ.setdefault("UVICORN_WS", "wsproto")
    
    # Check for transport argument
    if len(sys.argv) > 1 and sys.argv[1] == "streamable-http":
        # Run with streamable-http transport for web deployment
        # Configure uvicorn options for wsproto
        uvicorn_config = {
            "ws": "wsproto"  # Use wsproto instead of deprecated websockets
        }
        mcp.run(transport="streamable-http", **uvicorn_config)
    else:
        # Default to stdio transport for local MCP usage
        mcp.run()


if __name__ == "__main__":
    main()

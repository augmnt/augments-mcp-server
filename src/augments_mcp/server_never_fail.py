"""Never-fail MCP Server that guarantees documentation delivery."""

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
from .tools.documentation_never_fail import get_framework_docs_never_fail

load_dotenv()

logger = structlog.get_logger(__name__)

# Global instances with fallback handling
registry_manager: Optional[FrameworkRegistryManager] = None
doc_cache: Optional[DocumentationCache] = None
github_provider: Optional[GitHubProvider] = None
website_provider: Optional[WebsiteProvider] = None

# Server health tracking
server_health: Dict[str, Any] = {
    "status": "starting",
    "components": {
        "registry": False,
        "cache": False,
        "github_provider": False,
        "website_provider": False
    },
    "cache_warming": {
        "started": False,
        "completed": False,
        "frameworks_cached": 0,
        "total_frameworks": 0
    }
}


async def _aggressive_cache_warming(
    critical_frameworks: List[str],
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider
) -> None:
    """Aggressively warm cache with comprehensive error handling."""
    logger.info("Starting aggressive cache warming", frameworks=critical_frameworks)
    
    server_health["cache_warming"]["started"] = True
    server_health["cache_warming"]["total_frameworks"] = len(critical_frameworks)
    
    # Semaphore for controlled concurrency
    semaphore = asyncio.Semaphore(2)  # Max 2 concurrent requests
    
    async def warm_single_framework(framework: str) -> bool:
        """Warm a single framework with multiple attempts."""
        async with semaphore:
            for attempt in range(3):  # 3 attempts per framework
                try:
                    logger.info(f"Warming {framework} (attempt {attempt + 1})", 
                               framework=framework)
                    
                    # Use the never-fail function to ensure content is cached
                    content = await get_framework_docs_never_fail(
                        registry=registry,
                        cache=cache,
                        github_provider=github_provider,
                        website_provider=website_provider,
                        framework=framework,
                        section=None,
                        use_cache=False,  # Force fresh fetch to populate cache
                        ctx=None
                    )
                    
                    if content and not content.startswith("# Service"):
                        logger.info("Framework warming successful", framework=framework)
                        server_health["cache_warming"]["frameworks_cached"] += 1
                        return True
                    
                except Exception as e:
                    logger.warning(f"Warming attempt {attempt + 1} failed", 
                                 framework=framework, error=str(e))
                    if attempt < 2:  # Not the last attempt
                        await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff
                
            logger.warning("All warming attempts failed", framework=framework)
            return False
    
    # Warm all frameworks concurrently
    tasks = [warm_single_framework(fw) for fw in critical_frameworks]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    success_count = sum(1 for result in results if result is True)
    server_health["cache_warming"]["completed"] = True
    server_health["cache_warming"]["frameworks_cached"] = success_count
    
    logger.info("Cache warming completed", 
               successful=success_count, 
               total=len(critical_frameworks))


@asynccontextmanager
async def never_fail_lifespan(server: FastMCP):
    """Never-fail server lifespan that ensures service availability."""
    global registry_manager, doc_cache, github_provider, website_provider
    
    logger.info("Initializing Never-Fail Augments MCP Server")
    server_health["status"] = "initializing"
    
    initialization_errors = []
    
    # Step 1: Initialize cache (critical for fallbacks)
    try:
        cache_dir = os.getenv("AUGMENTS_CACHE_DIR", "~/.cache/augments-mcp-server")
        doc_cache = DocumentationCache(cache_dir)
        server_health["components"]["cache"] = True
        logger.info("Cache initialized successfully")
    except Exception as e:
        initialization_errors.append(f"Cache: {str(e)}")
        logger.error("Cache initialization failed", error=str(e))
        # Continue - static content can still work
    
    # Step 2: Initialize registry (important for framework info)
    try:
        frameworks_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frameworks")
        registry_manager = FrameworkRegistryManager(frameworks_dir)
        await registry_manager.initialize()
        server_health["components"]["registry"] = True
        logger.info("Registry initialized", frameworks=registry_manager.get_framework_count())
    except Exception as e:
        initialization_errors.append(f"Registry: {str(e)}")
        logger.error("Registry initialization failed", error=str(e))
        # Continue - static content and basic functionality still work
    
    # Step 3: Initialize providers (useful but not critical)
    try:
        github_provider = GitHubProvider()
        server_health["components"]["github_provider"] = True
        logger.info("GitHub provider initialized")
    except Exception as e:
        initialization_errors.append(f"GitHub Provider: {str(e)}")
        logger.error("GitHub provider initialization failed", error=str(e))
    
    try:
        website_provider = WebsiteProvider()
        server_health["components"]["website_provider"] = True
        logger.info("Website provider initialized")
    except Exception as e:
        initialization_errors.append(f"Website Provider: {str(e)}")
        logger.error("Website provider initialization failed", error=str(e))
    
    # Update server status
    healthy_components = sum(server_health["components"].values())
    if healthy_components >= 2:  # At least cache + registry or cache + one provider
        server_health["status"] = "healthy"
    elif healthy_components >= 1:
        server_health["status"] = "degraded"
    else:
        server_health["status"] = "minimal"
    
    logger.info("Server initialization completed", 
               status=server_health["status"],
               healthy_components=healthy_components,
               errors=len(initialization_errors))
    
    # Step 4: Start aggressive background cache warming
    if registry_manager and doc_cache and (github_provider or website_provider):
        critical_frameworks = [
            "nextjs", "react", "tailwindcss", "fastapi", "typescript",
            "vue", "angular", "svelte", "django", "express",
            "nuxtjs", "gatsby", "astro", "remix", "sveltekit"
        ]
        
        # Only start cache warming if we have all required components
        if github_provider and website_provider:
            asyncio.create_task(_aggressive_cache_warming(
                critical_frameworks,
                registry_manager,
                doc_cache,
                github_provider,
                website_provider
            ))
        
        logger.info("Background cache warming started")
    else:
        logger.warning("Skipping cache warming due to missing components")
    
    try:
        yield {
            "registry": registry_manager,
            "cache": doc_cache,
            "github_provider": github_provider,
            "website_provider": website_provider,
            "health": server_health,
            "initialization_errors": initialization_errors
        }
    finally:
        # Graceful shutdown
        logger.info("Shutting down Never-Fail Augments MCP Server")
        server_health["status"] = "shutting_down"
        
        shutdown_tasks = []
        if registry_manager:
            shutdown_tasks.append(registry_manager.shutdown())
        if github_provider:
            shutdown_tasks.append(github_provider.close())
        if website_provider:
            shutdown_tasks.append(website_provider.close())
        
        if shutdown_tasks:
            await asyncio.gather(*shutdown_tasks, return_exceptions=True)
        
        server_health["status"] = "stopped"
        logger.info("Server shutdown completed")


# Initialize server
mcp = FastMCP("augments-never-fail-server", lifespan=never_fail_lifespan)


@mcp.tool()
async def get_framework_docs(
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Get framework documentation with absolute guarantee of useful content.
    
    This function NEVER returns "No documentation found" errors. It provides:
    1. Cached content if available
    2. Fresh content from sources with retries
    3. Comprehensive static content
    4. Framework guidance as last resort
    
    Users always get helpful documentation or guidance.
    """
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        framework_name = framework.strip()
        
        # Always attempt to provide content, even with limited components
        result = await get_framework_docs_never_fail(
            registry=registry_manager or None,  # type: ignore
            cache=doc_cache or None,           # type: ignore
            github_provider=github_provider or None,  # type: ignore
            website_provider=website_provider or None,  # type: ignore
            framework=framework_name,
            section=section.strip() if section else None,
            use_cache=use_cache,
            ctx=ctx
        )
        
        # The never_fail function guarantees non-empty useful content
        logger.info("Framework documentation delivered", 
                   framework=framework_name, 
                   section=section,
                   content_length=len(result))
        
        return result
        
    except ToolError:
        raise
    except Exception as e:
        # Even if something goes wrong, provide helpful content
        logger.error("Unexpected error in get_framework_docs", 
                    framework=framework, error=str(e))
        
        return f"""# {framework.title()} Documentation Request

An unexpected error occurred while retrieving documentation: {str(e)}

## What I can still help with:
Despite this error, I can assist you with:

1. **General Questions**: Ask me about {framework} concepts and best practices
2. **Code Examples**: Request specific examples for your use case  
3. **Problem Solving**: Describe what you're building and I'll help
4. **Getting Started**: Ask how to begin with {framework}

## Try asking:
- "How do I create a {framework} component?"
- "Show me a {framework} example for [specific use case]"
- "What are the main concepts in {framework}?"
- "Help me build [something] with {framework}"

*Even when external systems have issues, I can provide valuable assistance based on my training data.*"""


@mcp.tool()
async def get_framework_examples(
    framework: str,
    pattern: Optional[str] = None,
    ctx: Optional[Context] = None
) -> str:
    """Get framework examples with guaranteed content delivery."""
    try:
        if not framework or not framework.strip():
            raise ToolError("Framework name is required")
        
        framework_name = framework.strip()
        
        # Try to get examples, but always provide something useful
        if framework_name.lower() in ["nextjs", "react", "tailwindcss", "fastapi"]:
            # Use our comprehensive static content
            from .tools.documentation_never_fail import COMPREHENSIVE_STATIC_DOCS
            
            framework_docs = COMPREHENSIVE_STATIC_DOCS.get(framework_name.lower(), {})
            
            # Look for pattern-specific content or return main content with examples
            if pattern and pattern in framework_docs:
                return framework_docs[pattern]
            else:
                main_content = framework_docs.get("main", "")
                if main_content:
                    # Extract code examples from main content
                    examples = _extract_code_examples(main_content, pattern)
                    if examples:
                        return f"# {framework_name.title()} Examples" + \
                               (f" - {pattern.title()}" if pattern else "") + \
                               f"\n\n{examples}"
                    return main_content
        
        # Fallback for any framework
        return f"""# {framework_name.title()} Examples{f" - {pattern.title()}" if pattern else ""}

While I don't have specific cached examples for {framework_name}{f" ({pattern})" if pattern else ""}, I can help you with:

## What I can create for you:
1. **Custom Examples**: Describe what you want to build and I'll create specific examples
2. **Pattern Examples**: Ask for specific patterns like "authentication", "routing", "forms"
3. **Use Case Examples**: Tell me your use case and I'll provide relevant code

## Try asking:
- "Show me a {framework_name} component that handles form submission"
- "Create a {framework_name} example for user authentication"
- "How do I implement routing in {framework_name}?"
- "Give me a {framework_name} starter template"

*I can generate custom examples tailored to your specific needs, which is often more helpful than generic examples.*"""
        
    except ToolError:
        raise
    except Exception as e:
        logger.error("Error in get_framework_examples", 
                    framework=framework, pattern=pattern, error=str(e))
        return f"I encountered an error but can still help with {framework} examples. " + \
               "Please ask me specific questions about what you'd like to build."


@mcp.tool()
async def get_server_health(ctx: Optional[Context] = None) -> Dict[str, Any]:
    """Get comprehensive server health and status information."""
    try:
        if ctx:
            await ctx.info("Checking server health")
        
        # Add runtime statistics
        health_report = server_health.copy()
        
        # Add component details
        if doc_cache:
            try:
                cache_stats = doc_cache.get_stats()
                health_report["cache_details"] = cache_stats
            except Exception:
                health_report["cache_details"] = {"error": "Unable to get cache stats"}
        
        if registry_manager:
            try:
                health_report["registry_details"] = {
                    "framework_count": registry_manager.get_framework_count(),
                    "loaded": registry_manager.is_loaded() if hasattr(registry_manager, 'is_loaded') else True
                }
            except Exception:
                health_report["registry_details"] = {"error": "Unable to get registry details"}
        
        # Add service guarantees
        health_report["service_guarantees"] = {
            "documentation_availability": "guaranteed",  # Always provides some content
            "static_content_frameworks": ["nextjs", "react", "tailwindcss", "fastapi"],
            "fallback_strategy": "4-layer (cache -> fresh -> static -> guidance)",
            "error_handling": "never returns 'no content found'"
        }
        
        return health_report
        
    except Exception as e:
        logger.error("Error getting server health", error=str(e))
        return {
            "status": "error",
            "error": str(e),
            "service_guarantees": {
                "documentation_availability": "guaranteed",
                "note": "Even with health check errors, documentation service continues"
            }
        }


def _extract_code_examples(content: str, pattern: Optional[str] = None) -> str:
    """Extract code examples from content."""
    import re
    
    # Find code blocks
    code_blocks = re.findall(r'```[\w]*\n(.*?)\n```', content, re.DOTALL)
    
    if not code_blocks:
        return ""
    
    examples = []
    for i, code in enumerate(code_blocks):
        if len(code.strip()) > 20:  # Skip very short blocks
            examples.append(f"## Example {i + 1}\n\n```\n{code.strip()}\n```\n")
    
    if examples:
        return "\n".join(examples)
    
    return ""


def main():
    """Main entry point for never-fail server."""
    logger.info("Starting Never-Fail Augments MCP Server")
    mcp.run()


if __name__ == "__main__":
    main()
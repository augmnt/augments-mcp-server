"""Framework update checking and cache refresh tools."""

from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import structlog
from mcp.server.fastmcp import Context
from fastmcp.exceptions import ToolError

from ..registry.manager import FrameworkRegistryManager
from ..registry.cache import DocumentationCache
from ..providers.github import GitHubProvider
from ..providers.website import WebsiteProvider
from ..utils.github_client import GitHubClient

logger = structlog.get_logger(__name__)


async def check_framework_updates(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    framework: str,
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Check if framework documentation has been updated since last cache.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        github_provider: GitHub provider for checking updates
        framework: Framework name to check
        ctx: MCP context for progress reporting
        
    Returns:
        Update status with last modified dates and change summary
    """
    try:
        if ctx:
            await ctx.info(f"Checking updates for {framework}")
        
        # Get framework configuration
        config = registry.get_framework(framework)
        if not config:
            error_msg = f"Framework '{framework}' not found in registry"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            raise ToolError(error_msg)
        
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Checking cache status")
        
        # Get current cache info
        cache_info = await cache.get_framework_cache_info(framework)
        
        # Check each source for updates
        update_results = {}
        
        # Check GitHub source
        if config.sources.documentation.github:
            if ctx:
                await ctx.debug(f"Checking GitHub updates for {config.sources.documentation.github.repo}")
            
            github_update = await _check_github_updates(
                github_provider,
                config.sources.documentation.github.repo,
                config.sources.documentation.github.docs_path,
                config.sources.documentation.github.branch,
                cache_info
            )
            update_results["github"] = github_update
        
        # Check website source (basic check)
        if config.sources.documentation.website:
            if ctx:
                await ctx.debug(f"Checking website updates for {config.sources.documentation.website}")
            
            website_update = await _check_website_updates(
                str(config.sources.documentation.website),
                cache_info
            )
            update_results["website"] = website_update
        
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Analyzing update status")
        
        # Determine overall update status
        has_updates = any(result.get("has_updates", False) for result in update_results.values())
        
        # Find the most recent update
        last_modified = None
        change_summary = []
        
        for source, result in update_results.items():
            if result.get("last_modified"):
                source_date = datetime.fromisoformat(result["last_modified"].replace('Z', '+00:00'))
                if not last_modified or source_date > last_modified:
                    last_modified = source_date
            
            if result.get("changes"):
                change_summary.extend(result["changes"])
        
        result = {
            "framework": framework,
            "display_name": config.display_name,
            "last_checked": datetime.now().isoformat(),
            "last_modified": last_modified.isoformat() if last_modified else None,
            "has_updates": has_updates,
            "change_summary": change_summary,
            "sources": update_results,
            "cache_info": cache_info
        }
        
        if ctx:
            status = "Updates available" if has_updates else "Up to date"
            await ctx.info(f"Update check completed for {framework}: {status}")
        
        logger.info("Framework update check completed", 
                   framework=framework,
                   has_updates=has_updates,
                   sources=len(update_results))
        
        return result
        
    except Exception as e:
        error_msg = f"Failed to check updates for {framework}: {str(e)}"
        logger.error("Update check failed", 
                    framework=framework,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


async def refresh_framework_cache(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: Optional[str] = None,
    force: bool = False,
    ctx: Optional[Context] = None
) -> str:
    """Refresh cached documentation for frameworks.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        github_provider: GitHub provider
        website_provider: Website provider
        framework: Specific framework to refresh, or None for all
        force: Force refresh even if cache is still valid
        ctx: MCP context for progress reporting
        
    Returns:
        Status message with refresh results
    """
    try:
        if framework:
            frameworks_to_refresh = [framework]
            if ctx:
                await ctx.info(f"Refreshing cache for {framework}")
        else:
            frameworks_to_refresh = list(registry.frameworks.keys())
            if ctx:
                await ctx.info(f"Refreshing cache for all {len(frameworks_to_refresh)} frameworks")
        
        refresh_results = []
        failed_refreshes = []
        
        for i, fw_name in enumerate(frameworks_to_refresh):
            if ctx:
                progress = (i + 1) / len(frameworks_to_refresh)
                await ctx.report_progress(progress * 0.9, 1.0, f"Refreshing {fw_name}")
            
            try:
                result = await _refresh_single_framework(
                    registry, cache, github_provider, website_provider,
                    fw_name, force
                )
                refresh_results.append(result)
                
            except Exception as e:
                logger.error("Failed to refresh framework cache", 
                           framework=fw_name, 
                           error=str(e))
                failed_refreshes.append(fw_name)
        
        # Generate summary
        total_refreshed = len([r for r in refresh_results if r.get("refreshed", False)])
        total_skipped = len([r for r in refresh_results if not r.get("refreshed", False)])
        
        summary_parts = []
        summary_parts.append("Cache refresh completed:")
        summary_parts.append(f"- Refreshed: {total_refreshed} frameworks")
        
        if total_skipped > 0:
            summary_parts.append(f"- Skipped (up-to-date): {total_skipped} frameworks")
        
        if failed_refreshes:
            summary_parts.append(f"- Failed: {len(failed_refreshes)} frameworks ({', '.join(failed_refreshes)})")
        
        summary = "\n".join(summary_parts)
        
        if ctx:
            await ctx.info(f"Cache refresh completed: {total_refreshed} refreshed, {total_skipped} skipped")
        
        logger.info("Framework cache refresh completed", 
                   total_frameworks=len(frameworks_to_refresh),
                   refreshed=total_refreshed,
                   skipped=total_skipped,
                   failed=len(failed_refreshes))
        
        return summary
        
    except Exception as e:
        error_msg = f"Cache refresh failed: {str(e)}"
        logger.error("Cache refresh failed", error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return f"Error: {error_msg}"


async def get_cache_statistics(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache
) -> Dict[str, Any]:
    """Get comprehensive cache statistics.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        
    Returns:
        Detailed cache statistics
    """
    try:
        # Get overall cache stats
        overall_stats = cache.get_stats()
        
        # Get per-framework stats
        framework_stats = []
        
        for framework_name in registry.frameworks.keys():
            fw_stats = await cache.get_framework_cache_info(framework_name)
            framework_stats.append(fw_stats)
        
        # Calculate totals
        total_memory_size = sum(
            len(entry.content) for entry in cache.memory_cache.values()
        )
        
        # Get cache age information
        cache_ages = []
        current_time = datetime.now()
        
        for entry in cache.memory_cache.values():
            cached_time = datetime.fromtimestamp(entry.cached_at)
            age_hours = (current_time - cached_time).total_seconds() / 3600
            cache_ages.append(age_hours)
        
        avg_cache_age = sum(cache_ages) / len(cache_ages) if cache_ages else 0
        
        result = {
            "overall": overall_stats,
            "frameworks": framework_stats,
            "summary": {
                "total_frameworks": len(framework_stats),
                "total_memory_size_bytes": total_memory_size,
                "average_cache_age_hours": round(avg_cache_age, 2),
                "oldest_cache_hours": max(cache_ages) if cache_ages else 0,
                "newest_cache_hours": min(cache_ages) if cache_ages else 0
            }
        }
        
        logger.debug("Cache statistics retrieved", 
                    frameworks=len(framework_stats),
                    memory_entries=overall_stats["memory_entries"])
        
        return result
        
    except Exception as e:
        logger.error("Failed to get cache statistics", error=str(e))
        raise ToolError(f"Failed to get cache statistics: {str(e)}")


async def _check_github_updates(
    github_provider: GitHubProvider,
    repo: str,
    docs_path: str,
    branch: str,
    cache_info: Dict[str, Any]
) -> Dict[str, Any]:
    """Check for updates in a GitHub repository."""
    try:
        # Get recent commits for the docs path
        async with GitHubClient() as client:
            # Check commits in the last week
            since_date = datetime.now() - timedelta(days=7)
            commits = await client.get_commits(
                repo=repo,
                path=docs_path,
                since=since_date,
                limit=10
            )
        
        if not commits:
            return {
                "has_updates": False,
                "last_modified": None,
                "changes": []
            }
        
        # Get the most recent commit
        latest_commit = commits[0]
        commit_date = latest_commit["commit"]["committer"]["date"]
        
        # Check if this is newer than our cache
        last_cached = cache_info.get("last_modified")
        has_updates = True
        
        if last_cached:
            try:
                cached_date = datetime.fromisoformat(last_cached.replace('Z', '+00:00'))
                commit_datetime = datetime.fromisoformat(commit_date.replace('Z', '+00:00'))
                has_updates = commit_datetime > cached_date
            except Exception:
                has_updates = True  # Default to has updates if date parsing fails
        
        # Extract change summaries
        changes = []
        for commit in commits[:5]:  # Last 5 commits
            message = commit["commit"]["message"]
            # Take first line of commit message
            first_line = message.split('\n')[0]
            changes.append(first_line)
        
        return {
            "has_updates": has_updates,
            "last_modified": commit_date,
            "changes": changes,
            "commit_count": len(commits)
        }
        
    except Exception as e:
        logger.warning("GitHub update check failed", 
                      repo=repo, 
                      path=docs_path, 
                      error=str(e))
        return {
            "error": str(e),
            "has_updates": False
        }


async def _check_website_updates(
    website_url: str,
    cache_info: Dict[str, Any]
) -> Dict[str, Any]:
    """Check for updates on a website (basic check)."""
    try:
        import httpx
        
        async with httpx.AsyncClient() as client:
            response = await client.head(website_url, timeout=10.0)
            
            # Check Last-Modified header
            last_modified = response.headers.get("Last-Modified")
            etag = response.headers.get("ETag")
            
            has_updates = True  # Default to assuming updates
            
            if last_modified:
                try:
                    from email.utils import parsedate_to_datetime
                    modified_date = parsedate_to_datetime(last_modified)
                    
                    last_cached = cache_info.get("last_modified")
                    if last_cached:
                        cached_date = datetime.fromisoformat(last_cached.replace('Z', '+00:00'))
                        has_updates = modified_date > cached_date
                    
                    return {
                        "has_updates": has_updates,
                        "last_modified": modified_date.isoformat(),
                        "etag": etag,
                        "changes": ["Website content may have been updated"] if has_updates else []
                    }
                except Exception:
                    pass
            
            # Fallback - assume updates if we can't determine
            return {
                "has_updates": True,
                "last_modified": datetime.now().isoformat(),
                "changes": ["Unable to determine update status - manual check recommended"]
            }
            
    except Exception as e:
        logger.warning("Website update check failed", 
                      url=website_url, 
                      error=str(e))
        return {
            "error": str(e),
            "has_updates": False
        }


async def _refresh_single_framework(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    force: bool
) -> Dict[str, Any]:
    """Refresh cache for a single framework."""
    
    config = registry.get_framework(framework)
    if not config:
        raise ValueError(f"Framework '{framework}' not found")
    
    # Check if refresh is needed
    if not force:
        cache_info = await cache.get_framework_cache_info(framework)
        
        # Skip if recently cached (within last hour)
        if cache_info.get("memory_entries", 0) > 0:
            # Simple heuristic - skip if we have cached content
            return {
                "framework": framework,
                "refreshed": False,
                "reason": "Recently cached content found"
            }
    
    refresh_count = 0
    
    # Refresh documentation
    doc_source = config.sources.documentation
    
    if doc_source.github:
        try:
            # Invalidate existing cache
            await cache.invalidate(framework, "", "docs")
            
            # Fetch fresh content
            fresh_content = await github_provider.fetch_documentation(
                repo=doc_source.github.repo,
                path=doc_source.github.docs_path,
                branch=doc_source.github.branch
            )
            
            if fresh_content:
                await cache.set(
                    framework=framework,
                    content=fresh_content,
                    path="",
                    source_type="docs",
                    version=config.version,
                    branch=doc_source.github.branch
                )
                refresh_count += 1
        except Exception as e:
            logger.warning("GitHub cache refresh failed", 
                          framework=framework, 
                          repo=doc_source.github.repo,
                          error=str(e))
    
    if doc_source.website:
        try:
            # Invalidate existing cache
            await cache.invalidate(framework, "", "website")
            
            # Fetch fresh content
            fresh_content = await website_provider.fetch_documentation(
                str(doc_source.website)
            )
            
            if fresh_content:
                await cache.set(
                    framework=framework,
                    content=fresh_content,
                    path="website",
                    source_type="docs",
                    version=config.version
                )
                refresh_count += 1
        except Exception as e:
            logger.warning("Website cache refresh failed", 
                          framework=framework, 
                          url=str(doc_source.website),
                          error=str(e))
    
    # Refresh examples if available
    if config.sources.examples:
        examples_source = config.sources.examples
        
        if examples_source.github:
            try:
                await cache.invalidate(framework, "", "examples")
                
                fresh_examples = await github_provider.fetch_examples(
                    repo=examples_source.github.repo,
                    path=examples_source.github.docs_path,
                    branch=examples_source.github.branch
                )
                
                if fresh_examples:
                    await cache.set(
                        framework=framework,
                        content=fresh_examples,
                        path="examples",
                        source_type="examples",
                        version=config.version,
                        branch=examples_source.github.branch
                    )
                    refresh_count += 1
            except Exception as e:
                logger.warning("Examples cache refresh failed", 
                              framework=framework,
                              error=str(e))
    
    return {
        "framework": framework,
        "refreshed": refresh_count > 0,
        "items_refreshed": refresh_count,
        "timestamp": datetime.now().isoformat()
    }
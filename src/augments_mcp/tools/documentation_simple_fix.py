"""Simple fix for documentation retrieval - always fetch if cache empty."""

import re
from typing import Optional, Dict, Any, List
import structlog
from mcp.server.fastmcp import Context

from ..registry.manager import FrameworkRegistryManager
from ..registry.cache import DocumentationCache
from ..providers.github import GitHubProvider
from ..providers.website import WebsiteProvider

logger = structlog.get_logger(__name__)


async def get_framework_docs(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Retrieve framework documentation with simple fallback logic.
    
    Simple strategy:
    1. Check cache first (if use_cache=True)
    2. If not cached, fetch fresh from sources
    3. Cache the result for next time
    
    No complex fallbacks - just ensure we always try to fetch when cache is empty.
    """
    try:
        if ctx:
            await ctx.info(f"Retrieving documentation for {framework}")
        
        # Get framework configuration
        config = registry.get_framework(framework)
        if not config:
            error_msg = f"Framework '{framework}' not found in registry"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            return f"Error: {error_msg}"
        
        # Step 1: Try cache first if enabled
        cached_content = None
        if use_cache:
            cached_content = await cache.get(framework, section or "", "docs")
            if cached_content:
                logger.debug("Documentation retrieved from cache", framework=framework)
                if ctx:
                    await ctx.debug("Using cached documentation")
                return cached_content
        
        # Step 2: Cache miss or cache disabled - fetch fresh content
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Fetching documentation from sources")
        
        documentation_parts = []
        
        # Try GitHub source first
        doc_source = config.sources.documentation
        if doc_source.github:
            if ctx:
                await ctx.debug(f"Fetching from GitHub: {doc_source.github.repo}")
            
            try:
                github_content = await github_provider.fetch_documentation(
                    repo=doc_source.github.repo,
                    path=section or doc_source.github.docs_path,
                    branch=doc_source.github.branch
                )
                
                if github_content:
                    documentation_parts.append({
                        "source": "GitHub",
                        "repo": doc_source.github.repo,
                        "content": github_content
                    })
                    logger.info("Successfully fetched from GitHub", framework=framework)
            except Exception as e:
                logger.warning("GitHub fetch failed", framework=framework, error=str(e))
        
        # Try website source if GitHub didn't work or as supplement
        if doc_source.website and not documentation_parts:  # Only try website if GitHub failed
            if ctx:
                await ctx.debug(f"Fetching from website: {doc_source.website}")
            
            try:
                website_url = str(doc_source.website)
                if section:
                    # Check if framework has section mappings
                    if hasattr(config, 'sections') and config.sections and section in config.sections:
                        section_path = config.sections[section]
                    else:
                        section_path = section
                    
                    # Try to append section to URL
                    if not website_url.endswith('/'):
                        website_url += '/'
                    website_url += section_path
                
                website_content = await website_provider.fetch_documentation(website_url)
                if website_content:
                    documentation_parts.append({
                        "source": "Website",
                        "url": website_url,
                        "content": website_content
                    })
                    logger.info("Successfully fetched from website", framework=framework)
            except Exception as e:
                logger.warning("Website fetch failed", framework=framework, error=str(e))
        
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Processing documentation")
        
        # Check if we got content from any source
        if not documentation_parts:
            error_msg = f"No documentation found for {framework}"
            if section:
                error_msg += f" (section: {section})"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            return f"Error: {error_msg}"
        
        # Step 3: Format the documentation
        formatted_docs = await _format_documentation(framework, documentation_parts, config)
        
        # Step 4: Cache the result for future requests
        if use_cache and formatted_docs and cache:
            try:
                await cache.set(
                    framework=framework,
                    content=formatted_docs,
                    path=section or "",
                    source_type="docs",
                    version=config.version
                )
                logger.info("Fresh documentation cached", framework=framework)
            except Exception as e:
                logger.warning("Failed to cache documentation", error=str(e))
        
        if ctx:
            await ctx.info(f"Documentation retrieved successfully for {framework}")
        
        logger.info("Documentation retrieved", 
                   framework=framework, 
                   section=section,
                   sources=len(documentation_parts))
        
        return formatted_docs
        
    except Exception as e:
        error_msg = f"Failed to retrieve documentation for {framework}: {str(e)}"
        logger.error("Documentation retrieval failed", 
                    framework=framework, 
                    section=section,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return f"Error: {error_msg}"


async def get_framework_examples(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    pattern: Optional[str] = None,
    ctx: Optional[Context] = None
) -> str:
    """Get code examples with simple cache-or-fetch logic."""
    try:
        if ctx:
            await ctx.info(f"Retrieving examples for {framework}")
        
        # Get framework configuration
        config = registry.get_framework(framework)
        if not config:
            error_msg = f"Framework '{framework}' not found in registry"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            return f"Error: {error_msg}"
        
        # Check cache first
        cache_key_suffix = f"examples:{pattern or 'general'}"
        cached_content = await cache.get(framework, cache_key_suffix, "examples")
        if cached_content:
            logger.debug("Examples retrieved from cache", framework=framework)
            if ctx:
                await ctx.debug("Using cached examples")
            return cached_content
        
        # Cache miss - fetch fresh examples
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Fetching examples from sources")
        
        examples_parts = []
        
        # Try examples source first
        if config.sources.examples:
            examples_source = config.sources.examples
            
            if examples_source.github:
                if ctx:
                    await ctx.debug(f"Fetching examples from GitHub: {examples_source.github.repo}")
                
                try:
                    examples_path = pattern or examples_source.github.docs_path
                    github_examples = await github_provider.fetch_examples(
                        repo=examples_source.github.repo,
                        path=examples_path,
                        branch=examples_source.github.branch,
                        pattern=pattern
                    )
                    
                    if github_examples:
                        examples_parts.append({
                            "source": "GitHub Examples",
                            "repo": examples_source.github.repo,
                            "content": github_examples
                        })
                except Exception as e:
                    logger.warning("GitHub examples fetch failed", error=str(e))
        
        # Fallback to main documentation source if no examples source
        if not examples_parts:
            doc_source = config.sources.documentation
            
            if doc_source.github:
                # Look for examples in common directories
                example_paths = ["examples", "docs/examples", "samples", "demos"]
                if pattern:
                    example_paths = [f"{path}/{pattern}" for path in example_paths]
                
                for example_path in example_paths:
                    try:
                        github_examples = await github_provider.fetch_examples(
                            repo=doc_source.github.repo,
                            path=example_path,
                            branch=doc_source.github.branch,
                            pattern=pattern
                        )
                        
                        if github_examples:
                            examples_parts.append({
                                "source": "GitHub Documentation",
                                "repo": doc_source.github.repo,
                                "path": example_path,
                                "content": github_examples
                            })
                            break  # Use first successful result
                    except Exception as e:
                        logger.debug("Example path failed", path=example_path, error=str(e))
                        continue
        
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Processing examples")
        
        if not examples_parts:
            error_msg = f"No examples found for {framework}"
            if pattern:
                error_msg += f" (pattern: {pattern})"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            return f"Error: {error_msg}"
        
        # Format the examples
        formatted_examples = await _format_examples(framework, examples_parts, pattern, config)
        
        # Cache the result
        if formatted_examples:
            try:
                await cache.set(
                    framework=framework,
                    content=formatted_examples,
                    path=cache_key_suffix,
                    source_type="examples",
                    version=config.version
                )
                logger.info("Examples cached successfully", framework=framework)
            except Exception as e:
                logger.warning("Failed to cache examples", error=str(e))
        
        if ctx:
            await ctx.info(f"Examples retrieved successfully for {framework}")
        
        logger.info("Examples retrieved", 
                   framework=framework, 
                   pattern=pattern,
                   sources=len(examples_parts))
        
        return formatted_examples
        
    except Exception as e:
        error_msg = f"Failed to retrieve examples for {framework}: {str(e)}"
        logger.error("Examples retrieval failed", 
                    framework=framework, 
                    pattern=pattern,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return f"Error: {error_msg}"


async def _format_documentation(
    framework: str, 
    documentation_parts: List[Dict[str, Any]], 
    config
) -> str:
    """Format documentation content from multiple sources."""
    
    formatted_parts = []
    
    # Add header
    formatted_parts.append(f"# {config.display_name} Documentation")
    formatted_parts.append(f"**Category:** {config.category} | **Type:** {config.type} | **Version:** {config.version}")
    formatted_parts.append("")
    
    # Add key features
    if config.key_features:
        formatted_parts.append("## Key Features")
        for feature in config.key_features:
            formatted_parts.append(f"- {feature}")
        formatted_parts.append("")
    
    # Add documentation content
    for i, part in enumerate(documentation_parts):
        if len(documentation_parts) > 1:
            formatted_parts.append(f"## Documentation Source {i+1}: {part['source']}")
            if 'repo' in part:
                formatted_parts.append(f"**Repository:** {part['repo']}")
            if 'url' in part:
                formatted_parts.append(f"**URL:** {part['url']}")
            formatted_parts.append("")
        
        # Clean and format the content
        content = part['content']
        content = _clean_markdown_content(content)
        formatted_parts.append(content)
        formatted_parts.append("")
    
    # Add common patterns
    if config.common_patterns:
        formatted_parts.append("## Common Patterns")
        for pattern in config.common_patterns:
            formatted_parts.append(f"- {pattern}")
        formatted_parts.append("")
    
    return "\n".join(formatted_parts)


async def _format_examples(
    framework: str, 
    examples_parts: List[Dict[str, Any]], 
    pattern: Optional[str],
    config
) -> str:
    """Format examples content from multiple sources."""
    
    formatted_parts = []
    
    # Add header
    title = f"{config.display_name} Examples"
    if pattern:
        title += f" - {pattern.title()}"
    formatted_parts.append(f"# {title}")
    formatted_parts.append("")
    
    # Add examples content
    for i, part in enumerate(examples_parts):
        if len(examples_parts) > 1:
            formatted_parts.append(f"## Examples Source {i+1}: {part['source']}")
            if 'repo' in part:
                formatted_parts.append(f"**Repository:** {part['repo']}")
            if 'url' in part:
                formatted_parts.append(f"**URL:** {part['url']}")
            if 'path' in part:
                formatted_parts.append(f"**Path:** {part['path']}")
            formatted_parts.append("")
        
        # Clean and format the content
        content = part['content']
        content = _clean_markdown_content(content)
        formatted_parts.append(content)
        formatted_parts.append("")
    
    return "\n".join(formatted_parts)


def _clean_markdown_content(content: str) -> str:
    """Clean and normalize markdown content."""
    if not content:
        return ""
    
    # Remove excessive whitespace
    content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
    
    # Fix heading levels (ensure they start at level 1)
    lines = content.split('\n')
    min_heading_level = float('inf')
    
    for line in lines:
        if line.strip().startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            min_heading_level = min(min_heading_level, level)
    
    if min_heading_level > 1 and min_heading_level != float('inf'):
        # Adjust heading levels
        adjustment = min_heading_level - 1
        adjusted_lines = []
        for line in lines:
            if line.strip().startswith('#'):
                level = len(line) - len(line.lstrip('#'))
                new_level = level - adjustment
                new_line = '#' * new_level + line.lstrip('#')
                adjusted_lines.append(new_line)
            else:
                adjusted_lines.append(line)
        content = '\n'.join(adjusted_lines)
    
    # Remove trailing whitespace
    content = '\n'.join(line.rstrip() for line in content.split('\n'))
    
    return content.strip()
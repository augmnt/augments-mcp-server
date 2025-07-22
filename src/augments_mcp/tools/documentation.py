"""Documentation retrieval and processing tools."""

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
    """Retrieve comprehensive documentation for a specific framework.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        github_provider: GitHub documentation provider
        website_provider: Website documentation provider
        framework: Framework name (e.g., 'react', 'tailwind', 'laravel')
        section: Specific documentation section (e.g., 'installation', 'configuration')
        use_cache: Whether to use cached content
        ctx: MCP context for progress reporting
        
    Returns:
        Formatted documentation content with examples and best practices
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
        
        # Try cache first
        if use_cache:
            cached_content = await cache.get(framework, section or "", "docs")
            if cached_content:
                logger.debug("Documentation retrieved from cache", framework=framework)
                if ctx:
                    await ctx.debug("Using cached documentation")
                return cached_content
        
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Fetching documentation from sources")
        
        # Fetch from sources
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
            except Exception as e:
                logger.warning("GitHub fetch failed", framework=framework, error=str(e))
                if ctx:
                    await ctx.debug(f"GitHub fetch failed: {str(e)}")
        
        # Try website source if GitHub didn't work or as supplement
        if doc_source.website and (not documentation_parts or section):
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
            except Exception as e:
                logger.warning("Website fetch failed", framework=framework, error=str(e))
                if ctx:
                    await ctx.debug(f"Website fetch failed: {str(e)}")
        
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Processing documentation")
        
        if not documentation_parts:
            error_msg = f"No documentation found for {framework}"
            if section:
                error_msg += f" (section: {section})"
            logger.warning(error_msg)
            if ctx:
                await ctx.warning(error_msg)
            return f"Error: {error_msg}"
        
        # Format the documentation
        formatted_docs = await _format_documentation(framework, documentation_parts, config)
        
        # Cache the result
        if use_cache and formatted_docs:
            await cache.set(
                framework=framework,
                content=formatted_docs,
                path=section or "",
                source_type="docs",
                version=config.version
            )
        
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
    """Get code examples for specific patterns within a framework.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache  
        github_provider: GitHub documentation provider
        website_provider: Website documentation provider
        framework: Framework name
        pattern: Specific pattern (e.g., 'components', 'routing', 'authentication')
        ctx: MCP context for progress reporting
        
    Returns:
        Code examples with explanations and best practices
    """
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
                    logger.warning("GitHub examples fetch failed", framework=framework, error=str(e))
            
            if examples_source.website:
                try:
                    website_url = str(examples_source.website)
                    if pattern:
                        if not website_url.endswith('/'):
                            website_url += '/'
                        website_url += pattern
                    
                    website_examples = await website_provider.fetch_examples(website_url, pattern)
                    if website_examples:
                        examples_parts.append({
                            "source": "Website Examples",
                            "url": website_url,
                            "content": website_examples
                        })
                except Exception as e:
                    logger.warning("Website examples fetch failed", framework=framework, error=str(e))
        
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
            # Try to extract examples from main documentation
            doc_content = await get_framework_docs(
                registry, cache, github_provider, website_provider,
                framework, pattern, True, None
            )
            
            if doc_content and not doc_content.startswith("Error:"):
                extracted_examples = _extract_examples_from_docs(doc_content, pattern)
                if extracted_examples:
                    examples_parts.append({
                        "source": "Extracted from Documentation",
                        "content": extracted_examples
                    })
        
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
            await cache.set(
                framework=framework,
                content=formatted_examples,
                path=cache_key_suffix,
                source_type="examples",
                version=config.version
            )
        
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


async def search_documentation(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    query: str,
    limit: int = 10,
    ctx: Optional[Context] = None
) -> List[Dict[str, Any]]:
    """Smart search within a framework's documentation with fallback to fresh docs.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        github_provider: GitHub documentation provider
        website_provider: Website documentation provider
        framework: Framework name to search within
        query: Search query
        limit: Maximum number of results
        ctx: MCP context for progress reporting
        
    Returns:
        List of search results with context
    """
    try:
        if ctx:
            await ctx.info(f"Searching documentation for {framework}: {query}")
        
        # First try: Search cached documentation
        doc_content = await cache.get(framework, "", "docs")
        if doc_content:
            results = _search_text_content(doc_content, query, limit)
            if results:
                logger.info("Documentation search completed using cache", 
                           framework=framework, query=query, results=len(results))
                if ctx:
                    await ctx.debug("Found results in cached documentation")
                return results
        
        # Second try: Fetch fresh documentation and search within it
        if ctx:
            await ctx.info("No cached results found, fetching fresh documentation")
        
        # Try to infer section from query for more targeted fetch
        inferred_section = _infer_section_from_query(query)
        
        fresh_docs = await get_framework_docs(
            registry=registry,
            cache=cache,
            github_provider=github_provider,
            website_provider=website_provider,
            framework=framework,
            section=inferred_section,
            use_cache=False,  # Force fresh fetch
            ctx=ctx
        )
        
        if fresh_docs and not fresh_docs.startswith("Error:"):
            # Search within fresh documentation
            results = _search_text_content(fresh_docs, query, limit)
            
            if results:
                logger.info("Documentation search completed using fresh docs", 
                           framework=framework, query=query, results=len(results))
                if ctx:
                    await ctx.info(f"Found {len(results)} results in fresh documentation")
                return results
        
        # Third try: Search across different types of cached content for the framework
        try:
            # Try searching examples cache if docs search failed
            examples_content = await cache.get(framework, "", "examples")
            if examples_content:
                results = _search_text_content(examples_content, query, limit)
                if results:
                    logger.info("Documentation search found results in cached examples", 
                               framework=framework, query=query)
                    if ctx:
                        await ctx.info("Found results in cached examples")
                    return results
        except Exception as e:
            logger.debug("Failed to search examples cache", error=str(e))
        
        logger.warning("No search results found", framework=framework, query=query)
        if ctx:
            await ctx.warning(f"No documentation found for query: {query}")
        return []
        
    except Exception as e:
        logger.error("Documentation search failed", 
                    framework=framework, query=query, error=str(e))
        if ctx:
            await ctx.error(f"Search failed: {str(e)}")
        return []


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
                new_line = '#' * int(new_level) + line.lstrip('#')
                adjusted_lines.append(new_line)
            else:
                adjusted_lines.append(line)
        content = '\n'.join(adjusted_lines)
    
    # Remove trailing whitespace
    content = '\n'.join(line.rstrip() for line in content.split('\n'))
    
    return content.strip()


def _extract_examples_from_docs(doc_content: str, pattern: Optional[str]) -> str:
    """Extract code examples from documentation content."""
    if not doc_content:
        return ""
    
    # Find code blocks
    code_blocks = re.findall(r'```[\w]*\n(.*?)\n```', doc_content, re.DOTALL)
    
    if not code_blocks:
        return ""
    
    examples = []
    
    for i, code_block in enumerate(code_blocks):
        # Skip very short code blocks
        if len(code_block.strip()) < 20:
            continue
        
        # If pattern is specified, try to filter relevant examples
        if pattern:
            pattern_lower = pattern.lower()
            code_lower = code_block.lower()
            
            # Check if the code block is relevant to the pattern
            if not any(keyword in code_lower for keyword in [
                pattern_lower, 
                pattern_lower.replace('-', ''), 
                pattern_lower.replace('_', '')
            ]):
                continue
        
        examples.append(f"### Example {i+1}\n\n```\n{code_block.strip()}\n```\n")
    
    if not examples:
        return ""
    
    result = "## Code Examples\n\n" + "\n".join(examples)
    return result


def _search_text_content(content: str, query: str, limit: int) -> List[Dict[str, Any]]:
    """Search for query within text content and return relevant sections."""
    if not content or not query:
        return []
    
    query_lower = query.lower()
    lines = content.split('\n')
    results = []
    
    # Search for matches
    for i, line in enumerate(lines):
        if query_lower in line.lower():
            # Get context around the match
            start_idx = max(0, i - 2)
            end_idx = min(len(lines), i + 3)
            
            context_lines = lines[start_idx:end_idx]
            context = '\n'.join(context_lines)
            
            # Highlight the matching line
            highlighted_context = context.replace(
                line, 
                f"**{line}**" if line.strip() else line
            )
            
            results.append({
                "line_number": i + 1,
                "content": highlighted_context,
                "relevance": _calculate_relevance(line, query)
            })
            
            if len(results) >= limit:
                break
    
    # Sort by relevance  
    results.sort(key=lambda x: -x['relevance'] if isinstance(x['relevance'], (int, float)) else 0.0)
    
    return results[:limit]


def _calculate_relevance(text: str, query: str) -> float:
    """Calculate relevance score for search results."""
    text_lower = text.lower()
    query_lower = query.lower()
    
    # Exact match gets highest score
    if query_lower == text_lower.strip():
        return 100.0
    
    # Count occurrences
    occurrences = text_lower.count(query_lower)
    if occurrences == 0:
        return 0.0
    
    # Base score from occurrences
    score = float(occurrences * 10)
    
    # Boost for word boundaries
    if re.search(r'\b' + re.escape(query_lower) + r'\b', text_lower):
        score += 20
    
    # Boost for beginning of line
    if text_lower.strip().startswith(query_lower):
        score += 15
    
    # Penalty for very long lines
    if len(text) > 200:
        score *= 0.8
    
    return min(score, 100.0)


def _infer_section_from_query(query: str) -> Optional[str]:
    """Infer documentation section from search query."""
    query_lower = query.lower()
    
    # Common section mappings
    section_mappings = {
        'app router': 'app-router',
        'router': 'routing',
        'routing': 'routing',
        'installation': 'installation',
        'install': 'installation',
        'setup': 'installation',
        'getting started': 'getting-started',
        'start': 'getting-started',
        'config': 'configuration',
        'configuration': 'configuration',
        'api': 'api',
        'component': 'components',
        'components': 'components',
        'hook': 'hooks',
        'hooks': 'hooks',
        'auth': 'authentication',
        'authentication': 'authentication',
        'deploy': 'deployment',
        'deployment': 'deployment',
        'testing': 'testing',
        'test': 'testing',
        'styling': 'styling',
        'css': 'styling',
        'dark mode': 'theming',
        'theme': 'theming',
        'theming': 'theming'
    }
    
    # Check for direct matches
    for keyword, section in section_mappings.items():
        if keyword in query_lower:
            return section
    
    return None
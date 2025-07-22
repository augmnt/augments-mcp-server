"""Improved documentation retrieval with graceful fallbacks."""

import re
from typing import Optional, Dict, Any, List
import structlog
from mcp.server.fastmcp import Context

from ..registry.manager import FrameworkRegistryManager
from ..registry.cache import DocumentationCache
from ..providers.github import GitHubProvider
from ..providers.website import WebsiteProvider

logger = structlog.get_logger(__name__)

# Static fallback content for common frameworks
FALLBACK_CONTENT = {
    "nextjs": """# Next.js - React Framework
**Category:** web | **Type:** react-framework | **Version:** latest

## Overview
Next.js is a React framework for building full-stack web applications with features like:
- App Router for modern routing
- Server-side rendering (SSR)
- Static site generation (SSG)
- API routes
- Image optimization
- TypeScript support

## Quick Start
```bash
npx create-next-app@latest my-app
cd my-app
npm run dev
```

## Key Concepts
- **App Router**: File-based routing in the `app/` directory
- **Server Components**: Components that render on the server
- **Client Components**: Interactive components marked with 'use client'
- **Layouts**: Shared UI across multiple pages

## Common Patterns
- file-based-routing
- server-components
- client-components
- data-fetching
- layout-patterns

*Note: This is fallback content. For the latest documentation, please visit https://nextjs.org/docs*
""",
    
    "react": """# React - JavaScript Library
**Category:** web | **Type:** library | **Version:** latest

## Overview
React is a JavaScript library for building user interfaces with:
- Component-based architecture
- Virtual DOM
- Hooks for state management
- JSX syntax
- Unidirectional data flow

## Quick Start
```jsx
import React from 'react';

function App() {
  return <h1>Hello, React!</h1>;
}

export default App;
```

## Key Concepts
- **Components**: Reusable UI pieces
- **Props**: Data passed to components
- **State**: Component data that changes over time
- **Hooks**: Functions to use React features

## Common Patterns
- functional-components
- state-management
- component-composition
- custom-hooks

*Note: This is fallback content. For the latest documentation, please visit https://react.dev*
""",

    "tailwindcss": """# Tailwind CSS - Utility-First CSS Framework
**Category:** web | **Type:** css-framework | **Version:** latest

## Overview
Tailwind CSS is a utility-first CSS framework with:
- Pre-built utility classes
- Responsive design
- Dark mode support
- Component-friendly
- Customizable design system

## Quick Start
```html
<div class="bg-blue-500 text-white p-4 rounded-lg">
  <h1 class="text-xl font-bold">Hello Tailwind!</h1>
</div>
```

## Key Concepts
- **Utility Classes**: Single-purpose classes like `p-4`, `text-xl`
- **Responsive Design**: Breakpoint prefixes like `md:`, `lg:`
- **Dark Mode**: `dark:` prefix for dark mode styles
- **Customization**: Configure via `tailwind.config.js`

## Common Patterns
- utility-first-styling
- responsive-design
- dark-mode
- custom-components

*Note: This is fallback content. For the latest documentation, please visit https://tailwindcss.com/docs*
""",

    "fastapi": """# FastAPI - Modern Python Web Framework
**Category:** backend | **Type:** web-framework | **Version:** latest

## Overview
FastAPI is a modern Python web framework with:
- Automatic API documentation
- Type hints integration
- Async/await support
- Data validation with Pydantic
- High performance

## Quick Start
```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def read_root():
    return {"Hello": "World"}

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str = None):
    return {"item_id": item_id, "q": q}
```

## Key Concepts
- **Path Parameters**: Dynamic URL segments
- **Query Parameters**: URL query strings
- **Request Bodies**: JSON data validation
- **Dependency Injection**: Reusable dependencies

## Common Patterns
- request-response-models
- async-endpoints
- middleware-patterns
- database-integration

*Note: This is fallback content. For the latest documentation, please visit https://fastapi.tiangolo.com*
"""
}

async def get_framework_docs_with_fallback(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    github_provider: GitHubProvider,
    website_provider: WebsiteProvider,
    framework: str,
    section: Optional[str] = None,
    use_cache: bool = True,
    ctx: Optional[Context] = None
) -> str:
    """Retrieve framework documentation with graceful fallbacks.
    
    This improved version provides multiple fallback strategies:
    1. Try cache first
    2. Try fresh fetch from sources
    3. Provide static fallback content
    4. Return helpful error with suggestions
    """
    try:
        if ctx:
            await ctx.info(f"Retrieving documentation for {framework}")
        
        # Get framework configuration
        config = registry.get_framework(framework)
        if not config:
            # Even if framework not in registry, try to provide something useful
            return _generate_framework_not_found_response(framework)
        
        # Step 1: Try cache first
        if use_cache:
            cached_content = await cache.get(framework, section or "", "docs")
            if cached_content:
                logger.debug("Documentation retrieved from cache", framework=framework)
                if ctx:
                    await ctx.debug("Using cached documentation")
                return cached_content
        
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Fetching documentation from sources")
        
        # Step 2: Try fresh fetch from sources
        try:
            documentation_parts = []
            
            # Try GitHub source first
            doc_source = config.sources.documentation
            if doc_source.github:
                if ctx:
                    await ctx.debug(f"Fetching from GitHub: {doc_source.github.repo}")
                
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
            
            # Try website source if GitHub didn't work or as supplement
            if doc_source.website and (not documentation_parts or section):
                if ctx:
                    await ctx.debug(f"Fetching from website: {doc_source.website}")
                
                website_url = str(doc_source.website)
                if section:
                    if not website_url.endswith('/'):
                        website_url += '/'
                    website_url += section
                
                website_content = await website_provider.fetch_documentation(website_url)
                if website_content:
                    documentation_parts.append({
                        "source": "Website",
                        "url": website_url,
                        "content": website_content
                    })
            
            # If we got fresh content, format and cache it
            if documentation_parts:
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
                
                logger.info("Documentation retrieved from sources", 
                           framework=framework, 
                           section=section,
                           sources=len(documentation_parts))
                
                return formatted_docs
                
        except Exception as fetch_error:
            logger.warning("Failed to fetch from external sources", 
                          framework=framework, error=str(fetch_error))
        
        # Step 3: Try static fallback content
        if framework.lower() in FALLBACK_CONTENT:
            if ctx:
                await ctx.info("Using fallback documentation content")
            
            logger.info("Using fallback content", framework=framework)
            return FALLBACK_CONTENT[framework.lower()]
        
        # Step 4: Generate helpful error with suggestions
        return _generate_helpful_error_response(framework, section, config)
        
    except Exception as e:
        error_msg = f"Failed to retrieve documentation for {framework}: {str(e)}"
        logger.error("Documentation retrieval failed", 
                    framework=framework, 
                    section=section,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return f"Error: {error_msg}"


def _generate_framework_not_found_response(framework: str) -> str:
    """Generate helpful response when framework is not in registry."""
    return f"""# Framework '{framework}' Not Found

The framework '{framework}' is not currently in our registry.

## What you can do:
1. **Check the spelling** - Make sure the framework name is correct
2. **Try similar frameworks** - Consider alternatives like:
   - For web frameworks: `react`, `nextjs`, `vue`, `angular`
   - For CSS frameworks: `tailwindcss`, `bootstrap`, `chakra-ui`
   - For backend: `fastapi`, `express`, `django`, `laravel`
3. **Use general information** - While I don't have specific docs, I can still help with:
   - General programming concepts
   - Code structure and patterns
   - Best practices

## Available Frameworks
To see all available frameworks, ask me to list them or search for specific categories.

*Tip: Try asking for 'list available frameworks' to see what's supported.*
"""


def _generate_helpful_error_response(
    framework: str, 
    section: Optional[str], 
    config: Any
) -> str:
    """Generate helpful error response with actionable suggestions."""
    
    base_msg = f"# {config.display_name} Documentation Temporarily Unavailable\n\n"
    
    # Add framework info we do have
    base_msg += f"**Category:** {config.category} | **Type:** {config.type}\n\n"
    
    # Add known features
    if config.key_features:
        base_msg += "## Known Features\n"
        for feature in config.key_features:
            base_msg += f"- {feature}\n"
        base_msg += "\n"
    
    # Add helpful suggestions
    base_msg += "## What happened?\n"
    base_msg += "The documentation sources are temporarily unavailable, but here's what you can do:\n\n"
    
    base_msg += "### 1. Try Basic Assistance\n"
    base_msg += "I can still help with general questions about this framework using my training data.\n\n"
    
    base_msg += "### 2. Check Official Sources\n"
    if hasattr(config.sources.documentation, 'website') and config.sources.documentation.website:
        base_msg += f"- Official docs: {config.sources.documentation.website}\n"
    if hasattr(config.sources.documentation, 'github') and config.sources.documentation.github:
        base_msg += f"- GitHub repo: https://github.com/{config.sources.documentation.github.repo}\n"
    base_msg += "\n"
    
    base_msg += "### 3. Try Again Later\n"
    base_msg += "The documentation cache may be rebuilding. Try again in a few minutes.\n\n"
    
    base_msg += "### 4. Ask Specific Questions\n"
    base_msg += "Instead of requesting docs, try asking specific questions like:\n"
    base_msg += f"- 'How do I get started with {framework}?'\n"
    base_msg += f"- 'Show me a basic {framework} example'\n"
    base_msg += f"- 'What are the key concepts in {framework}?'\n\n"
    
    if section:
        base_msg += f"*Note: You requested the '{section}' section specifically. Try requesting general documentation first.*\n"
    
    return base_msg


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
            formatted_parts.append(f"# Documentation from {part['source']}")
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
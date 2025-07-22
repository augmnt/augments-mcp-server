"""Context enhancement tools for multi-framework development."""

import re
from typing import List, Dict, Any, Optional
import structlog
from mcp.server.fastmcp import Context
from fastmcp.exceptions import ToolError

from ..registry.manager import FrameworkRegistryManager
from ..registry.cache import DocumentationCache
from ..registry.models import CompatibilityIssue

logger = structlog.get_logger(__name__)


async def get_framework_context(
    registry: FrameworkRegistryManager,
    cache: DocumentationCache,
    frameworks: List[str],
    task_description: str,
    ctx: Optional[Context] = None
) -> str:
    """Get relevant context for multiple frameworks based on the development task.
    
    Args:
        registry: Framework registry manager
        cache: Documentation cache
        frameworks: List of framework names being used
        task_description: Description of what you're trying to build
        ctx: MCP context for progress reporting
        
    Returns:
        Curated context combining relevant documentation, patterns, and best practices
    """
    try:
        if ctx:
            await ctx.info(f"Building context for {len(frameworks)} frameworks")
        
        if not frameworks:
            return "Error: No frameworks specified"
        
        if not task_description.strip():
            return "Error: Task description is required"
        
        # Validate frameworks exist
        valid_frameworks = []
        for framework in frameworks:
            config = registry.get_framework(framework)
            if config:
                valid_frameworks.append(framework)
            else:
                logger.warning("Framework not found", framework=framework)
                if ctx:
                    await ctx.warning(f"Framework '{framework}' not found in registry")
        
        if not valid_frameworks:
            return "Error: No valid frameworks found"
        
        # Analyze task to identify relevant patterns and features
        task_keywords = _extract_task_keywords(task_description)
        
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Analyzing task requirements")
        
        # Build context for each framework
        framework_contexts = []
        
        for i, framework in enumerate(valid_frameworks):
            if ctx:
                await ctx.report_progress(
                    0.2 + (0.6 * i / len(valid_frameworks)), 
                    1.0, 
                    f"Processing {framework}"
                )
            
            config = registry.get_framework(framework)
            
            # Get relevant sections based on task
            relevant_sections = _identify_relevant_sections(config, task_keywords)
            
            framework_context = {
                "framework": framework,
                "display_name": config.display_name,
                "category": config.category,
                "type": config.type,
                "relevant_features": _filter_relevant_features(config.key_features, task_keywords),
                "relevant_patterns": _filter_relevant_patterns(config.common_patterns, task_keywords),
                "integration_notes": await _get_integration_notes(config, valid_frameworks, task_keywords)
            }
            
            # Get documentation snippets for relevant sections
            doc_snippets = []
            for section in relevant_sections[:3]:  # Limit to top 3 sections
                try:
                    # First try to get from cache
                    cached_content = await cache.get(framework, section, "docs")
                    if cached_content:
                        snippet = _extract_relevant_snippet(cached_content, task_keywords, section)
                        if snippet:
                            doc_snippets.append({
                                "section": section,
                                "content": snippet
                            })
                except Exception as e:
                    logger.warning("Failed to get documentation snippet", 
                                 framework=framework, 
                                 section=section, 
                                 error=str(e))
            
            framework_context["documentation_snippets"] = doc_snippets
            framework_contexts.append(framework_context)
        
        if ctx:
            await ctx.report_progress(0.9, 1.0, "Generating combined context")
        
        # Generate compatibility insights
        compatibility_insights = await _generate_compatibility_insights(
            valid_frameworks, registry, task_keywords
        )
        
        # Format the final context
        formatted_context = await _format_framework_context(
            framework_contexts, 
            task_description, 
            compatibility_insights
        )
        
        if ctx:
            await ctx.info(f"Context generated for {len(valid_frameworks)} frameworks")
        
        logger.info("Framework context generated", 
                   frameworks=valid_frameworks,
                   task_keywords=task_keywords)
        
        return formatted_context
        
    except Exception as e:
        error_msg = f"Failed to generate framework context: {str(e)}"
        logger.error("Context generation failed", 
                    frameworks=frameworks,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        return f"Error: {error_msg}"


async def analyze_code_compatibility(
    registry: FrameworkRegistryManager,
    code: str,
    frameworks: List[str],
    ctx: Optional[Context] = None
) -> Dict[str, Any]:
    """Analyze code for framework compatibility and suggest improvements.
    
    Args:
        registry: Framework registry manager
        code: Code snippet to analyze
        frameworks: List of frameworks the code should work with
        ctx: MCP context for progress reporting
        
    Returns:
        Analysis results with compatibility issues and improvement suggestions
    """
    try:
        if ctx:
            await ctx.info("Analyzing code compatibility")
        
        if not code.strip():
            raise ToolError("No code provided for analysis")
        
        if not frameworks:
            raise ToolError("No frameworks specified for compatibility check")
        
        # Validate frameworks
        valid_frameworks = []
        framework_configs = {}
        
        for framework in frameworks:
            config = registry.get_framework(framework)
            if config:
                valid_frameworks.append(framework)
                framework_configs[framework] = config
            else:
                logger.warning("Framework not found for analysis", framework=framework)
        
        if not valid_frameworks:
            raise ToolError("No valid frameworks found")
        
        if ctx:
            await ctx.report_progress(0.2, 1.0, "Analyzing code structure")
        
        # Analyze code structure
        code_analysis = _analyze_code_structure(code)
        
        # Check compatibility with each framework
        issues = []
        suggestions = []
        compatibility_scores = {}
        
        for framework in valid_frameworks:
            if ctx:
                await ctx.debug(f"Checking compatibility with {framework}")
            
            config = framework_configs[framework]
            framework_issues, framework_suggestions, score = await _check_framework_compatibility(
                code, code_analysis, config
            )
            
            issues.extend(framework_issues)
            suggestions.extend(framework_suggestions)
            compatibility_scores[framework] = score
        
        if ctx:
            await ctx.report_progress(0.8, 1.0, "Generating recommendations")
        
        # Calculate overall compatibility
        overall_score = sum(compatibility_scores.values()) / len(compatibility_scores)
        is_compatible = overall_score >= 0.7 and len([i for i in issues if i.severity == "error"]) == 0
        
        # Generate cross-framework suggestions
        cross_framework_suggestions = _generate_cross_framework_suggestions(
            valid_frameworks, framework_configs, code_analysis
        )
        suggestions.extend(cross_framework_suggestions)
        
        # Remove duplicate suggestions
        unique_suggestions = list(set(suggestions))
        
        result = {
            "compatible": is_compatible,
            "frameworks": valid_frameworks,
            "overall_compatibility_score": round(overall_score, 2),
            "framework_scores": {k: round(v, 2) for k, v in compatibility_scores.items()},
            "issues": [
                {
                    "line": issue.line,
                    "severity": issue.severity,
                    "message": issue.message,
                    "suggestion": issue.suggestion
                }
                for issue in issues
            ],
            "suggestions": unique_suggestions,
            "code_analysis": code_analysis
        }
        
        if ctx:
            await ctx.info(f"Compatibility analysis completed - Score: {overall_score:.2f}")
        
        logger.info("Code compatibility analysis completed", 
                   frameworks=valid_frameworks,
                   overall_score=overall_score,
                   issues=len(issues))
        
        return result
        
    except Exception as e:
        error_msg = f"Code compatibility analysis failed: {str(e)}"
        logger.error("Compatibility analysis failed", 
                    frameworks=frameworks,
                    error=str(e))
        if ctx:
            await ctx.error(error_msg)
        raise ToolError(error_msg)


def _extract_task_keywords(task_description: str) -> List[str]:
    """Extract relevant keywords from task description."""
    # Common development keywords and patterns
    development_keywords = {
        'component', 'components', 'ui', 'interface', 'form', 'forms',
        'routing', 'router', 'navigation', 'auth', 'authentication', 'login',
        'api', 'rest', 'graphql', 'database', 'db', 'model', 'models',
        'state', 'store', 'redux', 'context', 'hook', 'hooks',
        'style', 'styling', 'css', 'design', 'theme', 'responsive',
        'test', 'testing', 'unit', 'integration', 'e2e',
        'deploy', 'deployment', 'build', 'production', 'server',
        'performance', 'optimization', 'bundle', 'lazy', 'loading'
    }
    
    # Extract words from task description
    words = re.findall(r'\b\w+\b', task_description.lower())
    
    # Filter for relevant keywords
    keywords = []
    for word in words:
        if word in development_keywords or len(word) > 3:
            keywords.append(word)
    
    # Remove duplicates while preserving order
    return list(dict.fromkeys(keywords))


def _identify_relevant_sections(config, task_keywords: List[str]) -> List[str]:
    """Identify relevant documentation sections based on task keywords."""
    # Common documentation sections
    sections = [
        "installation", "setup", "configuration", "getting-started",
        "components", "api", "routing", "state-management", "forms",
        "authentication", "styling", "theming", "testing", "deployment",
        "examples", "tutorial", "guide", "best-practices"
    ]
    
    relevant_sections = []
    
    # Check which sections might be relevant to the task
    for section in sections:
        section_score = 0
        
        # Direct keyword match
        if section in task_keywords:
            section_score += 10
        
        # Partial matches
        for keyword in task_keywords:
            if keyword in section or section in keyword:
                section_score += 5
        
        # Feature/pattern matches
        for feature in config.key_features:
            for keyword in task_keywords:
                if keyword.lower() in feature.lower():
                    section_score += 3
        
        for pattern in config.common_patterns:
            for keyword in task_keywords:
                if keyword.lower() in pattern.lower():
                    section_score += 3
        
        if section_score > 0:
            relevant_sections.append((section, section_score))
    
    # Sort by relevance score and return section names
    relevant_sections.sort(key=lambda x: -x[1])
    return [section for section, _ in relevant_sections[:5]]


def _filter_relevant_features(features: List[str], task_keywords: List[str]) -> List[str]:
    """Filter features that are relevant to the task."""
    relevant = []
    
    for feature in features:
        feature_lower = feature.lower()
        for keyword in task_keywords:
            if keyword in feature_lower or any(
                word in feature_lower for word in keyword.split('-')
            ):
                relevant.append(feature)
                break
    
    return relevant


def _filter_relevant_patterns(patterns: List[str], task_keywords: List[str]) -> List[str]:
    """Filter patterns that are relevant to the task."""
    relevant = []
    
    for pattern in patterns:
        pattern_lower = pattern.lower()
        for keyword in task_keywords:
            if keyword in pattern_lower or any(
                word in pattern_lower for word in keyword.split('-')
            ):
                relevant.append(pattern)
                break
    
    return relevant


async def _get_integration_notes(config, frameworks: List[str], task_keywords: List[str]) -> List[str]:
    """Generate integration notes for using this framework with others."""
    notes = []
    
    # Framework-specific integration guidance
    framework_integrations = {
        'react': {
            'tailwindcss': 'Use Tailwind classes directly in JSX className attributes',
            'nextjs': 'React components work seamlessly with Next.js pages and app router',
            'typescript': 'Add TypeScript types for props and state management'
        },
        'nextjs': {
            'tailwindcss': 'Configure Tailwind in next.config.js and use with App Router',
            'react': 'Use React components in Next.js pages and layouts',
            'vercel': 'Deploy easily to Vercel with zero configuration'
        },
        'tailwindcss': {
            'react': 'Use utility classes in className prop for responsive design',
            'nextjs': 'Configure PostCSS and import Tailwind in global styles',
            'shadcn-ui': 'shadcn/ui components are pre-styled with Tailwind utilities'
        }
    }
    
    current_framework = config.name.lower()
    
    for other_framework in frameworks:
        if other_framework != config.name:
            other_lower = other_framework.lower()
            
            # Check for specific integration notes
            if current_framework in framework_integrations:
                if other_lower in framework_integrations[current_framework]:
                    notes.append(framework_integrations[current_framework][other_lower])
            
            # Generic integration notes based on categories
            if config.category == 'web' and 'css' in task_keywords:
                notes.append(f"Ensure CSS styles from {config.display_name} are compatible with {other_framework}")
            
            if config.category == 'design' and other_lower in ['react', 'nextjs', 'vue']:
                notes.append(f"Import {config.display_name} components into {other_framework} components")
    
    return notes


def _extract_relevant_snippet(content: str, task_keywords: List[str], section: str) -> Optional[str]:
    """Extract a relevant snippet from documentation content."""
    if not content:
        return None
    
    lines = content.split('\n')
    relevant_lines = []
    context_window = 3
    
    # Find lines that match task keywords
    for i, line in enumerate(lines):
        line_lower = line.lower()
        
        # Check if line contains relevant keywords
        relevance_score = 0
        for keyword in task_keywords:
            if keyword in line_lower:
                relevance_score += 1
        
        if relevance_score > 0:
            # Include context around relevant lines
            start_idx = max(0, i - context_window)
            end_idx = min(len(lines), i + context_window + 1)
            
            context_lines = lines[start_idx:end_idx]
            relevant_lines.extend(context_lines)
    
    if not relevant_lines:
        # Fallback to first few lines of the section
        return '\n'.join(lines[:10]) if len(lines) > 10 else content
    
    # Remove duplicates while preserving order
    unique_lines = []
    seen = set()
    for line in relevant_lines:
        if line not in seen:
            unique_lines.append(line)
            seen.add(line)
    
    snippet = '\n'.join(unique_lines[:20])  # Limit snippet size
    return snippet if len(snippet) > 50 else None


async def _generate_compatibility_insights(
    frameworks: List[str], 
    registry: FrameworkRegistryManager, 
    task_keywords: List[str]
) -> List[str]:
    """Generate insights about framework compatibility."""
    insights = []
    
    # Get framework categories
    categories = {}
    for framework in frameworks:
        config = registry.get_framework(framework)
        if config:
            categories[framework] = config.category
    
    # Check for potential conflicts
    css_frameworks = [f for f, cat in categories.items() if cat in ['design', 'web'] and 'css' in f.lower()]
    if len(css_frameworks) > 1:
        insights.append(f"Multiple CSS frameworks detected: {', '.join(css_frameworks)}. Consider using one primary styling system.")
    
    # Check for complementary frameworks
    has_react = any('react' in f.lower() for f in frameworks)
    has_nextjs = any('next' in f.lower() for f in frameworks)
    
    if has_react and has_nextjs:
        insights.append("React and Next.js work excellently together. Use React components within Next.js pages and layouts.")
    
    # Task-specific insights
    if 'ui' in task_keywords or 'component' in task_keywords:
        design_frameworks = [f for f, cat in categories.items() if cat == 'design']
        if design_frameworks:
            insights.append(f"For UI components, leverage {', '.join(design_frameworks)} for consistent design patterns.")
    
    return insights


async def _format_framework_context(
    framework_contexts: List[Dict[str, Any]], 
    task_description: str,
    compatibility_insights: List[str]
) -> str:
    """Format the framework context into a readable format."""
    
    parts = []
    
    # Header
    framework_names = [ctx['display_name'] for ctx in framework_contexts]
    parts.append("# Multi-Framework Development Context")
    parts.append(f"**Frameworks:** {', '.join(framework_names)}")
    parts.append(f"**Task:** {task_description}")
    parts.append("")
    
    # Compatibility insights
    if compatibility_insights:
        parts.append("## Compatibility Insights")
        for insight in compatibility_insights:
            parts.append(f"- {insight}")
        parts.append("")
    
    # Framework-specific context
    for ctx in framework_contexts:
        parts.append(f"## {ctx['display_name']} ({ctx['category']})")
        
        if ctx['relevant_features']:
            parts.append("**Relevant Features:**")
            for feature in ctx['relevant_features']:
                parts.append(f"- {feature}")
            parts.append("")
        
        if ctx['relevant_patterns']:
            parts.append("**Relevant Patterns:**")
            for pattern in ctx['relevant_patterns']:
                parts.append(f"- {pattern}")
            parts.append("")
        
        if ctx['integration_notes']:
            parts.append("**Integration Notes:**")
            for note in ctx['integration_notes']:
                parts.append(f"- {note}")
            parts.append("")
        
        if ctx['documentation_snippets']:
            parts.append("**Documentation Snippets:**")
            for snippet in ctx['documentation_snippets']:
                parts.append(f"### {snippet['section'].title()}")
                parts.append(snippet['content'][:500] + "..." if len(snippet['content']) > 500 else snippet['content'])
                parts.append("")
    
    return '\n'.join(parts)


def _analyze_code_structure(code: str) -> Dict[str, Any]:
    """Analyze the structure and patterns in the code."""
    analysis = {
        "language": _detect_language(code),
        "imports": _extract_imports(code),
        "functions": _extract_functions(code),
        "classes": _extract_classes(code),
        "jsx_elements": _extract_jsx_elements(code),
        "css_selectors": _extract_css_selectors(code),
        "patterns": _detect_patterns(code)
    }
    
    return analysis


def _detect_language(code: str) -> str:
    """Detect the programming language of the code."""
    code_lower = code.lower()
    
    if 'import ' in code and ('from ' in code or 'jsx' in code or 'tsx' in code):
        if '<' in code and '>' in code:
            return 'jsx' if '.tsx' not in code_lower else 'tsx'
        return 'javascript' if '.ts' not in code_lower else 'typescript'
    
    if 'def ' in code and 'import ' in code:
        return 'python'
    
    if '<?php' in code or 'namespace ' in code:
        return 'php'
    
    if 'class ' in code and 'public ' in code:
        return 'java'
    
    return 'unknown'


def _extract_imports(code: str) -> List[str]:
    """Extract import statements from the code."""
    import_patterns = [
        r'import\s+.*?from\s+["\']([^"\']+)["\']',
        r'import\s+["\']([^"\']+)["\']',
        r'from\s+([^\s]+)\s+import',
        r'require\(["\']([^"\']+)["\']\)'
    ]
    
    imports = []
    for pattern in import_patterns:
        matches = re.findall(pattern, code)
        imports.extend(matches)
    
    return list(set(imports))


def _extract_functions(code: str) -> List[str]:
    """Extract function names from the code."""
    function_patterns = [
        r'function\s+(\w+)',
        r'const\s+(\w+)\s*=\s*\([^)]*\)\s*=>',
        r'def\s+(\w+)\s*\(',
        r'(\w+)\s*:\s*\([^)]*\)\s*=>'
    ]
    
    functions = []
    for pattern in function_patterns:
        matches = re.findall(pattern, code)
        functions.extend(matches)
    
    return list(set(functions))


def _extract_classes(code: str) -> List[str]:
    """Extract class names from the code."""
    class_patterns = [
        r'class\s+(\w+)',
        r'interface\s+(\w+)',
        r'type\s+(\w+)\s*='
    ]
    
    classes = []
    for pattern in class_patterns:
        matches = re.findall(pattern, code)
        classes.extend(matches)
    
    return list(set(classes))


def _extract_jsx_elements(code: str) -> List[str]:
    """Extract JSX element names from the code."""
    jsx_pattern = r'<(\w+)(?:\s|>|/)'
    matches = re.findall(jsx_pattern, code)
    
    # Filter out HTML elements to focus on custom components
    html_elements = {
        'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
        'form', 'input', 'button', 'select', 'option', 'textarea'
    }
    
    custom_elements = [elem for elem in matches if elem.lower() not in html_elements]
    return list(set(custom_elements))


def _extract_css_selectors(code: str) -> List[str]:
    """Extract CSS class names and selectors from the code."""
    css_patterns = [
        r'className=["\']([^"\']+)["\']',
        r'class=["\']([^"\']+)["\']',
        r'\.([a-zA-Z][a-zA-Z0-9_-]*)',
        r'#([a-zA-Z][a-zA-Z0-9_-]*)'
    ]
    
    selectors = []
    for pattern in css_patterns:
        matches = re.findall(pattern, code)
        selectors.extend(matches)
    
    return list(set(selectors))


def _detect_patterns(code: str) -> List[str]:
    """Detect common development patterns in the code."""
    patterns = []
    
    if 'useState' in code:
        patterns.append('react-hooks')
    
    if 'useEffect' in code:
        patterns.append('react-effects')
    
    if 'async' in code and 'await' in code:
        patterns.append('async-await')
    
    if 'fetch(' in code or 'axios' in code:
        patterns.append('api-calls')
    
    if 'router' in code.lower() or 'navigate' in code.lower():
        patterns.append('routing')
    
    if 'form' in code.lower() and ('onSubmit' in code or 'submit' in code):
        patterns.append('form-handling')
    
    return patterns


async def _check_framework_compatibility(
    code: str, 
    code_analysis: Dict[str, Any], 
    config
) -> tuple[List[CompatibilityIssue], List[str], float]:
    """Check code compatibility with a specific framework."""
    issues = []
    suggestions = []
    score = 1.0
    
    framework_name = config.name.lower()
    
    # Framework-specific compatibility checks
    if framework_name == 'react':
        issues_found, suggestions_made, score_penalty = _check_react_compatibility(code, code_analysis)
        issues.extend(issues_found)
        suggestions.extend(suggestions_made)
        score -= score_penalty
    
    elif framework_name == 'nextjs':
        issues_found, suggestions_made, score_penalty = _check_nextjs_compatibility(code, code_analysis)
        issues.extend(issues_found)
        suggestions.extend(suggestions_made)
        score -= score_penalty
    
    elif framework_name == 'tailwindcss':
        issues_found, suggestions_made, score_penalty = _check_tailwind_compatibility(code, code_analysis)
        issues.extend(issues_found)
        suggestions.extend(suggestions_made)
        score -= score_penalty
    
    return issues, suggestions, max(0.0, score)


def _check_react_compatibility(code: str, analysis: Dict[str, Any]) -> tuple[List[CompatibilityIssue], List[str], float]:
    """Check React-specific compatibility issues."""
    issues = []
    suggestions = []
    score_penalty = 0.0
    
    # Check for React import
    react_imported = any('react' in imp.lower() for imp in analysis['imports'])
    if not react_imported and analysis['jsx_elements']:
        issues.append(CompatibilityIssue(
            line=1,
            severity="error",
            message="JSX elements found but React not imported",
            suggestion="Add: import React from 'react'"
        ))
        score_penalty += 0.3
    
    # Check for proper hook usage
    if 'useState' in code and not react_imported:
        issues.append(CompatibilityIssue(
            line=1,
            severity="error", 
            message="useState hook used but React not imported",
            suggestion="Import React hooks: import { useState } from 'react'"
        ))
        score_penalty += 0.2
    
    # Suggestions
    if analysis['jsx_elements']:
        suggestions.append("Use React.Fragment or <> </> for multiple root elements")
        suggestions.append("Consider using React.memo for performance optimization")
    
    return issues, suggestions, score_penalty


def _check_nextjs_compatibility(code: str, analysis: Dict[str, Any]) -> tuple[List[CompatibilityIssue], List[str], float]:
    """Check Next.js-specific compatibility issues."""
    issues = []
    suggestions = []
    score_penalty = 0.0
    
    # Check for proper Next.js imports
    if 'Link' in code and not any('next/link' in imp for imp in analysis['imports']):
        issues.append(CompatibilityIssue(
            line=1,
            severity="warning",
            message="Link component used but not imported from next/link",
            suggestion="Add: import Link from 'next/link'"
        ))
        score_penalty += 0.1
    
    # Check for Image optimization
    if '<img' in code:
        suggestions.append("Consider using Next.js Image component for automatic optimization")
    
    return issues, suggestions, score_penalty


def _check_tailwind_compatibility(code: str, analysis: Dict[str, Any]) -> tuple[List[CompatibilityIssue], List[str], float]:
    """Check Tailwind CSS compatibility issues."""
    issues = []
    suggestions = []
    score_penalty = 0.0
    
    # Check for custom CSS alongside Tailwind
    css_selectors = analysis['css_selectors']
    if css_selectors:
        custom_classes = [sel for sel in css_selectors if not _is_tailwind_class(sel)]
        if custom_classes:
            suggestions.append("Consider replacing custom CSS classes with Tailwind utilities")
    
    return issues, suggestions, score_penalty


def _is_tailwind_class(class_name: str) -> bool:
    """Check if a class name follows Tailwind CSS patterns."""
    tailwind_patterns = [
        r'^(text|bg|border|rounded|p|m|w|h|flex|grid|space)-',
        r'^(sm|md|lg|xl|2xl):',
        r'^(hover|focus|active|disabled):',
        r'^(text|bg)-(red|blue|green|yellow|purple|pink|gray|black|white)-\d+$'
    ]
    
    return any(re.match(pattern, class_name) for pattern in tailwind_patterns)


def _generate_cross_framework_suggestions(
    frameworks: List[str], 
    configs: Dict[str, Any], 
    analysis: Dict[str, Any]
) -> List[str]:
    """Generate suggestions for working with multiple frameworks together."""
    suggestions = []
    
    framework_names = [f.lower() for f in frameworks]
    
    # React + Tailwind suggestions
    if 'react' in framework_names and 'tailwindcss' in framework_names:
        suggestions.append("Use className prop instead of class for Tailwind classes in React")
        suggestions.append("Consider using clsx or classnames for conditional Tailwind classes")
    
    # Next.js + Tailwind suggestions  
    if 'nextjs' in framework_names and 'tailwindcss' in framework_names:
        suggestions.append("Configure Tailwind in next.config.js for optimal performance")
        suggestions.append("Use Tailwind's JIT mode for faster builds in Next.js")
    
    # General multi-framework suggestions
    if len(frameworks) > 2:
        suggestions.append("Ensure consistent coding patterns across all frameworks")
        suggestions.append("Consider creating a shared configuration file for framework settings")
    
    return suggestions
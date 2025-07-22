"""Framework discovery tools for MCP."""

from typing import List, Dict, Any, Optional
import structlog

from ..registry.manager import FrameworkRegistryManager

logger = structlog.get_logger(__name__)


async def list_available_frameworks(
    registry: FrameworkRegistryManager,
    category: Optional[str] = None
) -> List[Dict[str, Any]]:
    """List all available frameworks, optionally filtered by category.
    
    Args:
        registry: Framework registry manager
        category: Filter by category (web, backend, mobile, ai-ml, design, tools)
    
    Returns:
        List of framework information including name, category, and description
    """
    try:
        frameworks = registry.list_frameworks(category=category)
        
        result = []
        for framework in frameworks:
            result.append({
                "name": framework.name,
                "display_name": framework.display_name,
                "category": framework.category,
                "type": framework.type,
                "description": framework.description,
                "tags": framework.tags,
                "priority": framework.priority,
                "version": framework.version
            })
        
        logger.info("Listed frameworks", 
                   count=len(result), 
                   category=category)
        
        return result
        
    except Exception as e:
        logger.error("Failed to list frameworks", error=str(e))
        raise


async def search_frameworks(
    registry: FrameworkRegistryManager,
    query: str
) -> List[Dict[str, Any]]:
    """Search for frameworks by name, keyword, or feature.
    
    Args:
        registry: Framework registry manager
        query: Search term to match against framework names and features
        
    Returns:
        Ranked list of matching frameworks with relevance scores
    """
    try:
        if not query or not query.strip():
            logger.warning("Empty search query provided")
            return []
        
        search_results = registry.search_frameworks(query.strip())
        
        result = []
        for search_result in search_results:
            framework = search_result.framework
            result.append({
                "name": framework.name,
                "display_name": framework.display_name,
                "category": framework.category,
                "type": framework.type,
                "description": framework.description,
                "tags": framework.tags,
                "priority": framework.priority,
                "version": framework.version,
                "relevance_score": search_result.relevance_score,
                "matched_fields": search_result.matched_fields
            })
        
        logger.info("Framework search completed", 
                   query=query, 
                   results=len(result))
        
        return result
        
    except Exception as e:
        logger.error("Framework search failed", query=query, error=str(e))
        raise


async def get_framework_categories(
    registry: FrameworkRegistryManager
) -> List[str]:
    """Get all available framework categories.
    
    Args:
        registry: Framework registry manager
        
    Returns:
        List of available categories
    """
    try:
        categories = registry.get_categories()
        
        logger.debug("Retrieved framework categories", 
                    categories=categories)
        
        return categories
        
    except Exception as e:
        logger.error("Failed to get categories", error=str(e))
        raise


async def get_framework_info(
    registry: FrameworkRegistryManager,
    framework_name: str
) -> Optional[Dict[str, Any]]:
    """Get detailed information about a specific framework.
    
    Args:
        registry: Framework registry manager
        framework_name: Name of the framework
        
    Returns:
        Framework information or None if not found
    """
    try:
        config = registry.get_framework(framework_name)
        
        if not config:
            logger.warning("Framework not found", framework=framework_name)
            return None
        
        result = {
            "name": config.name,
            "display_name": config.display_name,
            "category": config.category,
            "type": config.type,
            "version": config.version,
            "priority": config.priority,
            "sources": {
                "documentation": {},
                "examples": None
            },
            "context_files": config.context_files,
            "key_features": config.key_features,
            "common_patterns": config.common_patterns
        }
        
        # Add sections if available
        if config.sections:
            result["sections"] = config.sections
        
        # Add documentation source info
        doc_source = config.sources.documentation
        if doc_source.github:
            result["sources"]["documentation"]["github"] = {
                "repo": doc_source.github.repo,
                "docs_path": doc_source.github.docs_path,
                "branch": doc_source.github.branch
            }
        
        if doc_source.website:
            result["sources"]["documentation"]["website"] = str(doc_source.website)
        
        # Add examples source info if available
        if config.sources.examples:
            examples_source = config.sources.examples
            result["sources"]["examples"] = {}
            
            if examples_source.github:
                result["sources"]["examples"]["github"] = {
                    "repo": examples_source.github.repo,
                    "docs_path": examples_source.github.docs_path,
                    "branch": examples_source.github.branch
                }
            
            if examples_source.website:
                result["sources"]["examples"]["website"] = str(examples_source.website)
        
        logger.debug("Retrieved framework info", framework=framework_name)
        
        return result
        
    except Exception as e:
        logger.error("Failed to get framework info", 
                    framework=framework_name, 
                    error=str(e))
        raise


async def validate_framework_exists(
    registry: FrameworkRegistryManager,
    framework_name: str
) -> bool:
    """Validate that a framework exists in the registry.
    
    Args:
        registry: Framework registry manager
        framework_name: Name of the framework to validate
        
    Returns:
        True if framework exists, False otherwise
    """
    try:
        config = registry.get_framework(framework_name)
        exists = config is not None
        
        logger.debug("Framework validation", 
                    framework=framework_name, 
                    exists=exists)
        
        return exists
        
    except Exception as e:
        logger.error("Framework validation failed", 
                    framework=framework_name, 
                    error=str(e))
        return False


async def get_registry_stats(
    registry: FrameworkRegistryManager
) -> Dict[str, Any]:
    """Get statistics about the framework registry.
    
    Args:
        registry: Framework registry manager
        
    Returns:
        Registry statistics
    """
    try:
        total_frameworks = registry.get_framework_count()
        categories = registry.get_categories()
        
        # Count frameworks per category
        category_counts = {}
        for category in categories:
            frameworks_in_category = registry.list_frameworks(category=category)
            category_counts[category] = len(frameworks_in_category)
        
        result = {
            "total_frameworks": total_frameworks,
            "categories": categories,
            "category_counts": category_counts,
            "is_loaded": registry.is_loaded()
        }
        
        logger.debug("Registry stats retrieved", stats=result)
        
        return result
        
    except Exception as e:
        logger.error("Failed to get registry stats", error=str(e))
        raise
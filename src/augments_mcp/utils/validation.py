"""Validation utilities for framework configurations and data."""

import json
import re
from typing import Dict, Any, Optional, Union
from pathlib import Path
import structlog

logger = structlog.get_logger(__name__)


def validate_framework_config(config: Dict[str, Any]) -> bool:
    """Validate a framework configuration against the required schema.
    
    Args:
        config: Framework configuration dictionary
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Required fields
        required_fields = [
            "name", "display_name", "category", "type", 
            "sources", "context_files", "key_features", "common_patterns"
        ]
        
        for field in required_fields:
            if field not in config:
                logger.error("Missing required field", field=field)
                return False
        
        # Validate field types
        if not isinstance(config["name"], str) or not config["name"].strip():
            logger.error("Invalid name field")
            return False
        
        if not isinstance(config["display_name"], str) or not config["display_name"].strip():
            logger.error("Invalid display_name field")
            return False
        
        if not isinstance(config["category"], str) or not config["category"].strip():
            logger.error("Invalid category field")
            return False
        
        if not isinstance(config["type"], str) or not config["type"].strip():
            logger.error("Invalid type field")
            return False
        
        # Validate version (optional, defaults to "latest")
        version = config.get("version", "latest")
        if not isinstance(version, str):
            logger.error("Invalid version field")
            return False
        
        # Validate priority (optional, defaults to 50)
        priority = config.get("priority", 50)
        if not isinstance(priority, int) or priority < 0 or priority > 100:
            logger.error("Invalid priority field", priority=priority)
            return False
        
        # Validate sources
        if not validate_sources(config["sources"]):
            return False
        
        # Validate lists
        for list_field in ["context_files", "key_features", "common_patterns"]:
            if not isinstance(config[list_field], list):
                logger.error("Invalid list field", field=list_field)
                return False
            
            for item in config[list_field]:
                if not isinstance(item, str) or not item.strip():
                    logger.error("Invalid list item", field=list_field, item=item)
                    return False
        
        # Validate name format (alphanumeric, hyphens, underscores only)
        if not re.match(r'^[a-zA-Z0-9_-]+$', config["name"]):
            logger.error("Invalid name format", name=config["name"])
            return False
        
        # Validate category (must be one of the allowed categories)
        allowed_categories = ["web", "backend", "mobile", "ai-ml", "design", "tools", "database", "state-management"]
        if config["category"] not in allowed_categories:
            logger.error("Invalid category", category=config["category"], allowed=allowed_categories)
            return False
        
        logger.debug("Framework configuration validated successfully", name=config["name"])
        return True
        
    except Exception as e:
        logger.error("Validation error", error=str(e))
        return False


def validate_sources(sources: Dict[str, Any]) -> bool:
    """Validate the sources section of a framework configuration.
    
    Args:
        sources: Sources configuration dictionary
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Must have documentation source
        if "documentation" not in sources:
            logger.error("Missing documentation source")
            return False
        
        # Validate documentation source
        if not validate_documentation_source(sources["documentation"]):
            return False
        
        # Validate examples source (optional)
        if "examples" in sources:
            if not validate_documentation_source(sources["examples"]):
                return False
        
        return True
        
    except Exception as e:
        logger.error("Sources validation error", error=str(e))
        return False


def validate_documentation_source(source: Dict[str, Any]) -> bool:
    """Validate a documentation source configuration.
    
    Args:
        source: Documentation source dictionary
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Must have either github or website source
        has_github = "github" in source and source["github"] is not None
        has_website = "website" in source and source["website"] is not None
        
        if not has_github and not has_website:
            logger.error("Documentation source must have either github or website")
            return False
        
        # Validate GitHub source
        if has_github:
            github_config = source["github"]
            
            if not isinstance(github_config, dict):
                logger.error("Invalid github source configuration")
                return False
            
            if "repo" not in github_config or not isinstance(github_config["repo"], str):
                logger.error("Invalid github repo")
                return False
            
            # Validate repo format (owner/name)
            if not re.match(r'^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$', github_config["repo"]):
                logger.error("Invalid github repo format", repo=github_config["repo"])
                return False
            
            # Validate optional fields
            docs_path = github_config.get("docs_path", "docs")
            if not isinstance(docs_path, str):
                logger.error("Invalid docs_path")
                return False
            
            branch = github_config.get("branch", "main")
            if not isinstance(branch, str) or not branch.strip():
                logger.error("Invalid branch")
                return False
        
        # Validate website source
        if has_website:
            website = source["website"]
            if not isinstance(website, str) or not website.startswith(("http://", "https://")):
                logger.error("Invalid website URL", website=website)
                return False
        
        return True
        
    except Exception as e:
        logger.error("Documentation source validation error", error=str(e))
        return False


def validate_json_schema(data: Union[str, Dict[str, Any]], schema_path: Optional[str] = None) -> bool:
    """Validate JSON data against a schema.
    
    Args:
        data: JSON data (string or dict)
        schema_path: Path to JSON schema file (optional)
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Parse JSON string if needed
        if isinstance(data, str):
            data = json.loads(data)
        
        # Basic JSON validation
        if not isinstance(data, dict):
            logger.error("Data must be a JSON object")
            return False
        
        # If schema_path is provided, validate against it
        if schema_path:
            schema_file = Path(schema_path)
            if not schema_file.exists():
                logger.error("Schema file not found", path=schema_path)
                return False
            
            try:
                import jsonschema
                
                with open(schema_file, 'r') as f:
                    schema = json.load(f)
                
                jsonschema.validate(data, schema)
                logger.debug("JSON schema validation passed")
                return True
                
            except ImportError:
                logger.warning("jsonschema not available, skipping schema validation")
                return True
            except jsonschema.ValidationError as e:
                logger.error("JSON schema validation failed", error=str(e))
                return False
        
        return True
        
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON", error=str(e))
        return False
    except Exception as e:
        logger.error("JSON validation error", error=str(e))
        return False


def validate_framework_name(name: str) -> bool:
    """Validate a framework name.
    
    Args:
        name: Framework name to validate
        
    Returns:
        True if valid, False otherwise
    """
    if not isinstance(name, str) or not name.strip():
        return False
    
    # Must be alphanumeric with hyphens and underscores
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        return False
    
    # Must not start or end with hyphen/underscore
    if name.startswith(('-', '_')) or name.endswith(('-', '_')):
        return False
    
    # Reasonable length limits
    if len(name) < 2 or len(name) > 50:
        return False
    
    return True


def validate_url(url: str) -> bool:
    """Validate a URL.
    
    Args:
        url: URL to validate
        
    Returns:
        True if valid, False otherwise
    """
    if not isinstance(url, str) or not url.strip():
        return False
    
    # Basic URL validation
    url_pattern = re.compile(
        r'^https?://'  # http:// or https://
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'  # domain...
        r'localhost|'  # localhost...
        r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'  # ...or ip
        r'(?::\d+)?'  # optional port
        r'(?:/?|[/?]\S+)$', re.IGNORECASE)
    
    return bool(url_pattern.match(url))


def validate_file_path(path: str) -> bool:
    """Validate a file path.
    
    Args:
        path: File path to validate
        
    Returns:
        True if valid, False otherwise
    """
    if not isinstance(path, str) or not path.strip():
        return False
    
    # Remove leading slash for relative path validation
    path = path.lstrip('/')
    
    # Must not contain dangerous characters
    dangerous_chars = ['..', '\\', '\x00']
    for char in dangerous_chars:
        if char in path:
            return False
    
    # Must be reasonable length
    if len(path) > 500:
        return False
    
    return True


def sanitize_filename(filename: str) -> str:
    """Sanitize a filename by removing dangerous characters.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    if not isinstance(filename, str):
        return "invalid"
    
    # Remove or replace dangerous characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    filename = re.sub(r'[^\w\s\-.]', '', filename)
    filename = re.sub(r'[-\s]+', '-', filename)
    
    # Trim and ensure reasonable length
    filename = filename.strip('.-')[:100]
    
    # Ensure it's not empty
    if not filename:
        filename = "unnamed"
    
    return filename
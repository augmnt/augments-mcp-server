"""Data models for Augments MCP."""

from enum import Enum

# Import models from the new registry location for backward compatibility
from ..registry.models import (
    FrameworkConfig as Framework,
    FrameworkSources as SourceConfig, 
    GitHubSource,
    DocumentationSource,
    FrameworkInfo,
    SearchResult,
    UpdateStatus,
    CompatibilityIssue,
    CompatibilityAnalysis
)

# Create a simple registry class for backward compatibility
class FrameworkRegistry:
    def __init__(self, frameworks=None):
        self.frameworks = frameworks or {}
    
    def get_framework(self, name):
        return self.frameworks.get(name)
    
    def list_frameworks(self):
        return self.frameworks
    
    def search_frameworks(self, query):
        results = []
        for framework in self.frameworks.values():
            if query.lower() in framework.name.lower() or any(query.lower() in tag.lower() for tag in getattr(framework, 'tags', [])):
                results.append(framework)
        return results

# Create ProviderType enum for backward compatibility
class ProviderType(Enum):
    GITHUB = "github"
    WEBSITE = "website"

__all__ = [
    "Framework", 
    "FrameworkRegistry", 
    "SourceConfig", 
    "ProviderType",
    "GitHubSource",
    "DocumentationSource", 
    "FrameworkInfo",
    "SearchResult",
    "UpdateStatus",
    "CompatibilityIssue",
    "CompatibilityAnalysis"
]

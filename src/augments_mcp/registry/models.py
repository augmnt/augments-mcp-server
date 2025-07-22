"""Pydantic models for framework configuration."""

from pydantic import BaseModel, HttpUrl
from typing import List, Dict, Optional


class GitHubSource(BaseModel):
    """GitHub repository source configuration."""
    repo: str
    docs_path: str = "docs"
    branch: str = "main"


class DocumentationSource(BaseModel):
    """Documentation source configuration."""
    github: Optional[GitHubSource] = None
    website: Optional[HttpUrl] = None


class FrameworkSources(BaseModel):
    """Framework sources configuration."""
    documentation: DocumentationSource
    examples: Optional[DocumentationSource] = None


class FrameworkConfig(BaseModel):
    """Complete framework configuration model matching original prompt."""
    name: str
    display_name: str
    category: str
    type: str
    version: str = "latest"
    sources: FrameworkSources
    sections: Optional[Dict[str, str]] = None  # Section name to URL path mapping
    context_files: List[str]
    key_features: List[str]
    common_patterns: List[str]
    priority: int = 50  # Higher = more important


class FrameworkInfo(BaseModel):
    """Framework information for listing and search results."""
    name: str
    display_name: str
    category: str
    type: str
    description: str
    tags: List[str]
    priority: int
    version: str = "latest"


class SearchResult(BaseModel):
    """Search result with relevance scoring."""
    framework: FrameworkInfo
    relevance_score: float
    matched_fields: List[str]


class UpdateStatus(BaseModel):
    """Framework update status information."""
    framework: str
    last_checked: str
    last_modified: str
    has_updates: bool
    change_summary: Optional[str] = None


class CompatibilityIssue(BaseModel):
    """Code compatibility issue."""
    line: int
    severity: str  # "error", "warning", "info"
    message: str
    suggestion: Optional[str] = None


class CompatibilityAnalysis(BaseModel):
    """Code compatibility analysis results."""
    compatible: bool
    frameworks: List[str]
    issues: List[CompatibilityIssue]
    suggestions: List[str]
    confidence_score: float
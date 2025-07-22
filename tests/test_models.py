"""Tests for framework models."""

from src.augments_mcp.registry.models import (
    FrameworkConfig,
    FrameworkSources,
    GitHubSource,
    DocumentationSource,
    FrameworkInfo
)


def test_github_source_creation():
    """Test GitHubSource model creation."""
    source = GitHubSource(
        repo="owner/repo",
        branch="main",
        docs_path="docs"
    )

    assert source.repo == "owner/repo"
    assert source.branch == "main"
    assert source.docs_path == "docs"


def test_documentation_source_creation():
    """Test DocumentationSource model creation."""
    # Test with GitHub source
    github_source = GitHubSource(repo="owner/repo", docs_path="docs")
    doc_source = DocumentationSource(github=github_source)
    
    assert doc_source.github is not None
    assert doc_source.github.repo == "owner/repo"
    assert doc_source.website is None
    
    # Test with website source
    website_source = DocumentationSource(website="https://example.com/docs")
    assert str(website_source.website) == "https://example.com/docs"
    assert website_source.github is None


def test_framework_sources_creation():
    """Test FrameworkSources model creation."""
    github_source = GitHubSource(repo="owner/repo", docs_path="docs")
    doc_source = DocumentationSource(github=github_source)
    
    sources = FrameworkSources(
        documentation=doc_source,
        examples=None
    )
    
    assert sources.documentation.github.repo == "owner/repo"
    assert sources.examples is None


def test_framework_config_creation():
    """Test FrameworkConfig model creation."""
    github_source = GitHubSource(repo="owner/repo", docs_path="docs")
    doc_source = DocumentationSource(github=github_source)
    sources = FrameworkSources(documentation=doc_source)
    
    framework = FrameworkConfig(
        name="test-framework",
        display_name="Test Framework",
        category="test",
        type="library",
        version="1.0.0",
        sources=sources,
        context_files=["README.md"],
        key_features=["testing", "framework"],
        common_patterns=["pattern1"]
    )

    assert framework.name == "test-framework"
    assert framework.version == "1.0.0"
    assert framework.category == "test"
    assert framework.sources.documentation.github.repo == "owner/repo"
    assert "testing" in framework.key_features


def test_framework_info_creation():
    """Test FrameworkInfo model creation."""
    info = FrameworkInfo(
        name="test-framework",
        display_name="Test Framework",
        category="test",
        type="library",
        version="1.0.0",
        description="A test framework",
        tags=["test", "framework"],
        priority=50
    )

    assert info.name == "test-framework"
    assert info.display_name == "Test Framework"
    assert info.category == "test"
    assert "test" in info.tags
    assert info.description == "A test framework"
    assert info.priority == 50
"""Integration tests for the Augments MCP server."""

import pytest
import pytest_asyncio
import os
import tempfile
from src.augments_mcp.registry.manager import FrameworkRegistryManager
from src.augments_mcp.registry.cache import DocumentationCache
from src.augments_mcp.providers.github import GitHubProvider
from src.augments_mcp.providers.website import WebsiteProvider


@pytest_asyncio.fixture
async def temp_frameworks_dir():
    """Create a temporary frameworks directory with test data."""
    temp_dir = tempfile.mkdtemp()
    
    # Create a test framework config
    framework_content = """
{
  "name": "test-framework",
  "display_name": "Test Framework",
  "category": "tools",
  "type": "library",
  "version": "1.0.0",
  "sources": {
    "documentation": {
      "github": {
        "repo": "test/test-framework",
        "docs_path": "docs",
        "branch": "main"
      },
      "website": "https://example.com/docs"
    },
    "examples": {
      "github": {
        "repo": "test/test-framework-examples",
        "docs_path": "examples",
        "branch": "main"
      }
    }
  },
  "context_files": ["README.md"],
  "key_features": ["testing"],
  "common_patterns": ["pattern1"],
  "priority": 50
}
"""
    
    # Create test category directory
    category_dir = os.path.join(temp_dir, "tools")
    os.makedirs(category_dir, exist_ok=True)
    
    # Write test framework config
    with open(os.path.join(category_dir, "test-framework.json"), "w") as f:
        f.write(framework_content)
    
    yield temp_dir
    
    # Cleanup
    import shutil
    shutil.rmtree(temp_dir)


@pytest_asyncio.fixture
async def temp_cache_dir():
    """Create a temporary cache directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    import shutil
    shutil.rmtree(temp_dir)


@pytest.mark.asyncio
async def test_registry_manager_initialization(temp_frameworks_dir):
    """Test FrameworkRegistryManager initialization."""
    manager = FrameworkRegistryManager(temp_frameworks_dir)
    await manager.initialize()
    
    # Test that the framework was loaded
    assert manager.get_framework_count() >= 1
    
    # Test get framework
    framework = manager.get_framework("test-framework")
    assert framework is not None
    assert framework.name == "test-framework"
    
    # Test list frameworks
    frameworks = manager.list_frameworks()
    assert len(frameworks) >= 1
    
    # Cleanup
    await manager.shutdown()


@pytest.mark.asyncio
async def test_cache_initialization(temp_cache_dir):
    """Test DocumentationCache initialization."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)
    
    # Test basic cache operations
    await cache.set("test_framework", "test content", "section1", "docs")
    result = await cache.get("test_framework", "section1", "docs")
    assert result == "test content"
    
    # Test cache statistics
    stats = cache.get_stats()
    assert "memory_entries" in stats


@pytest.mark.asyncio
async def test_providers_initialization():
    """Test provider initialization."""
    github_provider = GitHubProvider()
    website_provider = WebsiteProvider()
    
    # Test that providers can be initialized
    assert github_provider is not None
    assert website_provider is not None
    
    # Test cleanup
    await github_provider.close()
    await website_provider.close()


@pytest.mark.asyncio
async def test_framework_search(temp_frameworks_dir):
    """Test framework search functionality."""
    manager = FrameworkRegistryManager(temp_frameworks_dir)
    await manager.initialize()
    
    # Test search
    results = manager.search_frameworks("test")
    assert isinstance(results, list)
    assert any(result.framework.name == "test-framework" for result in results)
    
    # Cleanup
    await manager.shutdown()


@pytest.mark.asyncio
async def test_framework_categories(temp_frameworks_dir):
    """Test framework category functionality."""
    manager = FrameworkRegistryManager(temp_frameworks_dir)
    await manager.initialize()
    
    # Test list by category
    frameworks = manager.list_frameworks(category="tools")
    assert isinstance(frameworks, list)
    assert any(fw.name == "test-framework" for fw in frameworks)
    
    # Test get categories
    categories = manager.get_categories()
    assert isinstance(categories, list)
    
    # Cleanup
    await manager.shutdown()
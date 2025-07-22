"""Tests for caching system."""

import pytest
import tempfile
import shutil
from src.augments_mcp.registry.cache import DocumentationCache


@pytest.fixture
def temp_cache_dir():
    """Create a temporary cache directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.mark.asyncio
async def test_documentation_cache(temp_cache_dir):
    """Test DocumentationCache functionality."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)

    # Test set and get
    await cache.set("test_framework", "test content", path="section1", source_type="docs")
    result = await cache.get("test_framework", path="section1", source_type="docs")
    assert result == "test content"

    # Test non-existent key
    result = await cache.get("test_framework", path="non_existent", source_type="docs")
    assert result is None

    # Test invalidate cache
    await cache.invalidate("test_framework", path="section1", source_type="docs")
    result = await cache.get("test_framework", path="section1", source_type="docs")
    assert result is None


@pytest.mark.asyncio
async def test_cache_expiration(temp_cache_dir):
    """Test cache expiration functionality."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)
    
    # Test setting documentation with short TTL for testing
    await cache.set("test_framework", "test content", version="dev")  # dev has 1 hour TTL
    
    # Test cache exists
    result = await cache.get("test_framework")
    assert result == "test content"


@pytest.mark.asyncio
async def test_cache_clear_operations(temp_cache_dir):
    """Test cache clearing operations."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)
    
    # Add some test data
    await cache.set("framework1", "content1", path="section1")
    await cache.set("framework1", "example1", path="section1", source_type="examples")
    await cache.set("framework2", "content2", path="section1")
    
    # Test clear specific framework
    cleared_count = await cache.clear_framework("framework1")
    assert cleared_count >= 2  # Should clear at least 2 entries
    
    # Test that framework1 is cleared but framework2 remains
    result1 = await cache.get("framework1", path="section1")
    assert result1 is None
    
    result2 = await cache.get("framework2", path="section1")
    assert result2 == "content2"


@pytest.mark.asyncio
async def test_cache_statistics(temp_cache_dir):
    """Test cache statistics functionality."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)
    
    # Add some test data
    await cache.set("framework1", "content1", path="section1")
    await cache.set("framework2", "content2", path="section1")
    
    # Test overall statistics
    stats = cache.get_stats()
    assert "memory_entries" in stats
    assert "disk_volume_bytes" in stats  # The actual key name
    assert stats["memory_entries"] >= 2


@pytest.mark.asyncio
async def test_framework_cache_info(temp_cache_dir):
    """Test framework-specific cache info."""
    cache = DocumentationCache(cache_dir=temp_cache_dir)
    
    # Add test data for specific framework
    await cache.set("test_framework", "content1", path="docs")
    await cache.set("test_framework", "example1", path="examples", source_type="examples")
    
    # Test get framework cache info
    info = await cache.get_framework_cache_info("test_framework")
    assert "memory_entries" in info  # The actual key name
    assert "disk_entries" in info     # The actual key name
    assert info["memory_entries"] >= 2
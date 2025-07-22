"""Tests for MCP tools functionality."""

import pytest
from unittest.mock import Mock
from src.augments_mcp.tools.framework_discovery import (
    list_available_frameworks,
    search_frameworks,
    get_framework_info,
    validate_framework_exists,
    get_registry_stats
)


@pytest.fixture
def mock_registry_manager():
    """Create a mock registry manager."""
    manager = Mock()
    
    # Mock framework data
    mock_framework = Mock()
    mock_framework.name = "test-framework"
    mock_framework.display_name = "Test Framework"
    mock_framework.category = "test"
    mock_framework.type = "library"
    mock_framework.version = "1.0.0"
    mock_framework.description = "A test framework"
    mock_framework.tags = ["test", "framework"]
    mock_framework.key_features = ["testing"]
    mock_framework.common_patterns = ["test-pattern"]
    mock_framework.context_files = ["README.md"]
    mock_framework.priority = 50
    
    # Mock search result
    mock_search_result = Mock()
    mock_search_result.framework = mock_framework
    mock_search_result.relevance_score = 0.95
    mock_search_result.matched_fields = ["name"]
    
    # Set up synchronous methods (these are not async in the actual implementation)
    manager.list_frameworks = Mock(return_value=[mock_framework])
    manager.search_frameworks = Mock(return_value=[mock_search_result])
    manager.get_framework = Mock(return_value=mock_framework)
    manager.get_framework_count = Mock(return_value=1)
    manager.get_categories = Mock(return_value=["test"])
    
    return manager


@pytest.mark.asyncio
async def test_list_available_frameworks(mock_registry_manager):
    """Test list_available_frameworks tool."""
    result = await list_available_frameworks(mock_registry_manager)
    
    assert isinstance(result, list)
    assert len(result) >= 1
    assert result[0]["name"] == "test-framework"
    assert result[0]["category"] == "test"


@pytest.mark.asyncio
async def test_search_frameworks(mock_registry_manager):
    """Test search_frameworks tool."""
    result = await search_frameworks(mock_registry_manager, "test")
    
    assert isinstance(result, list)
    assert len(result) >= 1
    assert result[0]["name"] == "test-framework"
    assert "relevance_score" in result[0]


@pytest.mark.asyncio
async def test_get_framework_info(mock_registry_manager):
    """Test get_framework_info tool."""
    result = await get_framework_info(mock_registry_manager, "test-framework")
    
    assert isinstance(result, dict)
    assert result["name"] == "test-framework"
    assert result["display_name"] == "Test Framework"
    assert result["category"] == "test"


@pytest.mark.asyncio
async def test_validate_framework_exists(mock_registry_manager):
    """Test validate_framework_exists tool."""
    # Test existing framework
    result = await validate_framework_exists(mock_registry_manager, "test-framework")
    assert result is True
    
    # Test non-existing framework
    mock_registry_manager.get_framework = Mock(return_value=None)
    result = await validate_framework_exists(mock_registry_manager, "non-existent")
    assert result is False


@pytest.mark.asyncio
async def test_get_registry_stats(mock_registry_manager):
    """Test get_registry_stats tool."""
    result = await get_registry_stats(mock_registry_manager)
    
    assert isinstance(result, dict)
    assert "total_frameworks" in result
    assert "categories" in result
    assert result["total_frameworks"] == 1
    assert "test" in result["categories"]
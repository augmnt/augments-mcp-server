"""Tests for documentation providers."""

import pytest
from src.augments_mcp.providers.github import GitHubProvider
from src.augments_mcp.providers.website import WebsiteProvider


@pytest.mark.asyncio
async def test_github_provider_init():
    """Test GitHubProvider initialization."""
    provider = GitHubProvider()
    assert provider.token is None or isinstance(provider.token, str)
    
    # Test with token
    provider_with_token = GitHubProvider(token="test_token")
    assert provider_with_token.token == "test_token"


@pytest.mark.asyncio
async def test_website_provider_init():
    """Test WebsiteProvider initialization."""
    provider = WebsiteProvider()
    assert provider._client is None
    
    # Test close method
    await provider.close()


@pytest.mark.asyncio
async def test_github_provider_methods():
    """Test GitHubProvider methods (without actual API calls)."""
    provider = GitHubProvider()
    
    # Test that methods exist and are callable
    assert hasattr(provider, "fetch_documentation")
    assert hasattr(provider, "fetch_examples")
    assert hasattr(provider, "search_repository")
    assert hasattr(provider, "close")
    
    # Test close method
    await provider.close()


@pytest.mark.asyncio
async def test_website_provider_methods():
    """Test WebsiteProvider methods (without actual web requests)."""
    provider = WebsiteProvider()
    
    # Test that methods exist and are callable
    assert hasattr(provider, "fetch_documentation")
    assert hasattr(provider, "fetch_examples")
    assert hasattr(provider, "close")
    
    # Test helper methods exist
    assert hasattr(provider, "_extract_main_content")
    assert hasattr(provider, "_format_html_content")
    assert hasattr(provider, "_extract_code_examples")
    
    # Test close method
    await provider.close()


def test_provider_helper_methods():
    """Test provider helper methods."""
    provider = WebsiteProvider()
    
    # Test language detection
    assert provider._detect_language("test.js") == "javascript"
    assert provider._detect_language("test.py") == "python"
    assert provider._detect_language("test.ts") == "typescript"
    assert provider._detect_language("test.unknown") == "text"
    
    # Test text cleaning
    dirty_text = "  Hello   World  \n\n\n  Test  "
    clean_text = provider._clean_text(dirty_text)
    assert "Hello World Test" in clean_text.replace('\n', ' ')
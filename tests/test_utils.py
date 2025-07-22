"""Tests for utility functions."""

from src.augments_mcp.utils.validation import (
    validate_framework_config,
    validate_url,
    validate_framework_name,
    validate_file_path,
    sanitize_filename
)


def test_validate_url():
    """Test URL validation utility."""
    # Valid URLs
    assert validate_url("https://example.com") is True
    assert validate_url("https://docs.example.com/api") is True
    assert validate_url("http://localhost:3000") is True
    
    # Invalid URLs
    assert validate_url("not-a-url") is False
    assert validate_url("ftp://example.com") is False
    assert validate_url("") is False
    assert validate_url("  ") is False


def test_validate_framework_name():
    """Test framework name validation."""
    # Valid names
    assert validate_framework_name("react") is True
    assert validate_framework_name("next-js") is True
    assert validate_framework_name("tailwind_css") is True
    assert validate_framework_name("vue3") is True
    
    # Invalid names
    assert validate_framework_name("") is False
    assert validate_framework_name("-react") is False
    assert validate_framework_name("react-") is False
    assert validate_framework_name("react@latest") is False
    assert validate_framework_name("a") is False  # too short
    assert validate_framework_name("x" * 60) is False  # too long


def test_validate_file_path():
    """Test file path validation."""
    # Valid paths
    assert validate_file_path("docs/README.md") is True
    assert validate_file_path("src/components/Button.tsx") is True
    assert validate_file_path("examples/basic.py") is True
    
    # Invalid paths
    assert validate_file_path("") is False
    assert validate_file_path("../../../etc/passwd") is False
    assert validate_file_path("docs\\readme.md") is False  # backslash
    assert validate_file_path("x" * 600) is False  # too long


def test_sanitize_filename():
    """Test filename sanitization."""
    # Test normal filenames
    assert sanitize_filename("README.md") == "README.md"
    assert sanitize_filename("my-file.txt") == "my-file.txt"
    
    # Test dangerous characters
    assert sanitize_filename("file<name>.txt") == "filename.txt"
    assert sanitize_filename("my:file|name.txt") == "myfilename.txt"
    
    # Test edge cases
    assert sanitize_filename("") == "unnamed"
    assert sanitize_filename("...") == "unnamed"
    assert sanitize_filename(123) == "invalid"


def test_validate_framework_config():
    """Test framework configuration validation."""
    # Valid config
    valid_config = {
        "name": "test-framework",
        "display_name": "Test Framework",
        "category": "web",
        "type": "library",
        "version": "1.0.0",
        "sources": {
            "documentation": {
                "github": {
                    "repo": "owner/repo",
                    "docs_path": "docs",
                    "branch": "main"
                }
            }
        },
        "context_files": ["README.md"],
        "key_features": ["testing"],
        "common_patterns": ["pattern1"],
        "priority": 50
    }
    
    assert validate_framework_config(valid_config) is True
    
    # Invalid config - missing required field
    invalid_config = valid_config.copy()
    del invalid_config["name"]
    assert validate_framework_config(invalid_config) is False
    
    # Invalid config - invalid category
    invalid_category_config = valid_config.copy()
    invalid_category_config["category"] = "invalid-category"
    assert validate_framework_config(invalid_category_config) is False
    
    # Invalid config - invalid name format
    invalid_name_config = valid_config.copy()
    invalid_name_config["name"] = "invalid@name"
    assert validate_framework_config(invalid_name_config) is False
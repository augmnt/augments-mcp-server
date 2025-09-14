#!/usr/bin/env python3
"""
Main entry point for augments-mcp-server.

This module provides a clean entry point that avoids the RuntimeWarning
about module imports when using python -m execution.
"""

import warnings
import sys


def suppress_deprecation_warnings():
    """Suppress known deprecation warnings from dependencies."""
    # Filter out websockets deprecation warnings
    warnings.filterwarnings(
        "ignore", 
        category=DeprecationWarning, 
        module="websockets.*"
    )
    warnings.filterwarnings(
        "ignore",
        category=DeprecationWarning,
        module="uvicorn.*"
    )


def main():
    """Main entry point for the server."""
    # Suppress deprecation warnings early
    suppress_deprecation_warnings()
    
    # Import after warnings are configured
    from .server import main as server_main
    
    # Run the server with any command line arguments
    server_main()


if __name__ == "__main__":
    main()
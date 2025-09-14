#!/usr/bin/env python3
"""
Main entry point for augments-mcp-server.

This module provides a clean entry point that avoids the RuntimeWarning
about module imports when using python -m execution.
"""

import sys


def main():
    """Main entry point for the server."""
    # Import after warnings are configured
    from .server import main as server_main
    
    # Run the server with any command line arguments
    server_main()


if __name__ == "__main__":
    main()
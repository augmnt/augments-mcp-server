"""Entry point for fastmcp.cloud deployment."""
import os
import sys

# Signal to server.py that we're running in fastmcp.cloud
os.environ["FASTMCP_CLOUD"] = "true"

sys.path.insert(0, "src")


def create_server():
    """Factory function to create the MCP server instance."""
    from augments_mcp.server import mcp
    return mcp

import { SERVER_VERSION } from '@/server';

export default function Home() {
  return (
    <main style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '2rem'
    }}>
      <h1>Augments MCP Server</h1>
      <p>Version: {SERVER_VERSION}</p>

      <h2>API Endpoints</h2>
      <ul>
        <li><code>GET /api/mcp</code> - Health check and server info</li>
        <li><code>POST /api/mcp</code> - MCP protocol endpoint</li>
      </ul>

      <h2>Documentation</h2>
      <p>
        Visit <a href="https://augments.dev/docs">augments.dev/docs</a> for full documentation.
      </p>

      <h2>Quick Start</h2>
      <pre style={{
        background: '#f5f5f5',
        padding: '1rem',
        borderRadius: '4px',
        overflow: 'auto'
      }}>
{`# Add to Claude Code
claude mcp add --transport http augments https://mcp.augments.dev/mcp

# Or configure in MCP settings
{
  "mcpServers": {
    "augments": {
      "transport": "http",
      "url": "https://mcp.augments.dev/mcp"
    }
  }
}`}
      </pre>

      <h2>Available Tools</h2>
      <ul>
        <li><strong>get_api_context</strong> - API signatures, prose documentation, and code examples for any npm package</li>
        <li><strong>search_apis</strong> - Search for APIs across frameworks by keyword or concept</li>
        <li><strong>get_version_info</strong> - Get npm version info and detect breaking changes</li>
      </ul>
    </main>
  );
}

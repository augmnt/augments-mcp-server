/**
 * MCP API Route for Vercel
 *
 * Handles HTTP requests for the MCP server using the official MCP SDK transport.
 * Uses WebStandardStreamableHTTPServerTransport for Claude Code compatibility.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getServer, SERVER_VERSION, registeredToolCount } from '@/server';
import { getLogger } from '@/utils/logger';

const logger = getLogger('api:mcp');

// CORS headers for MCP protocol
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
};

/**
 * Handle OPTIONS requests for CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Handle GET requests - MCP protocol or health check
 */
export async function GET(request: Request) {
  // Check if this is an MCP protocol request (has Accept header for SSE or JSON)
  const acceptHeader = request.headers.get('Accept') || '';
  const isMcpRequest = acceptHeader.includes('text/event-stream') || acceptHeader.includes('application/json');

  if (!isMcpRequest) {
    // Return health check response for non-MCP requests
    return new Response(
      JSON.stringify({
        name: 'augments-mcp-server',
        version: SERVER_VERSION,
        status: 'healthy',
        transport: 'streamable-http',
        endpoint: '/api/mcp',
        tools: registeredToolCount,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // Handle MCP GET request (for SSE streams)
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for serverless
      enableJsonResponse: true, // JSON instead of SSE for serverless compatibility
    });

    const server = await getServer();
    await server.connect(transport);

    const response = await transport.handleRequest(request);

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    logger.error('MCP GET request failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: null,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

/**
 * Handle POST requests - MCP protocol messages
 */
export async function POST(request: Request) {
  try {
    // Create stateless transport for each request (serverless compatible)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for serverless
      enableJsonResponse: true, // JSON instead of SSE for serverless compatibility
    });

    const server = await getServer();
    await server.connect(transport);

    const response = await transport.handleRequest(request);

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    logger.error('MCP POST request failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: null,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

/**
 * Handle DELETE requests - Session termination
 */
export async function DELETE(request: Request) {
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for serverless
      enableJsonResponse: true,
    });

    const server = await getServer();
    await server.connect(transport);

    const response = await transport.handleRequest(request);

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    logger.error('MCP DELETE request failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: null,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

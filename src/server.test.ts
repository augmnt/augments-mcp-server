import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the MCP SDK before importing the server module
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  const McpServer = vi.fn().mockImplementation(({ name, version }: { name: string; version: string }) => ({
    _name: name,
    _version: version,
    tool: vi.fn(),
    resource: vi.fn(),
  }));
  return { McpServer };
});

vi.mock('@/tools/v4', () => ({
  getApiContext: vi.fn(),
  formatApiContextResponse: vi.fn().mockReturnValue('api context response'),
  searchApis: vi.fn(),
  formatSearchApisResponse: vi.fn().mockReturnValue('search apis response'),
  getVersionInfo: vi.fn(),
  formatVersionInfoResponse: vi.fn().mockReturnValue('version info response'),
  getMigrationGuide: vi.fn(),
  formatMigrationGuideResponse: vi.fn().mockReturnValue('migration guide response'),
  diagnoseError: vi.fn(),
  formatDiagnoseErrorResponse: vi.fn().mockReturnValue('diagnose error response'),
  comparePackages: vi.fn(),
  formatComparePackagesResponse: vi.fn().mockReturnValue('compare packages response'),
  scanProjectDeps: vi.fn(),
  formatScanProjectDepsResponse: vi.fn().mockReturnValue('scan project deps response'),
}));

vi.mock('@/core', () => ({
  getDocFetcher: vi.fn().mockReturnValue({
    getCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0 }),
    fetchTypes: vi.fn().mockResolvedValue(null),
  }),
  getDocSearchEngine: vi.fn().mockReturnValue({
    getStats: vi.fn().mockReturnValue({ indexed: 0 }),
  }),
  getQueryParser: vi.fn().mockReturnValue({
    getKnownFrameworks: vi.fn().mockReturnValue(['react', 'vue']),
    getPackageName: vi.fn().mockReturnValue(null),
  }),
  getTypeFetcher: vi.fn().mockReturnValue({
    fetchTypes: vi.fn().mockResolvedValue(null),
    getPackageInfo: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('server', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('SERVER_VERSION', () => {
    it('is 7.1.0', async () => {
      const { SERVER_VERSION } = await import('@/server');
      expect(SERVER_VERSION).toBe('7.1.0');
    });
  });

  describe('getServer()', () => {
    it('returns a server instance', async () => {
      const { getServer } = await import('@/server');
      const server = await getServer();
      expect(server).toBeDefined();
      expect(typeof server).toBe('object');
    });

    it('constructs server with correct name', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { getServer } = await import('@/server');
      await getServer();
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'augments-mcp-server' })
      );
    });

    it('constructs server with correct version', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { getServer } = await import('@/server');
      await getServer();
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({ version: '7.1.0' })
      );
    });

    it('registers tools on the server instance', async () => {
      const { getServer } = await import('@/server');
      const server = await getServer();
      expect((server as any).tool).toHaveBeenCalled();
    });

    it('registers a resource on the server instance', async () => {
      const { getServer } = await import('@/server');
      const server = await getServer();
      expect((server as any).resource).toHaveBeenCalled();
    });
  });

  describe('registeredToolCount', () => {
    it('is 8 after getServer() is called', async () => {
      const serverModule = await import('@/server');
      await serverModule.getServer();
      expect(serverModule.registeredToolCount).toBe(8);
    });
  });

  describe('tool handler — formatResult (tested indirectly)', () => {
    it('formats string results as text content via tool handlers', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { getServer, formatApiContextResponse: _fmt } = await import('@/server');
      await getServer();

      const serverInstance = (McpServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      const toolCalls: Array<[string, string, object, Function]> = serverInstance.tool.mock.calls;

      // Find the get_api_context tool handler
      const [, , , handler] = toolCalls.find(([name]) => name === 'get_api_context')!;

      const { getApiContext, formatApiContextResponse } = await import('@/tools/v4');
      vi.mocked(getApiContext).mockResolvedValueOnce({ dummy: 'data' } as any);
      vi.mocked(formatApiContextResponse).mockReturnValueOnce('formatted string');

      const result = await handler({ query: 'test', includeExamples: true, maxExamples: 2 });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'formatted string' }],
      });
    });

    it('formats object results as JSON text via tool handlers', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { getServer } = await import('@/server');
      await getServer();

      const serverInstance = (McpServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      const toolCalls: Array<[string, string, object, Function]> = serverInstance.tool.mock.calls;

      const [, , , handler] = toolCalls.find(([name]) => name === 'get_api_context')!;

      const { getApiContext, formatApiContextResponse } = await import('@/tools/v4');
      const objectResult = { key: 'value', nested: { num: 42 } };
      vi.mocked(getApiContext).mockResolvedValueOnce({ dummy: 'data' } as any);
      vi.mocked(formatApiContextResponse).mockReturnValueOnce(objectResult as any);

      const result = await handler({ query: 'test', includeExamples: true, maxExamples: 2 });

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(objectResult, null, 2) }],
      });
    });
  });
});

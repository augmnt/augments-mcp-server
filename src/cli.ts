import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getServer, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  // Startup validation
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1));
  if (nodeMajor < 18) {
    process.stderr.write(`Error: Node.js >= 18 required, found ${nodeVersion}\n`);
    process.exit(1);
  }

  // Log startup info
  process.stderr.write(
    `augments-mcp-server v${SERVER_VERSION} | Node ${nodeVersion} | ${process.platform}\n`
  );

  const server = await getServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

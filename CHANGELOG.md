# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-01-23

### Changed
- **Complete TypeScript Rewrite**: Migrated from Python to TypeScript for better Vercel compatibility
- **Serverless Architecture**: Optimized for Vercel edge deployment
- **Cache System**: Switched from diskcache to Upstash Redis for serverless environments
- **Rate Limiting**: Implemented with Upstash Ratelimit for distributed rate limiting

### Added
- Next.js 14 App Router for API routes
- Zod schema validation for all inputs/outputs
- 12 MCP tools (expanded from 9)
- Upstash Redis integration for caching and rate limiting
- CORS headers for cross-origin requests
- Health check endpoint at `/mcp`

### Removed
- Python implementation (available in git history)
- Railway deployment configuration
- Docker deployment support
- diskcache, FastMCP, httpx dependencies

### Technical Stack
- TypeScript 5.4+
- Next.js 14
- @modelcontextprotocol/sdk
- Upstash Redis & Ratelimit
- Zod for validation
- Vercel deployment

## [2.0.9] - 2026-01-03

### Fixed
- Memory exhaustion with LRU eviction
- High Railway costs with reduced resource limits
- O(n) cache operations with framework key indexing

## [1.0.0] - 2025-01-21

### Added
- Initial stable release (Python implementation)
- Support for 85+ frameworks across 10 categories
- 9 MCP tools for documentation lifecycle
- FastMCP, Pydantic, httpx, BeautifulSoup4 stack

[3.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v3.0.0
[2.0.9]: https://github.com/augmnt/augments-mcp-server/releases/tag/v2.0.9
[1.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v1.0.0

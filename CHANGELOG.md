# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-01-28

### Added
- **Query-Focused Context Extraction**: New v4 architecture that fetches TypeScript definitions directly from npm packages
- **Extended Framework Support**: Added Supabase, React Hook Form, Framer Motion, Firebase, styled-components, Emotion
- **Barrel Export Handling**: Smart sub-module fetching for packages with re-exports (react-hook-form, @tanstack/react-query)
- **Improved Documentation Sources**: Added TanStack Query, tRPC, Supabase, React Hook Form, Express doc sources
- **TypeScript Definition Fetcher** (`src/core/type-fetcher.ts`): Fetches `.d.ts` files from npm packages and DefinitelyTyped
- **TypeScript Parser** (`src/core/type-parser.ts`): Uses TypeScript compiler API to extract API signatures, types, and interfaces
- **Query Parser** (`src/core/query-parser.ts`): Extracts framework and concept from natural language queries without LLM
- **Version Registry** (`src/core/version-registry.ts`): Tracks npm package versions, supports version comparison and diff
- **Code Example Extractor** (`src/core/example-extractor.ts`): Extracts code examples from official documentation

### New MCP Tools (v4)
- `get_api_context`: Primary tool for query-focused context extraction. Returns minimal, accurate API signatures and examples optimized for LLMs
- `search_apis`: Discovery tool for searching APIs across frameworks by name or keyword
- `get_version_info`: Version information tool with breaking change detection between versions

### Changed
- Bumped version to 4.0.0
- Server now registers 15 tools (12 v3 + 3 v4)

### Key Innovation
The v4 tools fetch TypeScript definitions as the source of truth for API signatures, rather than relying on parsed documentation. This provides:
- **Accuracy**: Types are compiled and must be correct
- **Minimal context**: ~500-2000 tokens vs 50KB of docs
- **Zero LLM cost**: Just data retrieval, the calling LLM uses the structured data
- **Version-specific**: Can query specific package versions
- **Universal coverage**: Any npm package with types can be queried

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

### Fixed
- SDK transport compatibility for Claude Code integration

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

[4.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v4.0.0
[3.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v3.0.0
[2.0.9]: https://github.com/augmnt/augments-mcp-server/releases/tag/v2.0.9
[1.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v1.0.0

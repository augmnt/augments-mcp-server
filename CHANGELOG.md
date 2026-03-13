# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0] - 2026-03-13

### Added
- **Documentation-first search**: New `DocFetcher` fetches real documentation from GitHub repos via Git Trees API, with in-memory file-name-to-path indexing and 1hr caching
- **BM25 search engine**: New `DocSearchEngine` indexes documentation by heading-based chunks with inverted index, BM25 scoring (k1=1.5, b=0.75), and 3x API name boosting
- **25 concept synonym clusters**: Expanded from 8 to 25 clusters (added middleware, pagination, validation, testing, streaming, error, database, layout, modal, table, upload, realtime, deployment, i18n, SSR, component, context) with bidirectional reverse lookup
- **`get_migration_guide` tool**: Cross-version migration guides with breaking changes, new features, deprecations, type diffs, and official migration docs from changelogs and GitHub Releases
- **`diagnose_error` tool**: Error diagnosis using curated pattern database (~25 patterns across React, Next.js, Prisma, Zod, etc.), GitHub Issues search, and troubleshooting docs
- **`compare_packages` tool**: Side-by-side comparison of 2-5 npm packages — downloads, bundle size, GitHub stars, dependencies, exported API counts
- **`scan_project_deps` tool**: Scans package.json for outdated packages, deprecated dependencies, and security advisories via npm bulk advisory endpoint
- **`diagnostics` tool**: Server health reporting — version, uptime, memory usage, cache statistics, Node.js version
- **`augments://frameworks` MCP resource**: Lists all supported frameworks with package name mappings
- **Changelog fetcher**: Fetches and parses CHANGELOG.md + GitHub Releases API, categorizes entries into breaking changes, features, bug fixes, deprecations
- **Type differ**: Compares .d.ts exports between versions, reports added/removed/changed APIs
- **LRU cache utility**: Generic LRU cache with max size eviction and hit/miss statistics, replacing FIFO eviction across all modules
- **Test suite**: 295 tests across 10 test files — type-fetcher, version-registry, get-version-info, server, e2e-network, integration, and extended get-api-context tests
- **E2E test script**: `npm run test:e2e` for real network tests against npm/GitHub/CDNs

### Changed
- **Documentation-first pipeline**: `get_api_context` now parallel-fetches types + docs + examples, using doc search results as primary prose source with README fallback
- **`get_version_info` enhanced**: Now returns real breaking changes and new features from changelogs instead of generic messages
- **`search_apis` fixed**: `DEFAULT_SEARCH_FRAMEWORKS` now uses correct framework alias keys instead of package names
- **Exponential backoff with jitter**: Registry retries use `1000 * 2^attempt + random(0-500)ms` capped at 10s, with 429 Retry-After header support
- **CDN circuit breaker**: Skips CDN endpoints after 3 failures within 5 minutes, auto-resets
- **GitHub rate limiting**: Tracks `X-RateLimit-Remaining`/`X-RateLimit-Reset` headers, skips fetches when exhausted
- **djb2 hash collision handling**: Parse cache now verifies content equality before returning cached results
- **Levenshtein early termination**: Added `maxDistance` parameter that bails when row minimum exceeds threshold
- **Cache warming**: Increased batch size 4→6 with 30s total timeout
- **Build optimized**: Added `minify: true` and `treeshake: true` to tsup config
- **Startup validation**: CLI validates Node.js >=18 and logs version/platform info
- Bumped version to 7.0.0 (8 tools + diagnostics)

## [6.0.0] - 2026-03-12

### Changed
- **Local stdio transport**: Replaced Vercel HTTP transport with stdio via `@modelcontextprotocol/sdk/server/stdio.js`. Users install with `npx -y @augmnt-sh/augments-mcp-server`
- **npm-publishable**: Removed `"private": true`, added `bin`, `files`, and `prepublishOnly` to package.json
- **tsup bundler**: Replaced Next.js build with tsup (ESM, node18 target, path alias resolution)
- **Logger writes to stderr**: All log methods use `process.stderr.write()` instead of `console.*` to avoid corrupting the JSON-RPC stream on stdout
- **typescript moved to dependencies**: Required at runtime by `type-parser.ts`

### Removed
- Next.js runtime (`next`, `react`, `react-dom`, `@types/react`, `eslint-config-next`)
- Vercel deployment files (`vercel.json`, `next.config.mjs`, `next-env.d.ts`, `.eslintrc.json`)
- HTTP transport layer (`app/api/mcp/route.ts`)
- Web UI (`app/page.tsx`, `app/layout.tsx`)

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

[7.0.0]: https://github.com/augmentscode/augments-mcp-server/releases/tag/v7.0.0
[6.0.0]: https://github.com/augmentscode/augments-mcp-server/releases/tag/v6.0.0
[4.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v4.0.0
[3.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v3.0.0
[2.0.9]: https://github.com/augmnt/augments-mcp-server/releases/tag/v2.0.9
[1.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v1.0.0

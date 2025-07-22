# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-21

### Added
- Initial stable release of Augments MCP Server
- Comprehensive framework documentation provider for Claude Code via Model Context Protocol (MCP)
- Support for 85+ frameworks across 8 categories:
  - Web Frameworks (25): React, Next.js, Vue.js, Angular, Svelte, Tailwind CSS, and more
  - Backend Frameworks (18): FastAPI, Django, Express.js, Laravel, Spring Boot, and more
  - AI/ML Frameworks (14): PyTorch, TensorFlow, Scikit-learn, LangChain, Streamlit, and more
  - Mobile Frameworks (6): React Native, Flutter, Expo, Ionic, and more
  - Database & ORM (5): Prisma, Mongoose, TypeORM, SQLAlchemy, Sequelize
  - State Management (4): Redux, Zustand, MobX, Recoil
  - Testing Frameworks (5): Jest, Vitest, Cypress, Playwright, pytest
  - Development Tools (7): Webpack, Vite, ESLint, Prettier, Turbo, and more
  - DevOps & Infrastructure (4): Docker, Kubernetes, Terraform, Ansible
  - Design Systems (1): shadcn/ui
- Advanced caching system with TTL strategies and multi-level caching
- Hot-reloading configuration support for dynamic framework updates
- 9 comprehensive MCP tools for complete documentation lifecycle:
  - `list_available_frameworks` - Framework discovery and listing
  - `search_frameworks` - Intelligent framework search
  - `get_framework_info` - Detailed framework information
  - `get_framework_docs` - Comprehensive documentation retrieval
  - `get_framework_examples` - Code examples and patterns
  - `search_documentation` - Framework-specific documentation search
  - `get_framework_context` - Multi-framework context enhancement
  - `analyze_code_compatibility` - Code compatibility analysis
  - `check_framework_updates` - Cache management and updates
- Async-first architecture with non-blocking operations throughout
- GitHub API integration with rate limiting and smart caching
- Web scraping capabilities for documentation aggregation
- Structured logging and comprehensive error handling
- Type safety with comprehensive type hints throughout
- Extensible plugin-based architecture for new providers
- Claude Code CLI integration support
- Environment-based configuration with optional GitHub token support

### Technical Stack
- FastMCP - Official MCP Python SDK
- Pydantic - Data validation and serialization
- httpx - Async HTTP client for API requests
- BeautifulSoup4 - HTML parsing for web scraping
- diskcache - Persistent caching with TTL support
- structlog - Structured logging for observability
- watchdog - File system monitoring for hot-reload

### Documentation
- Comprehensive README with installation, usage, and integration guides
- Framework configuration schema and examples
- Claude Code integration instructions (CLI and manual methods)
- Development setup and contribution guidelines
- Complete MCP tools reference with JSON examples

### Infrastructure
- Python 3.11+ support
- UV package manager integration
- Comprehensive test suite with pytest
- Code quality tools (Black, Ruff, mypy)
- GitHub Actions ready for CI/CD
- MIT License

[1.0.0]: https://github.com/augmnt/augments-mcp-server/releases/tag/v1.0.0
# Augments MCP Server

A comprehensive framework documentation provider for Claude Code via Model Context Protocol (MCP). Provides real-time access to framework documentation, context-aware assistance, and intelligent caching to enhance development workflows.

## 🚀 Overview

Augments MCP Server is a sophisticated documentation retrieval system that integrates with Claude Code to provide comprehensive, up-to-date framework information. It features advanced caching strategies, multi-source documentation aggregation, and intelligent context enhancement for modern development workflows.

## ✨ Key Features

### 🎯 **Comprehensive Framework Support**
- **Categorized Framework Registry**: Web, Backend, Mobile, AI/ML, Design, and Tools
- **Multi-Source Documentation**: GitHub repositories, official websites, and examples
- **Hot-Reloading Configuration**: Dynamic framework updates without server restart
- **Intelligent Prioritization**: Framework importance-based ranking

### ⚡ **Advanced Caching System**
- **TTL-Based Strategies**: Different cache durations for stable/beta/dev versions
- **Multi-Level Caching**: Memory and disk persistence for optimal performance
- **Smart Invalidation**: Automatic cache refresh based on source updates
- **Cache Analytics**: Detailed statistics and performance monitoring

### 🧠 **Context Enhancement**
- **Multi-Framework Context**: Combine documentation from multiple frameworks
- **Code Compatibility Analysis**: Detect framework compatibility issues
- **Pattern Recognition**: Common usage patterns and best practices
- **Task-Specific Guidance**: Context tailored to development tasks

### 🔧 **Developer Experience**
- **9 Comprehensive MCP Tools**: Full documentation lifecycle coverage
- **Structured Responses**: Clean, validated JSON outputs
- **Error Resilience**: Graceful degradation with detailed error messages
- **Async Performance**: Non-blocking operations throughout

## 🏗️ Architecture

### **Directory Structure**
```
src/augments_mcp/
├── registry/                   # Framework registry management
│   ├── manager.py             # Hot-reloading registry manager
│   ├── models.py              # Pydantic data models
│   └── cache.py               # Advanced caching system
├── tools/                      # MCP tool implementations
│   ├── framework_discovery.py # Framework search and listing
│   ├── documentation.py       # Documentation retrieval
│   ├── context_enhancement.py # Multi-framework context
│   └── updates.py             # Cache management and updates
├── providers/                  # Documentation source providers
│   ├── github.py              # GitHub API integration
│   ├── website.py             # Web scraping provider
│   └── base.py                # Provider interface
├── utils/                      # Shared utilities
│   ├── github_client.py       # GitHub API client with rate limiting
│   └── validation.py          # Data validation utilities
└── server.py                  # FastMCP server implementation

frameworks/                     # Framework configurations by category
├── web/                       # Web frameworks
│   ├── tailwindcss.json
│   ├── react.json
│   └── nextjs.json
├── backend/                   # Backend frameworks
│   └── fastapi.json
├── design/                    # Design systems
│   └── shadcn-ui.json
└── ai-ml/                     # AI/ML frameworks
    ├── mcp-sdk-python.json
    └── anthropic-sdk.json
```

### **Framework Configuration Schema**
```json
{
  "name": "framework-name",
  "display_name": "Framework Display Name",
  "category": "web|backend|mobile|ai-ml|design|tools",
  "type": "framework|library|tool|service", 
  "version": "latest",
  "sources": {
    "documentation": {
      "github": {
        "repo": "owner/repository",
        "docs_path": "docs",
        "branch": "main"
      },
      "website": "https://docs.framework.com"
    },
    "examples": {
      "github": {
        "repo": "owner/examples",
        "docs_path": "examples", 
        "branch": "main"
      }
    }
  },
  "context_files": ["README.md", "CHANGELOG.md", "API.md"],
  "key_features": ["feature1", "feature2", "feature3"],
  "common_patterns": ["pattern1", "pattern2"],
  "priority": 50
}
```

## 🛠️ Installation

### **Prerequisites**
- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### **Installation Steps**

```bash
# Clone the repository
git clone <repository-url>
cd augments-mcp-server

# Install with uv (recommended)
uv sync

# Or install with pip
pip install -e .
```

### **Environment Configuration**

Create a `.env` file for optional configuration:
```env
# Cache settings
AUGMENTS_CACHE_DIR=~/.cache/augments-mcp-server
AUGMENTS_CACHE_TTL=3600

# GitHub API (optional, for higher rate limits)
GITHUB_TOKEN=your_github_token_here

# Logging
LOG_LEVEL=INFO
```

## 🚀 Usage

### **Option 1: Hosted MCP Server (Recommended)**

For the easiest setup, connect directly to our hosted MCP server at `mcp.augments.dev`. No installation required!

#### **Using Claude Code CLI**

```bash
# Add the hosted MCP server
claude mcp add augments http://mcp.augments.dev

# Verify the server is configured
claude mcp list

# Get server details
claude mcp get augments
```

#### **Manual Configuration**

Add to your Claude Desktop MCP configuration file:

**Location**: 
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "augments": {
      "url": "http://mcp.augments.dev"
    }
  }
}
```

#### **Using the Hosted Server**

Once configured, you can access all framework documentation directly:

1. **Access Framework Documentation**:
   ```
   @augments list frameworks in the web category
   @augments get documentation for tailwindcss responsive design
   ```

2. **Get Multi-Framework Context**:
   ```
   @augments get context for nextjs, tailwindcss, and shadcn-ui 
   for building a dashboard with dark mode
   ```

3. **Analyze Code Compatibility**:
   ```
   @augments analyze this React component for tailwindcss compatibility:
   [paste your code]
   ```

4. **Search Documentation**:
   ```
   @augments search nextjs documentation for "app router"
   ```

The hosted server provides:
- ✅ **No installation required** - Works immediately
- ✅ **Always up-to-date** - Latest framework documentation
- ✅ **High availability** - Reliable uptime with smart caching
- ✅ **No authentication** - Completely frictionless access
- ✅ **Rate limiting protection** - Intelligent abuse prevention

### **Option 2: Local Installation**

For development, customization, or offline use, you can run the server locally.

#### **Starting the Local Server**

```bash
# Run with uv (recommended)
uv run augments-mcp-server

# Or run directly
python -m augments_mcp.server

# Development mode with auto-reload
uv run fastmcp dev src/augments_mcp/server.py
```

#### **Claude Code Integration (Local)**

##### **Method 1: Using Claude Code CLI (Recommended)**

```bash
# Add the local MCP server with environment variables
claude mcp add augments-local -e AUGMENTS_CACHE_DIR="~/.cache/augments-mcp-server" -e GITHUB_TOKEN="your_github_token" -- uv run augments-mcp-server

# Verify the server is configured
claude mcp list

# Get server details
claude mcp get augments-local
```

##### **Method 2: Manual Configuration**

```json
{
  "mcpServers": {
    "augments-local": {
      "command": "uv",
      "args": ["run", "augments-mcp-server"],
      "cwd": "/path/to/augments-mcp-server",
      "env": {
        "AUGMENTS_CACHE_DIR": "~/.cache/augments-mcp-server",
        "GITHUB_TOKEN": "your_github_token"
      }
    }
  }
}
```

##### **Method 3: Global Configuration**

```bash
# Add with full path to project directory
claude mcp add augments-local -e GITHUB_TOKEN="your_github_token" -- uv run --directory /path/to/augments-mcp-server augments-mcp-server
```

#### **Server Management**

```bash
# List all configured MCP servers
claude mcp list

# Get details for a specific server
claude mcp get augments

# Remove the server if needed
claude mcp remove augments

# Update server configuration (remove and re-add)
claude mcp remove augments
claude mcp add augments http://mcp.augments.dev
```

#### **Troubleshooting**

- **Server not appearing**: Restart Claude Code after configuration
- **Connection errors**: For hosted server, check internet connection. For local server, verify installation
- **Environment issues**: Only applies to local installations
- **Permission errors**: Ensure Claude Code has network access (hosted) or file access (local)

## 🔧 MCP Tools

### **Framework Discovery**

#### `list_available_frameworks`
List all available frameworks with optional category filtering.

```json
{
  "category": "web"
}
```

#### `search_frameworks` 
Search frameworks by name, features, or keywords.

```json
{
  "query": "react component library"
}
```

#### `get_framework_info`
Get detailed information about a specific framework.

```json
{
  "framework": "tailwindcss"
}
```

### **Documentation Access**

#### `get_framework_docs`
Retrieve comprehensive documentation for a framework.

```json
{
  "framework": "nextjs",
  "section": "app-router",
  "use_cache": true
}
```

#### `get_framework_examples`
Get code examples for specific patterns within a framework.

```json
{
  "framework": "react",
  "pattern": "hooks"
}
```

#### `search_documentation`
Search within a framework's cached documentation.

```json
{
  "framework": "tailwindcss",
  "query": "responsive design",
  "limit": 10
}
```

### **Context Enhancement**

#### `get_framework_context`
Get relevant context for multiple frameworks based on development task.

```json
{
  "frameworks": ["nextjs", "tailwindcss", "shadcn-ui"],
  "task_description": "Building a responsive dashboard with dark mode"
}
```

#### `analyze_code_compatibility`
Analyze code for framework compatibility and suggest improvements.

```json
{
  "code": "const App = () => { return <div className='p-4'>Hello</div> }",
  "frameworks": ["react", "tailwindcss"]
}
```

### **Cache Management**

#### `check_framework_updates`
Check if framework documentation has been updated since last cache.

```json
{
  "framework": "nextjs"
}
```

#### `refresh_framework_cache`
Refresh cached documentation for frameworks.

```json
{
  "framework": "react",
  "force": false
}
```

#### `get_cache_stats`
Get detailed cache statistics and performance metrics.

```json
{}
```

## 📚 Supported Frameworks

With **85+ frameworks** across 8 categories, providing comprehensive documentation coverage for modern development stacks:

### **Web Frameworks (25)**
- **React** - JavaScript library for building user interfaces
- **Next.js** - React framework for production applications
- **Vue.js** - Progressive JavaScript framework
- **Angular** - Platform for building web applications
- **Svelte** - Compile-time optimized web framework
- **SvelteKit** - Full-stack Svelte framework
- **Astro** - Static site generator with islands architecture
- **Remix** - Full-stack web framework focused on web fundamentals
- **Qwik** - Resumable web framework
- **SolidJS** - Reactive JavaScript library
- **Preact** - Fast 3kB React alternative
- **Alpine.js** - Minimal framework for HTML enhancement
- **Lit** - Simple library for building web components
- **Stimulus** - JavaScript framework for HTML
- **HTMX** - Modern HTML with minimal JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Bootstrap** - CSS framework for responsive design
- **Bulma** - Modern CSS framework based on Flexbox
- **Foundation** - Responsive front-end framework
- **Material-UI** - React components implementing Google's Material Design
- **Chakra UI** - Simple, modular, and accessible React components
- **Mantine** - Full-featured React components library
- **Semantic UI** - Development framework for creating beautiful, responsive layouts
- **Three.js** - JavaScript 3D library
- **D3.js** - Data-driven documents library

### **Backend Frameworks (18)**
- **FastAPI** - Modern, fast Python web framework
- **Django** - High-level Python web framework
- **Flask** - Lightweight Python web framework
- **Pyramid** - Python web framework
- **Sanic** - Async Python web server/framework
- **Express.js** - Fast, unopinionated Node.js web framework
- **Fastify** - Fast and low overhead Node.js web framework
- **Koa.js** - Expressive middleware for Node.js
- **NestJS** - Progressive Node.js framework
- **Laravel** - PHP web application framework
- **Ruby on Rails** - Server-side web application framework
- **Spring Boot** - Java-based framework
- **Actix** - Rust web framework
- **Axum** - Ergonomic and modular Rust web framework
- **Phoenix** - Elixir web framework
- **Echo** - High performance Go web framework
- **Gin** - HTTP web framework for Go
- **Fiber** - Express-inspired Go web framework

### **AI/ML Frameworks (14)**
- **PyTorch** - Machine learning framework
- **TensorFlow** - End-to-end ML platform
- **Scikit-learn** - Machine learning library for Python
- **NumPy** - Fundamental package for scientific computing
- **Pandas** - Data manipulation and analysis library
- **Matplotlib** - Plotting library for Python
- **Seaborn** - Statistical data visualization
- **OpenCV** - Computer vision library
- **Hugging Face** - Transformers and datasets library
- **LangChain** - Framework for developing LLM applications
- **Streamlit** - App framework for ML and data science
- **Gradio** - Build ML web apps
- **MCP SDK Python** - Model Context Protocol Python SDK
- **Anthropic SDK** - Python SDK for Anthropic APIs

### **Mobile Frameworks (6)**
- **React Native** - Build mobile apps using React
- **Flutter** - Google's UI toolkit for mobile
- **Expo** - Platform for universal React applications
- **Ionic** - Cross-platform mobile app development
- **Capacitor** - Cross-platform native runtime
- **Xamarin** - Microsoft's mobile development platform

### **Database & ORM (5)**
- **Prisma** - Next-generation Node.js and TypeScript ORM
- **Mongoose** - MongoDB object modeling for Node.js
- **TypeORM** - ORM for TypeScript and JavaScript
- **SQLAlchemy** - Python SQL toolkit and ORM
- **Sequelize** - Promise-based Node.js ORM

### **State Management (4)**
- **Redux** - Predictable state container for JavaScript
- **Zustand** - Small, fast, and scalable state management
- **MobX** - Reactive state management
- **Recoil** - Experimental state management for React

### **Testing Frameworks (5)**
- **Jest** - JavaScript testing framework
- **Vitest** - Fast Vite-native unit test framework
- **Cypress** - End-to-end testing framework
- **Playwright** - Web testing and automation
- **pytest** - Python testing framework

### **Development Tools (7)**
- **Webpack** - Module bundler
- **Vite** - Fast build tool
- **Parcel** - Zero configuration build tool
- **Rollup** - Module bundler for JavaScript
- **ESLint** - JavaScript linter
- **Prettier** - Code formatter
- **Turbo** - High-performance build system
- **Nx** - Smart, fast and extensible build system

### **DevOps & Infrastructure (4)**
- **Docker** - Containerization platform
- **Kubernetes** - Container orchestration
- **Terraform** - Infrastructure as code
- **Ansible** - Automation platform

### **Design Systems (1)**
- **shadcn/ui** - Beautifully designed React components

## 🔄 Adding New Frameworks

### **1. Create Framework Configuration**

Create a JSON file in the appropriate category directory:

```bash
# For a web framework
frameworks/web/my-framework.json

# For a backend framework  
frameworks/backend/my-framework.json
```

### **2. Framework Configuration Example**

```json
{
  "name": "my-framework",
  "display_name": "My Awesome Framework",
  "category": "web",
  "type": "framework",
  "version": "2.0.0",
  "sources": {
    "documentation": {
      "github": {
        "repo": "myorg/my-framework",
        "docs_path": "docs",
        "branch": "main"
      },
      "website": "https://myframework.dev/docs"
    },
    "examples": {
      "github": {
        "repo": "myorg/my-framework-examples",
        "docs_path": "examples",
        "branch": "main"
      }
    }
  },
  "context_files": ["README.md", "GUIDE.md"],
  "key_features": ["fast", "modern", "typescript"],
  "common_patterns": ["component-based", "declarative"],
  "priority": 60
}
```

### **3. Configuration Fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique framework identifier |
| `display_name` | string | ✅ | Human-readable name |
| `category` | string | ✅ | Framework category |
| `type` | string | ✅ | Framework type |
| `version` | string | ❌ | Version (default: "latest") |
| `sources` | object | ✅ | Documentation sources |
| `context_files` | array | ✅ | Important files to include |
| `key_features` | array | ✅ | Main features/capabilities |
| `common_patterns` | array | ✅ | Usage patterns |
| `priority` | number | ❌ | Importance (1-100, default: 50) |

The server automatically detects new framework configurations and hot-reloads them without restart.

## 🧪 Development

### **Running Tests**

```bash
# Run all tests
uv run pytest

# Run specific test categories
uv run pytest tests/test_models.py -v
uv run pytest tests/test_cache.py -v
uv run pytest tests/test_tools.py -v

# Run with coverage
uv run pytest --cov=src/augments_mcp --cov-report=html
```

### **Code Quality**

```bash
# Format code
uv run black src tests

# Lint code  
uv run ruff check src tests

# Type checking
uv run mypy src

# Run all quality checks
uv run black src tests && uv run ruff check src tests && uv run mypy src
```

### **Development Server**

```bash
# Run with auto-reload for development
uv run fastmcp dev src/augments_mcp/server.py

# Run with debug logging
LOG_LEVEL=DEBUG uv run augments-mcp-server
```

## 🏛️ Technical Details

### **Core Technologies**
- **FastMCP**: Official MCP Python SDK
- **Pydantic**: Data validation and serialization  
- **httpx**: Async HTTP client for API requests
- **BeautifulSoup4**: HTML parsing for web scraping
- **diskcache**: Persistent caching with TTL support
- **structlog**: Structured logging for observability
- **watchdog**: File system monitoring for hot-reload

### **Design Principles**
- **Async-First**: All I/O operations use async/await
- **Type Safety**: Comprehensive type hints throughout
- **Error Resilience**: Graceful degradation with detailed errors
- **Performance**: Multi-level caching and efficient data structures
- **Extensibility**: Plugin-based architecture for new providers
- **Observability**: Structured logging and comprehensive metrics

### **Caching Strategy**
- **Memory Cache**: Fast access for recently used data
- **Disk Cache**: Persistent storage with TTL expiration
- **TTL Strategies**: Different durations based on content stability
  - Stable releases: 24 hours
  - Beta versions: 6 hours  
  - Development branches: 1 hour
- **Smart Invalidation**: Automatic refresh based on source updates

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Add comprehensive tests** for new functionality
4. **Ensure code quality**: Run formatters and linters
5. **Update documentation** for new features
6. **Submit a pull request** with detailed description

### **Development Setup**

```bash
# Clone your fork
git clone https://github.com/yourusername/augments-mcp-server.git
cd augments-mcp-server

# Install development dependencies
uv sync

# Run tests to verify setup
uv run pytest
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📖 **Documentation**: [Model Context Protocol](https://modelcontextprotocol.io)
- 🐛 **Issues**: [GitHub Issues](https://github.com/augmnt/augments-mcp-server/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/augmnt/augments-mcp-server/discussions)

---

**Built with ❤️ for the Claude Code ecosystem**
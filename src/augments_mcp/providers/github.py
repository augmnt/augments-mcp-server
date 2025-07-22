"""GitHub documentation provider."""

import os
import re
from typing import Optional, List, Dict, Any
import structlog

from .base import BaseProvider
from ..utils.github_client import GitHubClient

logger = structlog.get_logger(__name__)


class GitHubProvider(BaseProvider):
    """Provider for fetching documentation from GitHub repositories."""

    def __init__(self, token: Optional[str] = None):
        """Initialize GitHub provider.
        
        Args:
            token: GitHub API token (optional, uses GITHUB_TOKEN env var)
        """
        self.token = token or os.getenv("GITHUB_TOKEN")
        self._client = None
        logger.info("GitHub provider initialized", has_token=bool(self.token))

    async def _get_client(self) -> GitHubClient:
        """Get or create GitHub client."""
        if self._client is None:
            self._client = GitHubClient(self.token)
        return self._client

    async def close(self):
        """Close the GitHub client."""
        if self._client:
            await self._client.close()
            self._client = None
            logger.debug("GitHub provider closed")

    async def fetch_documentation(
        self,
        repo: str,
        path: str = "docs",
        branch: str = "main"
    ) -> Optional[str]:
        """Fetch documentation content from a GitHub repository.
        
        Args:
            repo: Repository in format "owner/name"
            path: Documentation path in the repository
            branch: Branch name
            
        Returns:
            Formatted documentation content or None if not found
        """
        try:
            client = await self._get_client()
            
            # Try to get the content as a single file first
            content = await client.get_file_content(repo, path, branch)
            if content:
                return self._format_single_file(content, path)
            
            # If not a single file, try to get directory contents
            directory_contents = await client.get_directory_contents(repo, path, branch)
            if not directory_contents:
                logger.warning("No documentation found", repo=repo, path=path)
                return None
            
            # Process multiple files
            documentation_parts = []
            
            # Sort files to prioritize common documentation files
            priority_files = ["README.md", "index.md", "introduction.md", "getting-started.md"]
            regular_files = []
            
            for item in directory_contents:
                if item["type"] == "file" and item["name"].lower().endswith((".md", ".mdx")):
                    if item["name"] in priority_files:
                        # Add with priority
                        priority_index = priority_files.index(item["name"])
                        documentation_parts.append((priority_index, item))
                    else:
                        regular_files.append(item)
            
            # Sort priority files and add regular files
            documentation_parts.sort(key=lambda x: x[0])
            priority_items = [item for _, item in documentation_parts]
            
            # Limit to prevent overwhelming output
            all_files = priority_items + regular_files[:10]
            
            # Fetch content for each file
            content_parts = []
            for file_item in all_files:
                file_path = f"{path}/{file_item['name']}" if path else file_item['name']
                file_content = await client.get_file_content(repo, file_path, branch)
                
                if file_content:
                    formatted_content = self._format_file_content(
                        file_content, 
                        file_item['name'],
                        file_path
                    )
                    content_parts.append(formatted_content)
            
            if not content_parts:
                logger.warning("No readable documentation files found", repo=repo, path=path)
                return None
            
            # Combine all parts
            header = f"# Documentation from {repo}\n"
            if path != "docs":
                header += f"**Path:** {path}\n"
            header += f"**Branch:** {branch}\n\n"
            
            full_content = header + "\n\n".join(content_parts)
            
            logger.info("GitHub documentation fetched successfully", 
                       repo=repo, 
                       path=path,
                       files=len(content_parts))
            
            return full_content
            
        except Exception as e:
            logger.error("GitHub documentation fetch failed", 
                        repo=repo, 
                        path=path, 
                        branch=branch,
                        error=str(e))
            return None

    async def fetch_examples(
        self,
        repo: str,
        path: str = "examples",
        branch: str = "main",
        pattern: Optional[str] = None
    ) -> Optional[str]:
        """Fetch code examples from a GitHub repository.
        
        Args:
            repo: Repository in format "owner/name"
            path: Examples path in the repository
            branch: Branch name
            pattern: Specific pattern to search for
            
        Returns:
            Formatted examples content or None if not found
        """
        try:
            client = await self._get_client()
            
            # Get directory contents
            directory_contents = await client.get_directory_contents(repo, path, branch)
            if not directory_contents:
                return None
            
            # Filter for code files and example files
            code_extensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c']
            example_files = []
            
            for item in directory_contents:
                if item["type"] == "file":
                    file_name = item["name"].lower()
                    
                    # Check if it's a code file
                    if any(file_name.endswith(ext) for ext in code_extensions):
                        # If pattern is specified, filter by pattern
                        if pattern:
                            if pattern.lower() in file_name or pattern.lower() in item.get("path", ""):
                                example_files.append(item)
                        else:
                            example_files.append(item)
            
            if not example_files:
                return None
            
            # Limit number of files to process
            example_files = example_files[:5]
            
            # Fetch content for each example file
            examples_parts = []
            for file_item in example_files:
                file_path = f"{path}/{file_item['name']}" if path else file_item['name']
                file_content = await client.get_file_content(repo, file_path, branch)
                
                if file_content:
                    # Detect language for syntax highlighting
                    language = self._detect_language(file_item['name'])
                    
                    formatted_example = f"### {file_item['name']}\n\n"
                    formatted_example += f"```{language}\n{file_content}\n```\n"
                    
                    examples_parts.append(formatted_example)
            
            if not examples_parts:
                return None
            
            # Combine all examples
            header = f"# Examples from {repo}\n"
            if path != "examples":
                header += f"**Path:** {path}\n"
            if pattern:
                header += f"**Pattern:** {pattern}\n"
            header += f"**Branch:** {branch}\n\n"
            
            full_content = header + "\n".join(examples_parts)
            
            logger.info("GitHub examples fetched successfully", 
                       repo=repo, 
                       path=path,
                       pattern=pattern,
                       files=len(examples_parts))
            
            return full_content
            
        except Exception as e:
            logger.error("GitHub examples fetch failed", 
                        repo=repo, 
                        path=path, 
                        pattern=pattern,
                        error=str(e))
            return None

    async def search_repository(
        self,
        repo: str,
        query: str,
        file_extension: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for content in a repository.
        
        Args:
            repo: Repository in format "owner/name"
            query: Search query
            file_extension: Optional file extension filter
            
        Returns:
            List of search results
        """
        try:
            client = await self._get_client()
            results = await client.search_code(repo, query, file_extension)
            
            logger.debug("Repository search completed", 
                        repo=repo, 
                        query=query,
                        results=len(results))
            
            return results
            
        except Exception as e:
            logger.error("Repository search failed", 
                        repo=repo, 
                        query=query,
                        error=str(e))
            return []

    def _format_single_file(self, content: str, file_path: str) -> str:
        """Format content from a single file."""
        # Clean up the content
        content = self._clean_markdown(content)
        
        # Add file header if it doesn't already have one
        if not content.strip().startswith('#'):
            file_name = file_path.split('/')[-1]
            content = f"# {file_name}\n\n{content}"
        
        return content

    def _format_file_content(self, content: str, file_name: str, file_path: str) -> str:
        """Format content from a specific file."""
        content = self._clean_markdown(content)
        
        # Add section header
        section_title = file_name.replace('.md', '').replace('.mdx', '').replace('-', ' ').title()
        formatted_content = f"## {section_title}\n\n{content}"
        
        return formatted_content

    def _clean_markdown(self, content: str) -> str:
        """Clean and normalize markdown content."""
        if not content:
            return ""
        
        # Remove excessive whitespace
        content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
        
        # Remove HTML comments
        content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
        
        # Clean up relative links (basic cleanup)
        content = re.sub(r'\]\(\./([^)]+)\)', r'](\1)', content)
        
        return content.strip()

    def _detect_language(self, filename: str) -> str:
        """Detect programming language from filename."""
        ext_map = {
            '.js': 'javascript',
            '.jsx': 'jsx', 
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin'
        }
        
        for ext, lang in ext_map.items():
            if filename.lower().endswith(ext):
                return lang
        
        return 'text'
"""Website documentation provider."""

import re
from typing import Optional, List, Dict
import httpx
from bs4 import BeautifulSoup
import structlog

from .base import BaseProvider

logger = structlog.get_logger(__name__)


class WebsiteProvider(BaseProvider):
    """Provider for fetching documentation from websites."""

    def __init__(self):
        """Initialize website provider."""
        self._client = None
        logger.info("Website provider initialized")

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={
                    'User-Agent': 'Augments-MCP-Server/1.0 (Documentation Fetcher)'
                },
                follow_redirects=True
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
            logger.debug("Website provider closed")

    async def fetch_documentation(self, url: str) -> Optional[str]:
        """Fetch documentation content from a website.
        
        Args:
            url: Website URL to fetch from
            
        Returns:
            Formatted documentation content or None if failed
        """
        try:
            client = await self._get_client()
            
            logger.debug("Fetching documentation from website", url=url)
            
            response = await client.get(url)
            response.raise_for_status()
            
            # Parse HTML content
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract meaningful content
            content = self._extract_main_content(soup, url)
            
            if not content:
                logger.warning("No meaningful content extracted", url=url)
                return None
            
            # Convert to markdown-like format
            formatted_content = self._format_html_content(content, url)
            
            logger.info("Website documentation fetched successfully", 
                       url=url,
                       length=len(formatted_content))
            
            return formatted_content
            
        except httpx.RequestError as e:
            logger.error("Website request failed", url=url, error=str(e))
            return None
        except httpx.HTTPStatusError as e:
            logger.error("Website HTTP error", 
                        url=url, 
                        status=e.response.status_code,
                        error=str(e))
            return None
        except Exception as e:
            logger.error("Website documentation fetch failed", url=url, error=str(e))
            return None

    async def fetch_examples(self, url: str, pattern: Optional[str] = None) -> Optional[str]:
        """Fetch examples from a website.
        
        Args:
            url: Website URL to fetch from
            pattern: Optional pattern to filter examples
            
        Returns:
            Formatted examples content or None if failed
        """
        try:
            client = await self._get_client()
            
            response = await client.get(url)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract code examples
            examples = self._extract_code_examples(soup, pattern)
            
            if not examples:
                logger.warning("No code examples found", url=url, pattern=pattern)
                return None
            
            # Format examples
            formatted_examples = self._format_examples(examples, url, pattern)
            
            logger.info("Website examples fetched successfully", 
                       url=url,
                       pattern=pattern,
                       count=len(examples))
            
            return formatted_examples
            
        except Exception as e:
            logger.error("Website examples fetch failed", 
                        url=url, 
                        pattern=pattern,
                        error=str(e))
            return None

    def _extract_main_content(self, soup: BeautifulSoup, url: str) -> Optional[BeautifulSoup]:
        """Extract the main content from HTML soup."""
        
        # Try common content selectors in order of preference
        content_selectors = [
            'main',
            '[role="main"]',
            '.main-content',
            '.content',
            '.documentation',
            '.docs',
            'article',
            '.article',
            '#content',
            '#main'
        ]
        
        for selector in content_selectors:
            content = soup.select_one(selector)
            if content:
                logger.debug("Content found with selector", selector=selector, url=url)
                return content
        
        # Fallback to body content, but remove common navigation/footer elements
        body = soup.find('body')
        if body:
            # Remove navigation, header, footer, sidebar elements
            for unwanted in body.select('nav, header, footer, .nav, .navigation, .sidebar, .menu, .header, .footer'):
                unwanted.decompose()
            
            logger.debug("Using body content as fallback", url=url)
            return body
        
        logger.warning("No suitable content container found", url=url)
        return None

    def _format_html_content(self, content: BeautifulSoup, url: str) -> str:
        """Convert HTML content to markdown-like format."""
        
        formatted_parts = []
        
        # Add header
        formatted_parts.append(f"# Documentation from {url}\n")
        
        # Process content elements
        for element in content.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'code', 'ul', 'ol', 'blockquote']):
            
            if element.name.startswith('h'):
                # Handle headings
                level = int(element.name[1])
                heading_text = element.get_text().strip()
                if heading_text:
                    formatted_parts.append(f"{'#' * (level + 1)} {heading_text}\n")
                    
            elif element.name == 'p':
                # Handle paragraphs
                text = element.get_text().strip()
                if text and len(text) > 10:  # Skip very short paragraphs
                    formatted_parts.append(f"{text}\n")
                    
            elif element.name == 'pre':
                # Handle preformatted text (code blocks)
                code_text = element.get_text().strip()
                if code_text:
                    # Try to detect language from class
                    language = 'text'
                    code_elem = element.find('code')
                    if code_elem and code_elem.get('class'):
                        classes = code_elem.get('class')
                        for cls in classes:
                            if cls.startswith('language-'):
                                language = cls.replace('language-', '')
                                break
                            elif cls in ['javascript', 'python', 'html', 'css', 'json', 'bash']:
                                language = cls
                                break
                    
                    formatted_parts.append(f"```{language}\n{code_text}\n```\n")
                    
            elif element.name == 'code' and element.parent.name != 'pre':
                # Handle inline code
                code_text = element.get_text().strip()
                if code_text:
                    formatted_parts.append(f"`{code_text}`")
                    
            elif element.name in ['ul', 'ol']:
                # Handle lists
                list_items = element.find_all('li', recursive=False)
                for i, li in enumerate(list_items):
                    text = li.get_text().strip()
                    if text:
                        if element.name == 'ul':
                            formatted_parts.append(f"- {text}")
                        else:
                            formatted_parts.append(f"{i+1}. {text}")
                formatted_parts.append("")
                
            elif element.name == 'blockquote':
                # Handle blockquotes
                text = element.get_text().strip()
                if text:
                    formatted_parts.append(f"> {text}\n")
        
        # Clean up and join
        content_text = '\n'.join(formatted_parts)
        
        # Remove excessive whitespace
        content_text = re.sub(r'\n\s*\n\s*\n', '\n\n', content_text)
        
        return content_text.strip()

    def _extract_code_examples(self, soup: BeautifulSoup, pattern: Optional[str] = None) -> List[Dict[str, str]]:
        """Extract code examples from HTML soup."""
        
        examples = []
        
        # Find code blocks
        code_blocks = soup.find_all(['pre', 'code'])
        
        for i, block in enumerate(code_blocks):
            code_text = block.get_text().strip()
            
            # Skip very short code snippets
            if len(code_text) < 20:
                continue
            
            # If pattern is specified, filter by pattern
            if pattern:
                if pattern.lower() not in code_text.lower():
                    # Also check surrounding text for context
                    parent_text = ""
                    if block.parent:
                        parent_text = block.parent.get_text().lower()
                    
                    if pattern.lower() not in parent_text:
                        continue
            
            # Detect language
            language = 'text'
            if block.get('class'):
                for cls in block.get('class'):
                    if cls.startswith('language-'):
                        language = cls.replace('language-', '')
                        break
                    elif cls in ['javascript', 'python', 'html', 'css', 'json', 'bash', 'typescript']:
                        language = cls
                        break
            
            # Try to get a title/description from surrounding context
            title = f"Example {i + 1}"
            
            # Look for preceding heading
            prev_heading = None
            current = block
            for _ in range(5):  # Look up to 5 elements back
                current = current.find_previous(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                if current:
                    prev_heading = current.get_text().strip()
                    break
            
            if prev_heading:
                title = prev_heading
            
            examples.append({
                'title': title,
                'code': code_text,
                'language': language
            })
        
        return examples

    def _format_examples(self, examples: List[Dict[str, str]], url: str, pattern: Optional[str] = None) -> str:
        """Format extracted examples."""
        
        formatted_parts = []
        
        # Add header
        header = f"# Examples from {url}"
        if pattern:
            header += f"\n**Pattern:** {pattern}"
        formatted_parts.append(header + "\n")
        
        # Add each example
        for example in examples:
            formatted_parts.append(f"## {example['title']}")
            formatted_parts.append(f"```{example['language']}")
            formatted_parts.append(example['code'])
            formatted_parts.append("```\n")
        
        return '\n'.join(formatted_parts)

    def _clean_text(self, text: str) -> str:
        """Clean extracted text."""
        if not text:
            return ""
        
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'\n\s*\n', '\n\n', text)
        
        # Remove common unwanted characters
        text = text.replace('\u00a0', ' ')  # Non-breaking space
        text = text.replace('\u200b', '')   # Zero-width space
        
        return text.strip()

    def _detect_language(self, filename: str) -> str:
        """Detect programming language from filename extension.
        
        Args:
            filename: The filename to analyze
            
        Returns:
            Detected language name
        """
        if not filename:
            return "text"
        
        # Extract extension
        ext = filename.lower().split('.')[-1] if '.' in filename else ""
        
        # Language mapping
        language_map = {
            'js': 'javascript',
            'jsx': 'javascript', 
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'pyx': 'python',
            'html': 'html',
            'htm': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'sh': 'bash',
            'bash': 'bash',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'cxx': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'cs': 'csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'swift': 'swift',
            'kt': 'kotlin',
            'sql': 'sql',
            'dockerfile': 'dockerfile'
        }
        
        return language_map.get(ext, "text")
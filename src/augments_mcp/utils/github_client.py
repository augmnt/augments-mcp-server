"""GitHub API client with rate limiting and authentication."""

import os
import asyncio
import base64
from typing import Optional, Dict, Any, List
from datetime import datetime
import httpx
import structlog

logger = structlog.get_logger(__name__)


class RateLimitError(Exception):
    """Raised when GitHub API rate limit is exceeded."""
    pass


class GitHubClient:
    """GitHub API client with proper rate limiting and authentication."""
    
    def __init__(self, token: Optional[str] = None):
        """Initialize GitHub client.
        
        Args:
            token: GitHub personal access token (optional, uses GITHUB_TOKEN env var)
        """
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.base_url = "https://api.github.com"
        
        # Rate limiting tracking
        self.rate_limit_remaining = 5000  # Default for authenticated requests
        self.rate_limit_reset = datetime.now()
        self.last_request_time = datetime.now()
        
        # Configure httpx client
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Augments-MCP-Server/1.0"
        }
        
        if self.token:
            headers["Authorization"] = f"token {self.token}"
            logger.info("GitHub client initialized with authentication")
        else:
            logger.warning("GitHub client initialized without token - rate limits will be lower")
        
        self.client = httpx.AsyncClient(
            headers=headers,
            timeout=30.0,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
    
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
    
    async def _check_rate_limit(self):
        """Check and handle rate limiting."""
        if self.rate_limit_remaining <= 1:
            if datetime.now() < self.rate_limit_reset:
                wait_time = (self.rate_limit_reset - datetime.now()).total_seconds()
                logger.warning("Rate limit exceeded, waiting", wait_seconds=wait_time)
                await asyncio.sleep(wait_time)
        
        # Respect a minimum delay between requests
        time_since_last = (datetime.now() - self.last_request_time).total_seconds()
        if time_since_last < 0.1:  # 100ms minimum delay
            await asyncio.sleep(0.1 - time_since_last)
    
    async def _make_request(self, method: str, endpoint: str, **kwargs) -> httpx.Response:
        """Make a request to the GitHub API with rate limiting."""
        await self._check_rate_limit()
        
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        try:
            response = await self.client.request(method, url, **kwargs)
            self.last_request_time = datetime.now()
            
            # Update rate limit info from headers
            if "X-RateLimit-Remaining" in response.headers:
                self.rate_limit_remaining = int(response.headers["X-RateLimit-Remaining"])
            
            if "X-RateLimit-Reset" in response.headers:
                reset_timestamp = int(response.headers["X-RateLimit-Reset"])
                self.rate_limit_reset = datetime.fromtimestamp(reset_timestamp)
            
            # Handle rate limit response
            if response.status_code == 403 and "rate limit" in response.text.lower():
                logger.error("Rate limit exceeded", headers=dict(response.headers))
                raise RateLimitError("GitHub API rate limit exceeded")
            
            response.raise_for_status()
            return response
            
        except httpx.RequestError as e:
            logger.error("GitHub API request failed", error=str(e), url=url)
            raise
        except httpx.HTTPStatusError as e:
            logger.error("GitHub API HTTP error", 
                        status_code=e.response.status_code,
                        url=url,
                        response=e.response.text[:500])
            raise
    
    async def get_repo_info(self, repo: str) -> Dict[str, Any]:
        """Get repository information.
        
        Args:
            repo: Repository in format "owner/name"
            
        Returns:
            Repository information
        """
        response = await self._make_request("GET", f"/repos/{repo}")
        data = response.json()
        
        logger.debug("Retrieved repo info", repo=repo, stars=data.get("stargazers_count"))
        return data
    
    async def get_file_content(
        self, 
        repo: str, 
        path: str, 
        branch: str = "main"
    ) -> Optional[str]:
        """Get file content from a repository.
        
        Args:
            repo: Repository in format "owner/name"
            path: File path in the repository
            branch: Branch name (default: main)
            
        Returns:
            File content as string, or None if not found
        """
        try:
            endpoint = f"/repos/{repo}/contents/{path.lstrip('/')}"
            params = {"ref": branch}
            
            response = await self._make_request("GET", endpoint, params=params)
            data = response.json()
            
            if data.get("type") == "file" and "content" in data:
                # Decode base64 content
                content = base64.b64decode(data["content"]).decode("utf-8")
                logger.debug("Retrieved file content", 
                           repo=repo, 
                           path=path, 
                           size=len(content))
                return content
            else:
                logger.warning("File not found or not a file", repo=repo, path=path)
                return None
                
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.debug("File not found", repo=repo, path=path)
                return None
            raise
    
    async def get_directory_contents(
        self, 
        repo: str, 
        path: str = "", 
        branch: str = "main"
    ) -> List[Dict[str, Any]]:
        """Get directory contents from a repository.
        
        Args:
            repo: Repository in format "owner/name"
            path: Directory path in the repository
            branch: Branch name (default: main)
            
        Returns:
            List of directory contents
        """
        try:
            endpoint = f"/repos/{repo}/contents/{path.lstrip('/')}" if path else f"/repos/{repo}/contents"
            params = {"ref": branch}
            
            response = await self._make_request("GET", endpoint, params=params)
            data = response.json()
            
            if isinstance(data, list):
                logger.debug("Retrieved directory contents", 
                           repo=repo, 
                           path=path, 
                           count=len(data))
                return data
            else:
                logger.warning("Path is not a directory", repo=repo, path=path)
                return []
                
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.debug("Directory not found", repo=repo, path=path)
                return []
            raise
    
    async def search_code(
        self, 
        query: str, 
        repo: str, 
        extension: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for code in a repository.
        
        Args:
            query: Search query
            repo: Repository in format "owner/name"
            extension: File extension to filter by
            
        Returns:
            List of search results
        """
        search_query = f"{query} repo:{repo}"
        if extension:
            search_query += f" extension:{extension}"
        
        params = {
            "q": search_query,
            "sort": "indexed",
            "order": "desc"
        }
        
        try:
            response = await self._make_request("GET", "/search/code", params=params)
            data = response.json()
            
            results = data.get("items", [])
            logger.debug("Code search completed", 
                        repo=repo, 
                        query=query, 
                        results=len(results))
            return results
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403:
                logger.warning("Code search not available (rate limited or requires auth)")
                return []
            raise
    
    async def get_commits(
        self, 
        repo: str, 
        path: Optional[str] = None, 
        since: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent commits for a repository or file.
        
        Args:
            repo: Repository in format "owner/name"
            path: Optional file/directory path
            since: Only commits after this date
            limit: Maximum number of commits to return
            
        Returns:
            List of commit information
        """
        params = {"per_page": min(limit, 100)}
        
        if path:
            params["path"] = path
        
        if since:
            params["since"] = since.isoformat()
        
        try:
            response = await self._make_request("GET", f"/repos/{repo}/commits", params=params)
            data = response.json()
            
            logger.debug("Retrieved commits", 
                        repo=repo, 
                        path=path, 
                        count=len(data))
            return data
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.debug("Repository or path not found", repo=repo, path=path)
                return []
            raise
    
    async def check_file_exists(self, repo: str, path: str, branch: str = "main") -> bool:
        """Check if a file exists in the repository.
        
        Args:
            repo: Repository in format "owner/name"
            path: File path in the repository
            branch: Branch name (default: main)
            
        Returns:
            True if file exists, False otherwise
        """
        try:
            endpoint = f"/repos/{repo}/contents/{path.lstrip('/')}"
            params = {"ref": branch}
            
            response = await self._make_request("HEAD", endpoint, params=params)
            return response.status_code == 200
            
        except httpx.HTTPStatusError:
            return False
    
    def get_rate_limit_info(self) -> Dict[str, Any]:
        """Get current rate limit information.
        
        Returns:
            Rate limit status
        """
        return {
            "remaining": self.rate_limit_remaining,
            "reset_time": self.rate_limit_reset.isoformat(),
            "has_token": bool(self.token),
            "seconds_until_reset": max(0, (self.rate_limit_reset - datetime.now()).total_seconds())
        }
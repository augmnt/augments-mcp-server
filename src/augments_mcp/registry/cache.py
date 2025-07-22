"""Documentation caching system with advanced TTL strategies."""

import os
import time
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import diskcache as dc
import structlog

logger = structlog.get_logger(__name__)


@dataclass
class CacheEntry:
    """Cache entry with metadata."""
    content: str
    cached_at: float
    ttl: int
    version: str
    framework: str
    source_type: str  # 'github', 'website', 'custom'


class DocumentationCache:
    """Advanced documentation caching system."""
    
    def __init__(self, cache_dir: Optional[str] = None):
        """Initialize the documentation cache.
        
        Args:
            cache_dir: Directory for cache storage (defaults to ~/.cache/augments-mcp-server)
        """
        if cache_dir is None:
            cache_dir = os.path.expanduser("~/.cache/augments-mcp-server")
        
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize cache with TTL strategies
        self.cache = dc.Cache(str(self.cache_dir / "documentation"))
        self.memory_cache: Dict[str, CacheEntry] = {}
        
        # TTL strategies based on content stability
        self.cache_ttl = {
            'stable': 24 * 60 * 60,    # 24 hours for stable releases
            'beta': 6 * 60 * 60,       # 6 hours for beta versions  
            'dev': 1 * 60 * 60,        # 1 hour for development branches
            'default': 3 * 60 * 60     # 3 hours default
        }
        
        logger.info("Documentation cache initialized", cache_dir=str(self.cache_dir))
    
    def _get_cache_key(self, framework: str, path: str = "", source_type: str = "docs") -> str:
        """Generate a cache key for the given parameters."""
        key_data = f"{framework}:{path}:{source_type}"
        return hashlib.md5(key_data.encode()).hexdigest()
    
    def _determine_ttl(self, framework: str, version: str, branch: str = "main") -> int:
        """Determine TTL based on framework version and branch."""
        version_lower = version.lower()
        branch_lower = branch.lower()
        
        # Development branches get shorter TTL
        if branch_lower in ['dev', 'develop', 'development', 'master', 'main']:
            if 'dev' in version_lower or 'alpha' in version_lower:
                return self.cache_ttl['dev']
        
        # Beta versions get medium TTL
        if 'beta' in version_lower or 'rc' in version_lower:
            return self.cache_ttl['beta']
        
        # Stable versions get longer TTL
        if 'stable' in version_lower or version_lower == 'latest':
            return self.cache_ttl['stable']
        
        return self.cache_ttl['default']
    
    async def get(
        self, 
        framework: str, 
        path: str = "", 
        source_type: str = "docs"
    ) -> Optional[str]:
        """Get cached documentation content."""
        cache_key = self._get_cache_key(framework, path, source_type)
        
        # Check memory cache first
        if cache_key in self.memory_cache:
            entry = self.memory_cache[cache_key]
            if not self._is_expired(entry):
                logger.debug("Cache hit (memory)", framework=framework, path=path)
                return entry.content
            else:
                del self.memory_cache[cache_key]
        
        # Check disk cache
        try:
            entry_data = self.cache.get(cache_key)
            if entry_data:
                entry = CacheEntry(**entry_data)
                if not self._is_expired(entry):
                    # Promote to memory cache
                    self.memory_cache[cache_key] = entry
                    logger.debug("Cache hit (disk)", framework=framework, path=path)
                    return entry.content
                else:
                    # Remove expired entry
                    del self.cache[cache_key]
        except Exception as e:
            logger.warning("Cache read error", error=str(e), key=cache_key)
        
        logger.debug("Cache miss", framework=framework, path=path)
        return None
    
    async def set(
        self,
        framework: str,
        content: str,
        path: str = "",
        source_type: str = "docs",
        version: str = "latest",
        branch: str = "main"
    ) -> None:
        """Store documentation content in cache."""
        cache_key = self._get_cache_key(framework, path, source_type)
        ttl = self._determine_ttl(framework, version, branch)
        
        entry = CacheEntry(
            content=content,
            cached_at=time.time(),
            ttl=ttl,
            version=version,
            framework=framework,
            source_type=source_type
        )
        
        # Store in both memory and disk cache
        self.memory_cache[cache_key] = entry
        
        try:
            entry_dict = {
                'content': entry.content,
                'cached_at': entry.cached_at,
                'ttl': entry.ttl,
                'version': entry.version,
                'framework': entry.framework,
                'source_type': entry.source_type
            }
            self.cache.set(cache_key, entry_dict, expire=ttl)
            
            logger.debug("Content cached", 
                        framework=framework, 
                        path=path, 
                        ttl=ttl,
                        size=len(content))
                        
        except Exception as e:
            logger.error("Cache write error", error=str(e), key=cache_key)
    
    def _is_expired(self, entry: CacheEntry) -> bool:
        """Check if a cache entry has expired."""
        return time.time() - entry.cached_at > entry.ttl
    
    async def invalidate(self, framework: str, path: str = "", source_type: str = "docs") -> None:
        """Invalidate specific cached content."""
        cache_key = self._get_cache_key(framework, path, source_type)
        
        # Remove from memory cache
        self.memory_cache.pop(cache_key, None)
        
        # Remove from disk cache
        try:
            if cache_key in self.cache:
                del self.cache[cache_key]
                logger.debug("Cache invalidated", framework=framework, path=path)
        except Exception as e:
            logger.warning("Cache invalidation error", error=str(e), key=cache_key)
    
    async def clear_framework(self, framework: str) -> int:
        """Clear all cached content for a specific framework."""
        cleared_count = 0
        
        # Clear from memory cache
        keys_to_remove = []
        for key, entry in self.memory_cache.items():
            if entry.framework == framework:
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.memory_cache[key]
            cleared_count += 1
        
        # Clear from disk cache
        try:
            # This is inefficient but diskcache doesn't support prefix deletion
            for key in list(self.cache.iterkeys()):
                try:
                    entry_data = self.cache.get(key)
                    if entry_data and entry_data.get('framework') == framework:
                        del self.cache[key]
                        cleared_count += 1
                except Exception:
                    continue
        except Exception as e:
            logger.warning("Cache clear error", error=str(e), framework=framework)
        
        logger.info("Framework cache cleared", framework=framework, count=cleared_count)
        return cleared_count
    
    async def clear_all(self) -> int:
        """Clear all cached content."""
        # Clear memory cache
        memory_count = len(self.memory_cache)
        self.memory_cache.clear()
        
        # Clear disk cache
        disk_count = 0
        try:
            disk_count = len(self.cache)
            self.cache.clear()
        except Exception as e:
            logger.error("Disk cache clear error", error=str(e))
        
        total_count = memory_count + disk_count
        logger.info("All cache cleared", count=total_count)
        return total_count
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        try:
            disk_size = len(self.cache)
            disk_volume = self.cache.volume()
        except Exception:
            disk_size = 0
            disk_volume = 0
        
        return {
            "memory_entries": len(self.memory_cache),
            "disk_entries": disk_size,
            "disk_volume_bytes": disk_volume,
            "cache_directory": str(self.cache_dir),
            "ttl_strategies": self.cache_ttl
        }
    
    async def get_framework_cache_info(self, framework: str) -> Dict[str, Any]:
        """Get cache information for a specific framework."""
        memory_entries = 0
        disk_entries = 0
        total_size = 0
        
        # Count memory entries
        for entry in self.memory_cache.values():
            if entry.framework == framework:
                memory_entries += 1
                total_size += len(entry.content)
        
        # Count disk entries (this is expensive but comprehensive)
        try:
            for key in self.cache.iterkeys():
                try:
                    entry_data = self.cache.get(key)
                    if entry_data and entry_data.get('framework') == framework:
                        disk_entries += 1
                        total_size += len(entry_data.get('content', ''))
                except Exception:
                    continue
        except Exception as e:
            logger.warning("Error counting disk entries", error=str(e))
        
        return {
            "framework": framework,
            "memory_entries": memory_entries,
            "disk_entries": disk_entries,
            "total_size_bytes": total_size,
            "cache_directory": str(self.cache_dir)
        }
    
    async def list_keys(self, framework: str) -> List[str]:
        """List all cache keys for a specific framework."""
        framework_keys = []
        
        # Check memory cache
        for key, entry in self.memory_cache.items():
            if entry.framework == framework:
                # Reconstruct the original key format
                cache_key_parts = f"{framework}:{entry.source_type}"
                if cache_key_parts not in framework_keys:
                    framework_keys.append(cache_key_parts)
        
        # Check disk cache
        try:
            for key in self.cache.iterkeys():
                try:
                    entry_data = self.cache.get(key)
                    if entry_data and entry_data.get('framework') == framework:
                        # Reconstruct the original key format
                        source_type = entry_data.get('source_type', 'docs')
                        cache_key_parts = f"{framework}:{source_type}"
                        if cache_key_parts not in framework_keys:
                            framework_keys.append(cache_key_parts)
                except Exception:
                    continue
        except Exception as e:
            logger.warning("Error listing cache keys", error=str(e), framework=framework)
        
        return framework_keys
    
    async def get_by_key(self, cache_key: str) -> Optional[str]:
        """Get cached content by reconstructed cache key."""
        try:
            # Parse the cache key format: "framework:source_type"
            parts = cache_key.split(':')
            if len(parts) >= 2:
                framework = parts[0]
                source_type = parts[1]
                # Use empty path since we're looking for general content
                return await self.get(framework, "", source_type)
        except Exception as e:
            logger.warning("Error getting content by key", error=str(e), key=cache_key)
        
        return None
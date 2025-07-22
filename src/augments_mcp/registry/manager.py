"""Framework registry management."""

import json
import asyncio
from pathlib import Path
from typing import Dict, List, Optional
import structlog
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from .models import FrameworkConfig, FrameworkInfo, SearchResult
from ..utils.validation import validate_framework_config

logger = structlog.get_logger(__name__)


class FrameworkRegistryHandler(FileSystemEventHandler):
    """File system event handler for hot-reloading framework configs."""
    
    def __init__(self, registry_manager):
        self.registry_manager = registry_manager
    
    def on_modified(self, event):
        if event.is_directory or not event.src_path.endswith('.json'):
            return
        
        asyncio.create_task(self.registry_manager.reload_framework_config(event.src_path))


class FrameworkRegistryManager:
    """Manages framework configurations with hot-reloading support."""
    
    def __init__(self, frameworks_dir: str = "frameworks"):
        self.frameworks_dir = Path(frameworks_dir)
        self.frameworks: Dict[str, FrameworkConfig] = {}
        self._observer: Optional[Observer] = None
        self._loaded = False
    
    async def initialize(self) -> None:
        """Initialize the registry and start file watching."""
        await self.load_all_frameworks()
        self.start_watching()
        self._loaded = True
        logger.info("Framework registry initialized", framework_count=len(self.frameworks))
    
    async def shutdown(self) -> None:
        """Shutdown the registry and stop file watching."""
        self.stop_watching()
        logger.info("Framework registry shutdown")
    
    def start_watching(self) -> None:
        """Start watching for framework configuration changes."""
        if self._observer is None:
            self._observer = Observer()
            handler = FrameworkRegistryHandler(self)
            self._observer.schedule(handler, str(self.frameworks_dir), recursive=True)
            self._observer.start()
            logger.info("Started watching framework configurations")
    
    def stop_watching(self) -> None:
        """Stop watching for framework configuration changes."""
        if self._observer:
            self._observer.stop()
            self._observer.join()
            self._observer = None
            logger.info("Stopped watching framework configurations")
    
    async def load_all_frameworks(self) -> None:
        """Load all framework configurations from the frameworks directory."""
        self.frameworks.clear()
        
        if not self.frameworks_dir.exists():
            logger.warning("Frameworks directory not found", dir=str(self.frameworks_dir))
            return
        
        # Load configurations from all subdirectories
        for json_file in self.frameworks_dir.rglob("*.json"):
            try:
                await self.load_framework_config(json_file)
            except Exception as e:
                logger.error("Failed to load framework config", file=str(json_file), error=str(e))
    
    async def load_framework_config(self, config_path: Path) -> Optional[FrameworkConfig]:
        """Load a single framework configuration."""
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Validate configuration
            if not validate_framework_config(data):
                logger.error("Invalid framework configuration", file=str(config_path))
                return None
            
            config = FrameworkConfig(**data)
            self.frameworks[config.name] = config
            
            logger.info("Loaded framework configuration", 
                       framework=config.name, 
                       category=config.category,
                       file=str(config_path))
            
            return config
            
        except Exception as e:
            logger.error("Failed to load framework config", file=str(config_path), error=str(e))
            return None
    
    async def reload_framework_config(self, config_path: str) -> None:
        """Reload a framework configuration after file change."""
        config_path = Path(config_path)
        logger.info("Reloading framework configuration", file=str(config_path))
        await self.load_framework_config(config_path)
    
    def get_framework(self, name: str) -> Optional[FrameworkConfig]:
        """Get a framework configuration by name."""
        return self.frameworks.get(name)
    
    def list_frameworks(self, category: Optional[str] = None) -> List[FrameworkInfo]:
        """List all frameworks, optionally filtered by category."""
        frameworks = []
        
        for config in self.frameworks.values():
            if category and config.category != category:
                continue
            
            info = FrameworkInfo(
                name=config.name,
                display_name=config.display_name,
                category=config.category,
                type=config.type,
                description=f"{config.display_name} - {config.type}",
                tags=config.key_features + config.common_patterns,
                priority=config.priority,
                version=config.version
            )
            frameworks.append(info)
        
        # Sort by priority (higher first) then by name
        frameworks.sort(key=lambda x: (-x.priority, x.name))
        return frameworks
    
    def search_frameworks(self, query: str) -> List[SearchResult]:
        """Search frameworks by name, features, or patterns."""
        query_lower = query.lower()
        results = []
        
        for config in self.frameworks.values():
            score = 0.0
            matched_fields = []
            
            # Exact name match gets highest score
            if query_lower == config.name.lower():
                score += 100
                matched_fields.append("name")
            elif query_lower in config.name.lower():
                score += 50
                matched_fields.append("name")
            
            # Display name match
            if query_lower in config.display_name.lower():
                score += 30
                matched_fields.append("display_name")
            
            # Category match
            if query_lower == config.category.lower():
                score += 25
                matched_fields.append("category")
            
            # Type match
            if query_lower in config.type.lower():
                score += 20
                matched_fields.append("type")
            
            # Key features match
            for feature in config.key_features:
                if query_lower in feature.lower():
                    score += 15
                    matched_fields.append("key_features")
            
            # Common patterns match
            for pattern in config.common_patterns:
                if query_lower in pattern.lower():
                    score += 10
                    matched_fields.append("common_patterns")
            
            # Only include if there's a match
            if score > 0:
                framework_info = FrameworkInfo(
                    name=config.name,
                    display_name=config.display_name,
                    category=config.category,
                    type=config.type,
                    description=f"{config.display_name} - {config.type}",
                    tags=config.key_features + config.common_patterns,
                    priority=config.priority,
                    version=config.version
                )
                
                result = SearchResult(
                    framework=framework_info,
                    relevance_score=score,
                    matched_fields=list(set(matched_fields))
                )
                results.append(result)
        
        # Sort by relevance score (highest first)
        results.sort(key=lambda x: -x.relevance_score)
        return results
    
    def get_categories(self) -> List[str]:
        """Get all available framework categories."""
        categories = set()
        for config in self.frameworks.values():
            categories.add(config.category)
        return sorted(list(categories))
    
    def get_framework_count(self) -> int:
        """Get total number of loaded frameworks."""
        return len(self.frameworks)
    
    def is_loaded(self) -> bool:
        """Check if the registry has been loaded."""
        return self._loaded
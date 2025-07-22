"""Base provider interface for documentation fetching."""

from abc import ABC, abstractmethod
from typing import Dict, Optional, Any
import structlog


logger = structlog.get_logger(__name__)


class DocumentationSection:
    """Represents a section of documentation."""

    def __init__(
        self,
        title: str,
        content: str,
        url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.title = title
        self.content = content
        self.url = url
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "title": self.title,
            "content": self.content,
            "url": self.url,
            "metadata": self.metadata,
        }


class BaseProvider(ABC):
    """Base class for documentation providers."""

    def __init__(self):
        self.logger = logger.bind(provider=self.__class__.__name__)

    @abstractmethod
    async def close(self):
        """Close any resources used by the provider."""
        pass

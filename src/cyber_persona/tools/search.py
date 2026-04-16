"""MCP Search Tool implementation.

This module provides a search tool that connects to an MCP server
via HTTP transport to perform web searches.
"""

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

import httpx

from cyber_persona.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class SearchResultItem:
    """Single search result item."""

    title: str
    url: str | None = None
    snippet: str | None = None
    source: str | None = None
    published_at: str | None = None


@dataclass
class SearchToolConfig:
    """Configuration for search tool."""

    server_url: str
    tool_name: str = "bailian_web_search"
    auth_token: str | None = None
    auth_header: str = "Authorization"
    result_count: int = 10
    timeout: float = 10.0
    endpoints: list[str] = field(default_factory=lambda: ["", "/tools/call", "/mcp/tools/call", "/api/tools/call"])


class SearchTool:
    """MCP-based search tool.

    Connects to an MCP server via HTTP transport to perform web searches.
    Implements the same interface as the TypeScript reference implementation.
    """

    def __init__(self, config: SearchToolConfig | None = None) -> None:
        """Initialize search tool.

        Args:
            config: Tool configuration. If not provided, loads from settings.
        """
        if config is None:
            settings = get_settings()
            search_settings = getattr(settings, "search", None)
            if search_settings is not None:
                config = SearchToolConfig(
                    server_url=getattr(search_settings, "server_url", "http://localhost:3000"),
                    tool_name=getattr(search_settings, "tool_name", "bailian_web_search"),
                    auth_token=getattr(search_settings, "auth_token", None),
                    auth_header=getattr(search_settings, "auth_header", "Authorization"),
                    result_count=getattr(search_settings, "result_count", 10),
                )
            else:
                config = SearchToolConfig(server_url="http://localhost:3000")

        self.config = config
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            headers: dict[str, str] = {"Content-Type": "application/json"}
            if self.config.auth_token:
                header_name = self.config.auth_header
                if header_name.lower() == "authorization":
                    headers[header_name] = f"Bearer {self.config.auth_token}"
                else:
                    headers[header_name] = self.config.auth_token

            self._client = httpx.AsyncClient(
                headers=headers,
                timeout=self.config.timeout,
            )
        return self._client

    async def search(self, query: str) -> list[SearchResultItem]:
        """Execute search query.

        Args:
            query: Search query string.

        Returns:
            List of search result items.
        """
        client = await self._get_client()

        # Build MCP tool call request
        payload = {
            "name": self.config.tool_name,
            "arguments": {
                "query": query,
                "count": self.config.result_count,
            },
        }

        logger.info(
            "SearchTool querying=%r tool=%r endpoints=%s",
            query,
            self.config.tool_name,
            self.config.endpoints,
        )

        last_error: Exception | None = None
        for endpoint in self.config.endpoints:
            try:
                if endpoint:
                    url = urljoin(self.config.server_url.rstrip("/") + "/", endpoint)
                else:
                    url = self.config.server_url.rstrip("/")
                logger.info("SearchTool trying endpoint: %s", url)
                response = await client.post(url, json=payload)
                response.raise_for_status()

                data = response.json()
                results = self._parse_results(data)
                logger.info("SearchTool success at %s with %d results", url, len(results))
                return results

            except (httpx.HTTPError, json.JSONDecodeError) as e:
                logger.warning("SearchTool failed at %s: %s", url, e)
                last_error = e
                continue

        # If all endpoints failed, raise the last error
        if last_error:
            raise RuntimeError(
                f"Failed to call search tool on all endpoints: {last_error}"
            )

        return []

    def _parse_results(self, data: dict[str, Any]) -> list[SearchResultItem]:
        """Parse MCP tool response into search results.

        Args:
            data: Response data from MCP server.

        Returns:
            List of parsed search result items.
        """
        # MCP tool responses typically have content array
        content = data.get("content", [])

        # Find text content
        text_content = ""
        for item in content:
            if item.get("type") == "text":
                text_content = item.get("text", "")
                break

        if not text_content:
            return []

        # Parse JSON results
        try:
            parsed = json.loads(text_content)
        except json.JSONDecodeError:
            return []

        # Handle different response formats
        if isinstance(parsed, list):
            result_items = parsed
        elif isinstance(parsed, dict) and "pages" in parsed:
            result_items = parsed["pages"]
        elif isinstance(parsed, dict) and "results" in parsed:
            result_items = parsed["results"]
        else:
            return []

        # Map to SearchResultItem
        results: list[SearchResultItem] = []
        for item in result_items:
            if not isinstance(item, dict):
                continue

            results.append(
                SearchResultItem(
                    title=str(item.get("title", "No title")),
                    url=item.get("url"),
                    snippet=item.get("snippet") or item.get("description"),
                    source=item.get("source"),
                    published_at=item.get("publishedAt") or item.get("date"),
                )
            )

        return results

    async def close(self) -> None:
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "SearchTool":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.close()



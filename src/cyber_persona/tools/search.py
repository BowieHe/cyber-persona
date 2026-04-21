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
        """Execute search query via MCP JSON-RPC over HTTP.

        Args:
            query: Search query string.

        Returns:
            List of search result items.
        """
        client = await self._get_client()

        logger.info(
            "SearchTool querying=%r tool=%r server=%s",
            query,
            self.config.tool_name,
            self.config.server_url,
        )

        # MCP requires an initialize handshake before any tool calls.
        # 1. Send initialize request
        init_payload = {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "cyber-persona",
                    "version": "1.0.0",
                },
            },
        }
        url = self.config.server_url.rstrip("/")
        response = await client.post(url, json=init_payload)
        response.raise_for_status()
        init_data = response.json()
        logger.info("SearchTool MCP initialize response: %s", init_data)

        # 2. Send initialized notification
        notify_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }
        await client.post(url, json=notify_payload)

        # 3. Build MCP tool call request (JSON-RPC 2.0)
        tool_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": self.config.tool_name,
                "arguments": {
                    "query": query,
                    "count": self.config.result_count,
                },
            },
        }

        response = await client.post(url, json=tool_payload)
        response.raise_for_status()

        data = response.json()
        logger.debug("SearchTool raw response: %s", json.dumps(data, ensure_ascii=False)[:500])
        results = self._parse_results(data)
        logger.info("SearchTool success with %d results", len(results))
        return results

    def _parse_results(self, data: dict[str, Any]) -> list[SearchResultItem]:
        """Parse MCP JSON-RPC 2.0 tool response into search results.

        Args:
            data: Response data from MCP server (JSON-RPC 2.0 format).

        Returns:
            List of parsed search result items.
        """
        # Handle JSON-RPC error responses
        if "error" in data:
            logger.warning("SearchTool MCP error: %s", data["error"])
            return []

        # MCP JSON-RPC 2.0: content is inside result
        result = data.get("result", {})
        content = result.get("content", []) if isinstance(result, dict) else []

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



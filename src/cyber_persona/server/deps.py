"""Dependency injection for FastAPI."""

from functools import lru_cache
from typing import AsyncGenerator

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph

from cyber_persona.config import get_settings
from cyber_persona.engine import create_graph
from cyber_persona.tools import SearchTool


@lru_cache()
def get_graph() -> StateGraph:
    """Get or create cached graph instance."""
    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.llm.model,
        api_key=settings.llm.api_key,
        base_url=settings.llm.base_url,
        temperature=settings.llm.temperature,
        extra_body=settings.llm.extra_body,
    )
    llm_light = ChatOpenAI(
        model=settings.llm_light.model,
        api_key=settings.llm_light.api_key,
        base_url=settings.llm_light.base_url,
        temperature=settings.llm_light.temperature,
        extra_body=settings.llm_light.extra_body,
    )
    search_tool = SearchTool()
    return create_graph(llm=llm, llm_light=llm_light, search_tool=search_tool)


async def get_graph_async() -> AsyncGenerator[StateGraph, None]:
    """Async dependency for graph instance."""
    yield get_graph()

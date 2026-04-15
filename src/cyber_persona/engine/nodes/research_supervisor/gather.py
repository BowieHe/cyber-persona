"""Gather node for research supervisor.

Spawns multiple research sub-agents concurrently.
"""

import asyncio
import logging
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.graph.state import CompiledStateGraph

from cyber_persona.engine.nodes.research_sub_agent.graph import create_research_sub_agent
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


async def _run_sub_agent(
    agent: CompiledStateGraph,
    topic: str,
    user_query: str,
) -> dict[str, Any]:
    """Run a single sub-agent for one topic."""
    # Seed the sub-agent with the topic and user query
    initial_state: AssistantState = {
        "user_query": user_query,
        "current_query": topic,
        "retrieved_context": [],
        "sub_agent_results": [],
    }
    result = await agent.ainvoke(initial_state)
    # Extract the sub_agent_results produced by the sub-agent
    items = result.get("sub_agent_results", [])
    if items:
        return items[0]
    return {"topic": topic, "summary": "无结果", "sources": []}


def gather_node(llm: ChatOpenAI | None = None):
    """Factory for the gather node."""
    # Build once per gather node instance
    sub_agent = create_research_sub_agent(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        topics = state.get("research_plan", [])
        user_query = state.get("user_query", "")
        current_round = state.get("gather_round", 0)

        if not topics:
            logger.warning("GatherNode called with empty research_plan")
            return {
                "retrieved_context": [],
                "sub_agent_results": [],
                "status_message": " gather 失败：无研究计划",
                "gather_round": current_round + 1,
            }

        logger.info("GatherNode spawning %d sub-agents for round=%d", len(topics), current_round)

        tasks = [
            _run_sub_agent(sub_agent, topic, user_query)
            for topic in topics
        ]
        results = await asyncio.gather(*tasks)

        # Merge summaries into retrieved_context for downstream nodes
        snippets: list[str] = []
        for r in results:
            topic = r.get("topic", "")
            summary = r.get("summary", "")
            if summary:
                snippets.append(f"【{topic}】{summary}")

        logger.info("GatherNode collected %d summaries", len(snippets))

        return {
            "retrieved_context": snippets,
            "sub_agent_results": results,
            "gather_round": current_round + 1,
            "status_message": f"并发搜索完成 {len(topics)} 个子主题",
        }

    return _node

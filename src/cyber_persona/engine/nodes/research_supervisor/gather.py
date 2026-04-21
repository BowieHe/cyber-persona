"""Gather node for research supervisor.

Spawns multiple research sub-agents concurrently.
"""

import asyncio
import logging
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.research_sub_agent.graph import create_search_agent
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


# Limit concurrent sub-agents to avoid API rate limits (429 engine_overloaded_error)
_MAX_SUB_AGENT_CONCURRENCY = 2


async def _run_sub_agent(
    llm: ChatOpenAI | None,
    topic: str,
    user_query: str,
) -> dict[str, Any]:
    """Run a single sub-agent for one topic."""
    logger.info("SubAgent starting for topic=%r", topic)
    # Create a fresh agent instance per task to avoid concurrent state issues
    agent = create_search_agent(llm)

    # Build the initial message so the agent knows exactly what to search for.
    # create_react_agent consumes messages, so we pass the topic here.
    initial_state: AssistantState = {
        "messages": [
            HumanMessage(
                content=(
                    f"用户原始问题：{user_query}\n"
                    f"请搜索并总结关于「{topic}」的最新信息。\n"
                    "使用 web_search 工具进行搜索，然后提供简洁的总结。"
                )
            )
        ],
    }
    try:
        result = await asyncio.wait_for(agent.ainvoke(initial_state), timeout=60.0)
    except asyncio.TimeoutError:
        logger.error("SubAgent timed out for topic=%r", topic)
        return {"topic": topic, "summary": "子代理超时，无法完成搜索", "sources": []}
    logger.info("SubAgent completed for topic=%r", topic)
    # Extract the last assistant message as the summary
    messages = result.get("messages", [])
    summary = ""
    for msg in reversed(messages):
        if getattr(msg, "type", None) == "ai":
            summary = msg.content
            break
    return {"topic": topic, "summary": summary or "无结果", "sources": []}


def gather_node(llm: ChatOpenAI | None = None):
    """Factory for the gather node."""

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

        logger.info(
            "GatherNode spawning %d sub-agents for round=%d (max_concurrency=%d)",
            len(topics),
            current_round,
            _MAX_SUB_AGENT_CONCURRENCY,
        )

        semaphore = asyncio.Semaphore(_MAX_SUB_AGENT_CONCURRENCY)

        async def _throttled_run(topic: str, delay: float) -> dict[str, Any]:
            if delay > 0:
                logger.info("SubAgent delaying %.1fs for topic=%r", delay, topic)
                await asyncio.sleep(delay)
            async with semaphore:
                return await _run_sub_agent(llm, topic, user_query)

        tasks = [
            _throttled_run(topic, i * 0.8)
            for i, topic in enumerate(topics)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions from sub-agents
        valid_results: list[dict[str, Any]] = []
        for topic, r in zip(topics, results):
            if isinstance(r, Exception):
                logger.error("SubAgent failed for topic=%r: %s", topic, r)
                valid_results.append({"topic": topic, "summary": f"搜索失败: {r}", "sources": []})
            else:
                valid_results.append(r)

        # Merge summaries into retrieved_context for downstream nodes
        snippets: list[str] = []
        for r in valid_results:
            topic = r.get("topic", "")
            summary = r.get("summary", "")
            if summary:
                snippets.append(f"【{topic}】{summary}")

        logger.info("GatherNode collected %d summaries", len(snippets))

        return {
            "retrieved_context": snippets,
            "sub_agent_results": valid_results,
            "gather_round": current_round + 1,
            "status_message": f"并发搜索完成 {len(topics)} 个子主题",
        }

    return _node

"""Research sub-agent subgraph.

Each sub-agent handles a single research topic:
  search -> summarize -> END
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph

from cyber_persona.config import get_settings
from cyber_persona.engine.nodes.retriever.search_executor import search_executor_node
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


def _get_or_create_llm(llm: ChatOpenAI | None = None) -> ChatOpenAI:
    if llm is not None:
        return llm
    settings = get_settings()
    return ChatOpenAI(
        model=settings.llm_light.model,
        api_key=settings.llm_light.api_key,
        base_url=settings.llm_light.base_url,
        temperature=settings.llm_light.temperature,
    )


SUMMARIZE_PROMPT = """请对以下搜索结果进行简要总结，提取与用户问题相关的核心信息。

用户问题：{user_query}
子主题：{current_query}

搜索结果：
{retrieved_context}

要求：
1. 用 2-4 句话总结关键发现。
2. 保留具体数据和来源。
3. 不要添加搜索结果中没有的信息。
"""


def summarize_node(llm: ChatOpenAI | None = None):
    """Factory for the summarize node."""
    llm_instance = _get_or_create_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        topic = state.get("current_query", "")
        context = state.get("retrieved_context", [])

        logger.info("SubAgent summarizing topic=%r context_len=%d", topic, len(context))

        prompt = SUMMARIZE_PROMPT.format(
            user_query=user_query,
            current_query=topic,
            retrieved_context="\n".join(context) if context else "无",
        )

        messages = [
            SystemMessage(content="你是一个信息整理专家。请以 JSON 格式输出。"),
            HumanMessage(content=prompt),
        ]

        response = await llm_instance.ainvoke(messages)
        summary = response.content if hasattr(response, "content") else str(response)

        logger.info("SubAgent summary for topic=%r length=%d", topic, len(summary))

        return {
            "sub_agent_results": [{"topic": topic, "summary": summary, "sources": context}],
            "status_message": f"子主题总结完成: {topic}",
        }

    return _node


def create_research_sub_agent(
    llm: ChatOpenAI | None = None,
) -> CompiledStateGraph:
    """Build a single-topic research sub-agent.

    Flow: search_executor -> summarize -> END
    """
    builder = StateGraph(AssistantState)

    builder.add_node("sub_search", search_executor_node)
    builder.add_node("sub_summarize", summarize_node(llm))

    builder.add_edge("sub_search", "sub_summarize")
    builder.add_edge("sub_summarize", END)

    builder.set_entry_point("sub_search")

    return builder.compile()

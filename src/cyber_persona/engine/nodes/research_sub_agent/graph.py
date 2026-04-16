"""Research sub-agent as a ReAct agent."""

import logging
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph.graph.state import CompiledStateGraph

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.tools.langchain_compat import web_search

logger = logging.getLogger(__name__)


SUMMARIZE_PROMPT = """请对搜索结果进行简要总结，提取与用户问题相关的核心信息。

用户问题：{user_query}
子主题：{current_query}

要求：
1. 用 2-4 句话总结关键发现。
2. 保留具体数据和来源。
3. 不要添加搜索结果中没有的信息。
"""


def create_search_agent(llm: ChatOpenAI | None = None) -> CompiledStateGraph:
    """Build a single-topic research agent using ReAct."""
    llm_instance = get_llm(llm, light=True)
    prompt = (
        "你是一个研究子代理。你的任务是：\n"
        "1. 使用 web_search 工具搜索与用户问题相关的信息。\n"
        "2. 根据搜索结果，生成一段简洁的总结。\n"
        "3. 最终必须在对话中输出总结内容。"
    )
    return create_react_agent(
        model=llm_instance,
        tools=[web_search],
        prompt=prompt,
    )


# Backward-compatible alias until Task 6 updates all callers
create_research_sub_agent = create_search_agent

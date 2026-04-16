"""Query generator node for the retriever agent."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


class QueryOutput(BaseModel):
    """Structured output for query generation."""

    query: str = Field(description="生成的搜索关键词，要求简洁、直接、便于搜索引擎抓取。")
    reasoning: str = Field(description="简要解释为什么选择这个搜索角度。")


QUERY_GENERATOR_PROMPT = """你是一个专业的金融信息检索分析师。你的任务是根据用户的原始问题，生成一个高效的 Web 搜索关键词。

要求：
1. 搜索词必须简洁、直接、便于搜索引擎抓取。
2. 如果之前已经被 Harness 打回重试，说明当前信息不足，你必须尝试从侧面角度切入（例如：行业上下游、宏观政策、竞品对比、历史事件等）。
3. 严禁使用与【历史搜索词】重复或高度相似的搜索词。

用户问题：{user_query}
历史搜索词（禁止使用）：{attempted_queries}

请输出一个全新的搜索关键词。
"""


def query_generator_node(llm: ChatOpenAI | None = None):
    """Factory for the query generator node."""
    llm_instance = get_llm(llm)
    structured_llm = llm_instance.with_structured_output(QueryOutput)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        attempted = state.get("attempted_queries", [])
        retry_count = state.get("search_retry_count", 0)

        logger.info("QueryGenerator retry=%d attempted=%s", retry_count, attempted)

        prompt = QUERY_GENERATOR_PROMPT.format(
            user_query=user_query,
            attempted_queries=("\n- " + "\n- ".join(attempted)) if attempted else "无",
        )

        messages = [
            SystemMessage(content="你是一个金融信息检索分析师。"),
            HumanMessage(content=prompt),
        ]

        result: QueryOutput = await structured_llm.ainvoke(messages)
        logger.info("QueryGenerator produced query=%r", result.query)

        return {
            "status_message": f"正在检索：{result.query}",
            # Pass the generated query forward via a temporary key;
            # the search_executor will read it from state if we store it here.
            # However, AssistantState doesn't have current_query. We'll use
            # a lightweight approach: store it in the returned dict and let
            # LangGraph merge it. Since AssistantState is total=False, we can
            # return it and the next node sees it.
            "current_query": result.query,
        }

    return _node

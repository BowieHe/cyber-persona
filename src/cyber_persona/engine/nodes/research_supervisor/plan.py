"""Plan node for research supervisor.

Generates a list of sub-topics to research.
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


class ResearchPlanOutput(BaseModel):
    """Structured output for research plan."""

    topics: list[str] = Field(
        description="2-4 个明确的子主题，每个子主题适合独立搜索。"
    )
    reasoning: str = Field(description="简要解释为什么拆分这些子主题。")


PLAN_PROMPT = """你是一位专业的金融研究分析师。请根据用户的研究问题，拆分成 2-4 个明确的子主题，每个子主题适合独立进行网络搜索。

要求：
1. 子主题必须具体、可搜索。
2. 覆盖用户问题的不同维度（如：公司财报、行业竞争、宏观政策、风险提示）。
3. 不要输出无法搜索的抽象概念。

用户问题：{user_query}
"""


def plan_node(llm: ChatOpenAI | None = None):
    """Factory for the plan node."""
    llm_instance = get_llm(llm)
    structured_llm = llm_instance.with_structured_output(ResearchPlanOutput)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        logger.info("PlanNode generating research plan for query=%r", user_query)

        messages = [
            SystemMessage(content="你是一个研究计划制定专家。请以 JSON 格式输出。"),
            HumanMessage(content=PLAN_PROMPT.format(user_query=user_query)),
        ]

        result: ResearchPlanOutput = await structured_llm.ainvoke(messages)
        topics = [t.strip() for t in result.topics if t.strip()]

        logger.info("PlanNode generated topics=%s", topics)

        return {
            "research_plan": topics,
            "status_message": f"研究计划: {', '.join(topics)}",
        }

    return _node

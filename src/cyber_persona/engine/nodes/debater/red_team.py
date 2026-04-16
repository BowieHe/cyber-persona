"""Red Team (bullish/opportunity) node for the debater subgraph."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


RED_TEAM_PROMPT = """你是红方（牛派 / Red Team）。你的职责是"找机会"。

请阅读下面的初稿，并从积极角度补充论据：
1. 宏观环境是否有利？
2. 是否存在潜在的超额收益点？
3. 行业景气度或政策支持是否被低估？

约束：
- 不要直接给用户下结论。
- 只负责把各自视角的论据拉满。
- 保持简洁，控制在 200 字以内。

初稿：
{draft}
"""


def red_team_node(llm: ChatOpenAI | None = None):
    """Factory for the red team node."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        draft = state.get("draft", "")
        round_num = state.get("debate_round", 0) + 1

        logger.info("RedTeam debating round=%d", round_num)

        messages = [
            SystemMessage(content="你是红方牛派，专注于寻找机会和积极信号。"),
            HumanMessage(content=RED_TEAM_PROMPT.format(draft=draft)),
        ]

        response = await llm_instance.ainvoke(messages)
        content = response.content if hasattr(response, "content") else str(response)

        entry = f"[红方第{round_num}轮] {content}"
        return {
            "debate_log": [entry],
            "debate_round": round_num,
            "status_message": f"红蓝辩论第 {round_num}/3 轮",
        }

    return _node

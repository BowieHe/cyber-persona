"""Blue Team (bearish/risk) node for the debater subgraph."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


BLUE_TEAM_PROMPT = """你是蓝方（熊派 / Blue Team）。你的职责是"挑毛病"。

请阅读下面的初稿，并从风险角度进行反驳：
1. 是否存在逻辑漏洞或过度乐观？
2. 历史高回撤、估值泡沫或政策打压风险？
3. 是否有被忽视的下行催化剂？

约束：
- 不要直接给用户下结论。
- 只负责把各自视角的论据拉满。
- 保持简洁，控制在 200 字以内。

初稿：
{draft}
"""


def blue_team_node(llm: ChatOpenAI | None = None):
    """Factory for the blue team node."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        draft = state.get("draft", "")
        round_num = state.get("debate_round", 0)

        logger.info("BlueTeam debating round=%d", round_num)

        messages = [
            SystemMessage(content="你是蓝方熊派，专注于寻找风险和逻辑漏洞。"),
            HumanMessage(content=BLUE_TEAM_PROMPT.format(draft=draft)),
        ]

        response = await llm_instance.ainvoke(messages)
        content = response.content if hasattr(response, "content") else str(response)

        entry = f"[蓝方第{round_num}轮] {content}"
        return {
            "debate_log": [entry],
            "status_message": f"蓝方反驳第 {round_num}/3 轮",
        }

    return _node

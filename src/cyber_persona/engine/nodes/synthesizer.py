"""Synthesizer node for producing the final research answer."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


SYNTHESIZER_PROMPT = """你是系统的最终发言人（首席整合官）。

你的任务是将【初稿】（核心基调）和【辩论实录】（风险与机会补充）进行中和与排版，向用户交付一份既有主线逻辑，又兼顾多方风险提示的高质量深度回答。

要求：
1. 保留初稿的核心投资观点和关键数据。
2. 在适当位置融入红方（机会）和蓝方（风险）的论据，形成平衡的视角。
3. 如果辩论实录中提出了与初稿矛盾的事实，请优先以风险提示的方式呈现，不要掩盖。
4. 结构清晰，分点论述，适合直接呈现给用户。
5. 不要提及"初稿"、"红方"、"蓝方"等内部术语，用客观中立的口吻输出。

初稿：
{draft}

辩论实录：
{debate_log}

用户问题：{user_query}
"""


def synthesizer_node(llm: ChatOpenAI | None = None):
    """Factory for the synthesizer node."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        draft = state.get("draft", "")
        debate_log = state.get("debate_log", [])
        user_query = state.get("user_query", "")

        logger.info(
            "Synthesizer merging draft_length=%d debate_entries=%d",
            len(draft),
            len(debate_log),
        )

        prompt = SYNTHESIZER_PROMPT.format(
            draft=draft,
            debate_log="\n".join(debate_log) if debate_log else "无",
            user_query=user_query,
        )

        messages = [
            SystemMessage(content="你是一位资深的研究报告整合专家，输出客观、结构清晰的最终答案。"),
            HumanMessage(content=prompt),
        ]

        response = await llm_instance.ainvoke(messages)
        final_answer = response.content if hasattr(response, "content") else str(response)

        logger.info("Synthesizer produced final_answer length=%d", len(final_answer))

        return {
            "final_answer": final_answer,
            "output": final_answer,
            "last_specialist": "synthesizer",
            "status_message": "最终答案整合完成",
        }

    return _node

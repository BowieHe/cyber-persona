"""Synthesizer node for producing the final research answer."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


SYNTHESIZER_PROMPT = """你是系统的最终发言人（首席整合官）。

你的任务是将已有的研究信息整合为一份高质量、结构清晰的最终答案，直接回复用户。

要求：
1. 保留核心投资观点和关键数据。
2. 结构清晰，分点论述，适合直接呈现给用户。
3. 不要提及"初稿"、"红方"、"蓝方"等内部术语，用客观中立的口吻输出。
4. 如果信息有缺失，请客观指出，不要编造。

{content_section}

用户问题：{user_query}
"""


def synthesizer_node(llm: ChatOpenAI | None = None):
    """Factory for the synthesizer node."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        draft = state.get("draft", "")
        debate_log = state.get("debate_log", [])
        retrieved_context = state.get("retrieved_context", [])
        user_query = state.get("user_query", "")

        logger.info(
            "Synthesizer merging draft_length=%d debate_entries=%d context_len=%d",
            len(draft),
            len(debate_log),
            len(retrieved_context),
        )

        # Build content section based on available inputs
        sections: list[str] = []
        if draft:
            sections.append(f"初稿：\n{draft}")
        if debate_log:
            sections.append(f"辩论实录：\n{'\n'.join(debate_log)}")
        if retrieved_context and not draft:
            sections.append(f"检索到的信息：\n{'\n'.join(retrieved_context[:20])}")

        content_section = "\n\n".join(sections) if sections else "（无前置内容）"

        prompt = SYNTHESIZER_PROMPT.format(
            content_section=content_section,
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
            "execution_log": [f"synthesizer: 整合最终答案完成，长度 {len(final_answer)} 字符"],
        }

    return _node

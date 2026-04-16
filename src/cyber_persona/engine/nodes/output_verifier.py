"""Generic output verifier node for quality gates after specialists."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


class VerificationResult(BaseModel):
    """Structured output for output verification."""

    passed: bool = Field(description="输出是否完整、准确、直接回应了用户问题")
    correction_directive: str = Field(
        description="如果未通过，请具体说明遗漏了什么或哪里需要改进",
    )


_VERIFIER_PROMPTS: dict[str, str] = {
    "chat_agent": (
        "这是闲聊/问答助手的输出。要求：直接、友好、得体地回答了用户问题。"
        "简单问候只要得体即可通过，不要过度苛求。"
    ),
    "synthesizer": (
        "这是系统最终输出的研究报告。要求：\n"
        "1. 完整回答了用户问题；\n"
        "2. 结构清晰、口吻客观中立；\n"
        "3. 不能出现'红方'、'蓝方'、'初稿'、'辩论'等内部术语。"
    ),
}


_VERIFIER_PROMPT_TEMPLATE = """你是严格的输出质检员。

任务上下文：{context}
用户问题：{user_query}
当前输出：{output}

请判断当前输出是否符合任务上下文的要求、是否完整回应了用户问题。
"""


def output_verifier_node(llm: ChatOpenAI | None = None):
    """Factory for the generic output verifier node."""
    llm_instance = get_llm(llm, light=True)
    structured_llm = llm_instance.with_structured_output(VerificationResult)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        output = state.get("output", "")
        last_specialist = state.get("last_specialist", "")
        context = _VERIFIER_PROMPTS.get(last_specialist, "检查输出是否完整、准确地回应了用户问题。")

        prompt = _VERIFIER_PROMPT_TEMPLATE.format(
            context=context,
            user_query=user_query,
            output=output,
        )
        messages = [
            SystemMessage(content="你是一个严格的输出质检程序。"),
            HumanMessage(content=prompt),
        ]

        result: VerificationResult = await structured_llm.ainvoke(messages)

        logger.info(
            "OutputVerifier specialist=%s passed=%s correction=%r",
            last_specialist,
            result.passed,
            result.correction_directive[:80] if result.correction_directive else "",
        )

        patch: dict[str, Any] = {
            "status_message": f"质检: {'通过' if result.passed else '不通过'}",
        }
        if not result.passed:
            patch["correction_directive"] = result.correction_directive
        else:
            patch["correction_directive"] = ""

        return patch

    return _node


def verifier_router(state: AssistantState) -> str:
    """Route after output_verifier.

    Returns:
        - 'pass' -> END
        - 'retry_<specialist>' -> back to the originating specialist
    """
    directive = state.get("correction_directive", "")
    if not directive:
        return "pass"
    last_specialist = state.get("last_specialist", "chat_agent")
    return f"retry_{last_specialist}"

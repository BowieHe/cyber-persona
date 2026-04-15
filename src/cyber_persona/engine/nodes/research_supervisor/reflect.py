"""Reflect node for research supervisor.

Evaluates whether gathered information is sufficient.
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.config import get_settings
from cyber_persona.models import AssistantState, HarnessEvaluation

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


REFLECT_PROMPT = """你是一个严苛的金融信息质量审查员。请评估当前检索到的信息是否足够回答用户的原始问题。

评估规则：
1. PASSED: 信息充足且直接相关，可以进入撰写阶段。
2. NEEDS_RETRY: 信息不足或遗漏关键维度。请在 correction_directive 中列出还需要补充搜索的子主题（1-2个具体方向）。
3. PARTIAL_ACCEPT: 信息基本够用，但有小部分缺失。可以进入撰写阶段，但需在 missing_information 中清晰列出“当前查不到的数据盲区”。

用户问题：{user_query}
当前已搜索的子主题：{research_plan}
检索到的上下文摘要：
{retrieved_context}
"""


def reflect_node(llm: ChatOpenAI | None = None):
    """Factory for the reflect node."""
    llm_instance = _get_or_create_llm(llm)
    structured_llm = llm_instance.with_structured_output(HarnessEvaluation)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        plan = state.get("research_plan", [])
        context = state.get("retrieved_context", [])

        logger.info("ReflectNode evaluating gather results context_len=%d", len(context))

        prompt = REFLECT_PROMPT.format(
            user_query=user_query,
            research_plan=", ".join(plan) if plan else "无",
            retrieved_context="\n".join(context[:10]) if context else "无",
        )

        messages = [
            SystemMessage(content="你是一个严格的信息质量审查员。请以 JSON 格式输出。"),
            HumanMessage(content=prompt),
        ]

        evaluation: HarnessEvaluation = await structured_llm.ainvoke(messages)

        logger.info(
            "ReflectNode result=%s reasoning_preview=%r",
            evaluation.status,
            evaluation.reasoning[:100] if evaluation.reasoning else "",
        )

        patch: dict[str, Any] = {
            "current_harness_status": evaluation.status,
            "missing_information": evaluation.missing_information or "",
            "status_message": f"信息评估: {evaluation.status}",
        }

        if evaluation.status == "NEEDS_RETRY" and evaluation.correction_directive:
            # Parse new topics from correction_directive
            # Heuristic: split by common separators
            raw = evaluation.correction_directive
            new_topics = [t.strip("-• ") for t in raw.replace("；", "\n").replace(";", "\n").split("\n") if t.strip()]
            if new_topics:
                patch["research_plan"] = new_topics

        return patch

    return _node

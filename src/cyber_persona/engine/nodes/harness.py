"""Harness quality control nodes (LLM-as-a-Judge)."""

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
        model=settings.llm.model,
        api_key=settings.llm.api_key,
        base_url=settings.llm.base_url,
        temperature=settings.llm.temperature,
    )


SEARCH_HARNESS_PROMPT = """你是一个严苛的金融信息质量审查员。
你的任务是评估系统检索到的【上下文】能否足够解答用户的【原始问题】。

评估规则：
1. 若信息充足且直接相关，输出 status: PASSED。
2. 若信息完全无关或过时，且重试次数小于 5 次，输出 status: NEEDS_RETRY，并在 correction_directive 中给出建议的新搜索角度。
3. 若重试次数已达上限（当前已重试 {retry_count} 次），但仍未找到完美信息，请输出 status: PARTIAL_ACCEPT，并在 missing_information 中清晰列出“当前查不到的数据盲区”。

用户问题：{user_query}
当前检索到的上下文：{retrieved_context}
"""

FACT_CHECK_HARNESS_PROMPT = """你是一个以“零容忍”著称的事实核查程序的底层逻辑。
请将【初稿】与【参考上下文】进行逐字对比。

评估规则：
1. 忠实度：初稿中的任何具体数值、实体名称、趋势判断，必须能在上下文中找到明确对应。
2. 若发现任何一处“无中生有”或“篡改数据”，立即输出 status: NEEDS_RETRY，并在 correction_directive 中指出具体的造假位置。
3. 若所有事实均有出处，输出 status: PASSED。

初稿：{draft}
上下文：{retrieved_context}
"""


def search_harness_node(llm: ChatOpenAI | None = None):
    """Factory for the search quality harness node."""
    llm_instance = _get_or_create_llm(llm)
    structured_llm = llm_instance.with_structured_output(HarnessEvaluation)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        retrieved_context = state.get("retrieved_context", [])
        retry_count = state.get("search_retry_count", 0)

        logger.info("SearchHarness evaluating query=%r retry=%d", user_query, retry_count)

        prompt = SEARCH_HARNESS_PROMPT.format(
            user_query=user_query,
            retrieved_context="\n".join(retrieved_context) if retrieved_context else "无",
            retry_count=retry_count,
        )

        messages = [
            SystemMessage(content="你是一个严格的信息质量审查员。请以 JSON 格式输出。"),
            HumanMessage(content=prompt),
        ]

        evaluation: HarnessEvaluation = await structured_llm.ainvoke(messages)

        logger.info(
            "SearchHarness result=%s reasoning_preview=%r",
            evaluation.status,
            evaluation.reasoning[:100] if evaluation.reasoning else "",
        )

        patch: dict[str, Any] = {
            "current_harness_status": evaluation.status,
            "missing_information": evaluation.missing_information or "",
            "status_message": f"搜索质检: {evaluation.status}",
        }

        if evaluation.status == "NEEDS_RETRY" and evaluation.correction_directive:
            patch["correction_log"] = [f"[搜索质检] {evaluation.correction_directive}"]
            patch["search_retry_count"] = retry_count + 1

        if evaluation.status == "PARTIAL_ACCEPT":
            # Do not increment retry count; accept gracefully
            pass

        return patch

    return _node


def fact_check_harness_node(llm: ChatOpenAI | None = None):
    """Factory for the fact-check harness node."""
    llm_instance = _get_or_create_llm(llm)
    structured_llm = llm_instance.with_structured_output(HarnessEvaluation)

    async def _node(state: AssistantState) -> dict[str, Any]:
        draft = state.get("draft", "")
        retrieved_context = state.get("retrieved_context", [])
        retry_count = state.get("draft_retry_count", 0)

        logger.info("FactCheckHarness evaluating draft_length=%d retry=%d", len(draft), retry_count)

        prompt = FACT_CHECK_HARNESS_PROMPT.format(
            draft=draft,
            retrieved_context="\n".join(retrieved_context) if retrieved_context else "无",
        )

        messages = [
            SystemMessage(content="你是一个零容忍的事实核查程序。请以 JSON 格式输出。"),
            HumanMessage(content=prompt),
        ]

        evaluation: HarnessEvaluation = await structured_llm.ainvoke(messages)

        logger.info(
            "FactCheckHarness result=%s reasoning_preview=%r",
            evaluation.status,
            evaluation.reasoning[:100] if evaluation.reasoning else "",
        )

        patch: dict[str, Any] = {
            "current_harness_status": evaluation.status,
            "status_message": f"事实核查: {evaluation.status}",
        }

        if evaluation.status == "NEEDS_RETRY" and evaluation.correction_directive:
            patch["correction_log"] = [f"[事实核查] {evaluation.correction_directive}"]
            patch["draft_retry_count"] = retry_count + 1

        return patch

    return _node

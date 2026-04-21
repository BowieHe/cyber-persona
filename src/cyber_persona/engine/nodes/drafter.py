"""Drafter node for generating the research draft with dynamic error injection."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


BASE_DRAFTER_PROMPT = """你是一位资深的金融分析师。请基于以下检索到的上下文，撰写一份包含明确观点的分析报告初稿。

要求：
1. 报告必须有清晰的结构和明确的投资观点。
2. 所有具体数据、收益率、名称必须严格来自于上下文，严禁编造。
3. 如果上下文中缺少某些关键信息，请明确指出，不要自行推测。

上下文：
{retrieved_context}

用户问题：{user_query}
"""


def drafter_node(llm: ChatOpenAI | None = None):
    """Factory for the drafter node with dynamic prompt injection."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        retrieved_context = state.get("retrieved_context", [])
        correction_log = state.get("correction_log", [])
        harness_status = state.get("current_harness_status", "")
        missing_info = state.get("missing_information", "")

        logger.info(
            "Drafter generating draft: context_len=%d corrections=%d status=%s",
            len(retrieved_context),
            len(correction_log),
            harness_status,
        )

        # Build prompt dynamically
        prompt = BASE_DRAFTER_PROMPT.format(
            retrieved_context="\n".join(retrieved_context) if retrieved_context else "无",
            user_query=user_query,
        )

        if correction_log:
            errors = "\n- ".join(correction_log)
            prompt += (
                f"\n\n【🚨 严重监管警告 🚨】\n"
                f"你之前的尝试被审核程序驳回，你犯了以下严重错误：\n"
                f"- {errors}\n"
                f"本次重写请务必规避上述所有问题！否则系统将崩溃。"
            )

        if harness_status == "PARTIAL_ACCEPT" and missing_info:
            prompt += (
                f"\n\n【⚠️ 风险提示指令】\n"
                f"由于系统检索能力限制，目前缺失以下信息：{missing_info}。"
                f"请在报告开头以客观口吻明确向用户指出这一信息盲区，切勿自行推测编造。"
            )

        messages = [
            SystemMessage(content="你是一位资深的金融分析师，严格遵守事实。"),
            HumanMessage(content=prompt),
        ]

        response = await llm_instance.ainvoke(messages)
        draft = response.content if hasattr(response, "content") else str(response)

        logger.info("Drafter produced draft length=%d", len(draft))

        return {
            "draft": draft,
            "status_message": "初稿撰写完成",
            "execution_log": [f"drafter: 撰写初稿完成，长度 {len(draft)} 字符"],
        }

    return _node

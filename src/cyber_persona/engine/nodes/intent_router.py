"""Intent router node for branching between chat and research flows."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from cyber_persona.config import get_settings
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)


class IntentOutput(BaseModel):
    """Structured output for intent classification."""

    intent: str = Field(
        description="用户意图枚举值，必须是 'CHAT'（闲聊、问候、简单问题）或 'RESEARCH'（深度查询、投研分析、需要检索的复杂问题）"
    )
    reasoning: str = Field(
        description="简要解释为什么判定为该意图。"
    )


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


INTENT_ROUTER_PROMPT = """你是系统的前台接待员。请判断用户的问题属于哪种意图：

- CHAT: 闲聊、打招呼、天气、简单事实问答（如"你好"、"今天天气怎么样"、"2+2等于几"）
- RESEARCH: 需要深度分析、金融投研、多源信息整合的复杂查询（如"分析宁德时代投资风险"、"某基金业绩怎么样"）

只输出枚举值，不要回答具体问题。

用户输入：{user_query}
"""


def intent_router_node(llm: ChatOpenAI | None = None):
    """Factory for the intent router node."""
    llm_instance = _get_or_create_llm(llm)
    structured_llm = llm_instance.with_structured_output(IntentOutput)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        if not user_query:
            # Fallback: if user_query is empty but input exists, use input
            user_query = state.get("input", "")

        logger.info("IntentRouter classifying query=%r", user_query)

        messages = [
            SystemMessage(content="你是一个意图分类器，只输出 'CHAT' 或 'RESEARCH'。请以 JSON 格式输出。"),
            HumanMessage(content=INTENT_ROUTER_PROMPT.format(user_query=user_query)),
        ]

        result: IntentOutput = await structured_llm.ainvoke(messages)
        intent = result.intent.upper().strip()

        # Normalize
        if intent not in ("CHAT", "RESEARCH"):
            logger.warning("IntentRouter returned unexpected intent=%r, defaulting to CHAT", intent)
            intent = "CHAT"

        logger.info("IntentRouter result=%s reasoning=%r", intent, result.reasoning)

        return {
            "user_query": user_query,
            "intent": intent,
            "status_message": f"意图识别: {intent}",
        }

    return _node


def intent_router_router(state: AssistantState) -> str:
    """Conditional edge from intent router."""
    intent = state.get("intent", "CHAT")
    return "chat" if intent == "CHAT" else "research"

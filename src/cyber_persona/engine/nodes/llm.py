"""LLM call node."""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.base import BaseNode
from cyber_persona.engine.llm_factory import get_llm

logger = logging.getLogger(__name__)


class LLMNode(BaseNode):
    """Node for calling LLM and getting response."""

    def __init__(self, llm: ChatOpenAI | None = None) -> None:
        super().__init__(name="llm", llm=llm)

    def _convert_messages(self, messages: list[dict[str, Any]]) -> list:
        """Convert dict messages to LangChain messages."""
        lc_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))

        return lc_messages

    def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        """Call LLM and update state with response."""
        llm = get_llm(self.llm)
        messages = state.get("messages", [])

        # Convert and call LLM
        lc_messages = self._convert_messages(messages)
        logger.info("Calling LLM model=%s with %d messages", llm.model_name, len(lc_messages))
        response = llm.invoke(lc_messages)

        # Extract content
        content = response.content if hasattr(response, "content") else str(response)
        logger.info("LLM response length=%d preview=%r", len(content), content[:100])

        # Add assistant message to history
        messages.append({"role": "assistant", "content": content})

        return {
            **state,
            "messages": messages,
            "llm_response": content,
            "output": content,
            "current_node": self.name,
        }

"""Unified factory for creating LLM instances."""

from langchain_openai import ChatOpenAI
from cyber_persona.config import get_settings


def get_llm(
    llm: ChatOpenAI | None = None,
    *,
    light: bool = False,
    temperature: float | None = None,
) -> ChatOpenAI:
    """Get an existing LLM or create a new one from settings.

    Args:
        llm: Existing LLM instance to reuse. If provided, returned as-is.
        light: Whether to use lightweight LLM settings.
        temperature: Override temperature. Falls back to config if not set.

    Returns:
        Configured ChatOpenAI instance.
    """
    if llm is not None:
        return llm
    settings = get_settings()
    config = settings.llm_light if light else settings.llm
    return ChatOpenAI(
        model=config.model,
        api_key=config.api_key,
        base_url=config.base_url,
        temperature=temperature if temperature is not None else config.temperature,
        extra_body=config.extra_body,
        max_retries=5,
    )

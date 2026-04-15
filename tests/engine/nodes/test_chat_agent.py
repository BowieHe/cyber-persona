import pytest
from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage, HumanMessage

from cyber_persona.engine.nodes.chat_agent import create_chat_agent


@pytest.mark.asyncio
async def test_chat_agent_returns_response():
    fake_agent = AsyncMock()
    fake_agent.ainvoke.return_value = {
        "messages": [
            HumanMessage(content="你好"),
            AIMessage(content="你好！有什么可以帮你的吗？"),
        ],
    }

    with patch(
        "cyber_persona.engine.nodes.chat_agent.create_react_agent",
        return_value=fake_agent,
    ):
        agent = create_chat_agent()
        result = await agent({
            "user_query": "你好",
            "messages": [{"role": "human", "content": "你好"}],
        })
    assert "messages" in result
    assert len(result["messages"]) > 0
    assert "next_agent" in result
    assert result["next_agent"] == "supervisor"

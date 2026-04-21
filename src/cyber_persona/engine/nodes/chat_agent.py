from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage
from cyber_persona.engine.llm_factory import get_llm


def create_chat_agent(llm: ChatOpenAI | None = None):
    """Chat specialist as a ReAct agent (no tools needed)."""
    llm_instance = get_llm(llm)

    # We need a small wrapper because create_react_agent works with messages,
    # but we want to seed it from user_query and return next_agent.
    agent = create_react_agent(
        model=llm_instance,
        tools=[],
        prompt="你是一个友好的助手，回答用户的闲聊和简单问题。",
    )

    async def _wrapped(state):
        user_query = state.get("user_query", "")
        messages = state.get("messages", [])
        # Normalize dict messages to LangChain messages if needed
        lc_messages = []
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "human":
                lc_messages.append(HumanMessage(content=m.get("content", "")))
            elif hasattr(m, "type"):
                lc_messages.append(m)
        if not lc_messages and user_query:
            lc_messages = [HumanMessage(content=user_query)]
        logger = __import__("logging").getLogger(__name__)
        logger.info("ChatAgent invoking agent with %d messages", len(lc_messages))
        result = await agent.ainvoke({"messages": lc_messages})
        logger.info("ChatAgent agent returned %d messages", len(result.get("messages", [])))
        return {
            "messages": result["messages"],
            "output": result["messages"][-1].content if result["messages"] else "",
            "last_specialist": "chat_agent",
            "status_message": "chat 完成",
            "execution_log": ["chat_agent: 完成对话回复"],
        }

    return _wrapped

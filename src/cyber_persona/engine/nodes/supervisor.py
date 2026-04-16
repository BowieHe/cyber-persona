import logging
from typing import Any

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from cyber_persona.engine.llm_factory import get_llm

logger = logging.getLogger(__name__)


def create_supervisor_agent(llm: ChatOpenAI | None = None):
    """Supervisor that routes to specialist agents via handoff tools."""
    llm_instance = get_llm(llm, temperature=0.3)

    @tool
    def handoff_to_chat_agent() -> str:
        """Delegate to the chat agent for casual conversation or simple questions."""
        return "chat_agent"

    @tool
    def handoff_to_research_orchestrator() -> str:
        """Delegate to the research orchestrator for deep research requiring multiple sources."""
        return "research_orchestrator"

    @tool
    def handoff_to_drafter() -> str:
        """Delegate to the drafter to write a report based on gathered research."""
        return "drafter"

    @tool
    def handoff_to_debater_agent() -> str:
        """Delegate to the debater agent for critical review and argumentation."""
        return "debater_agent"

    @tool
    def handoff_to_synthesizer() -> str:
        """Delegate to the synthesizer to produce the final polished answer."""
        return "synthesizer"

    agent = create_react_agent(
        model=llm_instance,
        tools=[
            handoff_to_chat_agent,
            handoff_to_research_orchestrator,
            handoff_to_drafter,
            handoff_to_debater_agent,
            handoff_to_synthesizer,
        ],
        prompt=(
            "你是系统的总调度员。根据用户请求和当前状态，选择最合适的 specialist 处理下一步。\n"
            "使用 handoff_to_* 工具来做出选择。\n"
            "- chat_agent: 闲聊、问候、简单问答\n"
            "- research_orchestrator: 需要多源检索的深度研究\n"
            "- drafter: 已有足够检索结果，需要撰写草稿\n"
            "- debater_agent: 需要对草稿进行批判性辩论\n"
            "- synthesizer: 整合草稿和辩论意见，输出最终答案\n"
        ),
    )

    async def _wrapped(state: dict[str, Any]) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        messages = state.get("messages", [])
        # Seed the agent
        from langchain_core.messages import HumanMessage
        lc_messages = [HumanMessage(content=f"用户请求: {user_query}")]
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "human":
                lc_messages.append(HumanMessage(content=m.get("content", "")))
            elif hasattr(m, "type"):
                lc_messages.append(m)

        logger.info("Supervisor invoking agent with %d messages", len(lc_messages))
        result = await agent.ainvoke({"messages": lc_messages})
        logger.info("Supervisor agent returned %d messages", len(result.get("messages", [])))
        # The last message should be an AIMessage with a tool call result
        # Extract the chosen agent from tool results
        next_agent = None
        for msg in reversed(result["messages"]):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                # tool_calls is a list of dicts
                for tc in msg.tool_calls:
                    name = tc.get("name", "")
                    if name.startswith("handoff_to_"):
                        next_agent = tc.get("args", {}).get("__return__", name.replace("handoff_to_", ""))
                        break
            if next_agent:
                break

        if not next_agent:
            # Fallback based on simple heuristics if tool calling failed
            content = result["messages"][-1].content.lower() if result["messages"] else ""
            if "chat" in content:
                next_agent = "chat_agent"
            else:
                next_agent = "research_orchestrator"

        logger.info("Supervisor routed to %s", next_agent)
        return {
            "next_agent": next_agent,
            "messages": result["messages"],
            "status_message": f"Supervisor 路由到 {next_agent}",
        }

    return _wrapped

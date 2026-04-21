import logging
from typing import Any

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.engine.nodes.research_supervisor.router import MAX_GATHER_ROUNDS

logger = logging.getLogger(__name__)

# Supervisor may route to research_orchestrator at most MAX_GATHER_ROUNDS times.
# This keeps the outer loop limit consistent with the inner gather limit.
MAX_RESEARCH_ITERATIONS = MAX_GATHER_ROUNDS


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
            "- research_orchestrator: 需要多源检索的深度研究（尚未检索过或信息不足时）\n"
            "- drafter: 已有足够检索结果，需要撰写草稿\n"
            "- debater_agent: 需要对草稿进行批判性辩论\n"
            "- synthesizer: 整合草稿和辩论意见，输出最终答案\n\n"
            "重要：不要重复把同一个任务路由到 research_orchestrator。"
            "如果已经检索过但信息仍然不足，直接路由到 drafter 让其在有限信息下撰写。"
        ),
    )

    async def _wrapped(state: dict[str, Any]) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        messages = state.get("messages", [])
        research_iteration = state.get("research_iteration", 0)

        # Hard limit: force drafter if max research iterations reached
        if research_iteration >= MAX_RESEARCH_ITERATIONS:
            logger.info(
                "Max research iterations reached (%d >= %d), forcing drafter",
                research_iteration,
                MAX_RESEARCH_ITERATIONS,
            )
            return {
                "next_agent": "drafter",
                "status_message": f"已达到最大研究轮次 ({research_iteration})，强制进入撰写阶段",
                "research_iteration": research_iteration,
            }

        # Seed the agent with research state context so it knows
        # whether research has already been completed.
        from langchain_core.messages import HumanMessage
        harness_status = state.get("current_harness_status", "")
        retrieved = state.get("retrieved_context", [])
        has_draft = bool(state.get("draft", ""))
        context_text = (
            f"用户请求: {user_query}\n\n"
            f"当前研究状态：\n"
            f"- 已完成研究轮次: {research_iteration}\n"
            f"- 信息评估状态: {harness_status or '未开始'}\n"
            f"- 已检索信息: {len(retrieved)} 条\n"
            f"- 是否已有草稿: {'是' if has_draft else '否'}\n"
        )
        lc_messages = [HumanMessage(content=context_text)]
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "human":
                lc_messages.append(HumanMessage(content=m.get("content", "")))
            elif hasattr(m, "type"):
                lc_messages.append(m)

        logger.info(
            "Supervisor invoking agent with %d messages (research_iteration=%d)",
            len(lc_messages),
            research_iteration,
        )
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

        # Increment counter when routing to research_orchestrator
        new_iteration = research_iteration
        if next_agent == "research_orchestrator":
            new_iteration = research_iteration + 1

        logger.info("Supervisor routed to %s (research_iteration=%d)", next_agent, new_iteration)
        return {
            "next_agent": next_agent,
            "messages": result["messages"],
            "status_message": f"Supervisor 路由到 {next_agent}",
            "research_iteration": new_iteration,
        }

    return _wrapped

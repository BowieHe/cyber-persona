"""Verifier node for quality checking specialist outputs.

Checks whether the last specialist's output meets quality standards
before allowing the Router to advance to the next step.
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from cyber_persona.engine.llm_factory import get_llm
from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)

VERIFIER_PROMPT = """你是质量检查员。检查上一步 specialist 的输出是否满足用户请求。

用户请求：{user_query}
当前步骤：{current_step}

 specialist 的实际输出内容：
{output_content}

执行历史（最近）：
{execution_log}

请评估：
1. 输出是否完整回答了用户请求？
2. 信息是否充分、准确？
3. 是否存在明显错误或遗漏？

返回格式：
第一行必须写：PASSED 或 FAILED
后面可以写理由。
"""


def _extract_output_content(state: AssistantState, current_step: str) -> str:
    """Extract the actual output content produced by the specialist."""
    if current_step == "research_orchestrator":
        context = state.get("retrieved_context", [])
        if context:
            return "检索到的上下文摘要：\n" + "\n".join(context[:20])
        return "（无检索结果）"

    if current_step == "drafter":
        draft = state.get("draft", "")
        if draft:
            return f"草稿内容：\n{draft[:3000]}"
        return "（无草稿内容）"

    if current_step == "synthesizer":
        output = state.get("output", "")
        final_answer = state.get("final_answer", "")
        content = output or final_answer
        if content:
            return f"最终答案：\n{content[:3000]}"
        return "（无最终答案）"

    if current_step == "chat_agent":
        output = state.get("output", "")
        messages = state.get("messages", [])
        if output:
            return f"对话回复：\n{output[:3000]}"
        if messages:
            last = messages[-1]
            if hasattr(last, "content"):
                return f"对话回复：\n{last.content[:3000]}"
            if isinstance(last, dict):
                return f"对话回复：\n{last.get('content', '')[:3000]}"
        return "（无对话回复）"

    if current_step == "debater_agent":
        output = state.get("output", "")
        if output:
            return f"辩论结果：\n{output[:3000]}"
        return "（无辩论结果）"

    # Generic fallback: try common output fields
    for key in ("output", "final_answer", "draft", "result"):
        val = state.get(key)
        if val:
            return f"输出内容：\n{str(val)[:3000]}"
    return "（无可用输出内容）"


def verifier_node(llm: ChatOpenAI | None = None):
    """Factory for the verifier node."""
    llm_instance = get_llm(llm)

    async def _node(state: AssistantState) -> dict[str, Any]:
        user_query = state.get("user_query", "")
        plan = state.get("plan", [])
        plan_index = state.get("plan_index", 0)
        execution_log = state.get("execution_log", [])

        current_step = plan[plan_index] if plan_index < len(plan) else "unknown"
        logger.info("Verifier checking step=%s", current_step)

        output_content = _extract_output_content(state, current_step)
        log_text = "\n".join(execution_log[-10:]) if execution_log else "无"

        prompt = VERIFIER_PROMPT.format(
            user_query=user_query,
            current_step=current_step,
            output_content=output_content,
            execution_log=log_text,
        )
        messages = [HumanMessage(content=prompt)]
        result = await llm_instance.ainvoke(messages)

        content = result.content.strip()
        status = "PASSED" if content.upper().startswith("PASSED") else "FAILED"

        # Prevent infinite retry loops
        retry_count = state.get("step_retry_count", 0)
        MAX_RETRIES = 2
        if status == "FAILED" and retry_count >= MAX_RETRIES:
            logger.warning(
                "Verifier forcing PASSED after %d retries for %s",
                retry_count,
                current_step,
            )
            status = "PASSED"

        logger.info("Verifier result for %s: %s", current_step, status)

        patch: dict[str, Any] = {
            "verification_results": [
                {
                    "step": current_step,
                    "status": status,
                    "reason": content,
                }
            ],
            "execution_log": [f"verifier: {current_step} 质量检查 {status}"],
        }

        if status == "PASSED":
            # Advance to next step
            patch["plan_index"] = plan_index + 1
            patch["step_retry_count"] = 0
        else:
            # Stay on current step for retry
            patch["step_retry_count"] = retry_count + 1

        return patch

    return _node

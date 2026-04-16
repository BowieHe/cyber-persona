"""Graph state definition."""

from typing import Any, TypedDict, Annotated
import operator


class AssistantState(TypedDict, total=False):
    """Unified state for the single research graph.

    All fields are optional (total=False) to allow incremental state
    construction by LangGraph. Use `create_default_state()` to obtain
    a fully initialized dict.
    """

    # --- Input & Conversation ---
    input: str
    user_query: str
    intent: str
    messages: list[dict[str, Any]]

    # --- Business Context ---
    current_query: str
    retrieved_context: Annotated[list[str], operator.add]
    draft: str
    debate_log: Annotated[list[str], operator.add]
    final_answer: str

    # --- Compatibility / Chat path ---
    output: str
    llm_response: str
    error: str | None

    # --- Research Supervisor State ---
    research_plan: list[str]
    sub_agent_results: list[dict[str, Any]]
    gather_round: int

    # --- Harness Regulatory State ---
    attempted_queries: Annotated[list[str], operator.add]
    correction_log: Annotated[list[str], operator.add]
    search_retry_count: int
    draft_retry_count: int
    debate_round: int
    current_harness_status: str
    missing_information: str
    status_message: str

    # --- Multi-Agent Routing ---
    next_agent: str | None

    # --- Output Verifier ---
    last_specialist: str
    correction_directive: str


def create_default_state() -> AssistantState:
    """Create a fully initialized default state."""
    return {
        "input": "",
        "user_query": "",
        "intent": "",
        "messages": [],
        "current_query": "",
        "retrieved_context": [],
        "draft": "",
        "debate_log": [],
        "final_answer": "",
        "output": "",
        "llm_response": "",
        "error": None,
        "research_plan": [],
        "sub_agent_results": [],
        "gather_round": 0,
        "attempted_queries": [],
        "correction_log": [],
        "search_retry_count": 0,
        "draft_retry_count": 0,
        "debate_round": 0,
        "current_harness_status": "",
        "missing_information": "",
        "status_message": "",
        "next_agent": None,
        "last_specialist": "",
        "correction_directive": "",
    }


# Legacy dataclass state (kept for backward compatibility with old BaseNode chain)
from dataclasses import dataclass, field
from cyber_persona.models.message import Message


@dataclass
class GraphState:
    """Legacy state object passed between simple chat graph nodes."""

    input_text: str = ""
    messages: list[Message] = field(default_factory=list)
    current_node: str = ""
    node_outputs: dict[str, Any] = field(default_factory=dict)
    llm_response: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_results: dict[str, Any] = field(default_factory=dict)
    output: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for LangGraph."""
        return {
            "input": self.input_text,
            "messages": [m.to_dict() for m in self.messages],
            "current_node": self.current_node,
            "node_outputs": self.node_outputs,
            "llm_response": self.llm_response,
            "tool_calls": self.tool_calls,
            "tool_results": self.tool_results,
            "output": self.output,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GraphState":
        """Create from dictionary."""
        from cyber_persona.models.message import Message

        messages = [
            Message.from_dict(m) for m in data.get("messages", [])
        ]
        return cls(
            input_text=data.get("input", ""),
            messages=messages,
            current_node=data.get("current_node", ""),
            node_outputs=data.get("node_outputs", {}),
            llm_response=data.get("llm_response", ""),
            tool_calls=data.get("tool_calls", []),
            tool_results=data.get("tool_results", {}),
            output=data.get("output", ""),
            error=data.get("error"),
        )

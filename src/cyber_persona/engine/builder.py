"""Graph builder for creating LangGraph workflows."""

import logging
from typing import Any

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.chat_agent import create_chat_agent
from cyber_persona.engine.nodes.supervisor import create_supervisor_agent
from cyber_persona.engine.nodes.harness import fact_check_harness_node
from cyber_persona.engine.nodes.error_handler import error_handling_node
from cyber_persona.engine.routers import fact_check_harness_router
from cyber_persona.engine.nodes.research_supervisor.graph import create_research_orchestrator_subgraph
from cyber_persona.engine.nodes.drafter import drafter_node
from cyber_persona.engine.nodes.debater.graph import create_debater_subgraph
from cyber_persona.engine.nodes.synthesizer import synthesizer_node
from cyber_persona.engine.nodes.output_verifier import output_verifier_node, verifier_router
from cyber_persona.models import AssistantState, create_default_state
from cyber_persona.tools import SearchTool

logger = logging.getLogger(__name__)


class GraphBuilder:
    """Builder for creating LangGraph instances."""

    def __init__(
        self,
        llm: ChatOpenAI | None = None,
        search_tool: SearchTool | None = None,
    ) -> None:
        self.llm = llm
        self.search_tool = search_tool
        self.nodes: dict[str, Any] = {}
        self.edges: list[tuple[str, str]] = []
        self.conditional_edges: list[tuple[str, Any, dict]] = []
        self.entry_point: str = ""

    def add_node(self, name: str, node: Any) -> "GraphBuilder":
        self.nodes[name] = node
        return self

    def add_edge(self, from_node: str, to_node: str) -> "GraphBuilder":
        self.edges.append((from_node, to_node))
        return self

    def add_conditional_edges(
        self,
        from_node: str,
        router: Any,
        path_map: dict[str, str],
    ) -> "GraphBuilder":
        self.conditional_edges.append((from_node, router, path_map))
        return self

    def set_entry_point(self, name: str) -> "GraphBuilder":
        self.entry_point = name
        return self

    def build(self) -> CompiledStateGraph:
        if not self.nodes:
            raise ValueError("No nodes added.")
        if not self.entry_point:
            raise ValueError("Entry point not set.")
        if self.entry_point not in self.nodes:
            raise ValueError(f"Entry point '{self.entry_point}' not found in nodes")

        logger.info(
            "Building graph with %d nodes, %d edges, %d conditional edges",
            len(self.nodes), len(self.edges), len(self.conditional_edges)
        )

        builder = StateGraph(AssistantState)
        for name, node in self.nodes.items():
            builder.add_node(name, node)
        for from_node, to_node in self.edges:
            if to_node == END:
                builder.add_edge(from_node, END)
            else:
                builder.add_edge(from_node, to_node)
        for from_node, router, path_map in self.conditional_edges:
            builder.add_conditional_edges(from_node, router, path_map)
        builder.set_entry_point(self.entry_point)
        compiled = builder.compile()
        logger.info("Graph compiled successfully")
        return compiled


def _supervisor_router(state: AssistantState) -> str:
    return state.get("next_agent", "chat_agent")


def create_graph(
    llm: ChatOpenAI | None = None,
    llm_light: ChatOpenAI | None = None,
    search_tool: SearchTool | None = None,
) -> CompiledStateGraph:
    """Create the unified multi-agent graph."""
    builder = GraphBuilder(llm=llm, search_tool=search_tool)
    light = llm_light or llm

    # Supervisor and specialists
    builder.add_node("supervisor", create_supervisor_agent(light))
    builder.add_node("chat_agent", create_chat_agent(llm))
    builder.add_node("research_orchestrator", create_research_orchestrator_subgraph(light))
    builder.add_node("drafter", drafter_node(llm))
    builder.add_node("fact_check_harness", fact_check_harness_node(light))
    builder.add_node("debater_agent", create_debater_subgraph(llm))
    builder.add_node("synthesizer", synthesizer_node(llm))
    builder.add_node("error_handling", error_handling_node)
    builder.add_node("output_verifier", output_verifier_node(light))

    # Supervisor routing
    builder.add_conditional_edges(
        "supervisor",
        _supervisor_router,
        {
            "chat_agent": "chat_agent",
            "research_orchestrator": "research_orchestrator",
            "drafter": "drafter",
            "debater_agent": "debater_agent",
            "synthesizer": "synthesizer",
            "supervisor": "supervisor",
        },
    )

    # Specialists return to supervisor, verifier, or END
    builder.add_edge("chat_agent", "output_verifier")
    builder.add_edge("research_orchestrator", "supervisor")
    builder.add_edge("drafter", "fact_check_harness")
    builder.add_conditional_edges(
        "fact_check_harness",
        fact_check_harness_router,
        {
            "continue_to_debate": "debater_agent",
            "rewrite_draft": "drafter",
            "force_quit": "error_handling",
        },
    )
    builder.add_edge("debater_agent", "supervisor")
    builder.add_edge("synthesizer", "output_verifier")
    builder.add_edge("error_handling", END)
    builder.add_conditional_edges(
        "output_verifier",
        verifier_router,
        {
            "pass": END,
            "retry_chat_agent": "chat_agent",
            "retry_synthesizer": "synthesizer",
        },
    )

    builder.set_entry_point("supervisor")
    return builder.build()

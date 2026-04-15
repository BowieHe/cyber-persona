"""Graph builder for creating LangGraph workflows."""

import logging
from typing import Any

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.input import InputNode
from cyber_persona.engine.nodes.llm import LLMNode
from cyber_persona.engine.nodes.output import OutputNode
from cyber_persona.engine.nodes.intent_router import (
    intent_router_node,
    intent_router_router,
)
from cyber_persona.engine.nodes.harness import (
    search_harness_node,
    fact_check_harness_node,
)
from cyber_persona.engine.nodes.error_handler import error_handling_node
from cyber_persona.engine.routers import (
    search_harness_router,
    fact_check_harness_router,
)
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
        """Add a node to the graph."""
        self.nodes[name] = node
        return self

    def add_edge(self, from_node: str, to_node: str) -> "GraphBuilder":
        """Add an edge between nodes."""
        self.edges.append((from_node, to_node))
        return self

    def add_conditional_edges(
        self,
        from_node: str,
        router: Any,
        path_map: dict[str, str],
    ) -> "GraphBuilder":
        """Add conditional edges from a node."""
        self.conditional_edges.append((from_node, router, path_map))
        return self

    def set_entry_point(self, name: str) -> "GraphBuilder":
        """Set the entry point node."""
        self.entry_point = name
        return self

    def build(self) -> CompiledStateGraph:
        """Build and compile the graph."""
        if not self.nodes:
            raise ValueError("No nodes added. Call add_node() first.")
        if not self.entry_point:
            raise ValueError("Entry point not set. Call set_entry_point() first.")
        if self.entry_point not in self.nodes:
            raise ValueError(f"Entry point '{self.entry_point}' not found in nodes")

        logger.info(
            "Building graph with %d nodes, %d edges, %d conditional edges, entry_point=%s",
            len(self.nodes),
            len(self.edges),
            len(self.conditional_edges),
            self.entry_point,
        )

        # Create state graph with unified AssistantState
        builder = StateGraph(AssistantState)

        # Add nodes
        for name, node in self.nodes.items():
            builder.add_node(name, node)

        # Add regular edges
        for from_node, to_node in self.edges:
            if to_node == END:
                builder.add_edge(from_node, END)
            else:
                builder.add_edge(from_node, to_node)

        # Add conditional edges
        for from_node, router, path_map in self.conditional_edges:
            builder.add_conditional_edges(from_node, router, path_map)

        # Set entry point
        builder.set_entry_point(self.entry_point)

        compiled = builder.compile()
        logger.info("Graph compiled successfully")
        return compiled


# ---------------------------------------------------------------------------
# Placeholder nodes for incremental build-out (Phases 5-8)
# ---------------------------------------------------------------------------

from cyber_persona.engine.nodes.retriever.graph import create_retriever_subgraph


from cyber_persona.engine.nodes.drafter import drafter_node


from cyber_persona.engine.nodes.debater.graph import create_debater_subgraph


from cyber_persona.engine.nodes.synthesizer import synthesizer_node


# ---------------------------------------------------------------------------
# Public factory
# ---------------------------------------------------------------------------

def create_graph(
    llm: ChatOpenAI | None = None,
    llm_light: ChatOpenAI | None = None,
    search_tool: SearchTool | None = None,
) -> CompiledStateGraph:
    """Create the unified graph with both CHAT and RESEARCH paths."""
    builder = GraphBuilder(llm=llm, search_tool=search_tool)

    # Light model falls back to main llm if not provided
    light = llm_light or llm

    # ---------- Nodes ----------
    # Intent router
    builder.add_node("intent_router", intent_router_node(light))

    # CHAT path (legacy simple chain)
    builder.add_node("chat_input", InputNode())
    builder.add_node("chat_llm", LLMNode(llm))
    builder.add_node("format_output", OutputNode())

    # RESEARCH path (stubs to be replaced in Phases 5-8)
    builder.add_node("retriever_agent", create_retriever_subgraph(llm))
    builder.add_node("search_harness", search_harness_node(light))
    builder.add_node("drafter", drafter_node(llm))
    builder.add_node("fact_check_harness", fact_check_harness_node(light))
    builder.add_node("debater_agent", create_debater_subgraph(llm))
    builder.add_node("synthesizer", synthesizer_node(llm))
    builder.add_node("error_handling", error_handling_node)

    # ---------- Regular edges ----------
    # CHAT path
    builder.add_edge("chat_input", "chat_llm")
    builder.add_edge("chat_llm", "format_output")
    builder.add_edge("format_output", END)

    # RESEARCH path skeleton
    builder.add_edge("retriever_agent", "search_harness")
    builder.add_edge("drafter", "fact_check_harness")
    builder.add_edge("debater_agent", "synthesizer")
    builder.add_edge("synthesizer", END)
    builder.add_edge("error_handling", END)

    # ---------- Conditional edges ----------
    # Intent router -> CHAT or RESEARCH
    builder.add_conditional_edges(
        "intent_router",
        intent_router_router,
        {
            "chat": "chat_input",
            "research": "retriever_agent",
        },
    )

    # Search harness -> draft, retry, or quit
    builder.add_conditional_edges(
        "search_harness",
        search_harness_router,
        {
            "continue_to_draft": "drafter",
            "continue_to_draft_with_warning": "drafter",
            "rewrite_search_query": "retriever_agent",
            "force_quit": "error_handling",
        },
    )

    # Fact-check harness -> debate, rewrite, or quit
    builder.add_conditional_edges(
        "fact_check_harness",
        fact_check_harness_router,
        {
            "continue_to_debate": "debater_agent",
            "rewrite_draft": "drafter",
            "force_quit": "error_handling",
        },
    )

    # Set entry point
    builder.set_entry_point("intent_router")

    return builder.build()

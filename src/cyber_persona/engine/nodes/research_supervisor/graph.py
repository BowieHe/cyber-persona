"""Research supervisor subgraph assembly.

Flow:
    plan -> gather -> reflect -> router
    router: continue -> gather
    router: synthesize -> END
"""

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.research_supervisor.plan import plan_node
from cyber_persona.engine.nodes.research_supervisor.gather import gather_node
from cyber_persona.engine.nodes.research_supervisor.reflect import reflect_node
from cyber_persona.engine.nodes.research_supervisor.router import research_supervisor_router
from cyber_persona.models import AssistantState


def create_research_supervisor_subgraph(
    llm: ChatOpenAI | None = None,
) -> CompiledStateGraph:
    """Build the research supervisor subgraph.

    Flow:
        plan -> gather -> reflect -> router
        router: continue -> gather
        router: synthesize -> END
    """
    builder = StateGraph(AssistantState)

    builder.add_node("plan", plan_node(llm))
    builder.add_node("gather", gather_node(llm))
    builder.add_node("reflect", reflect_node(llm))

    builder.add_edge("plan", "gather")
    builder.add_edge("gather", "reflect")
    builder.add_conditional_edges(
        "reflect",
        research_supervisor_router,
        {
            "continue": "gather",
            "synthesize": END,
        },
    )

    builder.set_entry_point("plan")

    return builder.compile()

# Flat Multi-Agent Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the project from a hardcoded hierarchical subgraph to a flat multi-agent architecture where a ReAct-based supervisor dynamically routes to chat, research, drafter, debater, and synthesizer specialists.

**Architecture:** A top-level `create_react_agent` supervisor uses handoff tools to delegate work. The `research_orchestrator` retains its internal `plan -> gather -> reflect` subgraph to preserve concurrent topic searches via `asyncio.gather`. All other specialists (chat, drafter, debater, synthesizer) sit at the same flat level and are invoked by the supervisor.

**Tech Stack:** Python 3.13, LangGraph >= 1.1.6, LangChain OpenAI, Pydantic, pytest-asyncio

---

### Task 1: Wrap SearchTool as a LangChain Tool

**Files:**
- Create: `src/cyber_persona/tools/langchain_compat.py`
- Test: `tests/tools/test_langchain_compat.py`

**Step 1: Write the failing test**

```python
# tests/tools/test_langchain_compat.py
import pytest
from cyber_persona.tools.langchain_compat import web_search

@pytest.mark.asyncio
async def test_web_search_returns_string():
    result = await web_search.ainvoke({"query": "宁德时代", "count": 3})
    assert isinstance(result, str)
    assert "宁德时代" in result or result == ""
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/tools/test_langchain_compat.py::test_web_search_returns_string -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cyber_persona.tools.langchain_compat'`

**Step 3: Write minimal implementation**

```python
# src/cyber_persona/tools/langchain_compat.py
from langchain_core.tools import tool
from cyber_persona.tools.search import SearchTool

@tool
def web_search(query: str, count: int = 10) -> str:
    """Search the web for the given query and return a formatted result string."""
    import asyncio
    search = SearchTool()
    try:
        results = asyncio.run(search.search(query))
        lines = []
        for r in results[:count]:
            lines.append(f"Title: {r.title}\nURL: {r.url}\nSnippet: {r.snippet}")
        return "\n\n---\n\n".join(lines)
    finally:
        asyncio.run(search.close())
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/tools/test_langchain_compat.py::test_web_search_returns_string -v`
Expected: PASS (or skip if no network; if tool is not async-friendly, adjust to sync invoke in test)

**Step 5: Commit**

```bash
git add tests/tools/test_langchain_compat.py src/cyber_persona/tools/langchain_compat.py
git commit -m "feat: add web_search langchain tool wrapper"
```

---

### Task 2: Upgrade search_agent to create_react_agent

**Files:**
- Modify: `src/cyber_persona/engine/nodes/research_sub_agent/graph.py`
- Test: `tests/engine/nodes/research_sub_agent/test_graph.py` (create if missing)

**Step 1: Write the failing test**

```python
# tests/engine/nodes/research_sub_agent/test_graph.py
import pytest
from cyber_persona.engine.nodes.research_sub_agent.graph import create_search_agent

@pytest.mark.asyncio
async def test_search_agent_compiles_and_runs():
    agent = create_search_agent()
    result = await agent.ainvoke({
        "user_query": "宁德时代",
        "current_query": "宁德时代主营业务",
        "retrieved_context": [],
        "sub_agent_results": [],
    })
    assert "sub_agent_results" in result
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/engine/nodes/research_sub_agent/test_graph.py::test_search_agent_compiles_and_runs -v`
Expected: FAIL because `create_search_agent` does not exist yet (only `create_research_sub_agent` exists)

**Step 3: Write minimal implementation**

Replace the entire contents of `src/cyber_persona/engine/nodes/research_sub_agent/graph.py`:

```python
"""Research sub-agent as a ReAct agent."""

import logging
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph.graph.state import CompiledStateGraph

from cyber_persona.config import get_settings
from cyber_persona.tools.langchain_compat import web_search

logger = logging.getLogger(__name__)


def _get_or_create_llm(llm: ChatOpenAI | None = None) -> ChatOpenAI:
    if llm is not None:
        return llm
    settings = get_settings()
    return ChatOpenAI(
        model=settings.llm_light.model,
        api_key=settings.llm_light.api_key,
        base_url=settings.llm_light.base_url,
        temperature=settings.llm_light.temperature,
    )


SUMMARIZE_PROMPT = """请对搜索结果进行简要总结，提取与用户问题相关的核心信息。

用户问题：{user_query}
子主题：{current_query}

要求：
1. 用 2-4 句话总结关键发现。
2. 保留具体数据和来源。
3. 不要添加搜索结果中没有的信息。
"""


def create_search_agent(llm: ChatOpenAI | None = None) -> CompiledStateGraph:
    """Build a single-topic research agent using ReAct."""
    llm_instance = _get_or_create_llm(llm)
    prompt = (
        "你是一个研究子代理。你的任务是：\n"
        "1. 使用 web_search 工具搜索与用户问题相关的信息。\n"
        "2. 根据搜索结果，生成一段简洁的总结。\n"
        "3. 最终必须在对话中输出总结内容。"
    )
    return create_react_agent(
        model=llm_instance,
        tools=[web_search],
        prompt=prompt,
    )
```

Note: `create_react_agent` uses `messages` key by default. Our `AssistantState` will need to support this in later tasks.

**Step 4: Run test to verify it passes**

Run: `pytest tests/engine/nodes/research_sub_agent/test_graph.py::test_search_agent_compiles_and_runs -v`
Expected: PASS (agent compiles and runs; may skip search if offline)

**Step 5: Commit**

```bash
git add src/cyber_persona/engine/nodes/research_sub_agent/graph.py tests/engine/nodes/research_sub_agent/test_graph.py
git commit -m "feat: convert research sub-agent to create_react_agent"
```

---

### Task 3: Update AssistantState with next_agent and messages compatibility

**Files:**
- Modify: `src/cyber_persona/models/state.py`
- Test: `tests/models/test_state.py` (create if missing)

**Step 1: Write the failing test**

```python
# tests/models/test_state.py
from cyber_persona.models.state import AssistantState, create_default_state

def test_default_state_has_next_agent():
    state = create_default_state()
    assert "next_agent" in state
    assert state["next_agent"] is None
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/models/test_state.py::test_default_state_has_next_agent -v`
Expected: FAIL with `AssertionError` because `next_agent` is not in `create_default_state`

**Step 3: Write minimal implementation**

In `src/cyber_persona/models/state.py`, add to `AssistantState`:

```python
class AssistantState(TypedDict, total=False):
    # --- existing fields ...
    next_agent: str | None
    # keep messages as list[dict] for backward compat; 
    # we will convert to LangChain messages at agent boundaries
```

And in `create_default_state()` add `"next_agent": None`.

**Step 4: Run test to verify it passes**

Run: `pytest tests/models/test_state.py::test_default_state_has_next_agent -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cyber_persona/models/state.py tests/models/test_state.py
git commit -m "feat: add next_agent field to AssistantState"
```

---

### Task 4: Create chat_agent as a ReAct agent

**Files:**
- Create: `src/cyber_persona/engine/nodes/chat_agent.py`
- Test: `tests/engine/nodes/test_chat_agent.py`

**Step 1: Write the failing test**

```python
# tests/engine/nodes/test_chat_agent.py
import pytest
from cyber_persona.engine.nodes.chat_agent import create_chat_agent

@pytest.mark.asyncio
async def test_chat_agent_returns_response():
    agent = create_chat_agent()
    result = await agent.ainvoke({
        "user_query": "你好",
        "messages": [{"role": "human", "content": "你好"}],
    })
    assert "messages" in result
    assert len(result["messages"]) > 0
    assert "next_agent" in result
    assert result["next_agent"] == "supervisor"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/engine/nodes/test_chat_agent.py::test_chat_agent_returns_response -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# src/cyber_persona/engine/nodes/chat_agent.py
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage
from cyber_persona.config import get_settings


def _get_or_create_llm(llm: ChatOpenAI | None = None) -> ChatOpenAI:
    if llm is not None:
        return llm
    settings = get_settings()
    return ChatOpenAI(
        model=settings.llm.model,
        api_key=settings.llm.api_key,
        base_url=settings.llm.base_url,
        temperature=settings.llm.temperature,
    )


def create_chat_agent(llm: ChatOpenAI | None = None):
    """Chat specialist as a ReAct agent (no tools needed)."""
    llm_instance = _get_or_create_llm(llm)

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
        result = await agent.ainvoke({"messages": lc_messages})
        return {
            "messages": result["messages"],
            "output": result["messages"][-1].content if result["messages"] else "",
            "next_agent": "supervisor",
            "status_message": "chat 完成",
        }

    return _wrapped
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/engine/nodes/test_chat_agent.py::test_chat_agent_returns_response -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cyber_persona/engine/nodes/chat_agent.py tests/engine/nodes/test_chat_agent.py
git commit -m "feat: add chat_agent as create_react_agent wrapper"
```

---

### Task 5: Create supervisor_agent with handoff tools

**Files:**
- Create: `src/cyber_persona/engine/nodes/supervisor.py`
- Test: `tests/engine/nodes/test_supervisor.py`

**Step 1: Write the failing test**

```python
# tests/engine/nodes/test_supervisor.py
import pytest
from cyber_persona.engine.nodes.supervisor import create_supervisor_agent

@pytest.mark.asyncio
async def test_supervisor_decides_chat():
    agent = create_supervisor_agent()
    result = await agent.ainvoke({
        "user_query": "你好",
        "messages": [{"role": "human", "content": "你好"}],
    })
    assert "next_agent" in result
    assert result["next_agent"] in ["chat_agent", "research_orchestrator", "drafter", "debater_agent", "synthesizer"]
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/engine/nodes/test_supervisor.py::test_supervisor_decides_chat -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# src/cyber_persona/engine/nodes/supervisor.py
import logging
from typing import Any

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from cyber_persona.config import get_settings

logger = logging.getLogger(__name__)


def _get_or_create_llm(llm: ChatOpenAI | None = None) -> ChatOpenAI:
    if llm is not None:
        return llm
    settings = get_settings()
    return ChatOpenAI(
        model=settings.llm.model,
        api_key=settings.llm.api_key,
        base_url=settings.llm.base_url,
        temperature=0.3,
    )


def create_supervisor_agent(llm: ChatOpenAI | None = None):
    """Supervisor that routes to specialist agents via handoff tools."""
    llm_instance = _get_or_create_llm(llm)

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

        result = await agent.ainvoke({"messages": lc_messages})
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
```

Note: `create_react_agent` tool result handling may need refinement based on actual message structure; adjust in Task 5 refinement if test shows unexpected format.

**Step 4: Run test to verify it passes**

Run: `pytest tests/engine/nodes/test_supervisor.py::test_supervisor_decides_chat -v`
Expected: PASS (result contains next_agent == "chat_agent")

**Step 5: Commit**

```bash
git add src/cyber_persona/engine/nodes/supervisor.py tests/engine/nodes/test_supervisor.py
git commit -m "feat: add supervisor_agent with handoff tools"
```

---

### Task 6: Refactor research_orchestrator subgraph and update gather/reflect

**Files:**
- Modify: `src/cyber_persona/engine/nodes/research_supervisor/graph.py`
- Modify: `src/cyber_persona/engine/nodes/research_supervisor/gather.py`
- Modify: `src/cyber_persona/engine/nodes/research_supervisor/reflect.py`
- Test: `tests/engine/nodes/research_supervisor/test_graph.py`

**Step 1: Write the failing test**

```python
# tests/engine/nodes/research_supervisor/test_graph.py
import pytest
from cyber_persona.engine.nodes.research_supervisor.graph import create_research_orchestrator_subgraph

@pytest.mark.asyncio
async def test_research_orchestrator_exits_with_next_agent():
    agent = create_research_orchestrator_subgraph()
    result = await agent.ainvoke({
        "user_query": "测试",
        "research_plan": ["测试主题1"],
        "gather_round": 0,
        "retrieved_context": [],
        "sub_agent_results": [],
    })
    assert "next_agent" in result
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/engine/nodes/research_supervisor/test_graph.py::test_research_orchestrator_exits_with_next_agent -v`
Expected: FAIL because current graph does not set `next_agent` at END

**Step 3: Write minimal implementation**

In `src/cyber_persona/engine/nodes/research_supervisor/graph.py`, rename and adjust:

```python
"""Research orchestrator subgraph."""

from langgraph.graph import StateGraph, END
from langgraph.graph.state import CompiledStateGraph
from langchain_openai import ChatOpenAI

from cyber_persona.engine.nodes.research_supervisor.plan import plan_node
from cyber_persona.engine.nodes.research_supervisor.gather import gather_node
from cyber_persona.engine.nodes.research_supervisor.reflect import reflect_node
from cyber_persona.engine.nodes.research_supervisor.router import research_supervisor_router
from cyber_persona.models import AssistantState


def create_research_orchestrator_subgraph(
    llm: ChatOpenAI | None = None,
) -> CompiledStateGraph:
    """Build the research orchestrator subgraph."""
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
```

In `src/cyber_persona/engine/nodes/research_supervisor/gather.py`, import and use the new `create_search_agent`:

```python
from cyber_persona.engine.nodes.research_sub_agent.graph import create_search_agent

# inside gather_node:
sub_agent = create_search_agent(llm)
```

In `src/cyber_persona/engine/nodes/research_supervisor/reflect.py`, update the node so that when it routes to "synthesize", it also sets `next_agent = "drafter"` (or `"supervisor"` depending on flow):

```python
# In reflect_node return dict, add:
return {
    # ... existing fields
    "next_agent": "drafter" if status in ("PASSED", "PARTIAL_ACCEPT") else None,
}
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/engine/nodes/research_supervisor/test_graph.py::test_research_orchestrator_exits_with_next_agent -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cyber_persona/engine/nodes/research_supervisor/
git commit -m "feat: refactor research supervisor as research_orchestrator with next_agent"
```

---

### Task 7: Rebuild builder.py for flat multi-agent architecture

**Files:**
- Modify: `src/cyber_persona/engine/builder.py`
- Delete/Archive: `src/cyber_persona/engine/nodes/intent_router.py`
- Test: `tests/test_graph.py`

**Step 1: Write the failing test**

```python
# tests/test_graph.py
import pytest
from cyber_persona.engine.builder import create_graph

@pytest.mark.asyncio
async def test_graph_routes_chat_request():
    graph = create_graph()
    result = await graph.ainvoke({
        "user_query": "你好",
        "messages": [{"role": "human", "content": "你好"}],
    })
    assert "output" in result or "messages" in result
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_graph.py::test_graph_routes_chat_request -v`
Expected: FAIL because builder.py still uses intent_router and old wiring

**Step 3: Write minimal implementation**

Replace `src/cyber_persona/engine/builder.py` with flat architecture:

```python
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
        },
    )

    # Specialists return to supervisor (or END)
    builder.add_edge("chat_agent", "supervisor")
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
    builder.add_edge("synthesizer", END)
    builder.add_edge("error_handling", END)

    builder.set_entry_point("supervisor")
    return builder.build()
```

Note: We keep `fact_check_harness` and its router as-is because they are part of the drafter quality loop.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_graph.py::test_graph_routes_chat_request -v`
Expected: PASS (graph compiles and processes chat request)

**Step 5: Commit**

```bash
git add src/cyber_persona/engine/builder.py
git rm src/cyber_persona/engine/nodes/intent_router.py || true
git add tests/test_graph.py
git commit -m "feat: rebuild builder.py for flat multi-agent architecture"
```

---

### Task 8: Run full test suite and fix regressions

**Files:**
- All modified files

**Step 1: Run tests**

Run: `pytest tests/ -v`

**Step 2: Fix any failures**

Expected issues to watch for:
- `messages` format incompatibility between `dict` and LangChain `BaseMessage`
- Missing `next_agent` defaults causing `None` routing errors
- Import errors from deleted `intent_router.py` in other files

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve regressions after multi-agent refactor"
```

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-04-15-flat-multi-agent-architecture.md`.**

Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `@superpowers:subagent-driven-development`.

**2. Parallel Session (separate)** — Open a new session with `@superpowers:executing-plans`, batch execution with checkpoints.

Which approach do you prefer?

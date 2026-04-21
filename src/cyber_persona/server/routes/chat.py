"""Chat endpoints."""

import json
import logging
import traceback
from typing import AsyncGenerator

from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse
from langchain_core.messages import BaseMessage, message_to_dict
from langgraph.graph import StateGraph
from typing import Any

from cyber_persona.server.deps import get_graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

# Milestone nodes that are allowed to emit SSE events to the client.
# Internal subgraph nodes (query_generator, search_executor, red_team, blue_team)
# are filtered out to prevent event flooding.
ALLOWED_SSE_NODES = {
    "intent_router",
    "chat_input",
    "chat_llm",
    "supervisor",
    "chat_agent",
    "research_supervisor",
    "plan",
    "gather",
    "reflect",
    "drafter",
    "fact_check_harness",
    "debater_agent",
    "synthesizer",
    "output_verifier",
    "error_handling",
    "format_output",
}


def _extract_preview(node_data: dict) -> str:
    """Extract a short preview string from node output for logging."""
    for key in ("final_answer", "output", "status_message", "llm_response", "draft"):
        val = node_data.get(key)
        if isinstance(val, str) and val:
            return val[:100]
    return ""


def _sanitize_for_json(obj: Any) -> Any:
    """Recursively convert LangChain objects to JSON-serializable structures."""
    if isinstance(obj, BaseMessage):
        return message_to_dict(obj)
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(item) for item in obj]
    return obj


@router.post("")
async def chat_endpoint(
    request: Request,
    graph: StateGraph = Depends(get_graph),
) -> StreamingResponse:
    """Stream chat responses using SSE."""
    try:
        data = await request.json()
    except Exception as exc:
        logger.error("Failed to parse request JSON: %s", exc)

        async def error_stream() -> AsyncGenerator[str, None]:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Invalid JSON body: {exc}'})}\n\n"

        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    message = data.get("message", "")
    messages = data.get("messages", [])

    logger.info("Received chat request: message=%r history_length=%d", message, len(messages))

    async def event_stream() -> AsyncGenerator[str, None]:
        logger.info("SSE stream started")
        visited_nodes: list[str] = []
        try:
            async for event in graph.astream(
                {
                    "input": message,
                    "user_query": message,
                    "messages": messages,
                }
            ):
                node_name = list(event.keys())[0]
                node_data = list(event.values())[0]

                # Track execution flow for all nodes (including internal)
                visited_nodes.append(node_name)
                flow_chain = " -> ".join(visited_nodes)
                logger.info("Execution flow: %s", flow_chain)

                # Emit tool_call events before the node_complete so they appear
                # in the timeline as child steps of the current node.
                tool_calls = node_data.get("tool_calls", []) if isinstance(node_data, dict) else []
                if tool_calls:
                    for tc in tool_calls:
                        yield f"data: {json.dumps({'type': 'tool_call', 'node': node_name, 'data': _sanitize_for_json(tc)})}\n\n"

                # Skip internal subgraph nodes to avoid flooding the client
                if node_name not in ALLOWED_SSE_NODES:
                    logger.debug("Filtering out internal node event: %s", node_name)
                    continue

                output_preview = _extract_preview(node_data)
                logger.info(
                    "SSE event: node=%s output_preview=%r",
                    node_name,
                    output_preview,
                )
                yield f"data: {json.dumps({'type': 'node_complete', 'node': node_name, 'data': _sanitize_for_json(node_data)})}\n\n"
                yield f"data: {json.dumps({'type': 'flow_update', 'flow': visited_nodes})}\n\n"

            logger.info("SSE stream ended. Final execution flow: %s", " -> ".join(visited_nodes))
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            logger.error("Error in SSE stream: %s", e)
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'flow': visited_nodes})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

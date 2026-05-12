import { useCallback, useRef, useState } from "react";
import type { Message, NodeInfo, StreamEvent, ToolCall } from "@/types/events";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseEvent(line: string): StreamEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as StreamEvent;
  } catch {
    return null;
  }
}

function extractPreview(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  for (const key of ["status_message", "final_answer", "output", "llm_response", "draft"]) {
    const val = data[key];
    if (typeof val === "string" && val) {
      return val;
    }
  }
  return "";
}

function extractToolCalls(data: Record<string, unknown>): ToolCall[] {
  const raw = data.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((tc): tc is Record<string, unknown> => typeof tc === "object" && tc !== null)
    .map((tc) => ({
      name: String(tc.name || ""),
      args: (tc.args as Record<string, unknown>) || {},
      result: typeof tc.result === "string" ? tc.result : undefined,
    }));
}

function extractThinking(data: Record<string, unknown>): string {
  const parts: string[] = [];

  const reasoning = data.reasoning;
  if (typeof reasoning === "string" && reasoning.trim().length > 5) {
    parts.push(reasoning.trim());
  }

  const correction = data.correction_directive;
  if (typeof correction === "string" && correction.trim().length > 5) {
    parts.push(`Correction: ${correction.trim()}`);
  }

  const missing = data.missing_information;
  if (typeof missing === "string" && missing.trim().length > 5) {
    parts.push(`Missing: ${missing.trim()}`);
  }

  const plan = data.research_plan;
  if (Array.isArray(plan) && plan.length > 0) {
    const planStr = plan
      .map((item) => (typeof item === "string" ? item : String(item)))
      .filter((s) => s.trim())
      .join("; ");
    if (planStr.length > 5) {
      parts.push(`Plan: ${planStr}`);
    }
  }

  return parts.join("\n");
}

export function useSSE() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content,
      nodes: [],
      thinking: [],
      isLoading: false,
    };

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      nodes: [],
      thinking: [],
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    const history = messages
      .filter((m) => !m.isLoading && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: content,
          messages: history,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          for (const line of lines) {
            const event = parseEvent(line.trim());
            if (!event) continue;

            if (event.type === "node_complete" && event.node) {
              const nodeData = (event.data ?? {}) as Record<string, unknown>;
              const preview = extractPreview(nodeData);
              const thinkingText = extractThinking(nodeData);
              const nodeToolCalls = extractToolCalls(nodeData);

              // Only update main message content from terminal output nodes
              const CONTENT_NODES = new Set([
                "synthesizer",
                "chat_agent",
                "chat_llm",
                "format_output",
              ]);
              const isContentNode = CONTENT_NODES.has(event.node ?? "");

              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== "assistant") return prev;

                const updatedNodes: NodeInfo[] = last.nodes.map((n) =>
                  n.status === "running" ? { ...n, status: "done" as const, endTime: Date.now() } : n
                );

                const existingIndex = updatedNodes.findIndex((n) => n.name === event.node);
                if (existingIndex >= 0) {
                  updatedNodes[existingIndex] = {
                    ...updatedNodes[existingIndex],
                    status: "running",
                    output: preview,
                    statusMessage: preview,
                    data: nodeData,
                    toolCalls: nodeToolCalls.length > 0
                      ? nodeToolCalls
                      : updatedNodes[existingIndex].toolCalls,
                  };
                } else {
                  updatedNodes.push({
                    name: event.node!,
                    status: "running",
                    output: preview,
                    statusMessage: preview,
                    startTime: Date.now(),
                    data: nodeData,
                    toolCalls: nodeToolCalls,
                  });
                }

                const updatedThinking = thinkingText
                  ? [...last.thinking, thinkingText]
                  : last.thinking;

                // Only overwrite main content from terminal nodes to avoid
                // intermediate status messages flashing as the answer.
                let newContent = last.content;
                let contentReady = false;
                if (isContentNode) {
                  const possibleAnswer =
                    (nodeData.final_answer as string) ||
                    (nodeData.llm_response as string) ||
                    (nodeData.output as string) ||
                    "";
                  if (possibleAnswer) {
                    newContent = possibleAnswer;
                    contentReady = true;
                  }
                }

                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    nodes: updatedNodes,
                    thinking: updatedThinking,
                    content: newContent,
                    isLoading: contentReady ? false : last.isLoading,
                  },
                ];
              });
            } else if (event.type === "tool_call" && event.node) {
              // Attach the tool call to the most recent running node (or the matching node)
              const tcData = (event.data ?? {}) as Record<string, unknown>;
              const toolCall: ToolCall = {
                name: String(tcData.name || ""),
                args: (tcData.args as Record<string, unknown>) || {},
                result: typeof tcData.result === "string" ? tcData.result : undefined,
              };

              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== "assistant") return prev;

                const updatedNodes = last.nodes.map((n) => {
                  if (n.name === event.node || n.status === "running") {
                    return {
                      ...n,
                      toolCalls: [...(n.toolCalls || []), toolCall],
                    };
                  }
                  return n;
                });

                return [
                  ...prev.slice(0, -1),
                  { ...last, nodes: updatedNodes },
                ];
              });
            } else if (event.type === "done") {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== "assistant") return prev;
                const updatedNodes = last.nodes.map((n) =>
                  n.status === "running" ? { ...n, status: "done" as const, endTime: Date.now() } : n
                );
                return [
                  ...prev.slice(0, -1),
                  { ...last, nodes: updatedNodes, isLoading: false },
                ];
              });
            } else if (event.type === "error") {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== "assistant") return prev;
                return [
                  ...prev.slice(0, -1),
                  { ...last, isLoading: false, error: event.message || "Unknown error" },
                ];
              });
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "The operation was aborted.") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") return prev;
          return [...prev.slice(0, -1), { ...last, isLoading: false, error: msg }];
        });
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages]);

  return { messages, isLoading, sendMessage };
}

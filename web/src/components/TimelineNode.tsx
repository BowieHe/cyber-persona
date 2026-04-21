import { useState } from "react";
import { Check, ChevronDown, Loader2, Search, X, Wrench } from "lucide-react";
import type { NodeInfo, ToolCall } from "@/types/events";
import { NODE_NAME_MAP } from "@/types/events";

interface TimelineNodeProps {
  node: NodeInfo;
  isLast: boolean;
}

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  // Try to extract a human-readable query from common arg names
  const query =
    (tc.args.query as string) ||
    (tc.args.input as string) ||
    (tc.args.question as string) ||
    "";

  const resultPreview = tc.result
    ? tc.result.length > 120
      ? tc.result.slice(0, 120) + "..."
      : tc.result
    : "";

  return (
    <div className="mt-1.5 rounded-md border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover transition-colors"
      >
        <Wrench className="h-3 w-3 text-text-dim" />
        <span className="text-xs font-medium text-text">{tc.name}</span>
        {query && (
          <span className="text-xs text-text-muted truncate flex-1">
            {query}
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-text-dim transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-3 py-2 text-xs border-t border-border space-y-2">
          {query && (
            <div>
              <span className="text-text-dim">查询：</span>
              <span className="text-text font-mono">{query}</span>
            </div>
          )}
          {Object.keys(tc.args).length > 0 && (
            <div>
              <span className="text-text-dim">参数：</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-text-muted bg-bg rounded px-2 py-1">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}
          {tc.result && (
            <div>
              <span className="text-text-dim">结果：</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-text-muted bg-bg rounded px-2 py-1 max-h-40 overflow-y-auto">
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}

      {!expanded && resultPreview && (
        <div className="px-3 py-1 text-xs text-text-muted border-t border-border truncate">
          {resultPreview}
        </div>
      )}
    </div>
  );
}

export function TimelineNode({ node, isLast }: TimelineNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const displayName = NODE_NAME_MAP[node.name] || node.name;

  const icon =
    node.status === "running" ? (
      <Loader2 className="h-4 w-4 animate-spin text-accent" />
    ) : node.status === "error" ? (
      <X className="h-4 w-4 text-danger" />
    ) : (
      <Check className="h-4 w-4 text-success" />
    );

  const duration =
    node.endTime && node.startTime
      ? ((node.endTime - node.startTime) / 1000).toFixed(1)
      : null;

  const hasToolCalls = (node.toolCalls?.length ?? 0) > 0;

  return (
    <div className="flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-surface border border-border">
          {icon}
        </div>
        {!isLast && (
          <div className="mt-1 h-full w-px bg-border min-h-[1.5rem]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{displayName}</span>
          {node.status === "running" && (
            <span className="text-xs text-accent animate-pulse-dot">运行中</span>
          )}
          {duration && (
            <span className="text-xs text-text-dim">{duration}s</span>
          )}
          {hasToolCalls && (
            <span className="flex items-center gap-0.5 text-xs text-text-muted">
              <Search className="h-3 w-3" />
              {node.toolCalls!.length}
            </span>
          )}
        </div>

        {node.statusMessage && (
          <p className="mt-0.5 text-xs text-text-muted line-clamp-1">
            {node.statusMessage}
          </p>
        )}

        {/* Tool calls */}
        {hasToolCalls && (
          <div className="mt-1.5 space-y-1">
            {node.toolCalls!.map((tc, i) => (
              <ToolCallCard key={`${tc.name}-${i}`} tc={tc} />
            ))}
          </div>
        )}

        {(node.output?.length ?? 0) > 100 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-0.5 text-xs text-text-dim hover:text-text transition-colors"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded ? "收起详情" : "展开详情"}
          </button>
        )}

        {expanded && node.output && (
          <div className="mt-2 rounded-md bg-bg p-2 text-xs text-text-muted max-h-48 overflow-y-auto border border-border">
            <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">
              {node.output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

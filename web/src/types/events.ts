export interface StreamEvent {
  type: "node_complete" | "flow_update" | "tool_call" | "done" | "error";
  node?: string;
  data?: Record<string, unknown>;
  message?: string;
  flow?: string[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

export interface NodeData {
  output?: string;
  status_message?: string;
  llm_response?: string;
  final_answer?: string;
  draft?: string;
  reasoning?: string;
  correction_directive?: string;
  missing_information?: string;
  research_plan?: string[];
  tool_calls?: ToolCall[];
  [key: string]: unknown;
}

export type NodeStatus = "running" | "done" | "error";

export interface NodeInfo {
  name: string;
  status: NodeStatus;
  output: string;
  statusMessage: string;
  startTime: number;
  endTime?: number;
  toolCalls?: ToolCall[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  nodes: NodeInfo[];
  thinking: string[];      // 思考/推理文本片段
  isLoading: boolean;
  error?: string;
}

export const NODE_NAME_MAP: Record<string, string> = {
  intent_router: "意图识别",
  chat_input: "输入处理",
  chat_llm: "对话模型",
  plan_node: "任务规划",
  router: "节点路由",
  verifier: "质量检查",
  supervisor: "调度器",
  chat_agent: "对话 Agent",
  research_orchestrator: "研究调度",
  plan: "研究规划",
  gather: "信息收集",
  reflect: "反思评估",
  drafter: "起草",
  fact_check_harness: "事实核查",
  debater_agent: "对抗辩论",
  synthesizer: "综合总结",
  output_verifier: "输出质检",
  error_handling: "错误处理",
  format_output: "格式化输出",
};

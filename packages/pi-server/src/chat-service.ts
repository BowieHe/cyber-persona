import { join } from "node:path";
import { OpenAiProvider } from "@cyber-bowie/pi-ai";
import {
  AgentSession,
  createDefaultSystemPrompt,
  loadSoulFile
} from "@cyber-bowie/pi-agent-core";
import {
  createCyberBowieSearchSkill,
  createMcpSearchRuntime
} from "@cyber-bowie/pi-skills-search";
import { superpowerSkill } from "@cyber-bowie/pi-skills-superpower";

export interface ChatServiceConfig {
  cwd: string;
}

interface SessionContext {
  session: AgentSession;
  updatedAt: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先配置 .env`);
  }

  return value;
}

export class ChatService {
  private readonly sessions = new Map<string, SessionContext>();

  public constructor(private readonly config: ChatServiceConfig) {}

  private createAgentSession(): AgentSession {
    const session = new AgentSession(
      new OpenAiProvider({
        apiKey: getRequiredEnv("OPENAI_API_KEY"),
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
        temperature: process.env.OPENAI_TEMPERATURE
          ? Number(process.env.OPENAI_TEMPERATURE)
          : 0.4
      }),
      createDefaultSystemPrompt()
    );

    session.registerSkill(superpowerSkill);

    if (process.env.MCP_SEARCH_URL?.trim()) {
      session.registerSkill(
        createCyberBowieSearchSkill(
          createMcpSearchRuntime({
            serverUrl: process.env.MCP_SEARCH_URL.trim(),
            toolName: process.env.MCP_SEARCH_TOOL?.trim() || "bailian_web_search",
            authToken: process.env.MCP_SEARCH_AUTH_TOKEN?.trim() || undefined,
            authHeader: process.env.MCP_SEARCH_AUTH_HEADER?.trim() || undefined,
            resultCount: process.env.MCP_SEARCH_RESULT_COUNT
              ? Number(process.env.MCP_SEARCH_RESULT_COUNT)
              : 10
          })
        )
      );
    }

    return session;
  }

  private async getOrCreateSession(sessionId?: string): Promise<AgentSession> {
    const soul = await loadSoulFile(join(this.config.cwd, "SOUL.md"));

    if (!sessionId) {
      const session = this.createAgentSession();
      session.setSoul(soul);
      return session;
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.updatedAt = Date.now();
      existing.session.setSoul(soul);
      return existing.session;
    }

    const session = this.createAgentSession();
    session.setSoul(soul);
    this.sessions.set(sessionId, {
      session,
      updatedAt: Date.now()
    });
    this.cleanupSessions();
    return session;
  }

  private cleanupSessions(): void {
    const now = Date.now();
    const maxAgeMs = 1000 * 60 * 60 * 6;

    for (const [sessionId, context] of this.sessions.entries()) {
      if (now - context.updatedAt > maxAgeMs) {
        this.sessions.delete(sessionId);
      }
    }
  }

  public async getSkillsAndSoul(): Promise<{ skills: ReturnType<AgentSession["listSkills"]>; soul: string }> {
    const session = this.createAgentSession();
    const soul = await loadSoulFile(join(this.config.cwd, "SOUL.md"));

    return {
      skills: session.listSkills(),
      soul
    };
  }

  public async buildReply(message: string, sessionId?: string): Promise<{
    reply: string;
    skills: string[];
  }> {
    const session = await this.getOrCreateSession(sessionId);

    const result = await session.run({
      goal: message,
      constraints: [
        "所有输出都使用中文",
        "优先给出小而可用的方案",
        "保持语气自然，像真实的人在解释"
      ],
      context: [
        "这是一个人格化 agent server",
        "需要保留 SOUL 定义的人格",
        "如果 superpower 或 search skill 有帮助，可以把它纳入回答"
      ]
    });

    const skillBlock =
      result.skillResults.length > 0
        ? [
            "",
            "这次用到的能力：",
            ...result.skillResults.map((skill) => `- ${skill.skillName}: ${skill.summary}`)
          ].join("\n")
        : "";

    return {
      reply: `${result.raw}${skillBlock}`,
      skills: result.skillResults.map((skill) => skill.skillName)
    };
  }

  public async *streamReply(message: string, sessionId?: string): AsyncIterable<{
    type: "delta" | "skills" | "done";
    textDelta?: string;
    skills?: string[];
  }> {
    const session = await this.getOrCreateSession(sessionId);

    let latestSkillNames: string[] = [];

    for await (const event of session.runStream({
      goal: message,
      constraints: [
        "所有输出都使用中文",
        "优先给出小而可用的方案",
        "保持语气自然，像真实的人在解释"
      ],
      context: [
        "这是一个人格化 agent server",
        "需要保留 SOUL 定义的人格",
        "如果 superpower 或 search skill 有帮助，可以把它纳入回答"
      ]
    })) {
      latestSkillNames = event.skillResults.map((skill) => skill.skillName);
      yield {
        type: "delta",
        textDelta: event.chunk.textDelta
      };
    }

    if (latestSkillNames.length > 0) {
      yield {
        type: "skills",
        skills: latestSkillNames
      };
    }

    yield {
      type: "done"
    };
  }
}

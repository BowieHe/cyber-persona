import { access, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { OpenAiProvider, type AiProvider } from "@cyber-bowie/pi-ai";
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
  providerFactory?: () => AiProvider;
}

export interface PersonaDefinition {
  id: string;
  displayName: string;
  soulPath: string;
}

interface SessionContext {
  session: AgentSession;
  updatedAt: number;
}

export interface ChatRequestOptions {
  sessionId?: string;
  personaId?: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先配置 .env`);
  }

  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizePersonaId(personaId?: string): string {
  const normalized = personaId?.trim().toLowerCase();
  return normalized || "bowie";
}

function parseSoulDisplayName(soulText: string, fallback: string): string {
  const line = soulText
    .split("\n")
    .find((entry) => entry.trim().toLowerCase().startsWith("name:"));

  if (!line) {
    return fallback;
  }

  const name = line.split(":").slice(1).join(":").trim();
  return name || fallback;
}

export class ChatService {
  private readonly sessions = new Map<string, SessionContext>();
  private readonly providerFactory: () => AiProvider;

  public constructor(private readonly config: ChatServiceConfig) {
    this.providerFactory =
      config.providerFactory ??
      (() =>
        new OpenAiProvider({
          apiKey: getRequiredEnv("OPENAI_API_KEY"),
          model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
          baseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
          temperature: process.env.OPENAI_TEMPERATURE
            ? Number(process.env.OPENAI_TEMPERATURE)
            : 0.4
        }));
  }

  private createAgentSession(): AgentSession {
    const session = new AgentSession(
      this.providerFactory(),
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

  private buildSessionKey(options: ChatRequestOptions): string {
    return `${normalizePersonaId(options.personaId)}::${options.sessionId ?? "__ephemeral__"}`;
  }

  private async resolvePersonaSoulPath(personaId?: string): Promise<string> {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (normalizedPersonaId === "default" || normalizedPersonaId === "bowie") {
      return join(this.config.cwd, "SOUL.md");
    }

    const fromSoulsDir = join(this.config.cwd, "souls", `${normalizedPersonaId}.md`);
    if (await fileExists(fromSoulsDir)) {
      return fromSoulsDir;
    }

    return join(this.config.cwd, "SOUL.md");
  }

  private async loadPersonaSoul(personaId?: string): Promise<string> {
    return loadSoulFile(await this.resolvePersonaSoulPath(personaId));
  }

  private async discoverSoulPersonas(): Promise<PersonaDefinition[]> {
    const soulsDir = join(this.config.cwd, "souls");

    if (!(await fileExists(soulsDir))) {
      return [];
    }

    const entries = await readdir(soulsDir, {
      withFileTypes: true
    });
    const personas: PersonaDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const soulPath = join(soulsDir, entry.name);
      const id = basename(entry.name, ".md").trim().toLowerCase();
      const soul = await loadSoulFile(soulPath);

      personas.push({
        id,
        displayName: parseSoulDisplayName(soul, id),
        soulPath
      });
    }

    return personas;
  }

  public async listPersonas(): Promise<PersonaDefinition[]> {
    const rootSoulPath = join(this.config.cwd, "SOUL.md");
    const personas = new Map<string, PersonaDefinition>();
    const rootSoul = await loadSoulFile(rootSoulPath);

    personas.set("bowie", {
      id: "bowie",
      displayName: parseSoulDisplayName(rootSoul, "Bowie"),
      soulPath: rootSoulPath
    });

    for (const persona of await this.discoverSoulPersonas()) {
      personas.set(persona.id, persona);
    }

    const configured = process.env.TELEGRAM_BOTS_JSON?.trim();
    if (!configured) {
      return [...personas.values()];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(configured);
    } catch {
      return [...personas.values()];
    }

    if (!Array.isArray(parsed)) {
      return [...personas.values()];
    }

    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const record = item as Record<string, unknown>;
      const personaId =
        typeof record.personaId === "string" && record.personaId.trim()
          ? normalizePersonaId(record.personaId)
          : null;

      if (!personaId) {
        continue;
      }

      const soulPath = await this.resolvePersonaSoulPath(personaId);
      const existing = personas.get(personaId);
      personas.set(personaId, {
        id: personaId,
        displayName:
          typeof record.displayName === "string" && record.displayName.trim()
            ? record.displayName.trim()
            : existing?.displayName ?? personaId,
        soulPath
      });
    }

    return [...personas.values()];
  }

  private async getOrCreateSession(options: ChatRequestOptions): Promise<AgentSession> {
    const soul = await this.loadPersonaSoul(options.personaId);

    if (!options.sessionId) {
      const session = this.createAgentSession();
      session.setSoul(soul);
      return session;
    }

    const sessionKey = this.buildSessionKey(options);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.updatedAt = Date.now();
      existing.session.setSoul(soul);
      return existing.session;
    }

    const session = this.createAgentSession();
    session.setSoul(soul);
    this.sessions.set(sessionKey, {
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

  public async getSkillsAndSoul(personaId?: string): Promise<{
    skills: ReturnType<AgentSession["listSkills"]>;
    soul: string;
    personas: PersonaDefinition[];
  }> {
    const session = this.createAgentSession();
    const soul = await this.loadPersonaSoul(personaId);
    const personas = await this.listPersonas();

    return {
      skills: session.listSkills(),
      soul,
      personas
    };
  }

  public async buildReply(message: string, options: ChatRequestOptions = {}): Promise<{
    reply: string;
    skills: string[];
  }> {
    const personaId = normalizePersonaId(options.personaId);
    const session = await this.getOrCreateSession(options);

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
        "如果 superpower 或 search skill 有帮助，可以把它纳入回答",
        `当前 persona: ${personaId}`
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

  public async *streamReply(
    message: string,
    options: ChatRequestOptions = {}
  ): AsyncIterable<{
    type: "delta" | "skills" | "done";
    textDelta?: string;
    skills?: string[];
  }> {
    const personaId = normalizePersonaId(options.personaId);
    const session = await this.getOrCreateSession(options);

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
        "如果 superpower 或 search skill 有帮助，可以把它纳入回答",
        `当前 persona: ${personaId}`
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

export async function loadSoulTextForPersona(cwd: string, personaId?: string): Promise<string> {
  const normalizedPersonaId = normalizePersonaId(personaId);
  const rootSoulPath = join(cwd, "SOUL.md");

  if (normalizedPersonaId === "bowie" || normalizedPersonaId === "default") {
    return readFile(rootSoulPath, "utf8");
  }

  const customSoulPath = join(cwd, "souls", `${normalizedPersonaId}.md`);

  if (await fileExists(customSoulPath)) {
    return readFile(customSoulPath, "utf8");
  }

  return readFile(rootSoulPath, "utf8");
}

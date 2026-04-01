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
  introduction?: string;
  specialties: string[];
  collaborators: string[];
  collaborationStyle?: string;
  collaborationMode: "auto" | "always" | "manual";
}

interface SessionContext {
  session: AgentSession;
  updatedAt: number;
}

interface PersonaConfigRecord {
  id: string;
  displayName?: string;
  introduction?: string;
  specialties?: string[];
  collaborators?: string[];
  collaborationStyle?: string;
  collaborationMode?: "auto" | "always" | "manual";
}

interface PersonaTeamConfig {
  personas: PersonaConfigRecord[];
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

function normalizeKeywords(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseCollaborationMode(
  value: unknown
): "auto" | "always" | "manual" | undefined {
  return value === "auto" || value === "always" || value === "manual" ? value : undefined;
}

async function readPersonaTeamConfig(cwd: string): Promise<PersonaTeamConfig | null> {
  const configPath = join(cwd, "personas.json");

  if (!(await fileExists(configPath))) {
    return null;
  }

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const personas = Array.isArray((parsed as { personas?: unknown }).personas)
      ? (parsed as { personas: unknown[] }).personas
      : [];

    return {
      personas: personas
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item): PersonaConfigRecord => {
          return {
            id: typeof item.id === "string" ? item.id.trim().toLowerCase() : "",
            displayName:
              typeof item.displayName === "string" && item.displayName.trim()
                ? item.displayName.trim()
                : undefined,
            introduction:
              typeof item.introduction === "string" && item.introduction.trim()
                ? item.introduction.trim()
                : undefined,
            specialties: Array.isArray(item.specialties)
              ? item.specialties.filter((value): value is string => typeof value === "string")
              : [],
            collaborators: Array.isArray(item.collaborators)
              ? item.collaborators
                  .filter((value): value is string => typeof value === "string")
                  .map((value) => value.trim().toLowerCase())
              : [],
            collaborationStyle:
              typeof item.collaborationStyle === "string" && item.collaborationStyle.trim()
                ? item.collaborationStyle.trim()
                : undefined,
            collaborationMode: parseCollaborationMode(item.collaborationMode)
          };
        })
        .filter((item) => item.id.length > 0)
    };
  } catch {
    return null;
  }
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
        soulPath,
        specialties: [],
        collaborators: [],
        collaborationMode: "auto"
      });
    }

    return personas;
  }

  public async listPersonas(): Promise<PersonaDefinition[]> {
    const rootSoulPath = join(this.config.cwd, "SOUL.md");
    const personas = new Map<string, PersonaDefinition>();
    const rootSoul = await loadSoulFile(rootSoulPath);
    const teamConfig = await readPersonaTeamConfig(this.config.cwd);

    personas.set("bowie", {
      id: "bowie",
      displayName: parseSoulDisplayName(rootSoul, "Bowie"),
      soulPath: rootSoulPath,
      specialties: [],
      collaborators: [],
      collaborationMode: "auto"
    });

    for (const persona of await this.discoverSoulPersonas()) {
      personas.set(persona.id, persona);
    }

    for (const personaConfig of teamConfig?.personas ?? []) {
      const soulPath = await this.resolvePersonaSoulPath(personaConfig.id);
      const existing = personas.get(personaConfig.id);

      personas.set(personaConfig.id, {
        id: personaConfig.id,
        displayName: personaConfig.displayName ?? existing?.displayName ?? personaConfig.id,
        soulPath,
        introduction: personaConfig.introduction ?? existing?.introduction,
        specialties: normalizeKeywords(personaConfig.specialties ?? existing?.specialties),
        collaborators: normalizeKeywords(personaConfig.collaborators ?? existing?.collaborators),
        collaborationStyle: personaConfig.collaborationStyle ?? existing?.collaborationStyle,
        collaborationMode: personaConfig.collaborationMode ?? existing?.collaborationMode ?? "auto"
      });
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
        soulPath,
        introduction: existing?.introduction,
        specialties: existing?.specialties ?? [],
        collaborators: existing?.collaborators ?? [],
        collaborationStyle: existing?.collaborationStyle,
        collaborationMode: existing?.collaborationMode ?? "auto"
      });
    }

    return [...personas.values()];
  }

  private buildTeamRoster(personas: PersonaDefinition[]): string[] {
    return personas.map((persona) => {
      const parts = [
        `${persona.displayName} (${persona.id})`,
        persona.specialties.length > 0 ? `擅长: ${persona.specialties.join("、")}` : null,
        persona.introduction ? `定位: ${persona.introduction}` : null
      ].filter(Boolean);

      return `- ${parts.join("；")}`;
    });
  }

  private shouldCollaborate(message: string, persona: PersonaDefinition, personas: PersonaDefinition[]): boolean {
    if (persona.collaborationMode === "manual") {
      return /一起讨论|一起看|找.*一起|请.*协作|圆桌|顾问团/.test(message);
    }

    if (persona.collaborationMode === "always") {
      return personas.length > 1;
    }

    if (personas.length <= 1) {
      return false;
    }

    return (
      message.length >= 16 ||
      /分析|比较|方案|架构|研究|搜索|规划|评估|风险|设计|实现|拆分|怎么做|为什么/.test(
        message
      )
    );
  }

  private pickCollaborators(activePersona: PersonaDefinition, personas: PersonaDefinition[]): PersonaDefinition[] {
    const collaboratorIds =
      activePersona.collaborators.length > 0
        ? activePersona.collaborators
        : personas
            .filter((persona) => persona.id !== activePersona.id)
            .map((persona) => persona.id);

    const maxPeers = Math.max(1, Number(process.env.PERSONA_COLLAB_MAX_PEERS || 2));

    return collaboratorIds
      .map((id) => personas.find((persona) => persona.id === id))
      .filter((persona): persona is PersonaDefinition => Boolean(persona))
      .filter((persona) => persona.id !== activePersona.id)
      .slice(0, maxPeers);
  }

  private async collectCollaboratorNotes(
    message: string,
    options: ChatRequestOptions,
    activePersona: PersonaDefinition,
    personas: PersonaDefinition[]
  ): Promise<Array<{ persona: PersonaDefinition; note: string }>> {
    const collaborators = this.pickCollaborators(activePersona, personas);

    if (collaborators.length === 0) {
      return [];
    }

    const teamRoster = this.buildTeamRoster(personas);
    const notes = await Promise.all(
      collaborators.map(async (persona) => {
        const session = await this.getOrCreateSession({
          sessionId: options.sessionId,
          personaId: persona.id
        });
        const result = await session.run({
          goal: `请从你的擅长方向，协助 ${activePersona.displayName} 回答这个问题：${message}`,
          constraints: [
            "所有输出都使用中文",
            "这是一份只给队友看的内部意见，不要写客套话",
            "控制在 80 到 180 字之间",
            "优先给出你的专业判断、关键风险、建议动作"
          ],
          context: [
            "你正在一个多人格团队里协作",
            `当前主答 persona: ${activePersona.displayName} (${activePersona.id})`,
            `你的 persona: ${persona.displayName} (${persona.id})`,
            persona.collaborationStyle
              ? `你的协作风格: ${persona.collaborationStyle}`
              : "你的任务是给出高密度、可执行的内部意见",
            "团队成员如下：",
            ...teamRoster
          ]
        });

        return {
          persona,
          note: result.raw.trim()
        };
      })
    );

    return notes.filter((item) => item.note.length > 0);
  }

  private async buildRunInput(
    message: string,
    options: ChatRequestOptions
  ): Promise<{
    personaId: string;
    personas: PersonaDefinition[];
    activePersona: PersonaDefinition;
    constraints: string[];
    context: string[];
    collaborationNotes: Array<{ persona: PersonaDefinition; note: string }>;
  }> {
    const personaId = normalizePersonaId(options.personaId);
    const personas = await this.listPersonas();
    const activePersona =
      personas.find((persona) => persona.id === personaId) ??
      personas[0] ?? {
        id: personaId,
        displayName: personaId,
        soulPath: join(this.config.cwd, "SOUL.md"),
        specialties: [],
        collaborators: [],
        collaborationMode: "auto"
      };
    const teamRoster = this.buildTeamRoster(personas);
    const collaborationNotes = this.shouldCollaborate(message, activePersona, personas)
      ? await this.collectCollaboratorNotes(message, options, activePersona, personas)
      : [];

    return {
      personaId,
      personas,
      activePersona,
      collaborationNotes,
      constraints: [
        "所有输出都使用中文",
        "优先给出小而可用的方案",
        "保持语气自然，像真实的人在解释"
      ],
      context: [
        "这是一个人格化 agent server",
        "需要保留 SOUL 定义的人格",
        "如果 superpower 或 search skill 有帮助，可以把它纳入回答",
        `当前 persona: ${personaId}`,
        `当前 persona 的显示名: ${activePersona.displayName}`,
        activePersona.specialties.length > 0
          ? `当前 persona 擅长: ${activePersona.specialties.join("、")}`
          : "当前 persona 暂未配置专长标签",
        "团队成员如下：",
        ...teamRoster,
        ...(collaborationNotes.length > 0
          ? [
              "这次已经拿到的队友内部意见：",
              ...collaborationNotes.map(
                (item) => `- ${item.persona.displayName} (${item.persona.id}): ${item.note}`
              ),
              "请把这些意见自然吸收进最终回答，不要像会议纪要那样逐条复读。"
            ]
          : [])
      ]
    };
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
    const runInput = await this.buildRunInput(message, options);
    const session = await this.getOrCreateSession(options);

    const result = await session.run({
      goal: message,
      constraints: runInput.constraints,
      context: runInput.context
    });

    const skillBlock =
      result.skillResults.length > 0
        ? [
            "",
            "这次用到的能力：",
            ...result.skillResults.map((skill) => `- ${skill.skillName}: ${skill.summary}`)
          ].join("\n")
        : "";
    const collaborationBlock =
      runInput.collaborationNotes.length > 0
        ? [
            "",
            `这次一起参与思考的人格：${runInput.collaborationNotes
              .map((item) => item.persona.displayName)
              .join("、")}`
          ].join("\n")
        : "";

    return {
      reply: `${result.raw}${skillBlock}${collaborationBlock}`,
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
    const runInput = await this.buildRunInput(message, options);
    const session = await this.getOrCreateSession(options);

    let latestSkillNames: string[] = [];

    if (runInput.collaborationNotes.length > 0) {
      yield {
        type: "delta",
        textDelta: `我先把 ${runInput.collaborationNotes
          .map((item) => item.persona.displayName)
          .join("、")} 拉进来一起看一下。\n\n`
      };
    }

    for await (const event of session.runStream({
      goal: message,
      constraints: runInput.constraints,
      context: runInput.context
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

    if (runInput.collaborationNotes.length > 0) {
      yield {
        type: "delta",
        textDelta: `\n\n这次一起参与思考的人格：${runInput.collaborationNotes
          .map((item) => item.persona.displayName)
          .join("、")}`
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

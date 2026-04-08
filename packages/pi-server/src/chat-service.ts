import { access, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { OpenAiProvider, type AiProvider } from "@cyber-bowie/pi-ai";
import {
  AgentSession,
  createDefaultSystemPrompt,
  loadSoulFile,
  Orchestrator,
  type ExecutionPlan,
  type ExecutionStep
} from "@cyber-bowie/pi-agent-core";
import {
  createCyberBowieSearchSkill,
  createMcpSearchRuntime
} from "@cyber-bowie/pi-skills-search";
import { superpowerSkill } from "@cyber-bowie/pi-skills-superpower";
import { debugAPI } from "./debug-api.js";

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
  skills: string[];  // persona 掌握的 skills
}

interface PersonaConfigRecord {
  id: string;
  displayName?: string;
  introduction?: string;
  specialties?: string[];
  skills?: string[];
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
            skills: Array.isArray(item.skills)
              ? item.skills.filter((value): value is string => typeof value === "string")
              : []
          };
        })
        .filter((item) => item.id.length > 0)
    };
  } catch {
    return null;
  }
}

export class ChatService {
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

    const entries = await readdir(soulsDir, { withFileTypes: true });
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
        skills: []
      });
    }

    return personas;
  }

  public async listPersonas(): Promise<PersonaDefinition[]> {
    const rootSoulPath = join(this.config.cwd, "SOUL.md");
    const personas = new Map<string, PersonaDefinition>();
    const rootSoul = await loadSoulFile(rootSoulPath);
    const teamConfig = await readPersonaTeamConfig(this.config.cwd);

    // 默认 persona
    personas.set("bowie", {
      id: "bowie",
      displayName: parseSoulDisplayName(rootSoul, "Bowie"),
      soulPath: rootSoulPath,
      specialties: [],
      skills: ["orchestrate", "default_chat"]
    });

    // 从 souls 目录发现的 persona
    for (const persona of await this.discoverSoulPersonas()) {
      personas.set(persona.id, persona);
    }

    // 从 personas.json 合并配置
    for (const personaConfig of teamConfig?.personas ?? []) {
      const soulPath = await this.resolvePersonaSoulPath(personaConfig.id);
      const existing = personas.get(personaConfig.id);

      personas.set(personaConfig.id, {
        id: personaConfig.id,
        displayName: personaConfig.displayName ?? existing?.displayName ?? personaConfig.id,
        soulPath,
        introduction: personaConfig.introduction ?? existing?.introduction,
        specialties: normalizeKeywords(personaConfig.specialties ?? existing?.specialties),
        skills: normalizeKeywords(personaConfig.skills ?? existing?.skills)
      });
    }

    return [...personas.values()];
  }

  /**
   * 为指定 persona 创建 session，并注册该 persona 的 skills
   */
  private async createPersonaSession(personaId: string): Promise<AgentSession> {
    const session = new AgentSession(
      this.providerFactory(),
      createDefaultSystemPrompt()
    );

    // 获取 persona 的 skills
    const personas = await this.listPersonas();
    const persona = personas.find(p => p.id === normalizePersonaId(personaId));
    const skills = persona?.skills ?? [];

    // 根据 skills 注册对应的 skill 实现
    for (const skillName of skills) {
      switch (skillName) {
        case "search":
        case "web_search":
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
          break;
        case "superpower":
          session.registerSkill(superpowerSkill);
          break;
        default:
          // 其他 skills 后续扩展
          break;
      }
    }

    // 加载 soul
    const soul = await this.loadPersonaSoul(personaId);
    session.setSoul(soul);

    return session;
  }

  /**
   * 执行单个 persona 的任务
   */
  private async executePersona(
    personaId: string,
    message: string,
    sharedContext: Record<string, string>
  ): Promise<{ personaId: string; displayName: string; text: string; sharedData?: Record<string, unknown> }> {
    const session = await this.createPersonaSession(personaId);
    
    // 设置共享上下文
    if (Object.keys(sharedContext).length > 0) {
      session.setSharedContext(sharedContext);
    }

    const personas = await this.listPersonas();
    const persona = personas.find(p => p.id === normalizePersonaId(personaId));

    const result = await session.run({
      goal: message,
      constraints: [
        "所有输出都使用中文",
        "给出完整、有用的回答",
        "如果有 skill 结果，自然地融入回答中"
      ],
      context: [
        `你是 ${persona?.displayName || personaId}`,
        persona?.introduction ? `定位: ${persona.introduction}` : "",
        persona?.specialties?.length ? `专长: ${persona.specialties.join("、")}` : ""
      ].filter(Boolean)
    });

    return {
      personaId,
      displayName: persona?.displayName || personaId,
      text: result.raw,
      sharedData: result.skillResults.length > 0 
        ? Object.fromEntries(result.skillResults.map(s => [s.skillName, s.summary]))
        : undefined
    };
  }

  /**
   * Orchestrator 模式：决定需要哪些 persona，并行/串行执行
   * 支持即时发送（通过 AsyncIterable）
   */
  public async *orchestrateReply(
    message: string,
    options: ChatRequestOptions = {}
  ): AsyncIterable<{
    type: "announce" | "message";
    personaId?: string;
    displayName?: string;
    text: string;
  }> {
    const sessionId = options.sessionId || 'default';
    const personas = await this.listPersonas();
    const orchestrator = new Orchestrator(this.providerFactory(), personas);

    // 1. 创建执行计划
    const plan = await orchestrator.createPlan(message);
    console.log("[Orchestrator] Plan:", JSON.stringify(plan, null, 2));

    // 记录 plan 事件
    debugAPI.recordEvent(sessionId, {
      type: 'plan',
      payload: { steps: plan.steps }
    });

    // 2. 执行开场白
    const announceStep = plan.steps.find(s => s.type === 'announce');
    if (announceStep && announceStep.type === 'announce') {
      yield {
        type: "announce",
        text: announceStep.text
      };
      debugAPI.recordEvent(sessionId, {
        type: 'announce',
        payload: { text: announceStep.text }
      });
    }

    // 3. 收集所有 persona 步骤
    const personaSteps = plan.steps.filter(s => s.type === 'persona') as Array<ExecutionStep & { type: 'persona'; personaId: string }>;
    
    // 4. 按依赖关系执行
    const sharedContext: Record<string, string> = {};
    const completedPersonas = new Set<string>();

    // 分离有依赖和无依赖的步骤
    const independentSteps = personaSteps.filter(s => s.dependsOn.length === 0);
    const dependentSteps = personaSteps.filter(s => s.dependsOn.length > 0);

    // 4.1 并行执行无依赖的 persona
    if (independentSteps.length > 0) {
      const promises = independentSteps.map(async (step) => {
        // 检查并应用 steering
        const steeringMessages = debugAPI.drainSteering(sessionId);
        if (steeringMessages.length > 0) {
          sharedContext.steering = steeringMessages.join('\n');
        }

        debugAPI.recordEvent(sessionId, {
          type: 'persona_start',
          payload: { personaId: step.personaId, dependsOn: [] }
        });

        const result = await this.executePersona(step.personaId, message, sharedContext);

        // 更新共享上下文
        if (result.sharedData) {
          for (const [key, value] of Object.entries(result.sharedData)) {
            sharedContext[key] = String(value);
          }
        }
        completedPersonas.add(step.personaId);

        debugAPI.recordEvent(sessionId, {
          type: 'persona_output',
          payload: { personaId: result.personaId, displayName: result.displayName, text: result.text }
        });

        return result;
      });

      // 谁先完成谁先 yield（不按顺序）
      for (const promise of promises) {
        const result = await promise;
        yield {
          type: "message",
          personaId: result.personaId,
          displayName: result.displayName,
          text: result.text
        };
      }
    }

    // 4.2 执行有依赖的 persona（串行，等待依赖完成）
    for (const step of dependentSteps) {
      // 等待依赖完成
      for (const dep of step.dependsOn) {
        while (!completedPersonas.has(dep)) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // 检查并应用 steering
      const steeringMessages = debugAPI.drainSteering(sessionId);
      if (steeringMessages.length > 0) {
        sharedContext.steering = steeringMessages.join('\n');
      }

      debugAPI.recordEvent(sessionId, {
        type: 'persona_start',
        payload: { personaId: step.personaId, dependsOn: step.dependsOn }
      });

      // 执行
      const result = await this.executePersona(step.personaId, message, sharedContext);

      if (result.sharedData) {
        for (const [key, value] of Object.entries(result.sharedData)) {
          sharedContext[key] = String(value);
        }
      }
      completedPersonas.add(step.personaId);

      debugAPI.recordEvent(sessionId, {
        type: 'persona_output',
        payload: { personaId: result.personaId, displayName: result.displayName, text: result.text }
      });

      yield {
        type: "message",
        personaId: result.personaId,
        displayName: result.displayName,
        text: result.text
      };
    }

    // 标记会话完成
    debugAPI.completeSession(sessionId);
  }

  /**
   * 兼容旧接口：单条回复
   */
  public async buildReply(message: string, options: ChatRequestOptions = {}): Promise<{
    reply: string;
    skills: string[];
  }> {
    const messages: string[] = [];
    const skills: string[] = [];

    for await (const item of this.orchestrateReply(message, options)) {
      if (item.type === "announce") {
        messages.push(`[呱吉] ${item.text}`);
      } else {
        messages.push(`[${item.displayName}] ${item.text}`);
      }
    }

    return {
      reply: messages.join("\n\n"),
      skills
    };
  }

  public async getSkillsAndSoul(personaId?: string): Promise<{
    skills: string[];
    soul: string;
    personas: PersonaDefinition[];
  }> {
    const session = await this.createPersonaSession(personaId || "bowie");
    const soul = await this.loadPersonaSoul(personaId);
    const personas = await this.listPersonas();

    return {
      skills: session.listSkills().map(s => s.name),
      soul,
      personas
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

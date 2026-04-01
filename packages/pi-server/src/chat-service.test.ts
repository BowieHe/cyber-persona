import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiProvider, CompletionRequest, CompletionResponse } from "@cyber-bowie/pi-ai";
import { ChatService, loadSoulTextForPersona } from "./chat-service.js";

class RecordingProvider implements AiProvider {
  public readonly name: string;

  public constructor(private readonly id: number) {
    this.name = `provider-${id}`;
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return {
      text: `provider=${this.id};messages=${request.messages.length}`,
      model: this.name
    };
  }
}

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "cyber-bowie-test-"));
  await mkdir(join(cwd, "souls"));
  await writeFile(join(cwd, "SOUL.md"), "# SOUL\n\nName: 呱吉\n");
  await writeFile(join(cwd, "souls", "critic.md"), "# SOUL\n\nName: 挑刺版呱吉\n");
  await writeFile(join(cwd, "souls", "researcher.md"), "# SOUL\n\nName: 研究版呱吉\n");
  await writeFile(
    join(cwd, "personas.json"),
    JSON.stringify(
      {
        personas: [
          {
            id: "bowie",
            displayName: "呱吉",
            specialties: ["产品方向", "项目拆分"],
            collaborators: ["critic", "researcher"],
            collaborationMode: "auto"
          },
          {
            id: "critic",
            displayName: "挑刺版呱吉",
            specialties: ["风险识别"],
            collaborators: ["bowie"],
            collaborationMode: "manual"
          },
          {
            id: "researcher",
            displayName: "研究版呱吉",
            specialties: ["资料整理"],
            collaborators: ["bowie"],
            collaborationMode: "auto"
          }
        ]
      },
      null,
      2
    )
  );
  return cwd;
}

test("loadSoulTextForPersona 优先读取 souls/<persona>.md", async () => {
  const cwd = await createFixture();
  const soul = await loadSoulTextForPersona(cwd, "critic");

  assert.match(soul, /挑刺版呱吉/);
});

test("loadSoulTextForPersona 找不到 persona 时回退到根 SOUL.md", async () => {
  const cwd = await createFixture();
  const soul = await loadSoulTextForPersona(cwd, "missing");

  assert.match(soul, /呱吉/);
});

test("ChatService 会按 personaId + sessionId 复用会话", async () => {
  const cwd = await createFixture();
  let providerCount = 0;
  const service = new ChatService({
    cwd,
    providerFactory: () => new RecordingProvider(++providerCount)
  });

  const first = await service.buildReply("你好", {
    personaId: "bowie",
    sessionId: "session-1"
  });
  const second = await service.buildReply("继续", {
    personaId: "bowie",
    sessionId: "session-1"
  });
  const third = await service.buildReply("换个人格", {
    personaId: "critic",
    sessionId: "session-1"
  });

  assert.match(first.reply, /provider=1;messages=2/);
  assert.match(second.reply, /provider=1;messages=4/);
  assert.match(third.reply, /provider=2;messages=2/);
});

test("ChatService 会列出根 persona 和 souls 目录里的 persona", async () => {
  const cwd = await createFixture();
  const service = new ChatService({
    cwd,
    providerFactory: () => new RecordingProvider(1)
  });

  const personas = await service.listPersonas();

  assert.deepEqual(
    personas.map((persona) => persona.id).sort(),
    ["bowie", "critic", "researcher"]
  );
  assert.equal(personas.find((persona) => persona.id === "critic")?.displayName, "挑刺版呱吉");
  assert.deepEqual(personas.find((persona) => persona.id === "bowie")?.specialties, [
    "产品方向",
    "项目拆分"
  ]);
  assert.deepEqual(personas.find((persona) => persona.id === "bowie")?.collaborators, [
    "critic",
    "researcher"
  ]);
});

test("ChatService 会在复杂问题下拉队友一起协作", async () => {
  const cwd = await createFixture();
  const prompts: string[] = [];

  const service = new ChatService({
    cwd,
    providerFactory: () => ({
      name: "collab-provider",
      async complete(request) {
        const prompt = request.messages[request.messages.length - 1]?.content ?? "";
        prompts.push(prompt);

        if (prompt.includes("只给队友看的内部意见")) {
          const persona = /你的 persona: ([^(]+)\s*\(/.exec(prompt)?.[1]?.trim() ?? "队友";
          return {
            text: `${persona}内部意见：这里是从我专长出发的建议。`,
            model: "collab-provider"
          };
        }

        return {
          text: prompt.includes("这次已经拿到的队友内部意见")
            ? "主答人格已整合队友意见，给出最终方案。"
            : "主答人格独立回答。",
          model: "collab-provider"
        };
      }
    })
  });

  const result = await service.buildReply("帮我分析这个项目怎么拆模块、风险在哪、研究路线怎么铺。", {
    personaId: "bowie",
    sessionId: "team-session"
  });

  assert.match(result.reply, /主答人格已整合队友意见/);
  assert.match(result.reply, /这次一起参与思考的人格：挑刺版呱吉、研究版呱吉/);
  assert.equal(prompts.filter((prompt) => prompt.includes("只给队友看的内部意见")).length, 2);
});

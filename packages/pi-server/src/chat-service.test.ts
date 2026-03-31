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
    ["bowie", "critic"]
  );
  assert.equal(personas.find((persona) => persona.id === "critic")?.displayName, "挑刺版呱吉");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  createTelegramSessionId,
  parseTelegramBotConfigs,
  shouldRespondToTelegramMessage,
  type TelegramMessageContext
} from "./index.js";

function createEvent(overrides: Partial<TelegramMessageContext> = {}): TelegramMessageContext {
  const bot = {
    token: "123:abc",
    personaId: "bowie",
    displayName: "呱吉",
    aliases: ["bowie", "呱吉"],
    mode: "private-or-mention" as const,
    username: "bowie_bot",
    userId: 42,
    ...overrides.bot
  };

  const message = {
    updateId: 1,
    chatId: 100,
    chatType: "group",
    messageId: 10,
    text: "大家好",
    fromId: 7,
    fromIsBot: false,
    threadId: undefined,
    replyToUserId: undefined,
    replyToUsername: undefined,
    mentions: [],
    ...overrides.message
  };

  return {
    bot,
    message
  };
}

test("parseTelegramBotConfigs 会标准化 persona 和 aliases", () => {
  const configs = parseTelegramBotConfigs(
    JSON.stringify([
      {
        token: "123:abc",
        personaId: "Bowie",
        aliases: ["@Bowie", "呱吉", "呱吉"]
      }
    ])
  );

  assert.deepEqual(configs, [
    {
      token: "123:abc",
      personaId: "bowie",
      aliases: ["bowie", "呱吉"],
      displayName: undefined,
      mode: "private-or-mention"
    }
  ]);
});

test("shouldRespondToTelegramMessage 在私聊里总是响应", () => {
  assert.equal(
    shouldRespondToTelegramMessage(
      createEvent({
        message: {
          updateId: 1,
          chatId: 100,
          chatType: "private",
          messageId: 10,
          text: "你是谁",
          fromIsBot: false,
          mentions: []
        }
      })
    ),
    true
  );
});

test("shouldRespondToTelegramMessage 支持 @username 提及", () => {
  assert.equal(
    shouldRespondToTelegramMessage(
      createEvent({
        message: {
          updateId: 1,
          chatId: 100,
          chatType: "group",
          messageId: 10,
          text: "@bowie_bot 你是谁",
          fromIsBot: false,
          mentions: ["bowie_bot"]
        }
      })
    ),
    true
  );
});

test("shouldRespondToTelegramMessage 支持中文 alias 匹配", () => {
  assert.equal(
    shouldRespondToTelegramMessage(
      createEvent({
        message: {
          updateId: 1,
          chatId: 100,
          chatType: "group",
          messageId: 10,
          text: "呱吉，帮我想一个项目结构",
          fromIsBot: false,
          mentions: []
        }
      })
    ),
    true
  );
});

test("shouldRespondToTelegramMessage 默认忽略群聊里未点名的消息", () => {
  assert.equal(shouldRespondToTelegramMessage(createEvent()), false);
});

test("createTelegramSessionId 会把 chat / thread / user 拼进同一个 key", () => {
  assert.equal(
    createTelegramSessionId(
      createEvent({
        message: {
          updateId: 1,
          chatId: -10001,
          chatType: "group",
          messageId: 10,
          text: "test",
          fromIsBot: false,
          threadId: 12,
          fromId: 88,
          mentions: []
        }
      }).message
    ),
    "telegram:-10001:12:88"
  );
});

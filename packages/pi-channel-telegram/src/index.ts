export type TelegramResponseMode = "private-or-mention" | "always";

export interface TelegramBotPersonaConfig {
  token: string;
  personaId: string;
  displayName?: string;
  aliases?: string[];
  mode?: TelegramResponseMode;
}

export interface TelegramResolvedBotConfig extends TelegramBotPersonaConfig {
  aliases: string[];
  username?: string;
  userId?: number;
}

export interface TelegramMessage {
  updateId: number;
  chatId: number;
  chatType: string;
  messageId: number;
  text: string;
  fromId?: number;
  fromIsBot: boolean;
  threadId?: number;
  replyToUserId?: number;
  replyToUsername?: string;
  mentions: string[];
}

export interface TelegramMessageContext {
  bot: TelegramResolvedBotConfig;
  message: TelegramMessage;
}

export interface TelegramPollingResponse {
  text: string;
  replyToMessageId?: number;
}

export interface StartTelegramPollingOptions {
  bots: TelegramBotPersonaConfig[];
  onMessage(
    event: TelegramMessageContext
  ): Promise<TelegramPollingResponse | string | null | undefined>;
  pollTimeoutSeconds?: number;
  pollIntervalMs?: number;
  log?(level: "info" | "warn" | "error", message: string, meta?: unknown): void;
}

export interface TelegramPollingController {
  stop(): Promise<void>;
}

interface TelegramApiUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramApiChat {
  id: number;
  type: string;
}

interface TelegramApiMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: TelegramApiChat;
  from?: TelegramApiUser;
  message_thread_id?: number;
  reply_to_message?: {
    from?: TelegramApiUser;
  };
}

interface TelegramApiUpdate {
  update_id: number;
  message?: TelegramApiMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeAlias(alias: string): string {
  return alias.trim().replace(/^@/, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTelegramMentions(text: string): string[] {
  return [...text.matchAll(/(^|[\s(])@([a-zA-Z0-9_]{3,})/g)].map((match) =>
    match[2].toLowerCase()
  );
}

function includesAlias(text: string, aliases: string[]): boolean {
  const normalizedText = text.toLowerCase();

  return aliases.some((alias) => {
    if (!alias) {
      return false;
    }

    if (/^[a-z0-9_]+$/i.test(alias)) {
      const pattern = new RegExp(`(^|[\\s,，。！？!?:：;；()（）\\[\\]{}])${escapeRegExp(alias)}($|[\\s,，。！？!?:：;；()（）\\[\\]{}])`, "i");
      return pattern.test(text);
    }

    return normalizedText.includes(alias.toLowerCase());
  });
}

async function telegramRequest<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "Content-Type": "application/json"
        }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal
  });

  if (!response.ok) {
    throw new Error(`Telegram API 请求失败: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} 返回失败`);
  }

  return data.result;
}

export function parseTelegramBotConfigs(rawValue: string | undefined): TelegramBotPersonaConfig[] {
  const raw = rawValue?.trim();

  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`TELEGRAM_BOTS_JSON 不是合法 JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("TELEGRAM_BOTS_JSON 必须是数组");
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`TELEGRAM_BOTS_JSON 第 ${index + 1} 项必须是对象`);
    }

    const record = item as Record<string, unknown>;
    const token = typeof record.token === "string" ? record.token.trim() : "";
    const personaId = typeof record.personaId === "string" ? record.personaId.trim() : "";
    const aliases = Array.isArray(record.aliases)
      ? record.aliases
          .filter((alias): alias is string => typeof alias === "string")
          .map((alias) => normalizeAlias(alias))
          .filter(Boolean)
      : [];
    const mode =
      record.mode === "always" || record.mode === "private-or-mention"
        ? record.mode
        : "private-or-mention";

    if (!token) {
      throw new Error(`TELEGRAM_BOTS_JSON 第 ${index + 1} 项缺少 token`);
    }

    if (!personaId) {
      throw new Error(`TELEGRAM_BOTS_JSON 第 ${index + 1} 项缺少 personaId`);
    }

    return {
      token,
      personaId: personaId.toLowerCase(),
      displayName:
        typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : undefined,
      aliases: [...new Set(aliases)],
      mode
    };
  });
}

export function createTelegramSessionId(message: TelegramMessage): string {
  return [
    "telegram",
    message.chatId,
    message.threadId ?? "root",
    message.fromId ?? "unknown"
  ].join(":");
}

export function shouldRespondToTelegramMessage(event: TelegramMessageContext): boolean {
  const { bot, message } = event;

  if (!message.text.trim() || message.fromIsBot) {
    return false;
  }

  if (message.chatType === "private") {
    return true;
  }

  if (bot.mode === "always") {
    return true;
  }

  if (message.replyToUserId && bot.userId && message.replyToUserId === bot.userId) {
    return true;
  }

  if (
    message.replyToUsername &&
    bot.username &&
    message.replyToUsername.toLowerCase() === bot.username.toLowerCase()
  ) {
    return true;
  }

  if (bot.username && message.mentions.includes(bot.username.toLowerCase())) {
    return true;
  }

  return includesAlias(message.text, bot.aliases);
}

function normalizeTelegramMessage(update: TelegramApiUpdate): TelegramMessage | null {
  const message = update.message;

  if (!message) {
    return null;
  }

  const text = (message.text ?? message.caption ?? "").trim();

  if (!text) {
    return null;
  }

  return {
    updateId: update.update_id,
    chatId: message.chat.id,
    chatType: message.chat.type,
    messageId: message.message_id,
    text,
    fromId: message.from?.id,
    fromIsBot: message.from?.is_bot ?? false,
    threadId: message.message_thread_id,
    replyToUserId: message.reply_to_message?.from?.id,
    replyToUsername: message.reply_to_message?.from?.username,
    mentions: extractTelegramMentions(text)
  };
}

async function resolveBotIdentity(
  config: TelegramBotPersonaConfig
): Promise<TelegramResolvedBotConfig> {
  const me = await telegramRequest<TelegramApiUser>(config.token, "getMe");
  const aliases = new Set<string>(config.aliases ?? []);
  aliases.add(normalizeAlias(config.personaId));

  if (config.displayName) {
    aliases.add(normalizeAlias(config.displayName));
  }

  if (me.username) {
    aliases.add(normalizeAlias(me.username));
  }

  return {
    ...config,
    aliases: [...aliases].filter(Boolean),
    username: me.username,
    userId: me.id
  };
}

export function startTelegramPolling(
  options: StartTelegramPollingOptions
): TelegramPollingController {
  const pollTimeoutSeconds = Number(
    process.env.TELEGRAM_POLL_TIMEOUT || options.pollTimeoutSeconds || 25
  );
  const pollIntervalMs = Number(
    process.env.TELEGRAM_POLL_INTERVAL_MS || options.pollIntervalMs || 1500
  );
  let stopped = false;
  const tasks: Promise<void>[] = [];
  const controllers = new Set<AbortController>();

  const log = options.log ?? (() => undefined);

  for (const config of options.bots) {
    tasks.push(
      (async () => {
        try {
          const bot = await resolveBotIdentity(config);
          let offset = 0;

          log("info", "Telegram bot 已连接", {
            personaId: bot.personaId,
            username: bot.username
          });

          while (!stopped) {
            const controller = new AbortController();
            controllers.add(controller);

            try {
              const updates = await telegramRequest<TelegramApiUpdate[]>(
                bot.token,
                "getUpdates",
                {
                  offset,
                  timeout: pollTimeoutSeconds,
                  allowed_updates: ["message"]
                },
                controller.signal
              );

              for (const update of updates) {
                offset = Math.max(offset, update.update_id + 1);
                const message = normalizeTelegramMessage(update);

                if (!message) {
                  continue;
                }

                const event = {
                  bot,
                  message
                };

                if (!shouldRespondToTelegramMessage(event)) {
                  continue;
                }

                const response = await options.onMessage(event);
                const normalized =
                  typeof response === "string"
                    ? {
                        text: response
                      }
                    : response;

                if (!normalized?.text?.trim()) {
                  continue;
                }

                await telegramRequest(bot.token, "sendMessage", {
                  chat_id: message.chatId,
                  text: normalized.text,
                  reply_to_message_id: normalized.replyToMessageId,
                  message_thread_id: message.threadId
                });
              }
            } catch (error: unknown) {
              if (stopped) {
                break;
              }

              const message = error instanceof Error ? error.message : String(error);
              log("warn", "Telegram polling 出现错误，稍后重试", {
                personaId: config.personaId,
                error: message
              });
              await delay(pollIntervalMs);
            } finally {
              controllers.delete(controller);
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          log("error", "Telegram bot 初始化失败", {
            personaId: config.personaId,
            error: message
          });
        }
      })()
    );
  }

  return {
    async stop() {
      stopped = true;

      for (const controller of controllers) {
        controller.abort();
      }

      await Promise.allSettled(tasks);
    }
  };
}

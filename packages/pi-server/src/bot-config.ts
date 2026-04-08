/**
 * Unified Bot Configuration
 * Merges persona and Telegram bot config into one file
 * Max 4 bots allowed
 */

export interface BotConfig {
  personaId: string;
  token: string; // Telegram bot token (can use ${ENV_VAR} syntax)
  displayName?: string;
  // Runtime populated
  username?: string;
}

export interface BotsConfig {
  bots: BotConfig[];
}

const MAX_BOTS = 4;

function resolveEnvVar(value: string): string {
  // Support ${ENV_VAR} syntax
  const match = value.match(/^\$\{([^}]+)\}$/);
  if (match) {
    const envValue = process.env[match[1]];
    if (!envValue) {
      throw new Error(`Environment variable ${match[1]} not found`);
    }
    return envValue;
  }
  return value;
}

export function loadBotConfig(configPath?: string): BotConfig[] {
  // Try to load from bots.json or fallback to env-based config
  const fs = require("fs");
  const path = require("path");

  const pathsToTry = [
    configPath,
    process.env.BOTS_CONFIG,
    path.join(process.cwd(), "bots.json"),
    path.join(process.cwd(), "config", "bots.json")
  ].filter(Boolean);

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(content) as BotsConfig;

        if (!Array.isArray(parsed.bots)) {
          throw new Error("Invalid bots.json: bots must be an array");
        }

        if (parsed.bots.length > MAX_BOTS) {
          throw new Error(
            `Too many bots: ${parsed.bots.length}, max is ${MAX_BOTS}`
          );
        }

        // Resolve environment variables in tokens
        return parsed.bots.map((bot) => ({
          ...bot,
          token: resolveEnvVar(bot.token)
        }));
      } catch (err) {
        console.error(`Failed to load bot config from ${p}:`, err);
      }
    }
  }

  // Fallback: try to build config from old env vars
  return loadFromLegacyEnv();
}

function loadFromLegacyEnv(): BotConfig[] {
  const bots: BotConfig[] = [];

  // Try to parse TELEGRAM_BOTS_JSON
  const legacyConfig = process.env.TELEGRAM_BOTS_JSON;
  if (legacyConfig) {
    try {
      const parsed = JSON.parse(legacyConfig);
      for (const item of parsed) {
        bots.push({
          personaId: item.personaId,
          displayName: item.displayName || item.personaId,
          token: item.token
        });
      }
    } catch {
      // Ignore
    }
  }

  // Try individual bot tokens
  const botConfigs = [
    { id: "bowie", env: "MAIN_BOT_TOKEN" },
    { id: "researcher", env: "RESEARCHER_BOT_TOKEN" },
    { id: "critic", env: "CRITIC_BOT_TOKEN" },
    { id: "analyst", env: "ANALYST_BOT_TOKEN" }
  ];

  for (const cfg of botConfigs) {
    const token = process.env[cfg.env];
    if (token && !bots.find((b) => b.personaId === cfg.id)) {
      bots.push({
        personaId: cfg.id,
        displayName: cfg.id.charAt(0).toUpperCase() + cfg.id.slice(1),
        token
      });
    }
  }

  if (bots.length === 0) {
    throw new Error(
      "No bot configuration found. Create bots.json or set MAIN_BOT_TOKEN"
    );
  }

  return bots.slice(0, MAX_BOTS);
}

export function validateBotsConfig(bots: BotConfig[]): void {
  if (bots.length === 0) {
    throw new Error("At least one bot is required");
  }

  if (bots.length > MAX_BOTS) {
    throw new Error(`Maximum ${MAX_BOTS} bots allowed, got ${bots.length}`);
  }

  const ids = new Set<string>();
  for (const bot of bots) {
    if (ids.has(bot.personaId)) {
      throw new Error(`Duplicate bot personaId: ${bot.personaId}`);
    }
    ids.add(bot.personaId);

    if (!bot.token) {
      throw new Error(`Bot ${bot.personaId} is missing token`);
    }
  }
}

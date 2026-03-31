# cyber-bowie

一个用 TypeScript 写的个人 agent monorepo，灵感来自 `pi-mono`，但核心思路是：

- 人格放在本地 `SOUL.md`
- skill 可插拔
- 模型走 OpenAI 兼容接口
- 本地 Web UI 和 Telegram 都接同一个服务端
- 支持多 persona / 多 bot

## Packages

- `@cyber-bowie/pi-ai`: OpenAI 兼容模型适配层
- `@cyber-bowie/pi-agent-core`: agent runtime、SOUL 加载、skill registry
- `@cyber-bowie/pi-coding-agent`: CLI 入口
- `@cyber-bowie/pi-server`: 统一服务端，负责 Web API、会话、多 persona、Telegram 调度
- `@cyber-bowie/pi-channel-telegram`: Telegram 多 bot polling 通道
- `@cyber-bowie/pi-skills-superpower`: 内建 superpower skill
- `@cyber-bowie/pi-skills-search`: 从 finpal 抽出来的可插拔搜索 skill
- `@cyber-bowie/pi-web-chat`: React + TypeScript 本地聊天前端

## 项目结构

```text
.
├─ SOUL.md
├─ souls/
│  ├─ critic.md
│  └─ researcher.md
├─ .env
└─ packages/
```

- 根目录 `SOUL.md` 是默认人格，默认 personaId 是 `bowie`
- `souls/<personaId>.md` 是额外人格
- Web UI 和 Telegram bot 都可以指定 personaId

## 快速开始

```bash
npm install
cp .env.example .env
```

把 `.env` 填好之后：

```bash
npm run build
npm run check
npm test
npm run server
```

然后打开 `http://127.0.0.1:3000`。

如果你只是想先跑 CLI：

```bash
npm run agent -- --list-skills
npm run agent -- --skill superpower "帮我设计一个个人项目结构"
```

## 环境变量

最少需要：

```bash
OPENAI_API_KEY=你的密钥
OPENAI_MODEL=moonshot-v1-8k
OPENAI_BASE_URL=https://api.moonshot.cn/v1
```

常用可选项：

```bash
OPENAI_TEMPERATURE=0.4
MCP_SEARCH_URL=
MCP_SEARCH_TOOL=bailian_web_search
MCP_SEARCH_AUTH_TOKEN=
MCP_SEARCH_AUTH_HEADER=Authorization
MCP_SEARCH_RESULT_COUNT=10
TELEGRAM_BOTS_JSON=
TELEGRAM_POLL_TIMEOUT=25
TELEGRAM_POLL_INTERVAL_MS=1500
PORT=3000
HOST=127.0.0.1
```

说明：

- `.env` 会用 `override: true` 载入，优先级高于系统环境变量
- `OPENAI_BASE_URL` 填到 `/v1` 结尾通常就够了
- 出错时日志会带上实际请求的 `url`、`model`、掩码后的 `apiKey`

## Web UI

本地 Web UI 现在支持：

- ChatGPT 风格的聊天布局
- 流式输出
- 发送后立即清空输入框
- 会话保存在本地 `localStorage`
- 侧边栏切换不同 persona

接口：

- `GET /api/health`
- `GET /api/skills`
- `POST /api/chat`
- `POST /api/chat/stream`

`GET /api/skills?personaId=critic` 会返回当前技能、该 persona 的 soul，以及可用 persona 列表。

## Persona 机制

默认人格来自 [SOUL.md](/home/bowie/code/cyber-bowie/SOUL.md)。

如果你想加第二个人格，直接建文件：

```bash
mkdir -p souls
touch souls/critic.md
```

例如：

```md
# SOUL

Name: 挑刺版呱吉

## Identity

这是一个更尖锐、更会拆问题的人格。
```

服务端会自动读取 `souls/*.md`，Web UI 也会显示出来。

## Telegram 多 Bot

这个项目现在支持多个 Telegram bot，同一个服务端统一调度。

建议理解方式：

- 每个 bot 对应一个 persona
- 每个 bot 用自己的 token 发消息
- 服务端负责把消息路由到对应的 SOUL 和会话
- 群聊里默认是 `private-or-mention` 模式：私聊必回，群里要 `@bot`、回复 bot，或命中 alias 才回

`.env` 例子：

```json
[
  {
    "token": "123456:aaa",
    "personaId": "bowie",
    "displayName": "呱吉",
    "aliases": ["bowie", "呱吉"],
    "mode": "private-or-mention"
  },
  {
    "token": "123456:bbb",
    "personaId": "critic",
    "displayName": "挑刺版",
    "aliases": ["critic", "挑刺"],
    "mode": "private-or-mention"
  }
]
```

把上面 JSON 压成一行，填进 `TELEGRAM_BOTS_JSON`。

启动服务后，server 会自动开始 long polling，不需要额外 webhook。

## 多人格“群聊”怎么用

如果你想做一个“群里除了你都是 bot”的体验，比较实际的方式是：

1. 创建多个 Telegram bot
2. 每个 bot 绑定一个 personaId
3. 把这些 bot 拉进同一个 Telegram 群
4. 在群里 `@对应 bot`，或者直接回复某个 bot 的消息

要注意：

- Telegram bot 不能像真人一样彼此自由读取和接话
- 所以这里不是 bot 自己互聊，而是你对不同 persona 发起对话
- 每个 persona 会保留自己的上下文记忆

这已经很适合做“多人格顾问团”了，而且比折腾非开放平台稳定得多。

## Search Skill

`@cyber-bowie/pi-skills-search` 已经是可插拔包，保留了原来那种：

- 先拆子问题
- 多轮搜索
- 回顾结果是否合理
- 置信度达到 `80%` 左右再退出
- 底层通过 MCP 调外部搜索

如果你配置了 `MCP_SEARCH_*` 环境变量，server 和 CLI 都会自动挂上这个 skill。

## 测试

现在至少覆盖了两块关键行为：

- `packages/pi-server/src/chat-service.test.ts`
  - persona soul 读取与回退
  - `personaId + sessionId` 级别的会话复用
- `packages/pi-channel-telegram/src/index.test.ts`
  - Telegram bot 配置解析
  - 私聊 / mention / alias 响应规则
  - Telegram session key 生成

运行：

```bash
npm test
```

## 常用命令

```bash
npm run build
npm run check
npm test
npm run server
npm run web
npm run agent -- --list-skills
```

## Notes

- 这是一个受 `pi-mono` 启发的个人实现，不是源码镜像
- `.codex`、`codex/` 已经在 `.gitignore` 里过滤

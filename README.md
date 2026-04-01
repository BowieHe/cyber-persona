# cyber-bowie

一个用 TypeScript 写的个人 agent monorepo，灵感来自 `pi-mono`，但重点不是照着复刻，而是做一个你自己能继续养大的多人格 agent 系统。

现在这套代码已经支持：

- OpenAI 兼容模型接入
- 本地 Web UI
- Telegram 多 bot 接入
- `SOUL.md` + `souls/*.md` 的多 persona
- `personas.json` 定义人格专长和协作关系
- skill 插件机制
- 多人格在复杂问题上的协作回答

项目结构说明文档在 [docs/architecture.md](./docs/architecture.md)。

## Packages

- `@cyber-bowie/pi-ai`: OpenAI 兼容模型适配层
- `@cyber-bowie/pi-agent-core`: agent runtime、SOUL 加载、skill registry
- `@cyber-bowie/pi-coding-agent`: CLI 入口
- `@cyber-bowie/pi-server`: 主服务端，负责 Web API、persona 协作、Telegram 调度
- `@cyber-bowie/pi-channel-telegram`: Telegram 多 bot polling 通道
- `@cyber-bowie/pi-skills-superpower`: 内建 superpower skill
- `@cyber-bowie/pi-skills-search`: 从 finpal 抽出来的可插拔搜索 skill
- `@cyber-bowie/pi-web-chat`: React + TypeScript 本地聊天前端

## 快速开始

```bash
npm install
cp .env.example .env
cp personas.example.json personas.json
```

把 `.env` 填好之后：

```bash
npm run build
npm run check
npm test
npm run server
```

然后打开 `http://127.0.0.1:3000`。

如果你只想先跑 CLI：

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
PERSONA_COLLAB_MAX_PEERS=2
TELEGRAM_BOTS_JSON=
TELEGRAM_POLL_TIMEOUT=25
TELEGRAM_POLL_INTERVAL_MS=1500
PORT=3000
HOST=127.0.0.1
```

说明：

- `.env` 会用 `override: true` 载入，优先级高于系统环境变量
- `OPENAI_BASE_URL` 一般写到 `/v1` 结尾就够了
- 出错时日志会带上实际请求的 `url`、`model`、掩码后的 `apiKey`
- `PERSONA_COLLAB_MAX_PEERS` 控制一次最多拉几个队友一起协作

## Persona 配置

### 1. SOUL

默认人格来自 [SOUL.md](/home/bowie/code/cyber-bowie/SOUL.md)。

额外人格放在 `souls/<personaId>.md`。

例如：

```bash
mkdir -p souls
touch souls/critic.md
touch souls/researcher.md
```

### 2. 团队配置

再用 `personas.json` 定义这些人格的专长和协作关系。

先复制：

```bash
cp personas.example.json personas.json
```

一个人格配置长这样：

```json
{
  "id": "critic",
  "displayName": "挑刺版呱吉",
  "introduction": "负责拆风险和逻辑漏洞。",
  "specialties": ["风险识别", "逻辑审查", "边界条件"],
  "collaborators": ["bowie", "researcher"],
  "collaborationStyle": "优先指出最容易翻车的地方。",
  "collaborationMode": "manual"
}
```

字段含义：

- `id`: personaId，必须和 `souls/<id>.md` 对得上
- `displayName`: 对外显示名
- `introduction`: 前端和团队提示里用的人格定位
- `specialties`: 擅长什么
- `collaborators`: 默认优先找谁协作
- `collaborationStyle`: 给内部协作时的风格提示
- `collaborationMode`: `auto` / `always` / `manual`

### 3. 协作模式

- `auto`: 遇到复杂问题时自动拉队友
- `always`: 每次都拉队友
- `manual`: 只有用户说“大家一起看”“一起讨论”这类话时才协作

现在这套协作是：

- 主 persona 保持自己的语气
- 队友给内部意见
- 主 persona 整合后输出最终答复

这已经比单人格自然很多，而且还不会让前端和 Telegram 群聊乱成一锅粥。

## Web UI

本地 Web UI 现在支持：

- ChatGPT 风格布局
- 流式输出
- 发送后立即清空输入框
- persona 切换
- 显示 persona 定位、专长、默认协作对象
- 本地 `localStorage` 保存会话

接口：

- `GET /api/health`
- `GET /api/skills`
- `POST /api/chat`
- `POST /api/chat/stream`

例如：

- `GET /api/skills?personaId=critic`

会返回：

- 当前启用的 skill
- 当前 persona 的 SOUL
- 所有 persona 列表和专长信息

## Telegram 接入

### 基本接法

1. 在 Telegram 里找 `@BotFather`
2. 用 `/newbot` 创建一个或多个 bot
3. 拿到每个 bot 的 token
4. 把 token 填进 `TELEGRAM_BOTS_JSON`
5. 启动 `npm run server`

示例：

```env
TELEGRAM_BOTS_JSON=[{"token":"123456:aaa","personaId":"bowie","displayName":"呱吉","aliases":["bowie","呱吉"],"mode":"private-or-mention"},{"token":"123456:bbb","personaId":"critic","displayName":"挑刺版","aliases":["critic","挑刺"],"mode":"private-or-mention"}]
```

### 字段说明

- `token`: Telegram bot token
- `personaId`: 绑定哪个人格
- `displayName`: 可选，覆盖显示名
- `aliases`: 群聊里除了 `@username` 之外，也能触发的别名
- `mode`:
  - `private-or-mention`: 私聊必回，群里 mention / reply / alias 才回
  - `always`: 群里只要消息到了就回，通常不建议一开始就用

### 更稳定的建议

- 推荐先用 `private-or-mention`
- `TELEGRAM_POLL_TIMEOUT=25` 比较稳
- `TELEGRAM_POLL_INTERVAL_MS=1000~2000` 都可以，默认 `1500`
- 先在私聊里测通，再拉进群
- 如果你未来想让 bot 在群里监听更广，可以去 BotFather 调整 privacy mode，但第一版不建议一上来就放开
- 生产环境建议用 `pm2`、`systemd` 或 Docker 持续运行 `npm run server`

### Telegram 现在能做到什么

- 多个 bot 对应多个人格
- 一个服务端统一管理这些 bot
- 每个 persona 有自己的会话记忆
- 主人格可以拉队友协作

### 现在还不能做到什么

- Telegram bot 自己像真人一样彼此自由聊天
- 真正的 bot-to-bot 群聊自治

这不是你代码写得不够猛，是 Telegram bot 本身就有边界。所以比较合理的做法，还是用中心服务端编排人格协作。

## Search Skill

`@cyber-bowie/pi-skills-search` 已经是可插拔包，保留了原本比较像 finpal 的那条搜索逻辑：

- 先拆子问题
- 多轮搜索
- 回顾结果是否合理
- 置信度提高到约 `80%` 再退出
- 底层通过 MCP 调外部搜索

如果你配置了 `MCP_SEARCH_*` 环境变量，server 和 CLI 都会自动挂上它。

## 项目结构怎么读

如果你后面要继续接手这个项目，建议先看：

1. [docs/architecture.md](./docs/architecture.md)
2. `packages/pi-server/src/chat-service.ts`
3. `packages/pi-server/src/index.ts`
4. `packages/pi-agent-core/src/index.ts`
5. `packages/pi-channel-telegram/src/index.ts`
6. `packages/pi-web-chat/web/src/App.tsx`

## 测试

现在至少覆盖了这些关键点：

- `packages/pi-server/src/chat-service.test.ts`
  - persona soul 读取与回退
  - `personaId + sessionId` 会话复用
  - 多人格协作会拉队友一起出内部意见
- `packages/pi-channel-telegram/src/index.test.ts`
  - Telegram bot 配置解析
  - 私聊 / mention / alias 响应规则
  - Telegram session key 生成

运行：

```bash
npm test
```

## 代理说明

如果你的网络环境访问 Telegram 或模型接口需要代理，现在项目默认已经用 `node --use-env-proxy` 启动 `agent` 和 `server`。

也就是说，只要你的系统或终端里已经有这些环境变量：

```bash
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
NO_PROXY=127.0.0.1,localhost
```

那你直接执行：

```bash
npm run server
```

Node 进程就会自动走代理。

要注意：

- `NODE_USE_ENV_PROXY=1` 不适合只写进项目 `.env`
- 因为 `.env` 是程序启动后才读取的
- 代理变量最好放在系统 shell、启动脚本、`pm2` 或 `systemd` 里

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

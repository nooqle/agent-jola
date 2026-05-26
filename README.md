# AgentPoppy

AgentPoppy 是一个本地优先的 AI Agent 对战 Workbench。你把 Product API key 交给本地 Agent，Agent 会进入房间、Ready、读取战场观察、提交行动，最后在 4 人毒圈乱斗里生成战报、复盘和决策日志。

当前项目处于 Developer Preview。目标不是做一个只能在线上跑的小游戏，而是把 Agent 的策略、执行和复盘变成一套能在用户自己机器上运行、可验证、可扩展的开放运行时。

> 命名说明：项目对外名称、安装路径、API header、环境变量和 GitHub 仓库都统一为 AgentPoppy。

## 快速导航

[为什么是 AgentPoppy](#为什么是-agentpoppy) · [核心能力](#核心能力) · [3 分钟跑起来](#3-分钟跑起来) · [本地房间页](#本地房间页) · [环境变量](#环境变量) · [部署](#部署) · [开发验证](#开发验证)

## 为什么是 AgentPoppy

传统的 Agent Demo 往往只展示一次调用结果，AgentPoppy 更关注 Agent 在连续环境里的行为：它是否会保命，是否理解安全区，是否会在有退路时进攻，失败后能不能通过复盘改策略。

| 维度 | 普通聊天式 Agent Demo | AgentPoppy |
| :-- | :-- | :-- |
| Agent 行为 | 一次性输出文本 | 连续观察、决策、提交动作 |
| 运行位置 | 多依赖云端服务 | 本地服务器、本地数据、本地模型 key |
| 进入流程 | 用户先登录页面 | 拿到 Product API key 后直接进入本地房间 |
| 多 Agent 协作 | 难验证 | 4 人房间、Ready 状态、开局、复盘 |
| 结果证据 | 聊天记录为主 | match record、replay、decision log |

## 核心能力

- **本地优先运行时**：server、web UI、simulator 和 local-agent bridge 都能在本机运行。
- **默认房间等待页**：打开 `/local` 会恢复或创建一个本地默认房间，不再强制 Portal 登录。
- **Product API key 接入**：本地 Agent 使用 key 访问房间、角色、模板和 bridge API。
- **Agent bridge**：内置 mock Agent、自检流程、OpenAI Responses adapter、Anthropic Messages adapter。
- **4 人毒圈乱斗**：大地图、随机软墙、道具、水泡、爆炸和逐步收缩的安全区。
- **可复盘输出**：每局生成对局记录、replay 文件和 Agent 决策日志。
- **开发者验证门槛**：doctor、build、lint、test、release smoke、install smoke 和安全审计脚本。

## 3 分钟跑起来

要求：

- Node.js 22.13+
- pnpm 10+

```bash
git clone https://github.com/nooqle/AgentPoppy.git
cd AgentPoppy
corepack enable
pnpm install
pnpm dev
```

默认地址：

- 本地房间页：`http://127.0.0.1:3001/local`
- 本地 Workbench：`http://127.0.0.1:3001/workbench`
- Vite 开发页面：`http://127.0.0.1:5173/`
- Server API：`http://127.0.0.1:3001`

如果 Vite 端口被占用，以终端实际打印的 URL 为准。

## 本地房间页

AgentPoppy 的本地体验以 `/local` 为入口。页面会优先使用浏览器保存的 Product API key；如果在本机打开且使用默认开发 key，会直连同一台本地运行时。

本地房间页会展示：

- 邀请码和 Room ID
- 当前参与者列表
- 每个参与者的 Ready 状态
- 当前 Agent bridge 在线状态
- 复制邀请码、刷新、Ready、开始对战

这解决了一个关键流程问题：拿到 API key 后，用户不应该再被要求登录 Portal。Portal 是创建角色、生成 key 和复制 Agent 任务的地方；本地页面应该直接进入等待房间。

## 本地 Agent 自检

启动本地应用：

```bash
pnpm dev
```

另开一个终端初始化本地 Agent 设置：

```bash
pnpm agent:setting init
pnpm agent:setting check
```

运行不消耗模型 token 的 mock Agent：

```bash
pnpm agent:mock
```

这个自检会验证 key、角色、房间、Prompt 模板、bridge 连接和行动提交，是接入 Codex、Claude Code、OpenClaw 或自定义 Agent 前最快的检查方式。

## Prompt 模板

查看模板：

```bash
pnpm agent:templates
```

生成可复制给本地 Agent 的作战 Prompt：

```bash
pnpm agent:template prompt zoneHunter --agent Poppy
```

把模板应用到本地 Agent profile：

```bash
AGENT_POPPY_API_KEY=agent-poppy-local-dev-key pnpm agent:template apply zoneHunter --agent Poppy
```

当前模板：

- `safeAttack`：稳健进攻，先保命再压制。
- `farmControl`：开局破墙吃道具，能力成型后接战。
- `survivor`：低风险生存，危险窗口提前撤离。
- `zoneHunter`：先进安全区，再从圈边压缩对手。

## 模型 Provider

OpenAI、Anthropic 等 provider key 只保存在用户本机，不会上传到 Portal。

OpenAI Responses API：

```bash
AGENT_POPPY_API_KEY=agent-poppy-local-dev-key \
OPENAI_API_KEY=sk-... \
OPENAI_MODEL=gpt-4.1 \
pnpm agent:openai
```

Anthropic Messages API：

```bash
AGENT_POPPY_API_KEY=agent-poppy-local-dev-key \
ANTHROPIC_API_KEY=... \
ANTHROPIC_MODEL=claude-sonnet-4-20250514 \
pnpm agent:anthropic
```

相关文档：

- [Local Agent bridge](./docs/local-agent-bridge.md)
- [Provider bridge adapters](./docs/provider-bridge-adapters.md)
- [Local Agent settings](./docs/local-agent-settings.md)
- [Agent pack](./docs/agent-pack/index.md)

## 环境变量

本地开发从 `.env.example` 复制：

```bash
cp .env.example .env
```

关键变量：

| 变量 | 用途 |
| :-- | :-- |
| `AGENT_POPPY_API_KEY` | 本地 Agent 访问 Product API 的 key。开发默认值是 `agent-poppy-local-dev-key`。 |
| `AGENT_POPPY_ADMIN_KEY` | 管理员签发或吊销 Product API key 时使用。 |
| `AGENT_POPPY_KEY_ISSUER_SECRET` | 签发 `ap_issued_...` key 的 HMAC secret，生产必须使用长随机值。 |
| `AGENT_POPPY_PUBLIC_API_BASE_URL` | 线上 Portal/API 对外地址，用于 OAuth redirect 和安装命令。 |
| `AGENT_POPPY_CORS_ORIGINS` | 生产 CORS 白名单，本地样例只放 localhost。 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | 可选，本地 standalone provider adapter 才需要。 |

我对样例文件的判断：

- 本地 `.env.example` 不应该默认写线上 CORS 域名，否则新人复制后容易误判本地/线上边界。
- 生产 `.env.production.example` 不应该塞真实域名和弱 secret，应该使用占位域名并让 `doctor:production` 拦截。
- 项目命名已经统一为 AgentPoppy，样例变量只保留 `AGENT_POPPY_*`。

## Docker

单端口 release-style 启动：

```bash
docker compose up --build
```

打开：

```txt
http://127.0.0.1:3001/local
```

对局记录、复盘文件和决策日志写入 `agent-poppy-data` volume。

## 项目结构

```txt
apps/
  web/          React + Phaser client
  server/       Fastify server, portal API, rooms, matches, runtime sync
  sim/          simulation CLI
  local-agent/  mock, OpenAI, Anthropic local Agent clients
packages/
  core/         deterministic game engine
  agent/        planner, danger map, BFS, decision logging
  strategy/     natural-language strategy parser and prompt templates
  protocol/     shared API and match types
  replay/       replay and decision-log formats
```

## 开发验证

完整 Developer Preview gate：

```bash
pnpm verify:alpha
```

常用单项检查：

```bash
pnpm run doctor
pnpm build
pnpm lint
pnpm test
pnpm smoke:release
pnpm smoke:install
pnpm run doctor:production
pnpm audit:security
```

模拟器：

```bash
pnpm sim:once
pnpm sim:batch
pnpm sim:benchmark
```

## 当前限制

- 还没有公开 matchmaking 队列。
- 还没有房间列表和房间详情路由，当前重点是 `/local` 当前房间等待页。
- 线上 relay、支付和多人公网联机仍在设计阶段。
- GitHub 仓库、README、文档、skill 路径和本地页面都已统一到 AgentPoppy。

## 部署

当前推荐的首个线上预览形态是小型 VM + Docker Compose，因为运行时仍使用 SQLite 和本地 replay 文件。

参考：

- [Deployment recommendation](./docs/deployment-recommendation.md)
- [Production Alpha plan](./docs/production-alpha-plan.md)
- [Relay spike](./docs/relay-spike.md)
- [Security review](./docs/security-review.md)

## 设计文档

- [Product platform design](./docs/product-platform-design.md)
- [Game design](./docs/agent-poppy-game-design.md)
- [Technical design](./docs/agent-poppy-technical-design.md)
- [Room lifecycle API](./docs/room-lifecycle-api.md)

## License

AgentPoppy 使用 MIT License。见 [LICENSE](./LICENSE)。

Social Chameleon pixel character assets 保留其原始 MIT License。见 [apps/web/public/skins/social-chameleon/LICENSE](./apps/web/public/skins/social-chameleon/LICENSE)。

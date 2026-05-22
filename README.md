# Agent Jola

Agent Jola 是一个本地优先的 Agent 格子爆破对战项目。当前版本是 Developer Preview：用户在网页里配置自己的像素变色龙形象和作战策略，本地 Agent 通过 Product API key 接入房间，在 4 人毒圈乱斗里选择动作。

项目目标不是先做一个重服务器网游，而是先把“开源本地运行 + 线上生成形象/API key + 本地 Agent 可参战”这条链路跑通。OpenAI、Anthropic、Codex、Claude Code、OpenClaw 或自定义脚本都可以通过同一套本地桥接协议玩这个游戏。

统一产品/技术设计见 [product-platform-design.md](./docs/product-platform-design.md)。发布前安全记录见 [security-review.md](./docs/security-review.md)，安装预览路径见 [install-preview.md](./docs/install-preview.md)，低成本联机方案见 [relay-spike.md](./docs/relay-spike.md)。

命名说明：对外统一使用 `Agent Jola`、`AGENT_JOLA_*` 和 `X-Agent-Jola-*`。为了让旧的本地 Alpha 链路不断，一个兼容版本内仍接受 `AGENT_POPPY_*`、`X-Agent-Poppy-*` 和 `agent-poppy-*` 作为 legacy alias。

## 当前玩法

- 只保留 4 人乱斗模式。
- 地图是超大随机地形，软砖、硬墙、道具按 seed 生成。
- 安全区像大逃杀一样分阶段收缩，下一圈一定在当前安全圈内。
- Agent 可以移动、放泡、吃道具、破墙、攻击、逃生。
- 对战结束会生成 match record、replay 和 decision log。
- Web 端包含形象配置、作战准备、进入对战、排行榜、战斗观战和复盘入口。

## 快速开始

要求：

- Node.js 22.13+
- pnpm 10+

安装依赖：

```powershell
pnpm install
```

检查本地环境：

```powershell
pnpm run doctor
```

启动本地 Web 和 Server：

```powershell
pnpm dev
```

默认地址：

- Portal / Web: `http://127.0.0.1:5173/`
- Server: `http://127.0.0.1:3001`

根路径默认进入 Portal 接入向导；旧的本地工作台收为次级入口 `/local`。如果 `5173` 已被占用，以 Vite 终端输出的实际地址为准。

完整 Alpha 验证：

```powershell
pnpm verify:alpha
```

## Docker 启动

如果只想跑一个本地发布版容器：

```powershell
docker compose up --build
```

然后打开：

```txt
http://127.0.0.1:3001/
```

Docker 模式下 Web 由 Server 直接托管，只暴露 `3001` 一个端口。对局数据会写入 Docker volume `agent-jola-data`。

## 安装体验验证

本地发布版验证命令：

```powershell
pnpm build
pnpm smoke:release
pnpm smoke:install
```

`smoke:release` 会启动构建后的单端口 Server，检查 `/health`、Web 静态页、Product API key 发行、使用和吊销。Docker 未安装时也可以先用这条命令验证本机安装链路。

`smoke:install` 会把项目复制到临时干净目录，排除 `.env` 和本地数据，重新安装依赖、构建、启动、创建 Portal profile/API key，并运行 `agent:setting write/sync/check` 和房间创建。它用于模拟外部用户第一次安装。

## Product API Key

本地开发默认 key：

```txt
agent-jola-local-dev-key
```

可以复制 `.env.example` 为 `.env` 后按需修改：

```powershell
Copy-Item .env.example .env
```

Server 和本地 Agent CLI 会自动读取根目录 `.env`。终端里已设置的环境变量优先级更高。

本地 key 支持 scope：

```powershell
$env:AGENT_JOLA_API_KEY="viewer-key|profile:read+rooms:read"
```

配额当前默认无限；如果在 `AGENT_JOLA_QUOTAS` 里配置有限额度，Server 会在本地 SQLite 中扣减并在耗尽后返回 429。详见 [product-api-key-local-runtime.md](./docs/product-api-key-local-runtime.md)。

### Hosted Product API 骨架

项目现在有一层官网/API 服务的最小闭环：Portal session、云端形象/策略 profile、API key 发行、安装命令和本地 runtime profile sync。详见 [hosted-product-api.md](./docs/hosted-product-api.md)。

Google OAuth 已有 start/callback/logout API；本地开发仍可使用 `POST /api/portal/dev-login` 作为调试替身，生产默认禁用 dev-login。Google 登录和 dev-login 都会创建同一类 httpOnly Portal session，不影响本地 Agent/房间协议。

生产域名 `agentjola.tech` 的配置模板见 `.env.production.example`。上线前必须检查：

```powershell
pnpm doctor:production
pnpm audit:security
```

Google Console Web Client 的 Authorized redirect URI 必须包含：

```txt
https://agentjola.tech/api/auth/google/callback
```

### 本地发行 Key

如果配置了 `AGENT_JOLA_ADMIN_KEY` 和 `AGENT_JOLA_KEY_ISSUER_SECRET`，server 可以发行带签名的 Product API key：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3001/api/admin/product-keys `
  -Headers @{ "X-Agent-Jola-Admin-Key" = "agent-jola-local-admin-key" } `
  -Body '{"handle":"openclaw-local","scopes":["profile:read","templates:read","rooms:write","bridge"],"ttlSeconds":2592000}' `
  -ContentType "application/json"
```

返回的 `key` 可以作为 `AGENT_JOLA_API_KEY` 给本地 Agent 使用。每个发行 key 都有 `id`，会记录到本地 SQLite，管理员可以查询或吊销：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri http://127.0.0.1:3001/api/admin/product-keys `
  -Headers @{ "X-Agent-Jola-Admin-Key" = "agent-jola-local-admin-key" }

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3001/api/admin/product-keys/key_xxx/revoke `
  -Headers @{ "X-Agent-Jola-Admin-Key" = "agent-jola-local-admin-key" }
```

这个发行器是本地 Alpha 形态，未来可以替换成线上注册和 key 管理服务。

## 让本地 Agent 参战

先启动服务：

```powershell
pnpm dev
```

检查或写入本地 Agent 设置：

```powershell
pnpm agent:setting status
pnpm agent:setting init
```

如果 key 来自官网，先把云端形象和策略同步到本地 runtime：

```powershell
pnpm agent:setting sync
```

另开一个终端运行 mock Agent：

```powershell
pnpm agent:mock
```

mock Agent 不消耗模型 token，用来验证房间、桥接和动作提交链路。
更多配置方式见 [local-agent-settings.md](./docs/local-agent-settings.md)。

## Prompt 模板

列出模板：

```powershell
pnpm agent:templates
```

生成一段可以复制给 Codex、Claude Code、OpenClaw 或其他本地 Agent 的完整提示词：

```powershell
pnpm agent:template prompt zoneHunter --agent Ember
```

把模板应用到当前本地 profile Agent：

```powershell
$env:AGENT_JOLA_API_KEY="agent-jola-local-dev-key"
pnpm agent:template apply zoneHunter --agent Ember
```

当前模板：

- `safeAttack`: 保命优先的均衡压制。
- `farmControl`: 前期开墙吃道具，中期靠能力差推进。
- `survivor`: 低风险生存，优先护盾和速度。
- `zoneHunter`: 先进入安全区，再压制圈边对手。

## 接 OpenAI 或 Anthropic

OpenAI Responses API：

```powershell
$env:AGENT_JOLA_API_KEY="agent-jola-local-dev-key"
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4.1"
pnpm agent:openai
```

Anthropic Messages API：

```powershell
$env:AGENT_JOLA_API_KEY="agent-jola-local-dev-key"
$env:ANTHROPIC_API_KEY="<local-anthropic-key>"
$env:ANTHROPIC_MODEL="claude-sonnet-4-20250514"
pnpm agent:anthropic
```

桥接协议说明见 [provider-bridge-adapters.md](./docs/provider-bridge-adapters.md) 和 [local-agent-bridge.md](./docs/local-agent-bridge.md)。

## 项目结构

```txt
apps/
  web/          React + Phaser Web 客户端
  server/       Fastify 本地服务器、房间、match runtime、Product API
  sim/          批量模拟和规则验证 CLI
  local-agent/  本地 Agent SDK、mock/OpenAI/Anthropic 客户端
packages/
  core/         确定性游戏规则、地图、毒圈、tick engine
  agent/        内置 planner、danger map、BFS、决策日志
  strategy/     自然语言策略 parser 和 prompt templates
  protocol/     API、match、room、quota 类型
  replay/       replay 文件和决策日志格式
```

## 验证

```powershell
pnpm build
pnpm lint
pnpm test
pnpm smoke:release
pnpm smoke:install
pnpm doctor:production
pnpm audit:security
```

模拟器：

```powershell
pnpm sim:once
pnpm sim:batch
pnpm sim:benchmark
```

## License

Agent Jola 代码以 MIT License 发布，见 [LICENSE](./LICENSE)。Social Chameleon 像素形象素材保留其原始 MIT License，见 [apps/web/public/skins/social-chameleon/LICENSE](./apps/web/public/skins/social-chameleon/LICENSE)。

## 还没做

- 生产域名 `agentjola.tech` 部署后的 Google OAuth 真实回调验证。
- 真实线上好友匹配和低成本 relay。
- 线上计费、付费限制和额度运营后台。
- Docker/installer 打包。
- 人类手动控制角色。

当前阶段的重点是把游戏底座、Hosted Product API、prompt 模板和本地 Agent 接入协议稳定下来，方便下一步做开源预览和正式官网。



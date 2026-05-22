# Agent Jola 对话驱动格子爆破对战技术设计

## 1. 设计目标

本文把产品设计落成可执行的技术方案。第一版目标不是做完整平台，而是做出一条可验证的 Agent 迭代闭环：

```text
创建 Agent
  -> 用自然语言生成策略版本
  -> 运行模拟或对战
  -> 记录 replay 和决策日志
  -> 观战/复盘
  -> 根据证据继续调教策略
```

第一版必须满足：

- 单服务、单房间或少量并发房间。
- 2-4 个 Agent 自动对战，不做人类手动角色。
- 服务端权威 tick，客户端只渲染和发起策略/观战操作。
- 规则引擎确定性运行，可通过固定随机种子复现。
- Agent 动作由本地 planner 生成，LLM 不进入逐 tick 控制链路。
- 策略版本、match record、replay、decision log 是核心数据，不是后续附属功能。

第一版暂不做：

- 多用户账号系统。
- 跨服务匹配。
- OpenClaw 真接入。
- 强化学习。
- 踢泡、穿泡、困住/救援等高级玩法。

## 2. 技术框架

### 2.1 推荐栈

```text
语言        TypeScript
包管理      pnpm workspace
前端        Vite + React + Phaser 3
服务端      Node.js + Fastify + ws
测试        Vitest
Schema      zod
存储        SQLite + replay JSON files
代码质量    ESLint + Prettier + TypeScript strict
```

选择理由：

- TypeScript 让前后端共享规则类型、协议类型和 Agent 策略类型。
- Phaser 3 适合格子地图、Sprite、爆炸动画和战场渲染；React 负责工作台、列表、面板和表单。
- Fastify 足够轻，适合 HTTP API；`ws` 保持 WebSocket 控制简单。
- SQLite 适合单服务 MVP 的排行榜、对局历史、策略版本查询；replay 帧数据可能较大，放文件更合适。
- zod 用于保护策略 API、WebSocket 消息和持久化边界。

### 2.2 Monorepo 结构

```text
apps/
  web/
    src/
      app/
      features/
        agent-workbench/
        match-viewer/
        replay-viewer/
        leaderboard/
      game/
        phaser/
        overlays/
      api/
  server/
    src/
      http/
      ws/
      matches/
      records/
      strategies/
      leaderboard/
  sim/
    src/
      cli.ts
      batch-runner.ts
packages/
  core/
    src/
      game/
      engine/
      rules/
      rng/
      types/
  agent/
    src/
      planner/
      danger-map/
      pathfinding/
      scoring/
  strategy/
    src/
      parser/
      schema/
      presets/
  protocol/
    src/
      http.ts
      websocket.ts
      replay.ts
  replay/
    src/
      recorder.ts
      reader.ts
      summary.ts
docs/
  docs/agent-jola-game-design.md
  docs/agent-jola-technical-design.md
```

拆分原则：

- `packages/core` 不依赖 React、Node server、数据库或网络。
- `packages/agent` 只依赖 `core` 和策略 schema。
- `packages/strategy` 不依赖游戏运行时；它只把自然语言或表单输入转成策略版本。
- `apps/server` 组合 core、agent、strategy、replay 和存储。
- `apps/web` 只通过 HTTP/WebSocket/replay 协议和服务端交互。
- `apps/sim` 复用 server 以外的纯模块，用于快速跑批量测试。

## 3. 运行时架构

### 3.1 高层数据流

```text
React Agent 工作台
  -> POST /agents/:id/strategy-versions
  -> Strategy Interpreter
  -> Strategy Version Store
  -> POST /matches
  -> Match Runtime
       -> Core Engine tick
       -> Agent Planner action
       -> Replay Recorder
       -> WebSocket snapshots
  -> Match Record Store
  -> Replay / History / Leaderboard UI
```

### 3.2 Match Runtime

Match Runtime 是服务端内存对象，负责一局正在运行的对战。

职责：

- 持有当前 `MatchState`。
- 按固定 tick 调用 core engine。
- 在需要动作时调用每个 Agent planner。
- 广播节流后的状态快照。
- 缓冲 replay frame 和 decision log。
- 对局结束后写入 match record、leaderboard 统计和 replay 文件。

建议 tick：

- MVP 使用 `10 tick/s`，即每 tick 100ms。
- 水泡默认 `25 ticks` 后爆炸。
- 爆炸格保留 `3 ticks`。
- 普通移动每 `2 ticks` 可移动一格，`speedUp` 可临时降为每 `1 tick` 一格。

这些参数全部放在 `GameRulesConfig`，便于模拟调参。

## 4. 核心模块设计

### 4.1 Core Game Engine

位置：`packages/core`

核心输入：

```ts
type EngineTickInput = {
  state: MatchState;
  actions: AgentAction[];
  config: GameRulesConfig;
};
```

核心输出：

```ts
type EngineTickOutput = {
  state: MatchState;
  events: GameEvent[];
};
```

tick 结算顺序：

1. 清理过期 `blast`。
2. 校验 Agent actions。
3. 处理 `PLACE_BUBBLE`。
4. 处理移动意图。
5. 解决移动冲突。
6. 更新水泡倒计时。
7. 处理到期水泡和连锁爆炸。
8. 摧毁软墙，按 seeded RNG 生成道具。
9. 处理道具拾取。
10. 处理玩家被 blast 命中直接出局。
11. 判断胜负或超时。
12. 输出 events。

移动冲突规则：

- 两个 Agent 同 tick 进入同一格：都停在原地。
- 两个 Agent 互换格子：都停在原地。
- 进入墙、软墙、水泡、地图外：动作无效。
- 放泡后，水泡所在格允许 owner 离开；owner 离开后不可再进入。

交付物：

- `createInitialMatchState`
- `applyTick`
- `validateAction`
- `resolveMovement`
- `resolveExplosions`
- `resolveItems`
- `checkVictory`
- 单元测试覆盖核心规则。

### 4.2 Agent Planner

位置：`packages/agent`

输入：

```ts
type PlannerInput = {
  agentId: string;
  state: MatchState;
  strategy: AgentStrategy;
  config: GameRulesConfig;
};
```

输出：

```ts
type PlannerOutput = {
  action: AgentAction;
  decision: DecisionLogEntry;
};
```

内部模块：

- `danger-map`：预测未来 N tick 的爆炸危险。
- `pathfinding`：带时间维度的 BFS/A*，避免走入未来危险格。
- `scoring`：按策略权重评分候选目标。
- `safe-bomb`：判断放泡后是否有逃生路线。
- `fallback`：planner 超时或无路可走时输出 `WAIT` 或安全移动。

MVP 策略优先级：

1. 已知会死的动作禁止。
2. 当前危险时优先逃生。
3. 安全高价值道具优先。
4. 可安全放泡破墙或压制对手时放泡。
5. 无明确目标时向空间更大、风险更低的区域移动。

执行预算：

- planner 单 Agent P95 小于 `5ms`。
- 单 tick 总 planner P95 小于 `20ms`。
- 超时直接使用 fallback，不阻塞 match tick。

### 4.3 Strategy Interpreter

位置：`packages/strategy`

第一版不依赖 LLM 作为必需路径。先做规则解析和表单参数组合：

- 关键词识别：稳健、激进、先发育、追击、破墙、只保命、少放泡。
- 目标识别：道具、最近敌人、地图中心、指定颜色/编号 Agent。
- 临时指令：接下来 N 秒、这局、持久默认。
- 冲突处理：硬约束优先，已知必死动作永远不允许。

输出：

```ts
type StrategyParseResult = {
  accepted: boolean;
  needsClarification: boolean;
  readableSummary: string;
  patch: AgentStrategyPatch;
  warnings: string[];
};
```

后续可加 LLM adapter，但只能生成 strategy patch，不能生成逐 tick action。

### 4.4 Strategy Version Store

位置：`apps/server/src/strategies`

职责：

- 保存策略版本。
- 保存原始自然语言指令和可读摘要。
- 标记来源：`web`、`openclaw`、`system`。
- 提供当前默认策略版本。
- 支持对局中策略变更事件。

SQLite 表：

```sql
agents(id, name, created_at, current_strategy_version_id)
strategy_versions(id, agent_id, created_at, source, source_instruction, readable_summary, strategy_json)
```

### 4.5 Match Record 与 Replay

位置：

- `apps/server/src/records`
- `packages/replay`

SQLite 表：

```sql
matches(id, created_at, status, map_id, seed, winner_agent_id, finish_reason, replay_path, decision_log_path)
match_agents(match_id, agent_id, strategy_version_id, slot)
agent_stats(agent_id, wins, losses, draws, games_played, rating)
```

Replay 文件：

```ts
type ReplayFile = {
  version: 1;
  matchId: string;
  config: GameRulesConfig;
  initialState: MatchState;
  frames: ReplayFrame[];
};
```

Decision log 文件：

```ts
type DecisionLogEntry = {
  tick: number;
  agentId: string;
  action: AgentAction;
  reason: string;
  target?: GridPosition;
  strategyVersionId: string;
  danger?: {
    currentCellDangerTick: number | null;
    chosenPathRisk: number;
  };
};
```

Replay 文件建议放：

```text
data/replays/{matchId}.json
data/decisions/{matchId}.jsonl
```

### 4.6 Server API

位置：`apps/server/src/http`

MVP HTTP API：

```http
GET /health

GET /agents
POST /agents
GET /agents/:agentId

GET /agents/:agentId/strategy-versions
POST /agents/:agentId/strategy-versions

POST /matches
GET /matches
GET /matches/:matchId
GET /matches/:matchId/replay
GET /matches/:matchId/decisions

GET /leaderboard
```

`POST /matches` 示例：

```json
{
  "agentIds": ["agent_a", "agent_b"],
  "mapId": "classic",
  "seed": "optional-seed"
}
```

`POST /agents/:agentId/strategy-versions` 示例：

```json
{
  "instruction": "这局稳一点，先吃道具，不要主动贴脸",
  "scope": "next_match",
  "source": "web"
}
```

### 4.7 WebSocket Protocol

位置：`apps/server/src/ws` 和 `packages/protocol`

连接：

```text
GET /matches/:matchId/ws
```

服务端消息：

```ts
type ServerMessage =
  | { type: "snapshot"; tick: number; state: PublicMatchState }
  | { type: "events"; tick: number; events: GameEvent[] }
  | { type: "decision"; entry: DecisionLogEntry }
  | { type: "finished"; record: MatchRecord };
```

客户端消息：

```ts
type ClientMessage =
  | { type: "subscribe"; overlays?: OverlayMode[] }
  | { type: "set_speed"; speed: 0.5 | 1 | 2 }
  | { type: "pause_replay" }
  | { type: "seek_replay"; tick: number };
```

MVP 实时对战可以先只支持 `snapshot` 和 `finished`，回放 seek 走 replay viewer 的本地数据。

### 4.8 Web Client

位置：`apps/web`

页面：

1. Agent 工作台
   - Agent 列表。
   - 当前策略版本。
   - 策略输入框。
   - 开始模拟/对战按钮。
   - 最近对局。

2. Match Viewer
   - Phaser 战场。
   - 当前 tick、比分、存活状态。
   - Agent 策略摘要。
   - 最近决策解释。
   - 危险图/路径 overlay。

3. Replay Viewer
   - 从 replay 文件加载。
   - 时间轴拖动。
   - 决策日志按 tick 对齐。
   - 关键事件列表。

4. Leaderboard / History
   - Agent、胜率、场次、rating。
   - 对局记录、胜因、时间、回放入口。

前端状态：

- 服务端数据用轻量 fetch layer。
- Match runtime 状态来自 WebSocket。
- Phaser scene 只负责渲染，不持有业务真相。

## 5. 模块任务拆解

### Phase 0: 工程骨架

目标：可以安装、构建、测试、启动空服务。

任务：

- 初始化 pnpm workspace。
- 建立 `apps/web`、`apps/server`、`apps/sim`、`packages/*`。
- 配置 TypeScript strict。
- 配置 Vitest。
- 配置 ESLint/Prettier。
- 建立共享 `protocol` 包的导入路径。
- Server 提供 `GET /health`。
- Web 显示空工作台页面。

验收：

- `pnpm test` 通过。
- `pnpm dev` 可同时启动 web 和 server。
- `GET /health` 返回 ok。

### Phase 1: Core Engine

目标：无 UI 条件下能跑完一局 deterministic match。

任务：

- 定义 `MatchState`、`GameMap`、`AgentAction`、`GameEvent`。
- 实现 seeded RNG。
- 实现地图加载和初始状态生成。
- 实现移动、碰撞、放泡、爆炸、软墙、道具、胜负。
- 实现 tick event 输出。
- 补核心单元测试。

验收：

- 固定 seed 的同一场对局输出完全一致。
- 单元测试覆盖爆炸阻挡、连锁爆炸、移动冲突、道具拾取、胜负判定。

### Phase 2: Simulator CLI

目标：可以批量跑 Agent 对战，生成基础统计。

任务：

- `apps/sim` 提供 `run-once` 和 `run-batch`。
- 支持选择地图、seed、Agent preset。
- 输出胜负、平均 tick、异常数量。
- 写入临时 replay 和 decision log。

验收：

- 可以运行 1000 局无 UI 对战。
- 无未捕获异常。
- 输出自杀率、胜率、平均时长。

### Phase 3: Basic Agent Planner

目标：Agent 会逃生、吃道具、破墙，不频繁自杀。

任务：

- 实现 danger map。
- 实现 time-aware BFS。
- 实现目标评分。
- 实现 safe-bomb check。
- 实现 fallback action。
- 记录 `DecisionLogEntry`。

验收：

- Agent 在基础地图中能主动移动、吃道具、放泡破墙。
- 1000 局模拟中明显自杀率低于约定阈值。
- 每个关键动作有 reason。

### Phase 4: Strategy Version 与 Parser

目标：用户能用自然语言创建策略版本，Agent 行为可观察变化。

任务：

- 定义 `AgentStrategy` 和 `AgentStrategyPatch` zod schema。
- 实现关键词 parser。
- 实现策略合并和默认 preset。
- 实现 strategy version SQLite 表。
- 实现 `POST /agents/:id/strategy-versions`。
- 在 simulator 中指定策略版本运行。

验收：

- 输入“稳一点先吃道具”会提高 `survivalWeight`、`powerupWeight`，降低 `aggression`。
- 输入“激进追击”会提高 `aggression` 和 `trapWeight`，但不会放宽必死动作硬约束。
- 策略版本可在后续 match record 中追踪。

### Phase 5: Match Server 与 Replay Store

目标：服务端可启动对局、保存记录、提供回放。

任务：

- 实现 match runtime manager。
- 实现 `POST /matches`。
- 实现 `GET /matches`、`GET /matches/:id`。
- 实现 replay recorder。
- 实现 match record SQLite 表。
- 实现 leaderboard 统计更新。
- 实现 replay/decision 文件读写。

验收：

- 创建一局对战后能得到 match id。
- 对战结束后 match record、replay、decision log 都可读取。
- leaderboard 能按胜率或 rating 返回结果。

### Phase 6: WebSocket 与实时观战

目标：前端能实时看到对局。

任务：

- 实现 `/matches/:id/ws`。
- 广播 snapshot 和 finished 消息。
- 前端连接 WebSocket。
- Phaser 渲染地图、Agent、水泡、爆炸、道具。
- React 面板显示 tick、状态、最近决策。

验收：

- 点击开始对战后进入观战页。
- 战场动画和服务端状态一致。
- 对局结束后跳转或提示查看复盘。

### Phase 7: Agent 工作台

目标：用户能完成核心产品闭环。

任务：

- Agent 列表和创建 Agent。
- 当前策略版本显示。
- 策略输入框和解析摘要。
- 开始对战按钮。
- 最近对局列表。
- 当前简化排名。

验收：

- 用户从工作台输入一句策略，可以创建版本并发起对战。
- 对战结束后，工作台能显示新记录。

### Phase 8: Replay Viewer 与轻量复盘

目标：用户能根据证据继续调教。

任务：

- Replay loader。
- 时间轴。
- 关键事件列表。
- 决策日志按 tick 展示。
- 危险图和计划路径 overlay。
- 规则生成一句复盘建议。

验收：

- 任意 match record 可打开 replay。
- 用户能看到关键动作的 reason、目标和风险。
- 复盘页能指出至少一个可行动的策略调整建议。

### Phase 9: Hardening

目标：准备进入多人或 OpenClaw 前的稳定化。

任务：

- API 输入限流和错误处理。
- Replay schema versioning。
- 大 replay 文件分页或压缩。
- Planner 性能 profiling。
- WebSocket 断线重连。
- 移动端基础适配。
- 为 OpenClaw tool 做 API token 方案设计。

验收：

- 长时间批量模拟无内存增长异常。
- 关键 API 有 zod 校验和明确错误码。
- OpenClaw 接入不需要改 core engine。

## 6. 依赖顺序

```text
Phase 0 工程骨架
  -> Phase 1 Core Engine
  -> Phase 2 Simulator
  -> Phase 3 Agent Planner
  -> Phase 4 Strategy Version
  -> Phase 5 Match Server / Replay Store
  -> Phase 6 WebSocket / 观战
  -> Phase 7 工作台
  -> Phase 8 复盘
  -> Phase 9 Hardening / OpenClaw 准备
```

关键原则：

- 不要在 core engine 稳定前做复杂 UI。
- 不要在 simulator 能批量验证前接 OpenClaw。
- 不要让 LLM 输出动作，只能输出策略 patch。
- 不要把 replay 当成后续功能；从第一局开始记录。

## 7. 风险与技术应对

### 7.1 规则返工风险

风险：移动、放泡、爆炸顺序后改，会导致 Agent 和 replay 全部返工。

应对：

- Phase 1 先锁结算顺序。
- 用 golden replay 测试固定 seed 输出。
- Replay 文件保存 `rulesVersion`。

### 7.2 Planner 性能风险

风险：多 Agent 同 tick 路径规划超时，影响实时观战。

应对：

- 限制搜索 horizon。
- 缓存 danger map。
- 每 Agent planner 设置预算和 fallback。
- simulator 阶段先跑 P95。

### 7.3 策略解析不稳定

风险：自然语言解析结果和用户预期不同。

应对：

- 第一版 parser 以可解释关键词和表单参数为主。
- 每次创建策略版本都返回 readable summary。
- UI 允许用户确认或继续修正。

### 7.4 Replay 体积风险

风险：逐 tick 保存完整状态导致文件过大。

应对：

- MVP 可先保存完整 frame，降低实现风险。
- 后续改为 initial state + event delta。
- replay schema 从第一版开始带 version。

### 7.5 UI 过早复杂化

风险：工作台、观战、复盘同时做，拖慢核心验证。

应对：

- 先做工作台最小闭环。
- Match viewer 先只显示地图和状态。
- Overlay、复盘建议放 Phase 8。

## 8. 近期建议执行顺序

最小可执行拆解：

1. 建 monorepo 和空服务。
2. 写 `packages/core` 的类型和 `applyTick` 骨架。
3. 实现地图、移动、碰撞、胜负。
4. 实现水泡、爆炸、软墙。
5. 写 simulator CLI。
6. 实现最笨 Agent：随机安全移动。
7. 加 danger map 和 BFS。
8. 加 match record/replay。
9. 做 Web 最小观战页。
10. 做策略版本和工作台。

到第 8 步时，技术风险基本能看清；到第 10 步时，产品闭环能首次验证。

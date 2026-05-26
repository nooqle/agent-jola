# AgentPoppy 对话驱动格子爆破对战游戏设计文档

## 1. 背景

本项目目标是做一个格子爆破实时对战游戏：玩家不直接操控角色，而是通过对话向自己的 Agent 下达本局战术思路，Agent 根据战术目标在局内自动规划路线、放置水泡、躲避爆炸、争夺道具并尝试击败对手。

这里的“格子爆破”指通用玩法结构，不复刻任何既有游戏名称、美术、角色、音效或地图资产。核心机制包括格子地图、可破坏障碍、水泡延迟爆炸、十字形爆炸范围、道具成长、多人对战和胜负判定。

### 1.1 AgenTank 调研后的定位修正

AgenTank 已经验证了一条成立的产品闭环：创建坦克、编辑 Agent 逻辑、发布版本、打真实公开战、看排行榜和回放，再继续迭代。它的强项是 code-first 的 Agent 编程竞技，用户或 Agent 直接改 `onIdle(me, enemy, game)`。

本项目不应照搬这条 code-first 路线。我们的差异化应该是 dialogue-first：玩家像教练一样用自然语言塑造 Agent 战术，系统负责把指令转成策略参数，并在对局和复盘里解释 Agent 为什么这样行动。

因此本设计需要吸收 AgenTank 的闭环能力，但保持不同的核心体验：

- 必须有创建 Agent、运行对局、记录战绩、查看回放、再次调教的完整循环。
- 必须让策略版本、对局记录和排行榜尽早出现，否则 Agent 改进缺少目标。
- 用户主入口应是策略对话和可解释观战，不是代码编辑器。
- Agent 仍可有底层 planner 和策略 API，但人类用户默认不需要读代码。

## 2. 目标

### 2.1 产品目标

- 让玩家通过自然语言影响 Agent 的战术风格，而不是逐帧操作。
- 让 Agent 的局内行为具备可解释性：为什么往这里走、为什么放泡、为什么逃跑。
- 支持多 Agent 对战，形成可观战、可复盘、可持续调教的局内体验。
- 尽早形成“策略版本 -> 模拟/对战 -> 回放证据 -> 策略更新”的产品闭环。
- 让 OpenClaw、Web Chat 或站内策略面板都可以成为“教练席”，但第一版不把 OpenClaw 作为核心引擎前置依赖。

### 2.2 技术目标

- 游戏主循环必须实时、确定、低延迟。
- 大模型不进入逐帧控制链路，只负责策略理解和高层意图转译。
- Agent 的动作由本地规划器生成，保证响应速度和行为稳定性。
- 服务端权威处理地图、碰撞、爆炸、道具和胜负，防止客户端作弊。

### 2.3 非目标

- 第一版不做完整强化学习训练。
- 第一版不复刻任何既有游戏 IP 内容。
- 第一版不追求复杂物理效果，优先完成清晰的格子规则。
- 第一版不让 LLM 直接每个 tick 决定上下左右。
- 第一版不以代码编辑为主入口；代码能力可以存在于内部或高级模式，但默认体验是策略对话。

## 3. 目标用户与核心体验

### 3.1 目标用户

- 想观察、训练或调教 Agent 行为的玩家。
- 对 AI 对战、自动博弈和策略控制感兴趣的用户。
- 想通过 OpenClaw 等对话入口参与游戏的人。

### 3.2 核心体验

第一版核心循环：

1. 玩家创建或选择一个 Agent。
2. 玩家用自然语言设定打法，例如“先发育，别贴脸”“中盘开始围堵最近的人”。
3. 系统把指令转成可审计的策略版本。
4. Agent 进入模拟或公开对局。
5. 玩家观看对局，看到危险图、目标选择、最近决策理由。
6. 对局结束后，系统给出关键失败/成功证据。
7. 玩家继续用对话修正策略，发布下一个策略版本。

一局游戏开始前或进行中，玩家可以输入：

- “这局稳一点，先吃道具，不要主动贴脸。”
- “优先追击红色玩家，他放泡后堵他退路。”
- “现在地图中间资源多，先抢速度和威力。”
- “血量/容错低的时候只保命，不要放危险泡。”

系统将这些自然语言转换为 Agent 策略参数，Agent 在实时游戏中执行：

- 根据危险图判断哪些格子未来会爆炸。
- 根据目标权重选择吃道具、破墙、追击、围堵或撤退。
- 放泡前检查自己是否有安全逃生路线。
- 对手靠近时切换到防守或反制策略。
- 对每次关键动作记录解释，供观战和复盘使用。

## 4. 游戏规则设计

### 4.1 地图

地图是二维格子，例如 15 x 13。

格子类型：

- `empty`：可通行空地。
- `solid`：不可破坏墙。
- `soft`：可破坏障碍。
- `spawn`：出生点区域。
- `item`：道具所在格。
- `bubble`：已放置水泡所在格，默认不可穿越。
- `blast`：爆炸效果临时覆盖格。

### 4.2 玩家状态

每个玩家或 Agent 拥有：

- `id`
- `position`
- `alive`
- `bubbleCapacity`：同时可放置水泡数量。
- `activeBubbleCount`
- `blastRange`
- `speed`
- `invulnerableUntilTick`

MVP 暂不引入 `trapped`、`canKick`、`canPierce`。这些会显著增加结算顺序、路径预测和 UI 状态复杂度，应放到第二阶段。

### 4.3 水泡规则

- 玩家在当前格放置水泡。
- 水泡在固定 tick 后爆炸，例如 2.5 秒。
- 爆炸范围为十字形，中心格加上下左右四个方向。
- 爆炸遇到 `solid` 停止。
- 爆炸遇到 `soft` 摧毁该障碍并停止。
- 爆炸命中其他水泡时触发连锁爆炸。
- MVP 中爆炸命中玩家直接出局。困住/救援模式留到第二阶段。

### 4.4 道具

第一版建议保留少量核心道具：

- `rangeUp`：水泡爆炸范围 +1。
- `capacityUp`：同时可放水泡数量 +1。
- `speedUp`：移动速度提升。

MVP 可以先不做复杂负面道具。

### 4.5 胜负

基础模式：

- 最后存活的玩家获胜。
- 超时后按存活、击破数、道具数或地图控制评分判定。

第二阶段可选模式：

- 被爆炸命中后不是立即死亡，而是进入 `trapped` 状态。
- 队友可救援，被对手触碰则出局。

MVP 推荐先使用“命中即出局”，降低系统复杂度。

## 5. 系统架构

```text
站内策略面板 / Web Chat / OpenClaw
        |
        v
策略解释层 Strategy Interpreter
        |
        v
策略版本 Strategy Version Store
        |
        v
Agent Planner
        |
        v
游戏服务端 Game Server
        |                 |
        v                 v
无 UI Simulator      Match Record / Replay Store
        |                 |
        v                 v
前端客户端 Game Client / 排行榜 / 对局历史 / 复盘
```

### 5.1 前端客户端

职责：

- 渲染地图、玩家、水泡、爆炸、道具和 UI。
- 展示 Agent 当前策略、最近决策原因和局势摘要。
- 提供策略对话入口、策略版本查看、对局启动和回放入口。
- 展示排行榜、对局历史和 Agent 迭代证据。
- 接收服务端状态快照。

推荐技术：

- Phaser 3 或 PixiJS。
- React 用于房间 UI、Agent 面板、日志面板。
- Canvas/WebGL 用于游戏画面。

### 5.2 游戏服务端

职责：

- 维护权威游戏状态。
- 以固定 tick 运行主循环，例如 10、15 或 20 tick/s。
- 处理输入队列。
- 结算移动、放泡、爆炸、道具、胜负。
- 向客户端广播状态快照或增量事件。
- 写入 match record、replay 和关键决策日志。

推荐技术：

- Node.js + TypeScript。
- WebSocket，例如 `ws` 或 Socket.IO。
- 游戏状态使用纯 TypeScript 数据结构，方便测试。

### 5.3 Agent Planner

职责：

- 读取当前游戏状态和策略参数。
- 生成未来危险图。
- 评估候选目标。
- 计算安全路径。
- 输出下一步动作。

动作集合：

- `MOVE_UP`
- `MOVE_DOWN`
- `MOVE_LEFT`
- `MOVE_RIGHT`
- `PLACE_BUBBLE`
- `WAIT`

### 5.4 策略解释层

职责：

- 接收站内策略面板、Web Chat 或 OpenClaw 的自然语言。
- 解析为结构化策略。
- 写入对应 Agent 的策略版本，并保留原始指令、摘要和生效范围。
- 拒绝或追问超出白名单的指令，例如要求作弊、直接控制对手或绕过规则。

结构化策略示例：

```json
{
  "riskTolerance": 0.25,
  "primaryGoal": "collect_powerups",
  "secondaryGoal": "avoid_combat",
  "targetPlayerId": null,
  "aggression": 0.2,
  "powerupWeight": 0.8,
  "wallBreakWeight": 0.5,
  "trapWeight": 0.2,
  "survivalWeight": 1.0,
  "scope": "next_match",
  "sourceInstruction": "这局先吃道具，别主动贴脸"
}
```

### 5.5 对局记录与迭代闭环

调研 AgenTank 后，第一版需要把对局记录作为产品核心，而不是后续装饰。每一次模拟或公开对战至少产生：

- `matchId`
- 参与 Agent 与策略版本。
- 地图、随机种子、起止 tick。
- 胜负、胜因、关键事件。
- 最近若干条决策解释。
- 可复现 replay 数据。

这些记录用于三个界面：Agent 详情页的最近战绩、公开对局历史、策略复盘页。没有这些证据，用户很难知道下一句策略应该怎么改。

## 6. Agent 决策设计

### 6.1 决策原则

Agent 每次决策遵循固定优先级：

1. 如果当前或即将处于爆炸危险，优先逃生。
2. 如果有高价值安全道具，优先拾取。
3. 如果能安全放泡破墙或压制对手，考虑放泡。
4. 如果没有明确收益，移动到更有空间和资源的位置。
5. 已知必死动作属于硬约束，MVP 中永远禁止。`riskTolerance` 只影响高风险但非必死的动作选择。

### 6.2 危险图

危险图用于标记未来若干 tick 内每个格子的风险。

输入：

- 当前地图。
- 所有水泡的位置、爆炸时间和范围。
- 可能的连锁爆炸。

输出：

```ts
type DangerCell = {
  firstDangerTick: number | null;
  dangerScore: number;
};
```

用途：

- 判断当前位置是否安全。
- 判断候选路径是否会在未来被炸。
- 判断放泡后是否存在逃生路线。

### 6.3 路径规划

MVP 使用 BFS 或 A*。

规划输入：

- 起点。
- 目标集合。
- 地图阻挡信息。
- 危险图。
- Agent 移动速度。

路径有效条件：

- 不穿过墙、障碍和不可穿越水泡。
- 到达某格时，该格在对应 tick 不处于危险。
- 放泡动作后，必须仍能找到安全格。

### 6.4 目标评分

候选目标包括：

- 安全格。
- 道具格。
- 可破坏障碍旁边的放泡点。
- 对手附近的封锁点。
- 地图中心或资源密集区。

评分公式示例：

```text
score =
  survivalWeight * safetyScore
  + powerupWeight * powerupScore
  + wallBreakWeight * wallBreakScore
  + trapWeight * opponentTrapScore
  - distancePenalty
  - riskTolerancePenalty
```

策略参数来自用户对话，因此同一个局面下，不同 Agent 会呈现不同风格。

### 6.5 放泡检查

放泡前必须通过安全检查：

1. 当前水泡数量未超过容量。
2. 放泡位置合法。
3. 放泡后至少存在一条逃生路径。
4. 逃生路径到达的安全格在水泡爆炸后仍可存活。
5. 放泡收益超过阈值。

收益来源：

- 可炸毁软墙数量。
- 可能命中或封锁对手。
- 打开通道。
- 争夺关键资源。

### 6.6 决策解释

每次 Agent 输出动作时，同时记录解释：

```json
{
  "tick": 426,
  "action": "MOVE_LEFT",
  "reason": "current_cell_danger_in_18_ticks",
  "target": { "x": 5, "y": 7 },
  "strategy": "survival_first",
  "confidence": 0.78
}
```

前端可展示最近 3 条解释，复盘系统可记录完整日志。

## 7. 对话控制设计

### 7.1 对话输入类型

支持三类输入：

#### 全局风格

例：

- “这局打得稳一点。”
- “激进一点，主动找人打。”
- “别恋战，先发育。”

转换为：

- `riskTolerance`
- `aggression`
- `survivalWeight`
- `powerupWeight`

#### 战术目标

例：

- “优先抢中间的道具。”
- “针对蓝色玩家。”
- “多炸墙，打开路线。”

转换为：

- `primaryGoal`
- `targetArea`
- `targetPlayerId`
- `wallBreakWeight`

#### 临时指令

例：

- “接下来 10 秒只保命。”
- “现在别放泡。”
- “绕开右上角。”

转换为带过期时间的策略覆盖：

```json
{
  "type": "temporary_override",
  "durationTicks": 200,
  "constraints": {
    "allowBubble": false,
    "avoidArea": { "x1": 10, "y1": 0, "x2": 14, "y2": 4 }
  }
}
```

### 7.2 冲突处理

如果用户说“激进一点，但不要冒险”，系统应解释为：

- 提高追击和围堵权重。
- 不降低逃生检查门槛。
- 放泡仍必须满足安全路径。

策略解释层不直接发动作，只更新参数。

### 7.3 策略 API 与 OpenClaw 接入

第一阶段先实现内部 HTTP 策略 API 和站内调试面板。OpenClaw 后续作为同一 API 的外部调用方接入，不应阻塞核心引擎和前端观战。

站内或 Web Chat 调用：

```http
POST /agents/:agentId/strategy-versions
Content-Type: application/json

{
  "instruction": "这局先吃道具，别主动贴脸",
  "source": "web",
  "scope": "next_match"
}
```

返回：

```json
{
  "accepted": true,
  "versionId": "strat_001",
  "summary": "Agent 将优先收集道具并降低主动交战倾向。",
  "strategy": {
    "primaryGoal": "collect_powerups",
    "aggression": 0.2,
    "powerupWeight": 0.85,
    "survivalWeight": 1.0
  }
}
```

OpenClaw tool 可以映射到同一能力：

```ts
type SetAgentStrategyInput = {
  agentId: string;
  instruction: string;
  scope?: "next_match" | "current_match" | "persistent";
};

type SetAgentStrategyOutput = {
  accepted: boolean;
  versionId?: string;
  strategyPatch: AgentStrategyPatch;
  readableSummary: string;
};
```

如果对局已经开始，`current_match` 策略变更必须写入事件日志，并在 UI 上显示“第 N tick 起生效”。这样复盘时可以解释用户指令如何影响后续行为。

## 8. 数据模型草案

```ts
type MatchState = {
  matchId: string;
  tick: number;
  status: "waiting" | "running" | "finished";
  map: GameMap;
  players: Record<string, PlayerState>;
  bubbles: BubbleState[];
  blasts: BlastState[];
  items: ItemState[];
  seed: string;
};

type GameMap = {
  width: number;
  height: number;
  cells: CellType[];
};

type PlayerState = {
  id: string;
  type: "agent";
  x: number;
  y: number;
  alive: boolean;
  bubbleCapacity: number;
  activeBubbleCount: number;
  blastRange: number;
  speed: number;
  abilities: PlayerAbility[];
};

type BubbleState = {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  placedAtTick: number;
  explodeAtTick: number;
  range: number;
};

type AgentStrategy = {
  versionId: string;
  riskTolerance: number;
  aggression: number;
  survivalWeight: number;
  powerupWeight: number;
  wallBreakWeight: number;
  trapWeight: number;
  targetPlayerId?: string;
  targetArea?: Rect;
  constraints: StrategyConstraint[];
};

type AgentStrategyVersion = {
  id: string;
  agentId: string;
  createdAt: string;
  source: "web" | "openclaw" | "system";
  sourceInstruction: string;
  readableSummary: string;
  strategy: AgentStrategy;
};

type MatchRecord = {
  matchId: string;
  agentIds: string[];
  strategyVersionIds: string[];
  mapId: string;
  seed: string;
  winnerAgentId?: string;
  finishReason: "elimination" | "timeout" | "draw";
  replayUrl: string;
  decisionLogUrl: string;
};
```

## 9. 服务端 Tick 流程

每个 tick 执行：

1. 读取玩家输入和 Agent 动作。
2. 验证动作是否合法。
3. 处理移动。
4. 处理放泡。
5. 更新水泡倒计时。
6. 处理爆炸和连锁爆炸。
7. 处理软墙破坏和道具生成。
8. 处理玩家命中或出局。
9. 处理道具拾取。
10. 判断胜负。
11. 广播状态。
12. 记录关键事件和 Agent 决策解释。

Agent 动作可提前一个 tick 计算，避免阻塞主循环。

## 10. 前端界面设计

前端不要做营销落地页作为第一屏。用户进入后应直接看到可操作的 Agent 工作台：当前 Agent、最近战绩、下一步可做什么，以及策略输入框。

### 10.1 Agent 工作台

目标：让用户在 10 秒内完成“改一句策略 -> 开一局 -> 看结果”的循环。

首屏包含：

- Agent 列表或当前 Agent 卡片：名称、当前策略版本、胜率、最近 5 局结果。
- 主操作：`调整策略`、`开始模拟`、`公开对战`。
- 策略输入框：支持自然语言输入，并展示解析后的策略摘要。
- 最近对局：点击进入回放。
- 当前排名或本地评分：让用户知道迭代是否有效。

不要让代码编辑器成为默认入口。高级用户可以进入策略 JSON 或 planner 调试，但主界面应服务“教练式调教”。

### 10.2 对局观战页

核心布局：

- 中央为游戏地图。
- 顶部显示局内时间、存活 Agent、比分或资源状态。
- 右侧显示选中 Agent 的当前策略、当前目标、风险状态和最近决策解释。
- 底部显示事件流：放泡、吃道具、击杀、逃生、策略变更。
- 可开关覆盖层：危险图、计划路径、目标权重。

观战页的差异化重点是可解释性。AgenTank 的回放更偏结果和战斗记录，本项目应把“为什么这样走”变成主视觉信息。

### 10.3 复盘页

MVP 可以先做轻量复盘，不做完整视频剪辑式回放。

必须支持：

- 时间轴拖动到关键事件。
- 显示每个 Agent 当时的策略版本。
- 显示最近 3-5 条决策解释。
- 显示危险图和最终选择路径。
- 给出一句复盘建议，例如“第 412 tick 追击权重过高，导致没有优先逃离连锁爆炸区域”。

第二阶段再补：

- 多倍速播放。
- 逐 tick 调试视图。
- 用户指令与行为变化的对照图。

### 10.4 排行榜与对局历史

AgenTank 证明排行榜和公开对局能给 Agent 迭代提供目标感。本项目第一版也应有简化版：

- 排行榜：Agent、策略版本、胜场、胜率、最近变化。
- 对局历史：双方 Agent、地图、胜因、时间、精彩度或关键事件数量。
- 回放入口：每条历史记录都能打开复盘。

MVP 排行榜可以先是本地或单服务实例级，不需要全站账号系统。

### 10.5 视觉方向

不要复制 AgenTank 的复古纸张、黑框红章和坦克像素风。建议走“街机战术控制台”方向：

- 明亮、清晰、高对比的格子战场。
- UI 像教练席和战术板，而不是代码 IDE。
- 角色、道具和爆炸保持原创，避免既有游戏 IP 联想。
- 决策解释、危险图、路径线使用清楚的战术标注语言。

## 11. MVP 范围

### 11.1 第一阶段必须有

- 单服务单房间。
- 2-4 个 Agent 对战，MVP 不做人类手动角色。
- 固定地图或少量随机地图。
- 基础移动、放泡、爆炸、软墙、道具。
- 命中直接出局。
- 服务端权威 tick。
- 无 UI simulator，可批量跑对局。
- WebSocket 状态同步。
- Agent BFS/A* 路径规划。
- 危险图。
- 安全放泡检查。
- 策略版本模型。
- 简单自然语言策略解析和站内策略输入面板。
- HTTP 策略 API。
- 前端工作台、观战页和轻量复盘页。
- 对局记录、replay 数据和决策日志。
- 简化排行榜或本地评分榜。

### 11.2 第一阶段可以没有

- 强化学习。
- 排位匹配。
- 复杂角色技能。
- 完整观战回放编辑器。
- 复杂皮肤和装扮。
- 精细水泡困人/救人规则。
- 踢泡、穿泡、遥控泡等高级道具。
- OpenClaw 真接入。
- 多在线房间和账号系统。
- 长期记忆。

## 12. 推荐里程碑

### Milestone 1: 核心引擎与模拟器

- 地图加载。
- 玩家移动。
- 水泡放置和爆炸。
- 软墙破坏。
- 胜负判定。
- 单元测试覆盖爆炸和碰撞规则。
- 固定随机种子。
- 无 UI simulator 可跑批量对局。

### Milestone 2: 基础 Agent 与决策日志

- 危险图。
- BFS/A* 安全路径。
- 吃道具策略。
- 安全放泡策略。
- 决策日志。
- 模拟测试统计自杀率、拾取率、胜率。

### Milestone 3: 前端观战与工作台

- Canvas/Phaser 渲染。
- WebSocket 同步。
- Agent 工作台。
- 对局观战页。
- 最近对局列表。

### Milestone 4: 对话策略与版本化

- 策略参数模型。
- 自然语言到策略 patch。
- 策略版本历史。
- HTTP 策略 API。
- 临时指令和过期机制。

### Milestone 5: 复盘、排行榜与外部接入

- 多 Agent 风格差异。
- 轻量复盘。
- 简化排行榜。
- 更丰富地图。
- 平衡参数调优。
- OpenClaw 接入同一个策略 API。

## 13. 测试策略

### 13.1 单元测试

重点覆盖：

- 爆炸范围计算。
- 连锁爆炸。
- 软墙阻挡。
- 道具拾取。
- 水泡容量限制。
- 安全路径判断。
- 放泡后逃生检查。

### 13.2 模拟测试

运行大量无 UI 对局：

- 检查 Agent 是否频繁自杀。
- 检查是否卡在角落。
- 检查道具拾取率。
- 检查不同策略参数是否产生明显行为差异。

### 13.3 集成测试

- WebSocket 同步一致性。
- 站内策略面板能否正确创建策略版本。
- OpenClaw 接入后，OpenClaw 指令能否通过同一策略 API 更新策略。
- 服务端是否拒绝非法动作。
- 多客户端观战状态是否一致。

### 13.4 可解释性测试

抽样检查 Agent 决策日志：

- 动作是否和 reason 一致。
- 危险图判断是否正确。
- 用户策略变化是否反映在行为上。

## 14. 风险与应对

### 14.1 实时性风险

风险：如果每步都调用大模型，延迟不可接受。

应对：LLM 只做策略解释，局内动作由本地 planner 完成。

### 14.2 行为质量风险

风险：规则 Agent 可能看起来机械或不聪明。

应对：先用可解释规则跑通，再通过模拟对局调参；后期再考虑自博弈或学习型模型。

### 14.3 IP 风险

风险：复刻既有游戏名称、美术或音效会有版权和商标风险。

应对：使用原创名称、原创素材和通用格子爆破玩法表达。

### 14.4 网络同步风险

风险：实时对战中客户端状态不一致。

应对：服务端权威，客户端只渲染状态；必要时做插值和状态校正。

### 14.5 对话误解风险

风险：用户自然语言可能含糊或互相矛盾。

应对：策略解释层返回可读摘要，并允许用户继续修正，例如“不是，我是说只在安全时追击”。

## 15. 技术选型建议

默认推荐：

- 前端：React + Phaser 3。
- 服务端：Node.js + TypeScript。
- 通信：WebSocket。
- 测试：Vitest。
- 策略解释：站内策略面板调用后端策略 API，OpenClaw 后续复用同一 API。
- Agent 规划：TypeScript 内置 BFS/A* + danger map。

如果优先快速原型，也可以：

- 单仓库 Vite + Node WebSocket。
- 前后端共享 `packages/core` 里的游戏规则类型和纯函数。

建议目录结构：

```text
apps/
  web/
  server/
packages/
  core/
    game/
    agent/
    strategy/
  openclaw/
docs/
  docs/agent-poppy-game-design.md
```

当前设计文档先放在仓库根目录，后续创建项目结构时可移动到 `docs/`。

详细工程拆解见 `agent-poppy-technical-design.md`。

## 16. 后续需要确认的问题

1. 第一版是否锁定为纯 Agent 对战，不做人类手动控制角色？
2. 第一版公开对战是本地单服务榜，还是需要跨用户全站榜？
3. 策略输入是只支持赛前生效，还是允许对局中临时指令？
4. 复盘建议由规则生成即可，还是需要 LLM 生成自然语言总结？
5. 美术方向是否锁定为“街机战术控制台”，还是需要另找视觉方向？
6. OpenClaw 接入目标放在哪个里程碑，是否接受先用站内策略面板验证？
7. Agent 策略是否需要长期记忆，例如记住某个用户偏好的打法？

## 17. 建议决策

建议第一版采用“服务端权威 + TypeScript 规则引擎 + 无 UI simulator + Phaser/React 前端观战 + 站内策略面板”的方案。OpenClaw 接入保留为后续调用同一策略 API 的外部入口。

原因：

- 实时部分足够稳定。
- 对话控制和局内动作解耦，便于调试。
- 规则 Agent 可解释，便于复盘和迭代。
- 策略版本、对局记录和排行榜能形成类似 AgenTank 的迭代闭环，但不会牺牲 dialogue-first 差异化。
- 先用站内策略面板验证核心体验，可以避免 OpenClaw 接入过早拖慢规则引擎和前端观战。
- 后期可以在不推翻架构的情况下加入强化学习、自博弈或更复杂的对手建模。

第一版成功标准：

- 用户能通过一句自然语言生成新的策略版本。
- Agent 能在大多数情况下避开明显爆炸危险。
- Agent 能主动收集道具、破墙、追击或防守。
- 对局过程能被前端清楚展示，并能看到 Agent 最近几次决策理由。
- 每局都有可打开的 match record 和 replay，用户能根据证据继续调教下一版策略。

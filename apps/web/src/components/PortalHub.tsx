import {
  Check,
  ClipboardCheck,
  Copy,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCcw,
  Save,
  Sparkles,
  Trophy,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { buildLocalAgentPrompt, parseNaturalLanguageStrategy } from "@agent-poppy/strategy";
import type {
  PortalInstallCommandResponse,
  PortalMeResponse,
  PortalProductApiKeyResponse,
  ProductApiQuotaPolicy,
  ProductApiKeyRecord
} from "@agent-poppy/protocol";
import {
  ApiRequestError,
  portalCreateProductKey,
  portalDevLogin,
  portalGoogleStartUrl,
  portalLogout,
  portalMe,
  portalRevokeProductKey,
  portalSaveProfile,
  portalStrategyTemplates
} from "../api";
import {
  AGENT_SKINS,
  DEFAULT_AGENT_SKIN_ID,
  getAgentSkin,
  getSkinSignature,
  legacyAccessoryFromSkin,
  normalizeAgentSkinId
} from "../skins";
import type { AgentAppearance, LeaderboardRow, MatchRecord } from "../types";

const defaultStrategy =
  "毒圈生存：开局破墙吃道具，毒圈收缩前提前进安全区，确认逃生路线后再压制最近对手。";

const colors = ["#f97316", "#84cc16", "#38bdf8", "#eab308", "#fb7185", "#a78bfa", "#22c55e", "#facc15"];

export function PortalHub({
  matches,
  leaderboard,
  onOpenReplay
}: {
  matches: MatchRecord[];
  leaderboard: LeaderboardRow[];
  onOpenReplay: (match: MatchRecord) => void;
}) {
  const [me, setMe] = useState<PortalMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [devEmail, setDevEmail] = useState("ember@example.com");
  const [agentName, setAgentName] = useState("Ember");
  const [color, setColor] = useState(colors[0] ?? "#f97316");
  const [skinId, setSkinId] = useState(DEFAULT_AGENT_SKIN_ID);
  const [strategyText, setStrategyText] = useState(defaultStrategy);
  const [createdKey, setCreatedKey] = useState<PortalProductApiKeyResponse | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; title: string; tag: string; prompt: string }>>([]);
  const [copied, setCopied] = useState("");
  const [characterModalOpen, setCharacterModalOpen] = useState(false);

  const appearance: AgentAppearance = useMemo(
    () => ({
      color,
      accessory: legacyAccessoryFromSkin(skinId),
      skinId: normalizeAgentSkinId(skinId)
    }),
    [color, skinId]
  );
  const skin = getAgentSkin(appearance.skinId);
  const strategy = useMemo(() => parseNaturalLanguageStrategy(strategyText).strategy, [strategyText]);
  const activeKeys = me?.keys.filter((key) => !key.revokedAt) ?? [];
  const activeKey = activeKeys[0];
  const hasCharacter = Boolean(me?.profile);
  const hasCopiedPrompt = copied === "agent-prompt";
  const hasCopiedKey = copied === "raw-key";
  const hasRuntimeKey = Boolean(activeKey || createdKey);
  const canCopyPrompt = hasCharacter && hasRuntimeKey;
  const install = createdKey?.install ?? null;
  const recentMatches = matches.slice(0, 4);
  const setupSteps = [
    { label: "创建角色", done: hasCharacter, active: true },
    { label: "生成 API key", done: hasRuntimeKey, active: hasCharacter },
    { label: "交给 Agent", done: hasRuntimeKey, active: hasRuntimeKey },
    { label: "复制 Prompt", done: hasCopiedPrompt, active: canCopyPrompt }
  ];

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!me?.profile) return;
    setAgentName(me.profile.agentName);
    setColor(me.profile.appearance.color);
    setSkinId(normalizeAgentSkinId(me.profile.appearance.skinId));
    setStrategyText(me.profile.strategyText);
  }, [me?.profile]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const templateResponse = await portalStrategyTemplates().catch(() => ({ templates: [] }));
      const nextMe = await portalMe();
      setMe(nextMe);
      setTemplates(templateResponse.templates);
    } catch (refreshError) {
      setMe(null);
      if (refreshError instanceof ApiRequestError && refreshError.status === 401) {
        setError("");
      } else {
        setError(errorMessage(refreshError));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loginDev() {
    setError("");
    try {
      const localName = devEmail.split("@")[0]?.trim();
      await portalDevLogin(
        localName ? { email: devEmail, displayName: localName } : { email: devEmail }
      );
      await refresh();
    } catch (loginError) {
      setError(errorMessage(loginError));
    }
  }

  async function logout() {
    await portalLogout();
    setMe(null);
    setCreatedKey(null);
  }

  async function saveProfile() {
    setError("");
    try {
      await portalSaveProfile({ agentName, appearance, strategyText });
      setCharacterModalOpen(false);
      await refresh();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  }

  async function copyPrompt() {
    setError("");
    try {
      await portalSaveProfile({ agentName, appearance, strategyText });
      await copyText("agent-prompt", buildLocalAgentPrompt({ agentName, battlePlan: strategyText }));
      await refresh();
    } catch (copyError) {
      setError(errorMessage(copyError));
    }
  }

  async function randomizeCharacter() {
    const nextSkin = AGENT_SKINS[Math.floor(Math.random() * AGENT_SKINS.length)] ?? getAgentSkin(DEFAULT_AGENT_SKIN_ID);
    const nextColor = colors[Math.floor(Math.random() * colors.length)] ?? "#f97316";
    setSkinId(nextSkin.id);
    setColor(nextColor);
  }

  async function createKey() {
    setError("");
    try {
      const key = await portalCreateProductKey({
        handle: `${agentName || "Agent"} Runtime`,
        provider: "mock"
      });
      setCreatedKey(key);
      await refresh();
    } catch (keyError) {
      setError(errorMessage(keyError));
    }
  }

  async function revokeKey(key: ProductApiKeyRecord) {
    await portalRevokeProductKey(key.id);
    if (createdKey?.id === key.id) {
      setCreatedKey(null);
    }
    await refresh();
  }

  async function copyText(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? "" : current)), 1600);
  }

  if (!me) {
    return (
      <section className="portal-shell">
        <div className="portal-hero">
          <div className="portal-hero-copy">
            <p className="eyebrow">AgentPoppy Developer Preview</p>
            <h1>让你的本地 Agent 进入房间</h1>
            <p>在官网配置角色和战术，生成 API key，再把 AgentPoppy Skill 任务交给 Codex、Claude Code、OpenClaw 或自己的 Agent。</p>
            <div className="portal-login-steps" aria-label="接入流程">
              <span>
                <strong>1</strong>
                创建唯一变色龙
              </span>
              <span>
                <strong>2</strong>
                复制 API key
              </span>
              <span>
                <strong>3</strong>
                复制作战 Prompt 给 Agent
              </span>
            </div>
            <div className="portal-login-card">
              <a className="primary-button" href={portalGoogleStartUrl()}>
                <LogIn size={18} />
                使用 Google 登录
              </a>
              {import.meta.env.DEV ? (
                <div className="portal-dev-login">
                  <input value={devEmail} onChange={(event) => setDevEmail(event.target.value)} />
                  <button type="button" className="secondary-button" onClick={loginDev}>
                    本地 dev-login
                  </button>
                </div>
              ) : null}
              {loading ? <small>正在检查登录状态...</small> : null}
              {error ? <small className="danger-copy">{error}</small> : null}
            </div>
          </div>
          <PortalBattleDemo />
        </div>
      </section>
    );
  }

  return (
    <section className="portal-shell portal-console">
      <div className="portal-topbar">
        <div>
          <p className="eyebrow">AgentPoppy Portal</p>
          <h1>{hasCharacter ? "本地 Agent 接入向导" : "创建你的变色龙"}</h1>
          <p>
            {hasCharacter
              ? "按顺序完成两次复制：先把 API key 和 Skill 任务交给 Agent，再复制作战 Prompt。"
              : "先生成一个会进入战场的唯一角色。保存后会解锁 API key 和 Prompt。"}
          </p>
        </div>
        <div className="portal-user-pill">
          <UserRound size={18} />
          <span>{me.user.displayName}</span>
          <button type="button" className="ghost-button compact" onClick={logout}>
            <LogOut size={15} />
            退出
          </button>
        </div>
      </div>
      <PortalProgress steps={setupSteps} />

      {error ? <div className="portal-alert">{error}</div> : null}

      {!hasCharacter ? (
        <div className="portal-empty-character">
          <div className="portal-empty-stage">
            <div className="portal-empty-frame">
              <Sparkles size={42} />
              <span>等待生成</span>
            </div>
            <div>
              <p className="eyebrow">Step 01</p>
              <h2>创建我的变色龙</h2>
              <p>只需要一个名字和一个随机形象。一个账号只有一个主角色，后续可以重新随机外观。</p>
              <button type="button" className="primary-button" onClick={() => setCharacterModalOpen(true)}>
                <Sparkles size={18} />
                创建角色
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="portal-home-grid">
          <aside className="portal-player-card">
            <span className="portal-card-label">我的角色</span>
            <img src={skin.src} alt="" />
            <div>
              <strong>{agentName}</strong>
              <small>{getSkinSignature(skin)}</small>
            </div>
            <button type="button" className="portal-card-action secondary-button" onClick={() => setCharacterModalOpen(true)}>
              <RefreshCcw size={15} />
              编辑角色
            </button>
          </aside>

          <main className="portal-main-stack">
            <PortalSetupStep
              step="01"
              title="生成 API key 并交给 Agent"
              description="API key 只在创建时显示一次。复制给你信任的本地 Agent，让它通过 AgentPoppy Skill 完成安装和绑定。"
              status={createdKey ? "key 已生成" : activeKey ? "已有 key" : "待生成"}
              active
            >
              <div className="portal-key-console">
                <div className="portal-runtime-note">
                  <span>默认通过 AgentPoppy Skill 接入</span>
                  <small>Claude Code、Codex、OpenClaw 不需要额外模型 API key；只有独立直连 OpenAI/Anthropic runtime 才需要。</small>
                </div>
                <button type="button" className="portal-card-action primary-button" onClick={createKey}>
                  <KeyRound size={17} />
                  {activeKey && !createdKey ? "创建新的 API key" : "生成 API key"}
                </button>
              </div>

              {createdKey ? (
                <div className="portal-secret-box portal-secret-box-large">
                  <span>API key 只显示这一次</span>
                  <code>{createdKey.key}</code>
                  <button type="button" className="portal-card-action primary-button" onClick={() => void copyText("raw-key", createdKey.key)}>
                    {hasCopiedKey ? <Check size={17} /> : <Copy size={17} />}
                    {hasCopiedKey ? "API key 已复制" : "复制 API key"}
                  </button>
                </div>
              ) : (
                <div className="portal-muted-box">
                  {activeKey
                    ? "你已经有 active key。旧 key 不会再次显示；如果没有保存，直接创建新的 key。"
                    : "先生成 key，再把 API key 和 Skill 任务复制给本地 Agent。"}
                </div>
              )}

              {install || activeKey ? (
                <AgentPackCardGrid
                  install={install ?? null}
                  agentName={agentName}
                  strategyText={strategyText}
                  copied={copied}
                  onCopy={copyText}
                />
              ) : null}
              <PortalQuotaSummary quotas={me.quotas ?? []} />

              <details className="portal-secondary-details">
                <summary>Key 管理</summary>
                <div className="portal-key-list">
                  {me.keys.map((key) => (
                    <div key={key.id} className={key.revokedAt ? "revoked" : ""}>
                      <span>
                        <strong>{key.handle}</strong>
                        <small>
                          {key.id} · {keyStatus(key)} · 创建 {formatDate(key.createdAt)}
                          {key.lastUsedAt ? ` · 最近使用 ${formatDate(key.lastUsedAt)}` : " · 从未使用"}
                        </small>
                      </span>
                      {!key.revokedAt ? (
                        <button type="button" className="ghost-button compact" onClick={() => void revokeKey(key)}>
                          吊销
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            </PortalSetupStep>

            <PortalSetupStep
              step="02"
              title="复制作战策略"
              description="本地 Agent 接入后，再把这段 Prompt 复制给 Agent，让它知道怎么打。"
              status={hasCopiedPrompt ? "Prompt 已复制" : canCopyPrompt ? "待复制" : "先完成接入"}
              active={canCopyPrompt}
            >
              {canCopyPrompt ? (
                <>
                  <div className="portal-template-strip">
                    {templates.map((template) => (
                      <button key={template.id} type="button" onClick={() => setStrategyText(template.prompt)}>
                        <span>{template.tag}</span>
                        <strong>{template.title}</strong>
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={strategyText}
                    onChange={(event) => setStrategyText(event.target.value)}
                    rows={4}
                    placeholder="例：优先进安全区，拿到道具后再靠近最近对手。"
                  />
                  <div className="portal-brief-row">
                    <PortalRadar strategy={strategy} />
                  </div>
                  <button type="button" className="portal-card-action primary-button" onClick={() => void copyPrompt()}>
                    {hasCopiedPrompt ? <Check size={17} /> : <ClipboardCheck size={17} />}
                    {hasCopiedPrompt ? "Prompt 已复制" : "保存并复制 Prompt"}
                  </button>
                </>
              ) : (
                <div className="portal-muted-box">先完成上一步：创建 API key，并把 Skill 任务复制给本地 Agent。</div>
              )}
            </PortalSetupStep>

            <div className="portal-info-grid">
              <PortalMatchList matches={recentMatches} agentName={agentName} onOpenReplay={onOpenReplay} />
              <PortalLeaderboard leaderboard={leaderboard} />
            </div>
          </main>
        </div>
      )}

      {characterModalOpen ? (
        <CharacterModal
          agentName={agentName}
          color={color}
          skin={skin}
          onNameChange={setAgentName}
          onColorChange={setColor}
          onRandomize={() => void randomizeCharacter()}
          onClose={() => setCharacterModalOpen(false)}
          onSave={() => void saveProfile()}
          saveLabel={hasCharacter ? "保存角色" : "创建角色"}
        />
      ) : null}
    </section>
  );
}

function PortalBattleDemo() {
  const combatants = [
    { name: "Ember", code: "#101", src: "/skins/social-chameleon/101.png", className: "ember", status: "Ready" },
    { name: "Mesa", code: "#4", src: "/skins/social-chameleon/4.png", className: "mesa", status: "Ready" },
    { name: "Volt", code: "#377", src: "/skins/social-chameleon/377.png", className: "volt", status: "Ready" }
  ];
  const hardTiles = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 23, 24, 32, 40, 48, 56, 64, 72, 73, 74, 75, 76, 77, 78, 79, 80]);
  const softTiles = new Set([12, 13, 21, 29, 34, 35, 37, 43, 45, 51, 52, 60, 67, 69]);

  return (
    <div className="portal-battle-demo portal-lobby-demo" aria-label="AgentPoppy 等待开局展示">
      <div className="portal-lobby-panel">
        <header className="portal-lobby-header">
          <div>
            <span>ROOM LOCAL</span>
            <strong>等待 Agent 加入</strong>
          </div>
          <small>3/4 Ready</small>
        </header>

        <div className="portal-lobby-map" aria-hidden="true">
          {Array.from({ length: 81 }).map((_, index) => (
            <span key={index} className={`portal-lobby-tile ${hardTiles.has(index) ? "hard" : softTiles.has(index) ? "soft" : ""}`} />
          ))}
          <span className="portal-lobby-safe-zone" />
          <span className="portal-lobby-route route-one" />
          <span className="portal-lobby-route route-two" />
          <span className="portal-lobby-bomb bomb-one" />
          <span className="portal-lobby-bomb bomb-two" />
          {combatants.map((agent, index) => (
            <span key={agent.name} className={`portal-lobby-blip ${agent.className}`} style={{ "--delay": `${index * 0.16}s` } as CSSProperties}>
              <img src={agent.src} alt="" />
            </span>
          ))}
        </div>

        <div className="portal-lobby-roster">
          {combatants.map((agent, index) => (
            <div key={agent.name} className="portal-lobby-slot ready" style={{ "--delay": `${index * 0.1}s` } as CSSProperties}>
              <img src={agent.src} alt="" />
              <div>
                <strong>{agent.name}</strong>
                <small>
                  {agent.status} · {agent.code}
                </small>
              </div>
            </div>
          ))}
          <div className="portal-lobby-slot waiting">
            <span className="portal-lobby-empty">
              <span />
            </span>
            <div>
              <strong>等待加入</strong>
              <small>复制任务给本地 Agent</small>
            </div>
          </div>
        </div>

        <footer className="portal-lobby-footer">
          <span>
            <i />
            本地 Agent 接入中
          </span>
          <strong>准备开局</strong>
        </footer>
      </div>
    </div>
  );
}

function PortalProgress({
  steps
}: {
  steps: Array<{ label: string; done: boolean; active: boolean }>;
}) {
  return (
    <div className="portal-progress" aria-label="接入进度">
      {steps.map((step, index) => (
        <span
          key={step.label}
          className={`${step.done ? "done" : ""} ${step.active ? "active" : ""}`}
        >
          <strong>{step.done ? <Check size={15} /> : index + 1}</strong>
          {step.label}
        </span>
      ))}
    </div>
  );
}

function PortalSetupStep({
  step,
  title,
  description,
  status,
  active,
  children
}: {
  step: string;
  title: string;
  description: string;
  status: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`portal-setup-step ${active ? "active" : ""}`}>
      <div className="portal-step-head">
        <span>{step}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <small>{status}</small>
      </div>
      {children}
    </section>
  );
}

function CharacterModal({
  agentName,
  color,
  skin,
  onNameChange,
  onColorChange,
  onRandomize,
  onClose,
  onSave,
  saveLabel
}: {
  agentName: string;
  color: string;
  skin: ReturnType<typeof getAgentSkin>;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  onRandomize: () => void;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
}) {
  return (
    <div className="portal-modal-backdrop" role="presentation">
      <section className="portal-character-modal" role="dialog" aria-modal="true" aria-labelledby="character-modal-title">
        <button type="button" className="portal-modal-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <div className="portal-modal-art">
          <img src={skin.src} alt="" />
          <span>#{skin.id.replace(/\D/g, "") || "001"}</span>
        </div>
        <div className="portal-modal-form">
          <p className="eyebrow">唯一主形象</p>
          <h2 id="character-modal-title">创建我的变色龙</h2>
          <p>随机服装、眼镜和嘴部，输入一个会显示在战场上的名字。</p>
          <label className="field-label">
            <span>角色名</span>
            <input value={agentName} maxLength={32} onChange={(event) => onNameChange(event.target.value)} />
          </label>
          <div className="portal-color-row">
            {colors.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={candidate === color ? "active" : ""}
                style={{ "--swatch": candidate } as CSSProperties}
                onClick={() => onColorChange(candidate)}
                aria-label={candidate}
              />
            ))}
          </div>
          <div className="portal-modal-actions">
            <button type="button" className="secondary-button" onClick={onRandomize}>
              <RefreshCcw size={17} />
              随机形象
            </button>
            <button type="button" className="primary-button" onClick={onSave}>
              <Save size={18} />
              {saveLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PortalRadar({ strategy }: { strategy: ReturnType<typeof parseNaturalLanguageStrategy>["strategy"] }) {
  const metrics = [
    { label: "攻击", value: strategy.aggression },
    { label: "生存", value: strategy.safety },
    { label: "道具", value: strategy.itemBias },
    { label: "逃生", value: Math.min(1, strategy.tactics.escapeMarginTicks / 12) },
    { label: "破墙", value: strategy.wallBias }
  ];
  const points = metrics.map((metric, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / metrics.length;
    return `${112 + Math.cos(angle) * 74 * metric.value},${112 + Math.sin(angle) * 74 * metric.value}`;
  });
  return (
    <div className="portal-radar-wrap">
      <svg viewBox="0 0 224 224" className="portal-radar" aria-label="策略雷达图">
        {[0.33, 0.66, 1].map((level) => (
          <polygon
            key={level}
            points={metrics
              .map((_, index) => {
                const angle = -Math.PI / 2 + (index * Math.PI * 2) / metrics.length;
                return `${112 + Math.cos(angle) * 74 * level},${112 + Math.sin(angle) * 74 * level}`;
              })
              .join(" ")}
          />
        ))}
        <polygon className="portal-radar-shape" points={points.join(" ")} />
      </svg>
      <div>
        {metrics.map((metric) => (
          <span key={metric.label}>
            <small>{metric.label}</small>
            <strong>{Math.round(metric.value * 100)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentPackCardGrid({
  install,
  agentName,
  strategyText,
  copied,
  onCopy
}: {
  install: PortalInstallCommandResponse | null;
  agentName: string;
  strategyText: string;
  copied: string;
  onCopy: (id: string, text: string) => Promise<void>;
}) {
  const cards = [
    {
      id: "codex",
      label: "Codex",
      title: "用 Skill 接入项目",
      description: "让 Codex 使用 AgentPoppy skill，完成授权确认、配置写入、Prompt 预览和本地自检。"
    },
    {
      id: "claude",
      label: "Claude Code",
      title: "复制任务说明",
      description: "给 Claude Code 一段安全边界明确的接入指令，关键写入动作会停下来确认。"
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      title: "本地 Agent 接入",
      description: "让 OpenClaw 按同样流程接入角色、API key、Prompt 模板和房间验证。"
    }
  ] as const;

  return (
    <div className="agent-pack-grid" aria-label="复制给本地 Agent">
      <div className="agent-pack-intro">
        <span>给我的 Agent</span>
        <strong>复制一段任务，它就知道怎么接入 AgentPoppy。</strong>
        <small>这段内容可能包含刚生成的 API key，只发给你信任的本地 Agent。</small>
      </div>
      {cards.map((card) => {
        const copyId = `agent-pack-${card.id}`;
        return (
          <button
            key={card.id}
            type="button"
            className="agent-pack-card"
            onClick={() => void onCopy(copyId, buildAgentPackInstruction(card.id, install, agentName, strategyText))}
          >
            <span>{card.label}</span>
            <strong>{card.title}</strong>
            <small>{copied === copyId ? "已复制到剪贴板" : card.description}</small>
          </button>
        );
      })}
    </div>
  );
}

function buildAgentPackInstruction(
  target: "codex" | "claude" | "openclaw",
  install: PortalInstallCommandResponse | null,
  agentName: string,
  strategyText: string
): string {
  const platformIntro =
    target === "codex"
      ? "Use the AgentPoppy skill. If it is not installed yet, install it from the skill source below."
      : target === "claude"
        ? "Use these AgentPoppy instructions in Claude Code."
        : "Use these AgentPoppy instructions in OpenClaw.";
  const cloudUrl = install?.cloudUrl ?? window.location.origin;
  const localUrl = install?.baseUrl ?? "http://127.0.0.1:3001";
  return [
    "Set up AgentPoppy for my local Agent.",
    "",
    platformIntro,
    "",
    "Rules:",
    "1. Do not print raw Product API keys or provider keys back to chat.",
    "2. Ask me to paste the Product API key separately; do not infer it from browser content.",
    "3. Before applying any battle Prompt, preview the final strategy and ask for confirmation.",
    "4. Do not ask for OPENAI_API_KEY or ANTHROPIC_API_KEY for Claude Code/Codex/OpenClaw setup.",
    "5. Provider keys are only needed if I explicitly choose standalone OpenAI or Anthropic API runtime mode.",
    "6. Ask before creating, joining, readying, starting, cancelling, or leaving a room.",
    "",
    `Agent name: ${agentName}`,
    "Runtime mode: Agent Skill + local connection check first",
    `Cloud URL: ${cloudUrl}`,
    `Local URL: ${localUrl}`,
    "",
    "Use the AgentPoppy skill as the setup entry point.",
    "Skill source: https://github.com/nooqle/AgentPoppy/tree/main/skills/agent-poppy",
    "After the skill is available, ask for confirmation before it writes local settings.",
    "",
    "Battle strategy to preview before applying:",
    "```text",
    strategyText,
    "```",
    "",
    "Run the local connection self-check first. It does not call OpenAI or Anthropic:",
    "```powershell",
    "pnpm agent:setting sync",
    "pnpm agent:setting check",
    "pnpm agent:templates",
    "pnpm agent:template prompt zoneHunter --agent " + shellWord(agentName),
    "pnpm agent:mock",
    "```"
  ].join("\n");
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function PortalMatchList({
  matches,
  agentName,
  onOpenReplay
}: {
  matches: MatchRecord[];
  agentName: string;
  onOpenReplay: (match: MatchRecord) => void;
}) {
  return (
    <section className="portal-info-card">
      <div className="portal-info-head">
        <h2>最近对局</h2>
        <small>时间、参赛者、赢家、我的名次</small>
      </div>
      {matches.length === 0 ? <p className="portal-empty-note">还没有对局。本地 Agent 接入后开一局，这里会出现战报。</p> : null}
      {matches.map((match) => (
        <button key={match.id} type="button" className="portal-match-row" onClick={() => onOpenReplay(match)}>
          <span>
            <strong>{formatDate(match.createdAt)}</strong>
            <small>{participantsFor(match).map((participant) => participant.name).join(" / ") || "暂无参赛信息"}</small>
          </span>
          <span>
            <strong>{winnerName(match)}</strong>
            <small>{myPlacement(match, agentName)}</small>
          </span>
        </button>
      ))}
    </section>
  );
}

function PortalLeaderboard({ leaderboard }: { leaderboard: LeaderboardRow[] }) {
  return (
    <section className="portal-info-card">
      <div className="portal-info-head">
        <h2>排行榜</h2>
        <small>按胜率展示本地战绩</small>
      </div>
      {leaderboard.length === 0 ? <p className="portal-empty-note">暂无排行。</p> : null}
      {leaderboard.slice(0, 5).map((row, index) => (
        <div key={row.agentId} className="portal-rank-row">
          <span>
            <Trophy size={15} />
            <strong>{index + 1}</strong>
            {row.name}
          </span>
          <small>{Math.round(row.winRate * 100)}% · {row.matches} 场</small>
        </div>
      ))}
    </section>
  );
}

function PortalQuotaSummary({ quotas }: { quotas: ProductApiQuotaPolicy[] }) {
  if (quotas.length === 0) {
    return null;
  }
  return (
    <div className="portal-quota-strip" aria-label="API key 使用量">
      {quotas.slice(0, 5).map((quota) => (
        <span key={quota.key}>
          <small>{quotaLabel(quota)}</small>
          <strong>{quota.limit === null ? `${quota.used ?? 0} / 无限` : `${quota.used ?? 0} / ${quota.limit}`}</strong>
        </span>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function keyStatus(key: ProductApiKeyRecord): string {
  if (key.revokedAt) return "已吊销";
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return "已过期";
  return "active";
}

function quotaLabel(quota: ProductApiQuotaPolicy): string {
  if (quota.key === "character_randomize") return "随机形象";
  if (quota.key === "room_create") return "创建房间";
  if (quota.key === "template_read") return "读取模板";
  if (quota.key === "template_apply") return "应用模板";
  if (quota.key === "bridge_prompt") return "Agent 调用";
  return quota.label;
}

function winnerName(match: MatchRecord): string {
  if (!match.winnerAgentId) return "未决出";
  return participantsFor(match).find((participant) => participant.agentId === match.winnerAgentId)?.name ?? match.winnerAgentId;
}

function myPlacement(match: MatchRecord, agentName: string): string {
  const sorted = [...participantsFor(match)].sort((left, right) => {
    if (left.survived !== right.survived) return left.survived ? -1 : 1;
    return right.score - left.score;
  });
  const index = sorted.findIndex((participant) => participant.name.toLowerCase() === agentName.toLowerCase());
  return index >= 0 ? `我第 ${index + 1}` : "我未参赛";
}

function participantsFor(match: MatchRecord): NonNullable<MatchRecord["participants"]> {
  return match.participants ?? [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

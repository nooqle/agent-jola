import {
  Check,
  Copy,
  Gauge,
  History,
  ListChecks,
  Palette,
  Play,
  Save,
  Sparkles,
  Swords,
  Trophy,
  X
} from "lucide-react";
import {
  PROMPT_SNIPPET_IDS,
  STRATEGY_PROMPT_TEMPLATE_IDS,
  appendPromptSnippet,
  buildLocalAgentPrompt,
  parseNaturalLanguageStrategy,
  type AgentStrategy
} from "@agent-poppy/strategy";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../i18n";
import {
  AGENT_SKINS,
  DEFAULT_AGENT_SKIN_ID,
  agentSkinByIndex,
  getAgentSkin,
  getSkinSignature,
  legacyAccessoryFromSkin,
  normalizeAgentSkinId
} from "../skins";
import type {
  AgentAppearance,
  AgentProfile,
  AgentStrategyVersion,
  LeaderboardRow,
  MapPresetId,
  MatchRecord,
  ServerMode
} from "../types";

interface WorkbenchProps {
  agents: AgentProfile[];
  strategies: AgentStrategyVersion[];
  matches: MatchRecord[];
  leaderboard: LeaderboardRow[];
  mode: ServerMode;
  onCreateAgent: (name: string, appearance?: AgentAppearance) => Promise<void>;
  onUpdateAgent: (
    agentId: string,
    updates: { name?: string; appearance?: AgentAppearance }
  ) => Promise<void>;
  onSaveStrategy: (agentId: string, prompt: string) => Promise<void>;
  onStartMatch: (agentIds: string[], mapId: MapPresetId) => Promise<void>;
  onOpenReplay: (match: MatchRecord) => void;
}

type LobbySection = "battle" | "character" | "strategy" | "ranking";

interface MatchmakingState {
  agentIds: string[];
  elapsed: number;
  mapId: MapPresetId;
}

export function Workbench({
  agents,
  strategies,
  matches,
  leaderboard,
  mode,
  onUpdateAgent,
  onSaveStrategy,
  onStartMatch,
  onOpenReplay
}: WorkbenchProps) {
  const { t } = useI18n();
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [characterName, setCharacterName] = useState(agents[0]?.name ?? "");
  const [characterColor, setCharacterColor] = useState(agents[0]?.color ?? DEFAULT_AGENT_COLOR);
  const [characterSkinId, setCharacterSkinId] = useState(
    agents[0]?.appearance.skinId ?? DEFAULT_AGENT_SKIN_ID
  );
  const [randomizeCount, setRandomizeCount] = useState(0);
  const [strategyPrompt, setStrategyPrompt] = useState(t("workbench.defaultPrompt"));
  const [selectedMapId, setSelectedMapId] = useState<MapPresetId>("royale");
  const [activeSection, setActiveSection] = useState<LobbySection>("battle");
  const [matchmaking, setMatchmaking] = useState<MatchmakingState | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  useEffect(() => {
    if (!selectedAgent) return;
    setCharacterName(selectedAgent.name);
    setCharacterColor(selectedAgent.color);
    setCharacterSkinId(normalizeAgentSkinId(selectedAgent.appearance.skinId));
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    const stored = window.localStorage.getItem(randomizeStorageKey(selectedAgent.id));
    setRandomizeCount(stored ? Number(stored) || 0 : 0);
  }, [selectedAgent]);

  const currentStrategy = useMemo(
    () =>
      selectedAgent
        ? (strategies.find((strategy) => strategy.id === selectedAgent.currentStrategyVersionId) ??
          strategies.find((strategy) => strategy.agentId === selectedAgent.id))
        : undefined,
    [selectedAgent, strategies]
  );

  const compiledStrategy = useMemo(
    () => parseNaturalLanguageStrategy(strategyPrompt).strategy,
    [strategyPrompt]
  );
  const characterSkin = getAgentSkin(characterSkinId);
  const appearanceTraits = useMemo(() => getAppearanceTraitSummary(characterSkin), [characterSkin]);
  const recentRoyaleMatches = useMemo(
    () =>
      matches
        .filter((match) => match.mapId === "royale" && match.participantIds.length === 4)
        .slice(0, 6),
    [matches]
  );
  const matchParticipantIds = useMemo(
    () => buildMatchParticipantIds(selectedAgent?.id, agents),
    [agents, selectedAgent]
  );
  const hasCharacterSetup = Boolean(selectedAgent?.appearance?.skinId);
  const hasStrategySetup = Boolean(selectedAgent && currentStrategy);
  const canStart = hasCharacterSetup && hasStrategySetup && matchParticipantIds.length === 4;
  const queueReadyCount = matchmaking ? Math.min(4, 1 + matchmaking.elapsed) : 0;
  useEffect(() => {
    if (!matchmaking) return;
    const id = window.setInterval(() => {
      setMatchmaking((current) =>
        current ? { ...current, elapsed: current.elapsed + 1 } : current
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [matchmaking]);

  useEffect(() => {
    if (!matchmaking || matchmaking.elapsed < MATCHMAKING_SECONDS) return;
    const nextMatch = matchmaking;
    setMatchmaking(null);
    void onStartMatch(nextMatch.agentIds, nextMatch.mapId);
  }, [matchmaking, onStartMatch]);

  const randomizeCharacter = () => {
    if (!selectedAgent) return;
    const appearance = chooseRandomAppearance(characterSkinId);
    const nextCount = randomizeCount + 1;
    window.localStorage.setItem(randomizeStorageKey(selectedAgent.id), String(nextCount));
    setRandomizeCount(nextCount);
    setCharacterColor(appearance.color);
    setCharacterSkinId(appearance.skinId);
    void onUpdateAgent(selectedAgent.id, {
      name: characterName || selectedAgent.name,
      appearance
    });
  };

  const saveCharacter = () => {
    if (!selectedAgent) return;
    const skinId = normalizeAgentSkinId(characterSkinId);
    void onUpdateAgent(selectedAgent.id, {
      name: characterName,
      appearance: {
        color: characterColor,
        accessory: legacyAccessoryFromSkin(skinId),
        skinId
      }
    });
  };

  const enterMatchmaking = () => {
    if (!canStart) return;
    setActiveSection("battle");
    setMatchmaking({ agentIds: [...matchParticipantIds], elapsed: 0, mapId: selectedMapId });
  };

  const copyAgentPrompt = async (id: string, prompt: string) => {
    const ok = await copyToClipboard(prompt);
    if (!ok) return;
    setCopiedPromptId(id);
    window.setTimeout(
      () => setCopiedPromptId((current) => (current === id ? null : current)),
      1600
    );
  };

  const lobbySections: Array<{ icon: ReactNode; id: LobbySection }> = [
    { id: "battle", icon: <Swords size={18} /> },
    { id: "character", icon: <Palette size={18} /> },
    { id: "strategy", icon: <ListChecks size={18} /> },
    { id: "ranking", icon: <Trophy size={18} /> }
  ];

  return (
    <section className="workbench game-lobby">
      <div className="topline lobby-topline">
        <div>
          <p className="eyebrow">{t("workbench.eyebrow")}</p>
          <h1>{t("workbench.title")}</h1>
          <p>{t("workbench.subtitle")}</p>
        </div>
        <div className={`server-badge ${mode}`}>
          <span />
          {mode === "live"
            ? t("server.live")
            : mode === "checking"
              ? t("server.checking")
              : t("server.mock")}
        </div>
      </div>

      <div className="lobby-shell">
        <nav className="lobby-nav" aria-label={t("workbench.title")}>
          {lobbySections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? "active" : ""}
              disabled={Boolean(matchmaking) && section.id !== "battle"}
              onClick={() => setActiveSection(section.id)}
            >
              {section.icon}
              <span>
                <strong>{t(`workbench.nav.${section.id}`)}</strong>
                <small>{t(`workbench.nav.${section.id}Hint`)}</small>
              </span>
            </button>
          ))}
        </nav>

        <main className={`lobby-stage lobby-stage-${activeSection}`}>
          <div className="lobby-stage-header">
            <div>
              <span>{t(`workbench.nav.${activeSection}`)}</span>
              <h2>{t(`workbench.stage.${activeSection}.title`)}</h2>
              <p>{t(`workbench.stage.${activeSection}.desc`)}</p>
            </div>
          </div>

          {activeSection === "character" && selectedAgent ? (
            <>
              <section className="character-single-strip">
                <div className="lobby-mini-heading">
                  <strong>{t("workbench.myChameleon")}</strong>
                </div>
                <p>{t("workbench.characterRandomHint")}</p>
              </section>
              <div className="module-layout character-module single-character-module">
                <section className="module-panel character-showcase">
                  <PixelAgentAvatar
                    agent={{
                      ...selectedAgent,
                      name: characterName || selectedAgent.name,
                      color: characterColor,
                      accessory: legacyAccessoryFromSkin(characterSkinId),
                      appearance: {
                        color: characterColor,
                        accessory: legacyAccessoryFromSkin(characterSkinId),
                        skinId: characterSkinId
                      }
                    }}
                    size="display"
                  />
                  <div>
                    <strong>{characterName || selectedAgent.name}</strong>
                    <small>{getSkinSignature(characterSkin)}</small>
                  </div>
                </section>

                <section className="module-panel character-editor">
                  <label className="field-label">
                    <span>{t("workbench.characterName")}</span>
                    <input
                      value={characterName}
                      onChange={(event) => setCharacterName(event.target.value)}
                    />
                  </label>
                  <div className="skin-trait-card">
                    <div className="skin-trait-heading">
                      <strong>{t("workbench.characterTraits")}</strong>
                      <small>{t("workbench.characterTraitsHint")}</small>
                    </div>
                    <div className="skin-trait-list">
                      {appearanceTraits.map((trait) => (
                        <span key={`${characterSkin.id}-${trait.key}`}>
                          <small>{t(`appearanceTrait.${trait.key}`)}</small>
                          <strong>{trait.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="character-actions">
                    <button
                      type="button"
                      className="primary-button compact"
                      onClick={randomizeCharacter}
                    >
                      <Sparkles size={16} />
                      {t("workbench.randomAppearance")}
                      <small>{t("workbench.randomUnlimited")}</small>
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={saveCharacter}
                    >
                      <Save size={16} />
                      {t("workbench.saveCharacter")}
                    </button>
                  </div>
                  <p className="random-lock-copy">
                    {t("workbench.randomPaidHint")}
                  </p>
                </section>
              </div>
            </>
          ) : null}

          {activeSection === "strategy" ? (
            <div className="module-layout strategy-module">
              <section className="module-panel">
                <div className="strategy-templates">
                  <div className="template-heading">
                    <strong>{t("workbench.promptTemplateLibrary")}</strong>
                    <small>{t("workbench.promptTemplateLibraryHint")}</small>
                  </div>
                  <div className="agent-prompt-template-grid">
                    {STRATEGY_PROMPT_TEMPLATE_IDS.map((id) => (
                      <article
                        key={id}
                        className={`agent-prompt-template ${copiedPromptId === id ? "copied" : ""}`}
                      >
                        <div className="agent-prompt-template-head">
                          <span>{t(`workbench.template.${id}.tag`)}</span>
                          <strong>{t(`workbench.template.${id}.title`)}</strong>
                          <small>{t(`workbench.template.${id}.summary`)}</small>
                        </div>
                        <p>{t(`workbench.template.${id}.prompt`)}</p>
                        <div className="template-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setStrategyPrompt(t(`workbench.template.${id}.prompt`))}
                          >
                            {t("workbench.applyTemplate")}
                          </button>
                          <button
                            type="button"
                            className="primary-button compact"
                            onClick={() =>
                              void copyAgentPrompt(
                                id,
                                buildLocalAgentPrompt({
                                  agentName: characterName || selectedAgent?.name || "Agent",
                                  battlePlan: t(`workbench.template.${id}.prompt`),
                                  runtimeHint: t("workbench.externalPrompt.runtimeHint"),
                                  languageNote: t("workbench.externalPrompt.languageNote")
                                })
                              )
                            }
                          >
                            {copiedPromptId === id ? <Check size={16} /> : <Copy size={16} />}
                            {copiedPromptId === id
                              ? t("workbench.copied")
                              : t("workbench.copyForAgent")}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <textarea
                  value={strategyPrompt}
                  onChange={(event) => setStrategyPrompt(event.target.value)}
                  rows={5}
                  placeholder={t("workbench.strategyPlaceholder")}
                />
                <div className="strategy-action-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!selectedAgent}
                    onClick={() => {
                      if (!selectedAgent) return;
                      void onSaveStrategy(selectedAgent.id, strategyPrompt);
                    }}
                  >
                    <Save size={18} />
                    {t("workbench.saveVersion")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!strategyPrompt.trim()}
                    onClick={() =>
                      void copyAgentPrompt(
                        "current",
                        buildLocalAgentPrompt({
                          agentName: characterName || selectedAgent?.name || "Agent",
                          battlePlan: strategyPrompt,
                          runtimeHint: t("workbench.externalPrompt.runtimeHint"),
                          languageNote: t("workbench.externalPrompt.languageNote")
                        })
                      )
                    }
                  >
                    {copiedPromptId === "current" ? <Check size={18} /> : <Copy size={18} />}
                    {copiedPromptId === "current"
                      ? t("workbench.copied")
                      : t("workbench.copyCurrentForAgent")}
                  </button>
                </div>
                <div className="prompt-guide">
                  <div className="template-heading">
                    <strong>{t("workbench.promptGuide")}</strong>
                    <small>{t("workbench.promptGuideHint")}</small>
                  </div>
                  <div className="snippet-grid">
                    {PROMPT_SNIPPET_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="snippet-chip"
                        onClick={() =>
                          setStrategyPrompt((current) =>
                            appendPromptSnippet(current, t(`workbench.snippet.${id}.text`))
                          )
                        }
                      >
                        {t(`workbench.snippet.${id}.label`)}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <section className="module-panel">
                <StrategyCompilerPreview strategy={compiledStrategy} />
              </section>
            </div>
          ) : null}

          {activeSection === "battle" ? (
            <div className="module-layout battle-module">
              {matchmaking ? (
                <section className="module-panel matchmaking-panel">
                  <div className="queue-pulse" aria-hidden="true">
                    <span />
                  </div>
                  <div>
                    <span>{t("workbench.matchmakingTitle")}</span>
                    <h3>{t("workbench.matchmakingReady", { count: queueReadyCount })}</h3>
                    <p>{t("workbench.matchmakingHint")}</p>
                  </div>
                  <div className="queue-slots">
                    {matchmaking.agentIds.map((agentId, index) => {
                      const agent = agents.find((candidate) => candidate.id === agentId);
                      return (
                        <span key={agentId} className={index < queueReadyCount ? "ready" : ""}>
                          {agent ? <PixelAgentAvatar agent={agent} size="tiny" /> : null}
                          {agent?.name ?? agentId}
                        </span>
                      );
                    })}
                  </div>
                  <small>{t("workbench.queueTip")}</small>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setMatchmaking(null)}
                  >
                    <X size={18} />
                    {t("workbench.cancelMatchmaking")}
                  </button>
                </section>
              ) : (
                <>
                  <section className="battle-showcase" aria-label={t("workbench.readySquad")}>
                    {canStart && selectedAgent ? (
                      <div className="solo-stage">
                        <div className="squad-member solo-member">
                          <PixelAgentAvatar agent={selectedAgent} size="display" />
                          <strong>{selectedAgent.name}</strong>
                          <small>{t("workbench.matchOpponents")}</small>
                        </div>
                      </div>
                    ) : (
                      <div className="setup-gate">
                        <strong>{t("workbench.setupRequiredTitle")}</strong>
                        <p>{t("workbench.setupRequiredDesc")}</p>
                        <div>
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setActiveSection("character")}
                          >
                            <Palette size={16} />
                            {t("workbench.goCharacterSetup")}
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setActiveSection("strategy")}
                          >
                            <ListChecks size={16} />
                            {t("workbench.goStrategySetup")}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="battle-command-rail">
                    <div className="battle-mode-summary">
                      <span>{t("workbench.roomCode")}</span>
                      <strong>{t("workbench.roomModeFour")}</strong>
                      <small>{t("workbench.roomModeRoyaleHint")}</small>
                    </div>
                    <div className="map-select-compact">
                      {MAP_PRESET_IDS.map((mapId) => (
                        <button
                          key={mapId}
                          type="button"
                          className={`map-card ${selectedMapId === mapId ? "active" : ""}`}
                          onClick={() => setSelectedMapId(mapId)}
                        >
                          <MapMini mapId={mapId} />
                          <span>
                            <strong>{t(`map.${mapId}.name`)}</strong>
                            <small>{t(`map.${mapId}.summary`)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="squad-loadout" aria-label={t("workbench.readySquad")}>
                      {selectedAgent ? (
                        <span className="squad-slot">
                          <PixelAgentAvatar agent={selectedAgent} size="tiny" />
                          {selectedAgent.name}
                        </span>
                      ) : null}
                      <span className="squad-slot muted-slot">{t("workbench.opponentSlots")}</span>
                      <small>
                        {t("workbench.roomSelected", { count: matchParticipantIds.length, max: 4 })}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="primary-button start-button"
                      disabled={!canStart}
                      onClick={enterMatchmaking}
                    >
                      <Play size={18} />
                      {canStart ? t("workbench.enterQueue") : t("workbench.startLocked")}
                    </button>
                  </section>
                </>
              )}
            </div>
          ) : null}

          {activeSection === "ranking" ? (
            <div className="module-layout ranking-module">
              <section className="module-panel">
                <div className="panel-heading">
                  <Trophy size={18} />
                  <h2>{t("workbench.leaderboard")}</h2>
                </div>
                <div className="leaderboard-list">
                  {leaderboard.map((row, index) => (
                    <div key={row.agentId} className="leaderboard-row">
                      <span className="rank">{index + 1}</span>
                      <strong>{row.name}</strong>
                      <span>{Math.round(row.winRate * 100)}%</span>
                      <small>{row.rating}</small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="module-panel">
                <div className="panel-heading">
                  <History size={18} />
                  <h2>{t("workbench.recentMatches")}</h2>
                </div>
                <div className="match-list">
                  {recentRoyaleMatches.length === 0 ? (
                    <p className="empty-copy">{t("workbench.emptyMatches")}</p>
                  ) : null}
                  {recentRoyaleMatches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      className="match-row match-report-row"
                      onClick={() => onOpenReplay(match)}
                    >
                      <span className={`status-dot ${match.status}`} />
                      <span>
                        <strong>{match.id}</strong>
                        <MatchReportMeta
                          match={match}
                          agents={agents}
                          myAgentId={selectedAgent?.id}
                        />
                      </span>
                      <Gauge size={16} />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </section>
  );
}

const MAP_PRESET_IDS: MapPresetId[] = ["royale"];
const SKIN_COLOR_SWATCHES = [
  "#f97316",
  "#84cc16",
  "#38bdf8",
  "#eab308",
  "#fb7185",
  "#a78bfa",
  "#22c55e",
  "#facc15"
];
const DEFAULT_AGENT_COLOR = "#f97316";
const MATCHMAKING_SECONDS = 5;

function StrategyCompilerPreview({ strategy }: { strategy: AgentStrategy }) {
  const { t } = useI18n();
  const visibleNotes = strategy.notes.length > 5 ? strategy.notes.slice(-5) : strategy.notes;
  const metrics = getStrategyRadarMetrics(strategy, t);

  return (
    <div className="prompt-preview">
      <div className="template-heading">
        <strong>{t("workbench.strategyRadarTitle")}</strong>
        <small>{t("workbench.strategyRadarHint")}</small>
      </div>
      <StrategyRadar metrics={metrics} />
      <div className="radar-matrix-grid">
        {metrics.map((metric) => (
          <span key={metric.key}>
            <small>{metric.label}</small>
            <strong>{Math.round(metric.value * 100)}</strong>
          </span>
        ))}
      </div>
      <div className="compiler-notes">
        {visibleNotes.map((note) => (
          <small key={note}>{note}</small>
        ))}
      </div>
    </div>
  );
}

function StrategyRadar({
  metrics
}: {
  metrics: Array<{ key: string; label: string; value: number }>;
}) {
  const center = 112;
  const radius = 76;
  const levels = [0.33, 0.66, 1];
  const axes = metrics.map((_, index) => radarPoint(index, 1, metrics.length, center, radius));
  const polygon = metrics.map((metric, index) =>
    radarPoint(index, metric.value, metrics.length, center, radius)
  );

  return (
    <svg className="strategy-radar" viewBox="0 0 224 224" role="img" aria-label="strategy radar">
      {levels.map((level) => (
        <polygon
          key={level}
          className="radar-grid-line"
          points={metrics
            .map((_, index) => radarPoint(index, level, metrics.length, center, radius))
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
        />
      ))}
      {axes.map((point, index) => (
        <line
          key={metrics[index]?.key}
          className="radar-axis"
          x1={center}
          y1={center}
          x2={point.x}
          y2={point.y}
        />
      ))}
      <polygon
        className="radar-shape"
        points={polygon.map((point) => `${point.x},${point.y}`).join(" ")}
      />
      {polygon.map((point, index) => (
        <circle key={metrics[index]?.key} className="radar-dot" cx={point.x} cy={point.y} r="4" />
      ))}
      {axes.map((point, index) => (
        <text
          key={`${metrics[index]?.key}-label`}
          x={point.labelX}
          y={point.labelY}
          textAnchor={point.anchor}
        >
          {metrics[index]?.label}
        </text>
      ))}
    </svg>
  );
}

function radarPoint(index: number, value: number, total: number, center: number, radius: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  const x = center + Math.cos(angle) * radius * value;
  const y = center + Math.sin(angle) * radius * value;
  const labelX = center + Math.cos(angle) * (radius + 24);
  const labelY = center + Math.sin(angle) * (radius + 24) + 4;
  const anchor: "start" | "middle" | "end" =
    Math.cos(angle) > 0.35 ? "start" : Math.cos(angle) < -0.35 ? "end" : "middle";
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    labelX: Number(labelX.toFixed(2)),
    labelY: Number(labelY.toFixed(2)),
    anchor
  };
}

function getStrategyRadarMetrics(strategy: AgentStrategy, t: (key: string) => string) {
  return [
    { key: "attack", label: t("radar.attack"), value: clamp01(strategy.aggression) },
    { key: "survival", label: t("radar.survival"), value: clamp01(strategy.safety) },
    { key: "item", label: t("radar.item"), value: clamp01(strategy.itemBias) },
    {
      key: "escape",
      label: t("radar.escape"),
      value: clamp01(strategy.tactics.escapeMarginTicks / 12)
    },
    { key: "wall", label: t("radar.wall"), value: clamp01(strategy.wallBias) }
  ];
}

function PixelAgentAvatar({
  agent,
  size
}: {
  agent: AgentProfile;
  size: "tiny" | "small" | "large" | "hero" | "display";
}) {
  const skin = getAgentSkin(agent.appearance.skinId);
  return (
    <span
      className={`pixel-agent pixel-agent-${size} pixel-agent-skin`}
      style={{ "--agent-color": agent.color } as CSSProperties}
    >
      <img src={skin.src} alt="" />
      <small>{skin.label}</small>
    </span>
  );
}

function MapMini({ mapId }: { mapId: MapPresetId }) {
  return (
    <span className={`map-mini map-mini-${mapId}`}>
      {Array.from({ length: 25 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function MatchReportMeta({
  match,
  agents,
  myAgentId
}: {
  match: MatchRecord;
  agents: AgentProfile[];
  myAgentId?: string | undefined;
}) {
  const { t } = useI18n();
  const participants = match.participants?.length
    ? match.participants
    : match.participantIds.map((agentId) => ({
        agentId,
        name: agentNameById(agentId, agents),
        score: 0,
        survived: match.winnerAgentId === agentId
      }));
  const winnerName = match.winnerAgentId
    ? (participants.find((participant) => participant.agentId === match.winnerAgentId)?.name ??
      agentNameById(match.winnerAgentId, agents))
    : t("workbench.winnerUnknown");
  const myRank = formatMyRank(match, participants, myAgentId, t);

  return (
    <span className="match-report-meta">
      <small>
        <b>{t("workbench.matchTime")}</b>
        {formatMatchTime(match.finishedAt ?? match.createdAt)}
      </small>
      <small>
        <b>{t("workbench.participants")}</b>
        {participants.map((participant) => participant.name).join(" / ")}
      </small>
      <small>
        <b>{t("workbench.winner")}</b>
        {winnerName}
      </small>
      <small>
        <b>{t("workbench.myRank")}</b>
        {myRank}
      </small>
    </span>
  );
}

function chooseRandomAppearance(currentSkinId: string): AgentAppearance {
  const currentIndex = AGENT_SKINS.findIndex((skin) => skin.id === currentSkinId);
  const offset = 1 + Math.floor(Math.random() * Math.max(1, AGENT_SKINS.length - 1));
  const skin = agentSkinByIndex(currentIndex + offset);
  const color =
    SKIN_COLOR_SWATCHES[skin.edition % SKIN_COLOR_SWATCHES.length] ?? DEFAULT_AGENT_COLOR;
  return { color, accessory: legacyAccessoryFromSkin(skin.id), skinId: skin.id };
}

function getAppearanceTraitSummary(skin: ReturnType<typeof getAgentSkin>) {
  const traitValue = (types: string[]) =>
    types.map((type) => skin.traits.find((trait) => trait.type === type)?.value).find(Boolean) ??
    "-";
  return [
    {
      key: "outfit",
      value: traitValue(["Legend Outfit", "Outfit", "Special", "Legend Top", "Top"])
    },
    { key: "eyewear", value: traitValue(["Eye"]) },
    { key: "mouth", value: traitValue(["Mutated Mouth", "Mouth"]) }
  ];
}

function buildMatchParticipantIds(myAgentId: string | undefined, agents: AgentProfile[]): string[] {
  const ids = [myAgentId, ...agents.map((agent) => agent.id)].filter((id): id is string =>
    Boolean(id)
  );
  return Array.from(new Set(ids)).slice(0, 4);
}

function randomizeStorageKey(agentId: string): string {
  return `agent-poppy-free-randomize:${agentId}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function agentNameById(agentId: string, agents: AgentProfile[]): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function formatMatchTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function formatMyRank(
  match: MatchRecord,
  participants: Array<{ agentId: string; score: number; survived: boolean }>,
  myAgentId: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!myAgentId || !participants.some((participant) => participant.agentId === myAgentId)) {
    return t("workbench.rankUnplayed");
  }
  if (match.status !== "finished") {
    return t("workbench.rankRunning");
  }
  const ordered = [...participants].sort((a, b) => {
    if (match.winnerAgentId === a.agentId) return -1;
    if (match.winnerAgentId === b.agentId) return 1;
    if (a.survived !== b.survived) return a.survived ? -1 : 1;
    return b.score - a.score;
  });
  const rank = ordered.findIndex((participant) => participant.agentId === myAgentId) + 1;
  return rank > 0 ? t("workbench.rankValue", { rank }) : t("workbench.rankUnplayed");
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

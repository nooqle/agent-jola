import { ArrowLeft, DoorOpen, RadioTower, UserRoundCog } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  createAgent,
  createStrategyVersion,
  loadDashboard,
  startMatch,
  updateAgent,
  type DashboardData,
} from "./api";
import { Workbench } from "./components/Workbench";
import { PortalHub } from "./components/PortalHub";
import { LocalRoom } from "./components/LocalRoom";
import { I18nProvider, useI18n, type Language } from "./i18n";
import type {
  AgentAppearance,
  AgentProfile,
  AgentStrategyVersion,
  LeaderboardRow,
  MapPresetId,
  MatchRecord,
  ServerMode,
} from "./types";

const MatchViewer = lazy(() =>
  import("./components/MatchViewer").then((module) => ({ default: module.MatchViewer })),
);
const ReplayViewer = lazy(() =>
  import("./components/ReplayViewer").then((module) => ({ default: module.ReplayViewer })),
);

type ViewState =
  | { name: "local-room" }
  | { name: "workbench" }
  | { name: "portal" }
  | { name: "match"; match: MatchRecord }
  | { name: "replay"; match: MatchRecord };

export function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem("agent-poppy-language");
    return saved === "ja" || saved === "en" ? saved : "zh";
  });

  useEffect(() => {
    window.localStorage.setItem("agent-poppy-language", language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  }, [language]);

  return (
    <I18nProvider language={language}>
      <AppContent language={language} onLanguageChange={setLanguage} />
    </I18nProvider>
  );
}

function AppContent({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [strategies, setStrategies] = useState<AgentStrategyVersion[]>([]);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [mode, setMode] = useState<ServerMode>("checking");
  const [view, setView] = useState<ViewState>(() => viewFromPath(window.location.pathname));
  const { t } = useI18n();
  const viewerFallback = (
    <section className="viewer-shell loading-view">
      <div className="loading-mark" />
      <p>{t("replay.loading")}</p>
    </section>
  );

  const refreshDashboard = useCallback(async () => {
    const data = await loadDashboard();
    setAgents(data.agents);
    setStrategies(data.strategies);
    setMatches(data.matches);
    setLeaderboard(data.leaderboard);
    setMode(data.mode);
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadDashboard().then((data: DashboardData) => {
      if (disposed) return;
      setAgents(data.agents);
      setStrategies(data.strategies);
      setMatches(data.matches);
      setLeaderboard(data.leaderboard);
      setMode(data.mode);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (next: ViewState, path: string) => {
    setView(next);
    window.history.pushState({}, "", path);
  };

  const handleCreateAgent = async (name: string, appearance?: AgentAppearance) => {
    const agent = await createAgent(name, agents.length, mode, appearance);
    setAgents((current) => [agent, ...current]);
  };

  const handleUpdateAgent = async (agentId: string, updates: { name?: string; appearance?: AgentAppearance }) => {
    const agent = await updateAgent(agentId, updates, mode);
    setAgents((current) => current.map((candidate) => (candidate.id === agentId ? agent : candidate)));
  };

  const handleSaveStrategy = async (agentId: string, prompt: string) => {
    const strategy = await createStrategyVersion(agentId, prompt, mode);
    setStrategies((current) => [strategy, ...current]);
    setAgents((current) =>
      current.map((agent) => (agent.id === agentId ? { ...agent, currentStrategyVersionId: strategy.id } : agent)),
    );
  };

  const handleStartMatch = async (agentIds: string[], mapId: MapPresetId) => {
    const match = await startMatch(agentIds, mode, mapId);
    setMatches((current) => [match, ...current]);
    setView({ name: "match", match });
  };

  const handleOpenLocalMatch = (match: MatchRecord) => {
    setMatches((current) => [match, ...current.filter((candidate) => candidate.id !== match.id)]);
    setView({ name: "match", match });
  };

  const handleOpenReplay = (match: MatchRecord) => {
    setView({ name: "replay", match });
  };

  return (
    <main className={`app-shell app-shell-${view.name}`}>
      <div className="brand-rail">
        <div className="brand-lockup">
          <RadioTower size={22} />
          <span>{t("app.brand")}</span>
        </div>
        <div className="brand-actions">
          <label className="language-switch">
            <span>{t("language.label")}</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
              <option value="zh">{t("language.zh")}</option>
              <option value="ja">{t("language.ja")}</option>
              <option value="en">{t("language.en")}</option>
            </select>
          </label>
          {view.name === "local-room" ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                navigate({ name: "workbench" }, "/workbench");
                void refreshDashboard();
              }}
            >
              <UserRoundCog size={17} />
              作战大厅
            </button>
          ) : null}
          {view.name === "workbench" ? (
            <>
              <button type="button" className="ghost-button" onClick={() => navigate({ name: "local-room" }, "/local")}>
                <DoorOpen size={17} />
                当前房间
              </button>
              <button type="button" className="ghost-button" onClick={() => navigate({ name: "portal" }, "/portal")}>
                <UserRoundCog size={17} />
                回到 Portal
              </button>
            </>
          ) : null}
          {view.name !== "workbench" && view.name !== "portal" && view.name !== "local-room" ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                navigate({ name: "local-room" }, "/local");
                void refreshDashboard();
              }}
            >
              <ArrowLeft size={17} />
              {t("app.back")}
            </button>
          ) : null}
        </div>
      </div>

      {view.name === "local-room" ? <LocalRoom onOpenMatch={handleOpenLocalMatch} /> : null}

      {view.name === "workbench" ? (
        <Workbench
          agents={agents}
          strategies={strategies}
          matches={matches}
          leaderboard={leaderboard}
          mode={mode}
          onCreateAgent={handleCreateAgent}
          onUpdateAgent={handleUpdateAgent}
          onSaveStrategy={handleSaveStrategy}
          onStartMatch={handleStartMatch}
          onOpenReplay={handleOpenReplay}
        />
      ) : null}

      {view.name === "portal" ? (
        <PortalHub matches={matches} leaderboard={leaderboard} onOpenReplay={handleOpenReplay} />
      ) : null}

      {view.name === "match" ? (
        <Suspense fallback={viewerFallback}>
          <MatchViewer match={view.match} agents={agents} mode={mode} onOpenReplay={handleOpenReplay} />
        </Suspense>
      ) : null}

      {view.name === "replay" ? (
        <Suspense fallback={viewerFallback}>
          <ReplayViewer match={view.match} mode={mode} />
        </Suspense>
      ) : null}
    </main>
  );
}

function viewFromPath(pathname: string): ViewState {
  if (pathname === "/local") {
    return { name: "local-room" };
  }
  if (pathname === "/workbench") {
    return { name: "workbench" };
  }
  return { name: "portal" };
}

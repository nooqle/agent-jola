import { Pause, Play, Route, ShieldAlert, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getDecisions, getReplay } from "../api";
import { actionLabel, eventDescription, eventTitle, useI18n } from "../i18n";
import type { DecisionLogEntry, GameEvent, MatchRecord, ReplayFile, ServerMode } from "../types";
import { MapOverview } from "./MapOverview";
import { PhaserBoard } from "./PhaserBoard";

interface ReplayViewerProps {
  match: MatchRecord;
  mode: ServerMode;
}

export function ReplayViewer({ match, mode }: ReplayViewerProps) {
  const { language, t } = useI18n();
  const [replay, setReplay] = useState<ReplayFile | undefined>();
  const [decisions, setDecisions] = useState<DecisionLogEntry[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState<"danger" | "path">("danger");

  useEffect(() => {
    let disposed = false;
    void Promise.all([getReplay(match.id, mode), getDecisions(match.id, mode)]).then(([nextReplay, nextDecisions]) => {
      if (disposed) return;
      setReplay(nextReplay);
      setDecisions(nextDecisions);
      setFrameIndex(0);
    });
    return () => {
      disposed = true;
    };
  }, [match.id, mode]);

  useEffect(() => {
    if (!playing || !replay) return;
    const id = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= replay.frames.length - 1) {
          window.clearInterval(id);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 180);
    return () => window.clearInterval(id);
  }, [playing, replay]);

  const frame = replay?.frames[frameIndex];
  const nearbyDecision = useMemo(() => {
    if (!frame) return undefined;
    return decisions
      .filter((decision) => decision.tick <= frame.tick)
      .sort((left, right) => right.tick - left.tick)[0];
  }, [decisions, frame]);

  const keyEvents = replay?.summaryEvents.slice(0, 10) ?? [];
  const suggestions = useMemo(() => (replay ? buildStrategySuggestions(replay, decisions, t) : []), [decisions, replay, t]);

  if (!replay || !frame) {
    return (
      <section className="viewer-shell loading-view">
        <div className="loading-mark" />
        <p>{t("replay.loading")}</p>
      </section>
    );
  }

  return (
    <section className="viewer-shell">
      <div className="viewer-main">
        <div className="viewer-toolbar">
          <div>
            <p className="eyebrow">{t("replay.eyebrow")}</p>
            <h2>{match.id}</h2>
          </div>
          <div className="segmented-control" aria-label={t("match.overlay")}>
            <button className={overlay === "danger" ? "active" : ""} type="button" onClick={() => setOverlay("danger")}>
              <ShieldAlert size={15} />
              {t("match.danger")}
            </button>
            <button className={overlay === "path" ? "active" : ""} type="button" onClick={() => setOverlay("path")}>
              <Route size={15} />
              {t("match.path")}
            </button>
          </div>
        </div>
        <div className="board-stack">
          <MapOverview state={frame.state} />
          <div className="board-stage">
            <div className="board-stage-label">
              <span>{t("match.mainMap")}</span>
              <small>{t(`map.${frame.state.mapId}.name`)}</small>
            </div>
            <PhaserBoard state={frame.state} decision={nearbyDecision} overlay={overlay} />
          </div>
        </div>
        <div className="timeline">
          <button type="button" className="icon-button" onClick={() => setFrameIndex(0)} aria-label={t("replay.start")}>
            <SkipBack size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setFrameIndex((current) => Math.max(0, current - 1))}
            aria-label={t("replay.previous")}
          >
            <SkipBack size={17} />
          </button>
          <button type="button" className="primary-button compact" onClick={() => setPlaying((current) => !current)}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
            {playing ? t("replay.pause") : t("replay.play")}
          </button>
          <input
            type="range"
            min={0}
            max={replay.frames.length - 1}
            value={frameIndex}
            onChange={(event) => setFrameIndex(Number(event.target.value))}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setFrameIndex((current) => Math.min(replay.frames.length - 1, current + 1))}
            aria-label={t("replay.next")}
          >
            <SkipForward size={17} />
          </button>
          <span>t{frame.tick}</span>
        </div>
      </div>

      <aside className="match-side">
        <div className="side-section">
          <h3>{t("replay.keyEvents")}</h3>
          <div className="event-list">
            {keyEvents.map((event) => (
              <button key={event.id} type="button" className="event-row" onClick={() => jumpToTick(replay, event.tick, setFrameIndex)}>
                <span>t{event.tick}</span>
                <strong>{eventTitle(event, language)}</strong>
                <small>{eventDescription(event, language)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="side-section">
          <h3>{t("replay.decisionEvidence")}</h3>
          {nearbyDecision ? (
            <div className="evidence-box">
              <span>t{nearbyDecision.tick}</span>
              <strong>{actionLabel(nearbyDecision.action.type, nearbyDecision.action.direction, language)}</strong>
              <p>{nearbyDecision.reason}</p>
              <small>
                {t("replay.risk", { risk: nearbyDecision.risk.toFixed(2) })}
                {nearbyDecision.target
                  ? ` · ${t("replay.target", {
                      target: nearbyDecision.target.label ?? `${nearbyDecision.target.x},${nearbyDecision.target.y}`,
                    })}`
                  : ""}
              </small>
            </div>
          ) : (
            <p className="empty-copy">{t("replay.noDecision")}</p>
          )}
        </div>

        <div className="side-section">
          <h3>{t("replay.strategyVersions")}</h3>
          <div className="strategy-stack">
            {replay.strategyVersions.map((strategy) => (
              <div key={strategy.id} className="strategy-line">
                <span>v{strategy.version}</span>
                <p>{strategy.summary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="side-section">
          <h3>{t("replay.suggestions")}</h3>
          <div className="suggestion-list">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className={`suggestion-card ${suggestion.tone}`}>
                <strong>{suggestion.title}</strong>
                <p>{suggestion.body}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </section>
  );
}

function jumpToTick(replay: ReplayFile, tick: number, setFrameIndex: (value: number) => void) {
  const index = replay.frames.findIndex((frame) => frame.tick >= tick);
  setFrameIndex(index >= 0 ? index : replay.frames.length - 1);
}

interface StrategySuggestion {
  id: string;
  tone: "survival" | "growth" | "tempo" | "stable";
  title: string;
  body: string;
}

function buildStrategySuggestions(
  replay: ReplayFile,
  decisions: DecisionLogEntry[],
  t: (key: string, values?: Record<string, string | number | undefined>) => string,
): StrategySuggestion[] {
  const events = replay.frames.flatMap((frame) => frame.events);
  const eliminated = events.find((event) => event.type === "eliminated");
  const highRiskCount = decisions.filter((decision) => decision.risk >= 0.68).length;
  const itemCount = countEvents(events, "item_collected");
  const bubbleCount = countEvents(events, "bubble_placed");
  const wallCount = countEvents(events, "wall_destroyed");
  const suggestions: StrategySuggestion[] = [];

  if (eliminated) {
    suggestions.push({
      id: "survival",
      tone: "survival",
      title: t("suggestion.survival.title"),
      body: t("suggestion.survival.body", {
        agent: eliminated.agentId ?? "Agent",
        tick: eliminated.tick,
      }),
    });
  }

  if (highRiskCount >= 3) {
    suggestions.push({
      id: "risk",
      tone: "survival",
      title: t("suggestion.risk.title"),
      body: t("suggestion.risk.body", { count: highRiskCount }),
    });
  }

  if (itemCount < 2) {
    suggestions.push({
      id: "items",
      tone: "growth",
      title: t("suggestion.items.title"),
      body: t("suggestion.items.body", { count: itemCount }),
    });
  }

  if (bubbleCount < 4 || wallCount < 3) {
    suggestions.push({
      id: "tempo",
      tone: "tempo",
      title: t("suggestion.tempo.title"),
      body: t("suggestion.tempo.body", { bubbles: bubbleCount, walls: wallCount }),
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: "stable",
      tone: "stable",
      title: t("suggestion.default.title"),
      body: t("suggestion.default.body"),
    });
  }

  return suggestions.slice(0, 3);
}

function countEvents(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

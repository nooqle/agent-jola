import { Activity, Bomb, Eye, Route, ShieldAlert, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { useMatchSocket } from "../hooks/useMatchSocket";
import { useI18n } from "../i18n";
import { getAgentSkin } from "../skins";
import type { AgentProfile, MatchRecord, MatchState, ServerMode } from "../types";
import { PhaserBoard } from "./PhaserBoard";

interface MatchViewerProps {
  match: MatchRecord;
  agents: AgentProfile[];
  mode: ServerMode;
  onOpenReplay: (match: MatchRecord) => void;
}

export function MatchViewer({ match, agents, mode, onOpenReplay }: MatchViewerProps) {
  const { t } = useI18n();
  const [overlay, setOverlay] = useState<"off" | "danger" | "path">("danger");
  const live = useMatchSocket(match, mode);
  const latestDecision = live.decisions[0];
  const winner = agents.find((agent) => agent.id === live.state.winnerAgentId);
  const visualState = useMemo(() => withAgentAppearance(live.state, agents), [agents, live.state]);
  const myAgentId = match.participantIds[0];
  const resultSummary = useMemo(
    () => buildResultSummary(visualState, live.record ?? match, agents, myAgentId),
    [agents, live.record, match, myAgentId, visualState],
  );

  const aliveCount = useMemo(() => visualState.players.filter((player) => player.alive).length, [visualState.players]);

  return (
    <section className="viewer-shell match-viewer-shell">
      <div className="viewer-main">
        <div className="viewer-toolbar">
          <div>
            <p className="eyebrow">{t("match.eyebrow")}</p>
            <h2>{match.id}</h2>
          </div>
          <div className="segmented-control" aria-label={t("match.overlay")}>
            <button className={overlay === "off" ? "active" : ""} type="button" onClick={() => setOverlay("off")}>
              <Eye size={15} />
              {t("match.clean")}
            </button>
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
          <div className="board-stage">
            <div className="board-stage-label">
              <span>{t("match.mainMap")}</span>
              <small>{t(`map.${visualState.mapId}.name`)}</small>
            </div>
            <div className="battle-board-frame">
              <PhaserBoard state={visualState} decision={latestDecision} overlay={overlay} myAgentId={myAgentId} />
              {resultSummary ? (
                <div className="match-result-scrim" role="status" aria-live="polite">
                  <div className={`match-result-card ${resultSummary.isMineWinner ? "mine-winner" : ""}`}>
                    <span className="result-kicker">{t("match.finished")}</span>
                    <Trophy size={38} />
                    <h3>
                      {resultSummary.winnerName
                        ? t("match.result.title", { name: resultSummary.winnerName })
                        : t("match.result.draw")}
                    </h3>
                    <p className="result-rank">
                      {resultSummary.myRank
                        ? t("match.result.myRank", { rank: resultSummary.myRank })
                        : t("match.result.rankPending")}
                    </p>
                    <button type="button" className="secondary-button" onClick={() => onOpenReplay(live.record ?? match)}>
                      {t("match.openReplay")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside className="match-side">
        <div className="stat-strip">
          <span>
            <Activity size={16} />
            {t("match.tick", { tick: visualState.tick })}
          </span>
          <span>
            <Bomb size={16} />
            {t("match.armed", { count: visualState.bubbles.length })}
          </span>
          <span>{t("match.alive", { count: aliveCount })}</span>
          <span>{t("match.zone")}: {zoneLabel(visualState, t)}</span>
        </div>

        <div className="side-section">
          <h3>{t("match.agents")}</h3>
          <div className="player-list">
            {visualState.players.map((player) => (
              <div key={player.id} className={`player-row ${player.alive ? "" : "out"} ${player.id === myAgentId ? "mine" : ""}`}>
                <img src={getAgentSkin(player.appearance.skinId).src} alt="" />
                <strong>{player.name}</strong>
                <small>
                  {player.alive
                    ? `${t("match.playerStats", { range: player.blastRange, cap: player.bubbleCapacity })} · ${t(
                        "match.playerItems",
                        {
                          shield: player.shieldCharges,
                          pierce: player.pierceCharges,
                          quick: player.quickFuseCharges,
                        },
                      )}`
                    : t("match.eliminated")}
                </small>
              </div>
            ))}
          </div>
        </div>

        {visualState.status === "finished" ? (
          <div className="finish-box">
            <Trophy size={20} />
            <div>
              <strong>{winner ? t("match.wins", { name: winner.name }) : t("match.finished")}</strong>
              <span>{visualState.finishReason ?? t("match.replayReady")}</span>
            </div>
            <button type="button" className="secondary-button" onClick={() => onOpenReplay(live.record ?? match)}>
              {t("match.openReplay")}
            </button>
          </div>
        ) : (
          <div className="source-note">{live.source === "websocket" ? t("source.websocket") : t("source.mock")}</div>
        )}
      </aside>
    </section>
  );
}

function zoneLabel(state: MatchState, t: (key: string) => string): string {
  const zone = state.zone;
  if (!zone?.enabled) {
    return "-";
  }
  const statusKey =
    zone.status === "shrinking" ? "match.zoneShrinking" : zone.status === "waiting" ? "match.zoneWaiting" : "match.zoneStable";
  return `${t(statusKey)} · R${zone.radius.toFixed(1)}`;
}

function withAgentAppearance(state: MatchState, agents: AgentProfile[]): MatchState {
  return {
    ...state,
    players: state.players.map((player) => {
      const agent = agents.find((candidate) => candidate.id === player.id);
      if (!agent) return player;
      return {
        ...player,
        color: agent.color,
        accessory: agent.accessory,
        appearance: agent.appearance,
      };
    }),
  };
}

function buildResultSummary(
  state: MatchState,
  record: MatchRecord,
  agents: AgentProfile[],
  myAgentId: string | undefined,
): { winnerName: string | undefined; myRank: number | undefined; isMineWinner: boolean } | undefined {
  if (state.status !== "finished") {
    return undefined;
  }

  const winnerAgentId = state.winnerAgentId ?? record.winnerAgentId;
  const winnerName = winnerAgentId ? agentNameById(winnerAgentId, state, record, agents) : undefined;
  const myRank = myAgentId ? rankParticipant(myAgentId, winnerAgentId, state, record) : undefined;
  return {
    winnerName,
    myRank,
    isMineWinner: Boolean(myAgentId && winnerAgentId && myAgentId === winnerAgentId),
  };
}

function rankParticipant(
  myAgentId: string,
  winnerAgentId: string | undefined,
  state: MatchState,
  record: MatchRecord,
): number | undefined {
  const participants =
    record.participants && record.participants.length > 0
      ? record.participants
      : state.players.map((player, index) => ({
          agentId: player.id,
          name: player.name,
          score: state.players.length - index,
          survived: player.alive,
        }));

  if (!participants.some((participant) => participant.agentId === myAgentId)) {
    return undefined;
  }

  const ordered = [...participants].sort((a, b) => {
    if (winnerAgentId) {
      if (a.agentId === winnerAgentId) return -1;
      if (b.agentId === winnerAgentId) return 1;
    }
    if (a.survived !== b.survived) {
      return a.survived ? -1 : 1;
    }
    return b.score - a.score;
  });
  const rank = ordered.findIndex((participant) => participant.agentId === myAgentId) + 1;
  return rank > 0 ? rank : undefined;
}

function agentNameById(agentId: string, state: MatchState, record: MatchRecord, agents: AgentProfile[]): string {
  return (
    agents.find((agent) => agent.id === agentId)?.name ??
    record.participants?.find((participant) => participant.agentId === agentId)?.name ??
    state.players.find((player) => player.id === agentId)?.name ??
    agentId
  );
}

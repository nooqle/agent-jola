import { useEffect, useMemo, useState } from "react";
import { buildMatchWebSocketUrl, normalizeSocketMessage } from "../api";
import { createMockDecision, createMockState } from "../mockData";
import type { DecisionLogEntry, MatchRecord, MatchState, ServerMode } from "../types";

export interface MatchSocketState {
  state: MatchState;
  decisions: DecisionLogEntry[];
  record: MatchRecord | undefined;
  source: "websocket" | "mock";
}

export function useMatchSocket(match: MatchRecord | undefined, mode: ServerMode) {
  const initialState = useMemo(
    () => createMockState(match?.id ?? "pending-match", 0, match?.mapId ?? "royale"),
    [match?.id, match?.mapId],
  );
  const [socketState, setSocketState] = useState<MatchSocketState>({
    state: initialState,
    decisions: [],
    record: undefined,
    source: mode === "live" ? "websocket" : "mock",
  });

  useEffect(() => {
    if (!match) return;

    let disposed = false;
    let intervalId = 0;

    const startMockLoop = () => {
      let tick = 0;
      setSocketState({ state: createMockState(match.id, 0, match.mapId), decisions: [], record: undefined, source: "mock" });
      intervalId = window.setInterval(() => {
        tick += 4;
        const nextState = createMockState(match.id, tick, match.mapId);
        const decision = tick % 12 === 0 ? createMockDecision(match.id, tick) : undefined;
        setSocketState((previous) => ({
          state: nextState,
          decisions: decision ? [decision, ...previous.decisions].slice(0, 18) : previous.decisions,
          source: "mock",
          record: nextState.status === "finished" ? { ...match, status: "finished", totalTicks: nextState.tick } : previous.record,
        }));
        if (nextState.status === "finished") {
          window.clearInterval(intervalId);
        }
      }, 260);
    };

    if (mode !== "live") {
      startMockLoop();
      return () => {
        disposed = true;
        window.clearInterval(intervalId);
      };
    }

    let opened = false;
    let socket: WebSocket | undefined;

    try {
      socket = new WebSocket(buildMatchWebSocketUrl(match.id));
      socket.onopen = () => {
        opened = true;
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        const message = normalizeSocketMessage(JSON.parse(event.data as string));
        setSocketState((previous) => {
          if (message.type === "snapshot") {
            return { ...previous, state: message.state, source: "websocket" };
          }
          if (message.type === "decision") {
            return {
              ...previous,
              decisions: [message.decision, ...previous.decisions].slice(0, 18),
              source: "websocket",
            };
          }
          return {
            state: message.replay.frames.at(-1)?.state ?? previous.state,
            decisions: previous.decisions,
            source: "websocket",
            record: message.record,
          };
        });
      };
      socket.onerror = () => {
        if (!opened && !disposed) startMockLoop();
      };
      socket.onclose = () => {
        if (!opened && !disposed) startMockLoop();
      };
    } catch {
      startMockLoop();
    }

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      socket?.close();
    };
  }, [match, mode]);

  return socketState;
}

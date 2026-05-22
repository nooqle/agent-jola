import type { CSSProperties } from "react";
import { useI18n } from "../i18n";
import type { CellKind, MatchState, PlayerState } from "../types";

interface MapOverviewProps {
  state: MatchState;
}

const LEGEND_ITEMS = ["floor", "solid", "soft", "poison", "bubble", "blast", "agent", "item"] as const;

export function MapOverview({ state }: MapOverviewProps) {
  const { t } = useI18n();
  const playersByCell = new Map<string, PlayerState>();
  const bubblesByCell = new Set<string>();
  const blastsByCell = new Set<string>();
  const itemsByCell = new Set<string>();

  for (const player of state.players) {
    if (player.alive) {
      playersByCell.set(cellKey(player.x, player.y), player);
    }
  }
  for (const bubble of state.bubbles) {
    bubblesByCell.add(cellKey(bubble.x, bubble.y));
  }
  for (const blast of state.blasts) {
    blastsByCell.add(cellKey(blast.x, blast.y));
  }
  for (const item of state.items) {
    itemsByCell.add(cellKey(item.x, item.y));
  }

  const gridStyle = {
    "--map-ratio": `${state.map.width} / ${state.map.height}`,
    gridTemplateColumns: `repeat(${state.map.width}, minmax(0, 1fr))`,
  } as CSSProperties;

  return (
    <aside className="map-overview" aria-label={t("match.miniMap")}>
      <div className="map-overview-header">
        <span>{t("match.miniMap")}</span>
        <strong>{t(`map.${state.mapId}.name`)}</strong>
      </div>
      <div className="mini-map-grid" style={gridStyle} aria-hidden="true">
        {state.map.rows.flatMap((row, y) =>
          row.map((kind, x) => {
            const key = cellKey(x, y);
            const player = playersByCell.get(key);
            const hasBubble = bubblesByCell.has(key);
            const hasBlast = blastsByCell.has(key);
            const hasItem = itemsByCell.has(key);
            const outsideZone = Boolean(state.zone?.enabled && !isInsideZone(state, x, y));
            return (
              <span key={key} className={miniCellClass(kind, hasBubble, hasBlast, outsideZone)}>
                {hasBlast ? <i className="mini-blast-mark" /> : null}
                {hasBubble ? <i className="mini-bubble-mark" /> : null}
                {hasItem && !hasBubble ? <i className="mini-item-mark" /> : null}
                {player ? (
                  <i
                    className="mini-player-mark"
                    style={{ "--player-color": player.color } as CSSProperties}
                  />
                ) : null}
              </span>
            );
          }),
        )}
      </div>
      <div className="map-legend" aria-label={t("match.legend")}>
        {LEGEND_ITEMS.map((item) => (
          <span key={item}>
            <i className={`legend-chip legend-${item}`} />
            {t(`match.legend.${item}`)}
          </span>
        ))}
      </div>
    </aside>
  );
}

function miniCellClass(kind: CellKind, hasBubble: boolean, hasBlast: boolean, outsideZone: boolean): string {
  return [
    "mini-cell",
    `mini-cell-${kind}`,
    outsideZone ? "mini-cell-outside-zone" : "",
    hasBubble ? "mini-cell-has-bubble" : "",
    hasBlast ? "mini-cell-has-blast" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isInsideZone(state: MatchState, x: number, y: number): boolean {
  const zone = state.zone;
  if (!zone?.enabled) {
    return true;
  }
  const dx = x - zone.center.x;
  const dy = y - zone.center.y;
  return Math.sqrt(dx * dx + dy * dy) <= zone.radius;
}

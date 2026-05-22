import Phaser from "phaser";
import { useEffect, useMemo, useRef } from "react";
import { itemGlyph, useI18n } from "../i18n";
import { AGENT_SKINS, getAgentSkin } from "../skins";
import type { BubbleState, CellKind, DecisionLogEntry, ItemType, MatchState, PlayerState, Position } from "../types";

const TILE = 36;
const BOARD_PADDING = 36;
const CANVAS_WIDTH = 1508;
const CANVAS_HEIGHT = 1216;

interface PhaserBoardProps {
  state: MatchState;
  decision: DecisionLogEntry | undefined;
  overlay: "off" | "danger" | "path";
  myAgentId?: string | undefined;
}

interface BoardLabels {
  tick: string;
  active: string;
  seed: string;
  waiting: string;
  running: string;
  finished: string;
  me: string;
}

class AgentBomberScene extends Phaser.Scene {
  private snapshot?: MatchState;
  private decision: DecisionLogEntry | undefined;
  private overlay: "off" | "danger" | "path" = "off";
  private labels: BoardLabels = {
    tick: "TICK",
    active: "ACTIVE",
    seed: "SEED",
    waiting: "WAITING",
    running: "RUNNING",
    finished: "FINISHED",
    me: "ME",
  };
  private graphics?: Phaser.GameObjects.Graphics;
  private myAgentId: string | undefined;

  constructor() {
    super("agent-bomber-board");
  }

  create() {
    this.graphics = this.add.graphics();
    this.cameras.main.setBackgroundColor("#100f0c");
    this.time.addEvent({
      delay: 360,
      loop: true,
      callback: () => this.redraw(),
    });
    this.redraw();
  }

  preload() {
    for (const skin of AGENT_SKINS) {
      this.load.image(skin.id, skin.src);
    }
  }

  setFrame(
    snapshot: MatchState,
    decision: DecisionLogEntry | undefined,
    overlay: "off" | "danger" | "path",
    labels: BoardLabels,
    myAgentId: string | undefined,
  ) {
    this.snapshot = snapshot;
    this.decision = decision;
    this.overlay = overlay;
    this.labels = labels;
    this.myAgentId = myAgentId;
    this.redraw();
  }

  private redraw() {
    if (!this.graphics || !this.snapshot) return;

    const graphics = this.graphics;
    const state = this.snapshot;
    const pulse = 0.5 + Math.sin(this.time.now / 260) * 0.5;
    graphics.clear();
    this.children
      .getChildren()
      .filter((child) => child !== graphics)
      .forEach((child) => child.destroy());

    const boardWidth = state.map.width * TILE;
    const boardHeight = state.map.height * TILE;
    const originX = Math.max(BOARD_PADDING, (this.scale.width - boardWidth) / 2);
    const originY = 52;

    this.drawBackdrop(graphics, originX, originY, boardWidth, boardHeight);
    this.drawTiles(graphics, state, originX, originY);
    this.drawZone(graphics, state, originX, originY, pulse);

    if (this.overlay === "danger") {
      this.drawDangerOverlay(graphics, state, originX, originY, pulse);
    }

    if (this.overlay === "path") {
      this.drawPathOverlay(graphics, state, originX, originY, pulse);
    }

    for (const blast of state.blasts) {
      this.drawBlast(graphics, originX, originY, blast, pulse);
    }

    for (const item of state.items) {
      this.drawItem(graphics, originX, originY, item, pulse);
    }

    for (const bubble of state.bubbles) {
      this.drawBubble(graphics, state, originX, originY, bubble, pulse);
    }

    for (const player of state.players) {
      this.drawPlayer(graphics, originX, originY, player, player.id === this.myAgentId, pulse);
    }

    this.drawBoardHud(state, originX, originY, boardWidth);
  }

  private drawBackdrop(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number,
    boardWidth: number,
    boardHeight: number,
  ) {
    graphics.fillStyle(0x0f0d0a, 1);
    graphics.fillRect(originX - 26, originY - 34, boardWidth + 52, boardHeight + 78);
    graphics.lineStyle(2, 0x5b4b35, 0.9);
    graphics.strokeRect(originX - 26, originY - 34, boardWidth + 52, boardHeight + 78);

    graphics.fillStyle(0x1d1710, 1);
    graphics.fillRect(originX - 16, originY - 18, boardWidth + 32, boardHeight + 32);
    graphics.lineStyle(1, 0x2f281f, 1);
    graphics.strokeRect(originX - 16, originY - 18, boardWidth + 32, boardHeight + 32);

    graphics.fillStyle(0xf59e0b, 0.12);
    graphics.fillRect(originX - 12, originY - 30, 118, 4);
    graphics.fillStyle(0x84cc16, 0.16);
    graphics.fillRect(originX + boardWidth - 122, originY + boardHeight + 24, 118, 4);
  }

  private drawTiles(graphics: Phaser.GameObjects.Graphics, state: MatchState, originX: number, originY: number) {
    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        const kind = state.map.rows[y]?.[x] ?? "empty";
        const px = originX + x * TILE;
        const py = originY + y * TILE;
        this.drawTile(graphics, px, py, x, y, kind);
      }
    }
  }

  private drawTile(graphics: Phaser.GameObjects.Graphics, px: number, py: number, x: number, y: number, kind: CellKind) {
    const variance = tileNoise(x, y);
    const floorColor = variance > 0.55 ? 0x173c32 : 0x102c27;
    const floorLine = variance > 0.55 ? 0x35705f : 0x28584d;

    graphics.fillStyle(floorColor, 1);
    graphics.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    graphics.lineStyle(1, floorLine, 0.58);
    graphics.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);

    graphics.fillStyle(0xffffff, 0.035);
    graphics.fillRect(px + 6, py + 6, TILE - 12, 2);
    graphics.fillStyle(0x000000, 0.13);
    graphics.fillRect(px + 5, py + TILE - 8, TILE - 10, 3);
    graphics.fillStyle(0x79d7b8, 0.08);
    graphics.fillRect(px + 12, py + 12, 4, 4);
    graphics.fillRect(px + TILE - 16, py + TILE - 16, 4, 4);

    if (kind === "solid") {
      this.drawSolidBlock(graphics, px, py, variance);
    } else if (kind === "soft") {
      this.drawSoftCrate(graphics, px, py, variance);
    } else if (variance > 0.72) {
      graphics.fillStyle(0x5b4b35, 0.22);
      graphics.fillCircle(px + 10, py + TILE - 8, 2);
      graphics.fillCircle(px + TILE - 8, py + 12, 1.5);
    }
  }

  private drawSolidBlock(graphics: Phaser.GameObjects.Graphics, px: number, py: number, variance: number) {
    const base = variance > 0.5 ? 0x334a58 : 0x283d4b;
    graphics.fillStyle(0x05080a, 0.42);
    graphics.fillRect(px + 6, py + 8, TILE - 7, TILE - 5);
    graphics.fillStyle(base, 1);
    graphics.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    graphics.fillStyle(0x496779, 1);
    graphics.fillRect(px + 7, py + 7, TILE - 14, 8);
    graphics.fillStyle(0x1a2730, 1);
    graphics.fillRect(px + 7, py + TILE - 15, TILE - 14, 7);
    graphics.lineStyle(2, 0x8fb3bd, 0.58);
    graphics.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);
    graphics.lineStyle(1, 0x17242d, 0.74);
    graphics.lineBetween(px + TILE / 2, py + 8, px + TILE / 2, py + TILE - 9);
    graphics.lineBetween(px + 8, py + TILE / 2, px + TILE - 8, py + TILE / 2);
    graphics.fillStyle(0xb7cbd0, 0.72);
    graphics.fillRect(px + 10, py + 10, 4, 4);
    graphics.fillRect(px + TILE - 14, py + 10, 4, 4);
    graphics.fillRect(px + 10, py + TILE - 14, 4, 4);
    graphics.fillRect(px + TILE - 14, py + TILE - 14, 4, 4);
  }

  private drawSoftCrate(graphics: Phaser.GameObjects.Graphics, px: number, py: number, variance: number) {
    const base = variance > 0.5 ? 0xbd6a31 : 0xa9562c;
    graphics.fillStyle(0x0b0806, 0.25);
    graphics.fillRect(px + 7, py + 9, TILE - 9, TILE - 7);
    graphics.fillStyle(base, 1);
    graphics.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
    graphics.fillStyle(0xd98745, 1);
    graphics.fillRect(px + 8, py + 8, TILE - 16, 7);
    graphics.lineStyle(2, 0x5b2f1d, 0.9);
    graphics.strokeRect(px + 5, py + 5, TILE - 10, TILE - 10);
    graphics.lineStyle(2, 0x6e351e, 0.72);
    graphics.lineBetween(px + 7, py + 17, px + TILE - 7, py + 17);
    graphics.lineBetween(px + 7, py + 28, px + TILE - 7, py + 28);
    graphics.lineBetween(px + 18, py + 7, px + 18, py + 17);
    graphics.lineBetween(px + TILE - 7, py + 15, px + TILE - 7, py + TILE - 7);
    graphics.lineBetween(px + 18, py + 28, px + 18, py + TILE - 7);
    graphics.lineStyle(2, 0x2d1710, 0.72);
    graphics.lineBetween(px + 14, py + 13, px + 22, py + 21);
    graphics.lineBetween(px + 22, py + 21, px + 17, py + 29);
    graphics.fillStyle(0xffb86c, 0.56);
    graphics.fillRect(px + TILE - 13, py + 9, 4, 4);
  }

  private drawZone(
    graphics: Phaser.GameObjects.Graphics,
    state: MatchState,
    originX: number,
    originY: number,
    pulse: number,
  ) {
    const zone = state.zone;
    if (!zone?.enabled) return;

    for (let y = 0; y < state.map.height; y += 1) {
      for (let x = 0; x < state.map.width; x += 1) {
        if (cellInsideCircle(x, y, zone.center, zone.radius)) {
          continue;
        }
        const px = originX + x * TILE;
        const py = originY + y * TILE;
        graphics.fillStyle(0x46130d, 0.28 + pulse * 0.08);
        graphics.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        graphics.lineStyle(1, 0xff6b55, 0.16);
        graphics.lineBetween(px + 3, py + TILE - 4, px + TILE - 4, py + 3);
      }
    }

    const centerX = originX + (zone.center.x + 0.5) * TILE;
    const centerY = originY + (zone.center.y + 0.5) * TILE;
    graphics.lineStyle(3, zone.status === "shrinking" ? 0xff6b55 : 0xf59e0b, 0.78 + pulse * 0.12);
    graphics.strokeCircle(centerX, centerY, zone.radius * TILE);

    const targetX = originX + (zone.targetCenter.x + 0.5) * TILE;
    const targetY = originY + (zone.targetCenter.y + 0.5) * TILE;
    graphics.lineStyle(2, 0x5bd6a0, 0.42);
    graphics.strokeCircle(targetX, targetY, zone.targetRadius * TILE);
  }

  private drawDangerOverlay(
    graphics: Phaser.GameObjects.Graphics,
    state: MatchState,
    originX: number,
    originY: number,
    pulse: number,
  ) {
    for (const cell of projectedDangerCells(state)) {
      const px = originX + cell.x * TILE;
      const py = originY + cell.y * TILE;
      graphics.fillStyle(0xff3b1f, 0.16 + pulse * 0.12);
      graphics.fillRoundedRect(px + 5, py + 5, TILE - 10, TILE - 10, 5);
      graphics.lineStyle(1, 0xffb020, 0.32);
      for (let offset = -TILE; offset < TILE; offset += 12) {
        graphics.lineBetween(px + offset, py + TILE - 7, px + offset + TILE, py + 7);
      }
    }
  }

  private drawPathOverlay(
    graphics: Phaser.GameObjects.Graphics,
    state: MatchState,
    originX: number,
    originY: number,
    pulse: number,
  ) {
    const path = this.decision?.path ?? fallbackPath(state, this.decision);
    if (path.length === 0) return;

    graphics.lineStyle(4, 0x9ee493, 0.42 + pulse * 0.18);
    for (let index = 0; index < path.length - 1; index += 1) {
      const start = tileCenter(originX, originY, path[index] as Position);
      const end = tileCenter(originX, originY, path[index + 1] as Position);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
    }
    for (const [index, cell] of path.entries()) {
      const center = tileCenter(originX, originY, cell);
      graphics.fillStyle(index === 0 ? 0xfacc15 : 0x84cc16, 0.22 + pulse * 0.16);
      graphics.fillCircle(center.x, center.y, index === 0 ? 12 : 8);
      graphics.lineStyle(2, index === 0 ? 0xfacc15 : 0x84cc16, 0.8);
      graphics.strokeCircle(center.x, center.y, index === 0 ? 12 : 8);
    }
  }

  private drawItem(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number,
    item: { type: string; x: number; y: number },
    pulse: number,
  ) {
    const center = tileCenter(originX, originY, item);
    const type = item.type as ItemType;
    const color = itemColor(type);
    graphics.fillStyle(color, 0.14 + pulse * 0.1);
    graphics.fillCircle(center.x, center.y, 13);
    graphics.lineStyle(2, color, 0.86);
    graphics.strokeCircle(center.x, center.y, 10);
    graphics.fillStyle(color, 1);
    if (item.type === "speedUp") {
      graphics.fillTriangle(center.x + 3, center.y - 13, center.x - 8, center.y + 2, center.x + 1, center.y + 2);
      graphics.fillTriangle(center.x - 1, center.y - 2, center.x + 8, center.y - 2, center.x - 4, center.y + 13);
    } else if (item.type === "capacityUp") {
      graphics.fillRoundedRect(center.x - 9, center.y - 8, 18, 16, 6);
      graphics.fillStyle(0x10100d, 0.6);
      graphics.fillRect(center.x - 2, center.y - 6, 4, 12);
    } else if (item.type === "rangeUp") {
      graphics.fillCircle(center.x, center.y, 8);
      graphics.fillStyle(0x10100d, 0.72);
      graphics.fillCircle(center.x + 2, center.y - 2, 3);
    } else if (item.type === "shield") {
      graphics.fillRoundedRect(center.x - 9, center.y - 12, 18, 22, 7);
      graphics.fillStyle(0x10100d, 0.58);
      graphics.fillTriangle(center.x, center.y + 8, center.x - 7, center.y - 5, center.x + 7, center.y - 5);
    } else if (item.type === "pierce") {
      graphics.fillTriangle(center.x - 12, center.y + 9, center.x + 13, center.y, center.x - 12, center.y - 9);
      graphics.fillStyle(0x10100d, 0.64);
      graphics.fillCircle(center.x - 3, center.y, 3);
    } else {
      graphics.fillCircle(center.x, center.y, 9);
      graphics.fillStyle(0x10100d, 0.7);
      graphics.fillCircle(center.x + 4, center.y - 4, 3);
    }
    this.add
      .text(center.x, center.y + 15, itemGlyph(type), {
        color: "#fff7d6",
        fontFamily: "Sora, sans-serif",
        fontSize: "8px",
        fontStyle: "800",
        backgroundColor: "rgba(16, 15, 12, 0.76)",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 0.5);
  }

  private drawBubble(
    graphics: Phaser.GameObjects.Graphics,
    state: MatchState,
    originX: number,
    originY: number,
    bubble: BubbleState,
    pulse: number,
  ) {
    const center = tileCenter(originX, originY, bubble);
    const fuse = Math.max(0, bubble.explodeAtTick - state.tick);
    const fuseProgress = Phaser.Math.Clamp(1 - fuse / 25, 0, 1);
    graphics.fillStyle(0x000000, 0.34);
    graphics.fillEllipse(center.x, center.y + 7, 22, 8);
    graphics.fillStyle(0x12100e, 1);
    graphics.fillCircle(center.x, center.y, 11);
    graphics.fillStyle(0x2d2a26, 1);
    graphics.fillCircle(center.x - 2, center.y - 3, 8);
    graphics.fillStyle(0xffffff, 0.15);
    graphics.fillCircle(center.x - 5, center.y - 6, 3);
    graphics.lineStyle(3, 0xffc857, 0.28);
    graphics.strokeCircle(center.x, center.y, 14);
    graphics.lineStyle(3, bubble.quickFuse || fuseProgress > 0.72 ? 0xff4d2a : 0xffb020, 0.78 + pulse * 0.2);
    graphics.beginPath();
    graphics.arc(center.x, center.y, 14, -Math.PI / 2, -Math.PI / 2 + fuseProgress * Math.PI * 2, false);
    graphics.strokePath();
    graphics.lineStyle(2, 0xffd166, 0.85);
    graphics.lineBetween(center.x + 7, center.y - 10, center.x + 12, center.y - 16);
    graphics.fillStyle(0xfff1a8, 0.8 + pulse * 0.2);
    graphics.fillCircle(center.x + 13, center.y - 17, 2 + pulse * 1.2);
    if ((bubble.pierce ?? 0) > 0) {
      graphics.lineStyle(2, 0xf87171, 0.88);
      graphics.lineBetween(center.x - 9, center.y + 9, center.x + 9, center.y - 9);
    }
  }

  private drawBlast(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number,
    blast: Position,
    pulse: number,
  ) {
    const px = originX + blast.x * TILE;
    const py = originY + blast.y * TILE;
    const center = tileCenter(originX, originY, blast);
    graphics.fillStyle(0xff3d1f, 0.62 + pulse * 0.16);
    graphics.fillRoundedRect(px + 3, py + 3, TILE - 6, TILE - 6, 7);
    graphics.fillStyle(0xffd166, 0.46);
    graphics.fillCircle(center.x, center.y, 14 + pulse * 4);
    graphics.lineStyle(2, 0xfff1a8, 0.75);
    graphics.lineBetween(center.x - 15, center.y, center.x + 15, center.y);
    graphics.lineBetween(center.x, center.y - 15, center.x, center.y + 15);
  }

  private drawPlayer(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number,
    player: PlayerState,
    isMine: boolean,
    pulse: number,
  ) {
    const center = tileCenter(originX, originY, player);
    const color = toColor(player.color);
    if (isMine) {
      this.drawOwnMarker(graphics, center, player.alive, pulse);
    }
    graphics.fillStyle(0x000000, isMine ? 0.48 : 0.38);
    graphics.fillEllipse(center.x, center.y + (isMine ? 15 : 10), isMine ? 42 : 24, isMine ? 12 : 8);

    const skin = getAgentSkin(player.appearance.skinId);
    if (this.textures.exists(skin.id)) {
      this.drawPlayerSkin(graphics, center, player, skin.id, color, isMine);
      return;
    }

    if (!player.alive) {
      graphics.fillStyle(0x57504a, 0.68);
      graphics.fillRect(center.x - 13, center.y - 13, 26, 26);
      graphics.lineStyle(3, 0x2e2925, 0.9);
      graphics.lineBetween(center.x - 8, center.y - 8, center.x + 8, center.y + 8);
      graphics.lineBetween(center.x + 8, center.y - 8, center.x - 8, center.y + 8);
      this.drawNameTag(center.x, isMine ? center.y - 40 : center.y + 25, player, "#8b8376", isMine);
      return;
    }

    if (player.shieldCharges > 0) {
      graphics.lineStyle(3, 0x60a5fa, 0.55);
      graphics.strokeRect(center.x - 24, center.y - 24, 48, 48);
    }
    if (player.pierceCharges > 0) {
      graphics.lineStyle(2, 0xf87171, 0.5);
      graphics.strokeRect(center.x - 27, center.y - 27, 54, 54);
    }
    if (player.quickFuseCharges > 0) {
      graphics.fillStyle(0xfacc15, 0.88);
      graphics.fillRect(center.x + 13, center.y - 17, 7, 7);
    }

    graphics.fillStyle(0x10100d, 1);
    graphics.fillRect(center.x - 16, center.y - 18, 32, 36);
    graphics.fillStyle(color, 1);
    graphics.fillRect(center.x - 13, center.y - 17, 26, 22);
    graphics.fillStyle(Phaser.Display.Color.ValueToColor(color).darken(28).color, 1);
    graphics.fillRect(center.x - 11, center.y + 5, 22, 13);
    graphics.fillStyle(0xffffff, 0.2);
    graphics.fillRect(center.x - 9, center.y - 14, 8, 5);
    graphics.fillStyle(0x0b0d0c, 1);
    graphics.fillRect(center.x - 7, center.y - 6, 4, 4);
    graphics.fillRect(center.x + 4, center.y - 6, 4, 4);
    graphics.fillRect(center.x - 5, center.y + 3, 10, 3);
    graphics.fillStyle(0x0b0d0c, 1);
    graphics.fillRect(center.x - 12, center.y + 18, 8, 5);
    graphics.fillRect(center.x + 4, center.y + 18, 8, 5);

    const directionTip = directionPoint(player, center);
    graphics.fillStyle(0xfff1a8, 0.9);
    graphics.fillRect(directionTip.x - 3, directionTip.y - 3, 6, 6);

    graphics.lineStyle(2, 0x10100d, 0.9);
    graphics.strokeRect(center.x - 13, center.y - 17, 26, 35);
    this.drawAccessory(graphics, center.x, center.y, player.accessory);
    this.drawNameTag(center.x, isMine ? center.y - 44 : center.y + 25, player, "#f6ead8", isMine);
  }

  private drawPlayerSkin(
    graphics: Phaser.GameObjects.Graphics,
    center: Position,
    player: PlayerState,
    skinKey: string,
    color: number,
    isMine: boolean,
  ) {
    const frameSize = isMine ? 48 : 34;
    const frameTop = isMine ? 31 : 22;
    const imageSize = isMine ? 42 : 30;
    if (player.shieldCharges > 0) {
      graphics.lineStyle(3, 0x60a5fa, 0.55);
      graphics.strokeRect(center.x - frameSize / 2 - 4, center.y - frameTop - 4, frameSize + 8, frameSize + 8);
    }
    if (player.pierceCharges > 0) {
      graphics.lineStyle(2, 0xf87171, 0.5);
      graphics.strokeRect(center.x - frameSize / 2 - 6, center.y - frameTop - 6, frameSize + 12, frameSize + 12);
    }
    if (player.quickFuseCharges > 0 && player.alive) {
      graphics.fillStyle(0xfacc15, 0.88);
      graphics.fillRect(center.x + frameSize / 2 - 8, center.y - frameTop - 4, isMine ? 8 : 5, isMine ? 8 : 5);
    }

    graphics.fillStyle(0x10100d, 1);
    graphics.fillRect(center.x - frameSize / 2, center.y - frameTop, frameSize, frameSize);
    graphics.lineStyle(2, player.alive ? color : 0x8b8376, 0.92);
    graphics.strokeRect(center.x - frameSize / 2, center.y - frameTop, frameSize, frameSize);
    this.add
      .image(center.x, center.y - 4, skinKey)
      .setDisplaySize(imageSize, imageSize)
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setAlpha(player.alive ? 1 : 0.48)
      .setTint(player.alive ? 0xffffff : 0x80786d);

    if (!player.alive) {
      graphics.lineStyle(3, 0x2e2925, 0.9);
      graphics.lineBetween(center.x - 8, center.y - 15, center.x + 8, center.y + 1);
      graphics.lineBetween(center.x + 8, center.y - 15, center.x - 8, center.y + 1);
      this.drawNameTag(center.x, isMine ? center.y - frameTop - 19 : center.y + 22, player, "#8b8376", isMine);
      return;
    }

    const directionTip = directionPoint(player, center);
    graphics.fillStyle(0xfff1a8, 0.9);
    graphics.fillRect(directionTip.x - 3, directionTip.y - 3, 6, 6);
    this.drawNameTag(center.x, isMine ? center.y - frameTop - 19 : center.y + 22, player, "#f6ead8", isMine);
  }

  private drawOwnMarker(graphics: Phaser.GameObjects.Graphics, center: Position, alive: boolean, pulse: number) {
    const markerColor = alive ? 0xf6c453 : 0x8b8376;
    const radius = TILE * 0.82 + pulse * 5;
    graphics.lineStyle(6, 0x060907, 0.82);
    graphics.strokeCircle(center.x, center.y - 4, radius + 2);
    graphics.lineStyle(4, markerColor, 0.92);
    graphics.strokeCircle(center.x, center.y - 4, radius);
    graphics.lineStyle(2, 0xf7e7c7, 0.82);
    graphics.lineBetween(center.x - radius - 5, center.y - 4, center.x - radius + 7, center.y - 4);
    graphics.lineBetween(center.x + radius - 7, center.y - 4, center.x + radius + 5, center.y - 4);
    graphics.lineBetween(center.x, center.y - radius - 9, center.x, center.y - radius + 5);
    graphics.lineBetween(center.x, center.y + radius - 8, center.x, center.y + radius + 4);
    graphics.fillStyle(markerColor, 0.95);
    graphics.fillTriangle(center.x, center.y - radius - 21, center.x - 9, center.y - radius - 8, center.x + 9, center.y - radius - 8);
  }

  private drawAccessory(graphics: Phaser.GameObjects.Graphics, x: number, y: number, accessory: PlayerState["accessory"]) {
    if (accessory === "cap") {
      graphics.fillStyle(0xf7e7c7, 1);
      graphics.fillRect(x - 13, y - 22, 26, 5);
      graphics.fillRect(x + 5, y - 17, 13, 4);
    } else if (accessory === "visor") {
      graphics.fillStyle(0x0ea5e9, 1);
      graphics.fillRect(x - 10, y - 8, 20, 6);
      graphics.lineStyle(1, 0x082f49, 1);
      graphics.strokeRect(x - 10, y - 8, 20, 6);
    } else if (accessory === "scarf") {
      graphics.fillStyle(0xef4444, 1);
      graphics.fillRect(x - 14, y + 2, 28, 5);
      graphics.fillRect(x + 10, y + 7, 10, 9);
    } else if (accessory === "crown") {
      graphics.fillStyle(0xfacc15, 1);
      graphics.fillRect(x - 12, y - 25, 6, 9);
      graphics.fillRect(x - 3, y - 29, 6, 13);
      graphics.fillRect(x + 6, y - 25, 6, 9);
      graphics.fillStyle(0xca8a04, 1);
      graphics.fillRect(x - 12, y - 17, 24, 4);
    } else if (accessory === "antenna") {
      graphics.fillStyle(0xd9ffe9, 1);
      graphics.fillRect(x - 1, y - 28, 3, 12);
      graphics.fillStyle(0x5bd6a0, 1);
      graphics.fillRect(x - 4, y - 33, 9, 7);
    }
  }

  private drawNameTag(x: number, y: number, player: PlayerState, color: string, isMine = false) {
    const text = isMine ? `${this.labels.me} · ${player.name}` : player.name.slice(0, 2).toUpperCase();
    this.add
      .text(x, y, text, {
        color,
        fontFamily: "Sora, sans-serif",
        fontSize: isMine ? "18px" : "9px",
        fontStyle: "900",
        backgroundColor: isMine ? "rgba(6, 9, 7, 0.9)" : "rgba(16, 15, 12, 0.72)",
        padding: isMine ? { x: 8, y: 4 } : { x: 4, y: 2 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(isMine ? 12 : 7);
  }

  private drawBoardHud(state: MatchState, originX: number, originY: number, boardWidth: number) {
    const alive = state.players.filter((player) => player.alive).length;
    const statusLabel = this.labels[state.status] ?? state.status;
    this.add
      .text(originX, originY - 27, `${this.labels.tick} ${state.tick}  /  ${alive} ${this.labels.active}  /  ${this.labels.seed} ${state.seed}`, {
        color: "#b8aa92",
        fontFamily: "Sora, sans-serif",
        fontSize: "11px",
        fontStyle: "700",
      })
      .setOrigin(0, 0.5);
    this.add
      .text(originX + boardWidth, originY - 27, statusLabel, {
        color: state.status === "finished" ? "#f59e0b" : "#84cc16",
        fontFamily: "Sora, sans-serif",
        fontSize: "11px",
        fontStyle: "800",
      })
      .setOrigin(1, 0.5);
  }
}

export function PhaserBoard({ state, decision, overlay, myAgentId }: PhaserBoardProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const labels = useMemo<BoardLabels>(
    () => ({
      tick: t("board.tick"),
      active: t("board.active"),
      seed: t("board.seed"),
      waiting: t("status.waiting"),
      running: t("status.running"),
      finished: t("status.finished"),
      me: t("board.me"),
    }),
    [t],
  );

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: "#100f0c",
      antialias: false,
      pixelArt: true,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      scene: AgentBomberScene,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pushFrame = () => {
      const scene = gameRef.current?.scene.getScene("agent-bomber-board") as AgentBomberScene | undefined;
      scene?.setFrame(state, decision, overlay, labels, myAgentId);
    };
    pushFrame();
    const id = window.setTimeout(pushFrame, 90);
    return () => window.clearTimeout(id);
  }, [state, decision, overlay, labels, myAgentId]);

  return <div ref={hostRef} className="phaser-host" aria-label="Tactical match board" />;
}

function tileCenter(originX: number, originY: number, position: Position) {
  return {
    x: originX + position.x * TILE + TILE / 2,
    y: originY + position.y * TILE + TILE / 2,
  };
}

function projectedDangerCells(state: MatchState): Position[] {
  const cells = new Map<string, Position>();
  for (const blast of state.blasts) {
    cells.set(`${blast.x},${blast.y}`, { x: blast.x, y: blast.y });
  }
  for (const bubble of state.bubbles) {
    for (const cell of blastCells(state, bubble)) {
      cells.set(`${cell.x},${cell.y}`, cell);
    }
  }
  return [...cells.values()];
}

function blastCells(state: MatchState, bubble: BubbleState): Position[] {
  const cells: Position[] = [{ x: bubble.x, y: bubble.y }];
  for (const direction of [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]) {
    let pierceLeft = bubble.pierce ?? 0;
    for (let distance = 1; distance <= bubble.range; distance += 1) {
      const cell = { x: bubble.x + direction.x * distance, y: bubble.y + direction.y * distance };
      const kind = state.map.rows[cell.y]?.[cell.x];
      if (!kind || kind === "solid") break;
      cells.push(cell);
      if (kind === "soft") {
        if (pierceLeft <= 0) break;
        pierceLeft -= 1;
      }
    }
  }
  return cells;
}

function fallbackPath(state: MatchState, decision: DecisionLogEntry | undefined): Position[] {
  const player = state.players.find((entry) => entry.id === decision?.agentId && entry.alive) ?? state.players.find((entry) => entry.alive);
  if (!player || !decision?.target) return [];
  return [
    { x: player.x, y: player.y },
    { x: decision.target.x, y: decision.target.y },
  ];
}

function cellInsideCircle(x: number, y: number, center: Position, radius: number): boolean {
  const dx = x - center.x;
  const dy = y - center.y;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

function directionPoint(player: PlayerState, center: Position): Position {
  const distance = 12;
  const direction = player.name.length % 4;
  if (direction === 0) return { x: center.x, y: center.y - distance };
  if (direction === 1) return { x: center.x + distance, y: center.y };
  if (direction === 2) return { x: center.x, y: center.y + distance };
  return { x: center.x - distance, y: center.y };
}

function tileNoise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function toColor(hex: string): number {
  try {
    return Phaser.Display.Color.HexStringToColor(hex).color;
  } catch {
    return 0xf59e0b;
  }
}

function itemColor(type: ItemType): number {
  const colors: Record<ItemType, number> = {
    rangeUp: 0xfacc15,
    capacityUp: 0xa3e635,
    speedUp: 0x48cae4,
    shield: 0x60a5fa,
    pierce: 0xf87171,
    quickFuse: 0xfb923c,
  };
  return colors[type];
}

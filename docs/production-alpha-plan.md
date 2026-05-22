# Production Alpha Plan

## Status

The MVP is complete enough for local closed-loop demos:

- Create or select an Agent.
- Configure one player-owned chameleon profile.
- Set a template-backed natural-language strategy.
- Start 4-agent royale matches.
- Watch matches live.
- Open replay, key events, decision reasons, and strategy suggestions.
- View recent matches and a simplified leaderboard.

Production Alpha should not expand the MVP blindly. The next goal is to make the loop reliable, measurable, and understandable after repeated use.

## Alpha Goals

1. Make Agent behavior measurably better.
2. Make strategy editing understandable to non-technical users.
3. Make rooms and matches durable enough for repeated local sessions.
4. Make replay and decision data versioned and inspectable.
5. Make the pixel identity system feel like one coherent asset pipeline.

## Workstreams

### 1. Gameplay Reliability

Ship benchmark-driven Agent tuning before adding more features.

- Track self-elimination rate, opponent eliminations, win rate, item collection, wall breaks, bubble usage, high-risk decisions, and wait ratio.
- Add golden benchmark seeds for 1v1 and 4-agent matches.
- Set target thresholds before changing planner logic.
- Improve attack quality: only commit bombs when escape and opponent pressure are both credible.
- Improve retreat quality: reduce moves that step into known blast windows.

Alpha acceptance:

- `pnpm sim:benchmark -- --count 200 --agents 4` completes without uncaught exceptions.
- Self-elimination rate trends downward across benchmark runs.
- At least one aggressive strategy produces opponent eliminations without a higher self-elimination rate than baseline.

### 2. Strategy UX

Keep the user-facing strategy surface small.

- Default path: choose tactical style, write one sentence, save.
- Advanced path: show compiled parameters in a collapsed panel.
- Replay page should translate failure into a next strategy sentence.
- Avoid exposing raw planner vocabulary unless the user opens advanced details.

Alpha acceptance:

- A new user can set a strategy without reading parameter docs.
- Replay suggestions can be pasted back into the strategy input directly.

### 3. Room Model

Move from a local control panel into a clear room lifecycle.

- Room states: `draft`, `ready`, `running`, `finished`.
- Participants can join, leave, lock character, lock strategy, and ready up.
- Match start requires valid participant count and ready status.
- Persist room snapshots locally before adding accounts or networking.

Alpha acceptance:

- 4-agent royale rooms use one clear state model.
- Refreshing the web page does not lose the current room draft.

### 4. Data Hardening

Keep SQLite for Alpha, but make data contracts explicit.

- Add schema migration tracking.
- Add replay file version.
- Add decision log version.
- Add benchmark output version.
- Add cleanup policy for stale running matches.

Alpha acceptance:

- Old replay files either load or fail with a clear version error.
- Runtime cleanup handles abandoned matches.

### 5. Pixel Identity Pipeline

The current MVP uses selected Social Chameleon generated images. Alpha should make generation intent explicit.

- Treat selected generated images as skins with metadata traits.
- Keep manual skin selection as an advanced option.
- Add a deterministic character generator from cue + strategy + seed.
- Later: compose new skins from source layers into app-owned output.

Alpha acceptance:

- Character generation is reproducible from the same cue and seed.
- Selected traits are shown as first-class character identity, not decorative labels.

## First Implementation Slice

1. Add `sim:benchmark`.
2. Capture baseline metrics for 1v1 and 4-agent matches.
3. Tune planner against benchmark failures.
4. Add room state model after behavior metrics are visible.



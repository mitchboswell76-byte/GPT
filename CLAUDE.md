# Creature Reserve — notes for AI sessions

Read `docs/PROJECT_BRIEF.md` (architecture, loop, controls), `docs/ASSETS.md`
(model findings and repairs) and `docs/ROADMAP.md` before larger changes.

## Commands
- `npm run dev` — Vite dev server on :5173 (needed by the playtest tools)
- `npm run build` — production build to `dist/`
- `npm run assets` — rebuild runtime GLBs from `assets-src/` and regenerate textures
- `npm run audio` — rebuild `public/assets/audio/` from the pinned recordings in `tools/audio/sources.json`
- `node tools/playtest/stage1_build.mjs <out> <profile>` then `stage2_puppy.mjs`, `stage3_care.mjs`
  — real-input playthrough in headless Chromium (Q=low|medium|high env var)
- `node tools/playtest/shot.mjs out.png "q=low&rigtest=dog_puppy&speed=1"` — single frame

## Conventions
- Plain ES modules + three.js; no framework. Tunables live in `src/data/config.js`.
- Models face +Z; +X is an animal's left. Yaw: forward = (sin yaw, 0, cos yaw).
- Procedural bone edits must start from the bind pose each frame (`CreatureBody.resetPose`).
- Species, elemental affinity and inherited traits are separate fields — keep them separate.
- Saves are versioned JSON (`core/Save.js`); add migrations rather than breaking old saves.
- Headless rendering is software (SwiftShader): step frames with `__game.step(n, dt, render)`
  and render only for screenshots.

---
name: trail-map-dev
description: Guide for continuing development of the offline-trail-map project (Expo/React Native app + PWA in docs/ + manual in manual/). Use when adding features, fixing bugs, or releasing changes to the trail map app.
---

# offline-trail-map development guide

Project language: README, manual and UI text are in **Thai**. Keep new user-facing text in Thai and match existing wording.

## Layout
- **Native app (Expo + MapLibre RN):** `App.tsx` (all screens), `trailStyle.ts` (map style: hillshade, peaks, trails, optional contours via `CONTOUR_TILES_URL`), `app.json`, `eas.json`.
- **PWA (plain JS, no build step):** `docs/` is served as-is (GitHub Pages). `index.html` loads one script per module (`app.js`, `nav.js`, `route.js`, `geo.js`, `stars.js`, `wind.js`, `sensors.js`, `cam.js`, `sound.js`, `jump.js`, `projects.js`, `symbols.js`, `print.js`, `export.js`, `paper.js`, `plate.js`, `common.js`). Shared helpers live in `common.js`.
- **Docs:** `manual/manual.html` (user manual), `manual/plan.html` (mobile/pricing plan), `README.md`.
- **CI:** `.github/workflows/build-ios.yml` builds an unsigned iOS .ipa.

## Rules for PWA changes (docs/)
1. Plain ES5-style JS (`var`, `function`) matching surrounding code; no bundler or npm dependencies.
2. Adding a new JS/CSS/asset file: add it to `SHELL_FILES` in `docs/sw.js` **and** reference it in `index.html`.
3. Any change to a cached file: bump `SHELL_CACHE` (currently `shell-vNN`) in `docs/sw.js`, otherwise users keep the stale offline copy.
4. Everything must work offline: no runtime CDN requests; vendor libs go in `docs/lib/`.
5. Never bulk-download tiles from tile.openstreetmap.org (policy violation); tile sources are OpenFreeMap and AWS Terrain Tiles.

## Rules for native app changes
1. Run `npm install` then `npm run typecheck` (`tsc --noEmit`) before committing.
2. The app uses native modules, so it can't run in Expo Go; test via `npx expo run:android|ios` or EAS Build (`eas build --platform android --profile preview`).
3. Keep the download-size guard (~20,000 tiles) and zoom range 10–15 unless deliberately changing them; update README if so.

## Track recording and team (native app)
- `tracker.ts`: one background location task (`TRACK_TASK`) serves both trip recording (JSONL files in `Paths.document/tracks/`) and team position sharing (`setLocationListener`). Stop it only when neither is active (`stopLocationTaskIfIdle`).
- `team.ts` + `TeamPanel.tsx`: WebSocket client for `server/` (Node + `ws`, in-memory teams). Limits: 10 members, name ≤16 chars, 10 unique colors. `TEAM_COLORS` in `team.ts` must match `COLORS` in `server/index.js`.
- Server changes: run `cd server && npm test`. Protocol is documented in `server/README.md`.

- PWA contour lines: `docs/contour.js` (TrailContour) uses the vendored `docs/lib/maplibre-contour.min.js` (BSD-3, license file alongside) on the same Terrarium DEM as the hillshade; thresholds per zoom in `THRESHOLDS`. Base `paper` shows all imported paper maps via `TrailPaper.setSolo`.
- PWA counterparts: `docs/rec.js` (TrailRec: trips in localStorage, GPX via TrailExport.share) and `docs/team.js` (TrailTeam, same server protocol; shares the screen wake lock through `TrailRec.holdWake`). Browser E2E was done with Playwright against a local `server/` and stubbed map tiles.

## Workflow
1. Read the relevant file(s) fully before editing; files are 80–1100 lines.
2. Make the smallest change that fits the existing style.
3. Verify: typecheck for `.ts/.tsx`; for `docs/` run `node --check docs/<file>.js` on touched files and, if possible, serve `docs/` (`python3 -m http.server -d docs`) and open with Playwright/Chromium to confirm no console errors.
4. Update `README.md` / `manual/manual.html` when behavior visible to users changes.
5. Commit with a clear message; push to a feature branch, open a PR only if asked.

## Known gaps / roadmap (from README)
- Draw/edit routes, drop pins, GPX import/export in the native app (the PWA already has `route.js` / `export.js`; check there first for reusable logic).
- Contour lines disabled until a tile URL is set in `trailStyle.ts`.
- iOS sideload build and map style are untested on real devices; ask the user for error text when they report failures.
- Paid map provider or self-hosted tiles recommended before public release.

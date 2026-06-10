# MG Community Hub

Community Hub for **Magic Garden / Magic Circle** — friends, messages, groups,
leaderboards, public rooms and chat importing, as a standalone userscript.
Companion of [Arie's Mod](https://github.com/Ariedam64/MG-AriesMod): both work
on their own and side by side (they share the game store capture and game data
through cross-mod page globals).

## Install

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Install the script: **[mg-community-hub.user.js](https://github.com/Ariedam64/MG-CommunityHub/raw/refs/heads/main/dist/mg-community-hub.user.js)**
3. Open the game — a Community Hub button appears in the toolbar.

Supported surfaces: magicgarden.gg, magiccircle.gg, starweaver.org and the
Discord Activity.

If you were using the hub inside Arie's Mod before: your Discord login and
settings are kept automatically.

## Development

```bash
npm install
cp .env.example .env   # BUILD_DEV=1 → also produces the dev build
npm run build          # dist/mg-community-hub.user.js (+ .dev.user.js)
npm run watch          # rebuilds the dev build on change
npm run typecheck
```

Two build channels from the same source (esbuild `define` `__HUB_DEV_BUILD__`):

| Channel | File | Notes |
|---|---|---|
| public | `dist/mg-community-hub.user.js` | distributed build |
| dev | `dist/mg-community-hub.dev.user.js` | adds dev-only tooling (Search tab), local only |

For local development, point a loader userscript at the dev build:

```
// @require file://<repo>/dist/mg-community-hub.dev.user.js
```

## Repo map

- `src/main.ts` — boot sequence
- `src/api/` — backend client (auth, endpoints, SSE/long-poll streams, caches)
- `src/store/` — jotai store capture + `__MG_STORE_BRIDGE__` cross-mod sharing
- `src/data/` — game catalogs (mg-api, hardcoded fallback)
- `src/game/` — minimal game-side helpers (fake modals, garden preview, TOS hook)
- `src/ui/` — toolbar button, hub panel and tabs
- `src/storage/` — persistence (`mgch_hub` blob, shared `aries_api_key`)

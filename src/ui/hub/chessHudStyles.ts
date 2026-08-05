// src/ui/hub/chessHudStyles.ts
//
// The chess panel's stylesheet, injected once.
//
// The panel used to be styled inline, which cannot express a hover state, a
// transition or a keyframe - so the clock could not flash as it ran out and the
// buttons could not answer the pointer. A sheet costs one injection and gets all
// three.
//
// Class names are prefixed and the sheet only ever matches inside .mgchess, so
// nothing here can reach the game's own DOM.

const STYLE_ID = "mg-chess-hud-css";

/** Palette taken from the hub panel, so the two read as one product. */
const CSS = `
.mgchess {
  position: fixed;
  width: 244px;
  box-sizing: border-box;
  padding: 0;
  border-radius: 14px;
  border: 1px solid #2a3543;
  background: linear-gradient(180deg, #141d29, #0a1119);
  box-shadow: 0 18px 44px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset;
  color: #e7eef7;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  user-select: none;
  touch-action: none;
  overflow: hidden;
}

/* Header doubles as the drag handle, so the grip is where the cursor already is. */
.mgchess-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: grab;
  background: rgba(255,255,255,0.025);
  border-bottom: 1px solid #202b38;
}
.mgchess-header:active { cursor: grabbing; }

.mgchess-grip {
  color: #4a5a6c;
  font-size: 13px;
  letter-spacing: 1px;
  line-height: 1;
}

.mgchess-title {
  flex: 1 1 auto;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: #93a4b7;
}

.mgchess-watchers {
  flex: 0 0 auto;
  font-size: 11px;
  color: #93a4b7;
  font-variant-numeric: tabular-nums;
}

/* ── Sides ────────────────────────────────────────────────────────────────── */

.mgchess-sides { padding: 6px; }

.mgchess-side {
  position: relative;
  padding: 7px 9px 7px 11px;
  border-radius: 9px;
  transition: background 140ms ease;
}

/* The side to move is the one thing worth finding at a glance. */
.mgchess-side.is-active { background: rgba(94,234,212,0.07); }
.mgchess-side.is-active::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 2px;
  background: #5eead4;
}

.mgchess-side-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mgchess-dot {
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid #5d6b7c;
}
.mgchess-dot.is-white { background: #ece6d8; }
.mgchess-dot.is-black { background: #263140; }

.mgchess-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.mgchess-time {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  font-size: 15px;
  letter-spacing: 0.2px;
  color: #cdd9e6;
  transition: color 140ms ease;
}
.mgchess-side.is-active .mgchess-time { color: #f2f7fc; }

/* Only the running clock is allowed to shout. */
.mgchess-side.is-active .mgchess-time.is-urgent {
  color: #ff7a7a;
  animation: mgchess-pulse 1s ease-in-out infinite;
}
@keyframes mgchess-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.mgchess-caps {
  display: none;
  align-items: center;
  flex-wrap: wrap;
  gap: 1px;
  min-height: 15px;
  margin: 4px 0 0 19px;
}
.mgchess-caps.is-shown { display: flex; }

.mgchess-cap {
  width: 15px;
  height: 15px;
  display: inline-block;
}
.mgchess-cap + .mgchess-cap { margin-left: -4px; }

.mgchess-cap-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

/* A black piece is almost the panel's own colour, so it gets a thin edge to
   sit on. The white ones already stand out and are left alone. */
.mgchess-cap-img.is-black {
  filter: drop-shadow(0 0 1px rgba(226,236,247,0.8));
}

.mgchess-edge {
  margin-left: 7px;
  font-size: 11px;
  font-weight: 600;
  color: #7fd1a6;
  font-variant-numeric: tabular-nums;
}

/* ── Banners ──────────────────────────────────────────────────────────────── */

.mgchess-banner {
  display: none;
  margin: 0 9px 9px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(255,255,255,0.04);
  border: 1px solid #2b3745;
  font-size: 12px;
}
.mgchess-banner.is-shown { display: block; }
.mgchess-banner.is-result {
  font-weight: 650;
  font-size: 13px;
  text-align: center;
  background: rgba(94,234,212,0.08);
  border-color: rgba(94,234,212,0.25);
}

.mgchess-banner-text { margin-bottom: 7px; }

.mgchess-status {
  display: none;
  margin: 0 12px 9px;
  font-size: 11px;
  color: #7f90a3;
}
.mgchess-status.is-shown { display: block; }

/* ── Controls ─────────────────────────────────────────────────────────────── */

.mgchess-controls {
  display: flex;
  gap: 6px;
  padding: 0 9px 10px;
}
.mgchess-controls:empty { display: none; }

.mgchess-btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 7px 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  color: #cdd9e6;
  background: rgba(255,255,255,0.045);
  border: 1px solid #2e3a49;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 130ms ease, border-color 130ms ease, color 130ms ease;
}
.mgchess-btn:hover {
  background: rgba(94,234,212,0.1);
  border-color: rgba(94,234,212,0.35);
  color: #5eead4;
}
.mgchess-btn:active { transform: translateY(1px); }

.mgchess-btn.is-primary {
  background: rgba(127,209,166,0.15);
  border-color: rgba(127,209,166,0.4);
  color: #a5e8c6;
}
.mgchess-btn.is-primary:hover {
  background: rgba(127,209,166,0.25);
  border-color: rgba(127,209,166,0.6);
  color: #c8f3dd;
}

/* Armed resign: the second click is the one that counts. */
.mgchess-btn.is-danger {
  background: rgba(255,107,107,0.14);
  border-color: rgba(255,107,107,0.45);
  color: #ff9a9a;
}
.mgchess-btn.is-danger:hover {
  background: rgba(255,107,107,0.22);
  border-color: rgba(255,107,107,0.6);
  color: #ffb5b5;
}

/* ── Promotion ────────────────────────────────────────────────────────────── */

.mgchess-promo {
  display: none;
  padding: 9px 9px 10px;
  border-top: 1px solid #202b38;
  background: rgba(255,255,255,0.02);
}
.mgchess-promo.is-shown { display: block; }

.mgchess-promo-label {
  font-size: 11px;
  color: #7f90a3;
  margin-bottom: 7px;
}

.mgchess-promo-row { display: flex; gap: 6px; }

.mgchess-promo-btn {
  flex: 1 1 0;
  padding: 4px 0 6px;
  font-size: 20px;
  line-height: 1.1;
  color: #e7eef7;
  background: rgba(255,255,255,0.045);
  border: 1px solid #2e3a49;
  border-radius: 8px;
  cursor: pointer;
  transition: background 130ms ease, border-color 130ms ease;
}
.mgchess-promo-btn:hover {
  background: rgba(94,234,212,0.12);
  border-color: rgba(94,234,212,0.4);
}
`;

export function ensureChessHudStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

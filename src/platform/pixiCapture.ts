// src/platform/pixiCapture.ts
// A game build moved the right-side icon rail (Chat, Leaderboard, Stats,
// Notifications, ...) from real DOM buttons to native Pixi rendering, so
// anything that used to anchor next to it via `document.querySelector`
// (see the old ui/toolbarButton.ts) has nothing left to find. Buttons that
// need to live in that rail now have to be inserted directly into the Pixi
// scene graph instead — which first requires a handle on the renderer and
// on PIXI's own `Text`/`Container` constructors (Text in particular is not
// safely substitutable: it carries a renderer-specific glyph-metrics cache).
//
// If Arie's Mod is also running, it already exposes this exact shape on
// `__MG_SPRITE_STATE__` (a much heavier boot that also loads the sprite
// atlas) — reuse it instead of deriving our own. Running standalone, this
// module does its own minimal capture: just enough to draw text in the
// game's scene graph, no atlas/texture loading involved.
import { pageWindow, shareGlobal, readSharedGlobal } from "./page-context";
import { sleep } from "./mgCommon";
import { findAcrossBranches } from "./pixiTree";

export interface PixiCaptureCtors {
  Text: any;
  Container: any;
}

export interface PixiCaptureState {
  renderer: any;
  app: any;
  ctors: PixiCaptureCtors | null;
}

const STATE_GLOBAL = "__MG_CH_PIXI_STATE__";
const CTORS_RETRY_MS = 150;
const RENDERER_HEALTH_CHECK_MS = 1000;
const REQUIRED_STALE_STREAK = 3;

function canvasOf(renderer: any): any {
  return renderer?.canvas || renderer?.view?.canvas || renderer?.view || null;
}

function isRiveLikeNode(node: any): boolean {
  return !!(node?.artboard || node?.stateMachine || node?.rive);
}

/**
 * Finds any live Text node to borrow its constructor from. Prefers a real
 * Pixi v8 text node (`renderPipeId === 'text'`) — a bare "has .text and
 * .style" match can also hit the game's Rive-based display objects, whose
 * constructor then throws when instantiated with `{ text, style }`.
 */
function findTextCtor(stage: any): any {
  const strict = findAcrossBranches(
    stage,
    (node: any) =>
      (typeof node?.text === "string" || typeof node?.text === "number") &&
      !!node?.style &&
      node.renderPipeId === "text",
  );
  if (strict) return strict.constructor;

  const loose = findAcrossBranches(
    stage,
    (node: any) =>
      (typeof node?.text === "string" || typeof node?.text === "number") &&
      !!node?.style &&
      !isRiveLikeNode(node),
  );
  return loose?.constructor ?? null;
}

function fastCheckPixi(): { app: any; renderer: any } | null {
  const root = pageWindow as any;
  const app = root.__PIXI_APP__ || root.PIXI_APP || root.app || null;
  let renderer = root.__PIXI_RENDERER__ || root.PIXI_RENDERER__ || root.renderer || app?.renderer || null;
  if (!renderer && root.__PIXI_DEVTOOLS__?.renderers?.size > 0) {
    renderer = [...(root.__PIXI_DEVTOOLS__.renderers as Set<any>)][0] ?? null;
  }
  if (!app && !renderer) return null;
  return { app, renderer };
}

function hookPixiInit(onCandidate: (app: any, renderer: any) => void): void {
  const root = pageWindow as any;
  const install = (name: string, cb: (...args: any[]) => void) => {
    const prev = root[name];
    root[name] = function (this: unknown, ...args: any[]) {
      try {
        cb(...args);
      } finally {
        if (typeof prev === "function") {
          try {
            prev.apply(this, args);
          } catch {
            /* ignore */
          }
        }
      }
    };
  };
  install("__PIXI_APP_INIT__", (app: any) => onCandidate(app, app?.renderer ?? null));
  install("__PIXI_RENDERER_INIT__", (renderer: any) => onCandidate(null, renderer));
}

export function getStage(state: PixiCaptureState): any {
  return state.app?.stage ?? state.renderer?.lastObjectRendered ?? state.renderer?.stage ?? null;
}

export function getPixiCaptureState(): PixiCaptureState | null {
  const shared = readSharedGlobal<any>("__MG_SPRITE_STATE__");
  if (shared?.renderer && shared?.ctors?.Text) {
    return {
      renderer: shared.renderer,
      app: shared.app ?? null,
      ctors: { Text: shared.ctors.Text, Container: shared.ctors.Container ?? null },
    };
  }
  return readSharedGlobal<PixiCaptureState>(STATE_GLOBAL) ?? null;
}

let captureStarted = false;

export function startPixiCapture(): void {
  if (captureStarted) return;
  captureStarted = true;

  const state: PixiCaptureState = { renderer: null, app: null, ctors: null };
  shareGlobal(STATE_GLOBAL, state);

  let latestApp: any = null;
  let latestRenderer: any = null;
  const applyCandidate = (app: any, renderer: any) => {
    if (app) latestApp = app;
    if (renderer) latestRenderer = renderer;
  };

  hookPixiInit(applyCandidate);
  const fast = fastCheckPixi();
  if (fast) applyCandidate(fast.app, fast.renderer);

  const deriveCtors = async () => {
    for (;;) {
      if (!latestApp && !latestRenderer) {
        const retry = fastCheckPixi();
        if (retry) applyCandidate(retry.app, retry.renderer);
      }
      const stage = latestApp?.stage ?? latestRenderer?.lastObjectRendered ?? latestRenderer?.stage ?? null;
      const textCtor = stage ? findTextCtor(stage) : null;
      if (textCtor) {
        state.renderer = latestRenderer;
        state.app = latestApp;
        state.ctors = { Text: textCtor, Container: stage.constructor };
        return;
      }
      await sleep(CTORS_RETRY_MS);
    }
  };
  void deriveCtors();

  // The browser can fully tear down and recreate the game's WebGL renderer
  // after the tab is backgrounded a while (GPU context reclaimed on
  // alt-tab) — without this, `state` would keep pointing at a dead,
  // detached canvas forever with no way to recover short of a page reload.
  let staleStreak = 0;
  pageWindow.setInterval(() => {
    const canvas = canvasOf(state.renderer);
    const healthy = !!canvas && typeof document !== "undefined" && document.contains(canvas);
    if (healthy) {
      staleStreak = 0;
      return;
    }
    staleStreak += 1;
    if (staleStreak < REQUIRED_STALE_STREAK) return;
    if (!latestRenderer || latestRenderer === state.renderer) return;
    const freshCanvas = canvasOf(latestRenderer);
    if (!freshCanvas || !document.contains(freshCanvas)) return;

    state.renderer = latestRenderer;
    state.app = latestApp;
    state.ctors = null;
    staleStreak = 0;
    void deriveCtors();
  }, RENDERER_HEALTH_CHECK_MS);
}

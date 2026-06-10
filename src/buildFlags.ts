// src/buildFlags.ts
// Build-channel flag injected by esbuild (see esbuild.config.mjs `define`).
// __HUB_DEV_BUILD__ is replaced by the literal `true` in the dev build
// (mg-community-hub.dev.user.js) and `false` in the public build
// (mg-community-hub.user.js).
//
// Use the global `__HUB_DEV_BUILD__` directly in conditionals when the
// dev-only code must be TREE-SHAKEN out of the public bundle (esbuild folds
// the literal and drops the dead branch + its imports). The re-exported
// IS_DEV_BUILD const is fine for plain runtime checks.

declare global {
  const __HUB_DEV_BUILD__: boolean;
}

export const IS_DEV_BUILD: boolean = __HUB_DEV_BUILD__;

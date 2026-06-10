// src/main.ts
// MG Community Hub — standalone userscript entry point.
// Boot order matters:
//   1. OAuth bridge page short-circuit (auth popup callback).
//   2. Discord Activity CSP interceptor.
//   3. Game data fetch (shared with Arie's Mod via window.__MG_DATA_STATE__).
//   4. Toolbar button + hub panel (self-injecting, waits for the game UI).
//   5. Backend heartbeat + event streams (this mod owns them — the matching
//      Arie's Mod release no longer starts its own).

import {
  initAuthBridgeIfNeeded,
  startPlayerStateReportingWhenGameReady,
  initializeStreamsWhenReady,
} from "@/api";
import {
  installEmojiDataFetchInterceptor,
  isDiscordActivityContext,
} from "@/platform/discordCsp";
import { pageWindow, shareGlobal } from "@/platform/page-context";
import { MGVersion } from "@/platform/mgVersion";
import { MGData } from "@/data/dynamic";
import { warmupSpriteCache } from "@/ui/spriteIcons";
import { tos } from "@/game/tileObjectSystem";
import { renderCommunityHub } from "@/ui/hub";

(function () {
  "use strict";

  // Auth popup callback page: capture the API key and stop.
  if (initAuthBridgeIfNeeded()) return;

  if (isDiscordActivityContext()) {
    installEmojiDataFetchInterceptor();
  }

  // Game catalogs (plants/pets/abilities/…) served by mg-api. The capture
  // state lives on the page window, so when Arie's Mod runs alongside us the
  // fetch only happens once for both mods.
  MGData.init();
  if (!(pageWindow as unknown as Record<string, unknown>).MGData) {
    shareGlobal("MGData", MGData);
  }

  MGVersion.prefetch();
  try {
    warmupSpriteCache();
  } catch {}

  // Tile object system hook — needed by the friend garden preview to sync
  // tiles visually. Must install before the game engine initializes.
  try {
    tos.init();
  } catch {}

  // An Arie's Mod old enough to still embed the Community Hub renders it via
  // the same window.__qws_cleanup_community_hub slot — whichever mod renders
  // last wins, so only one hub ever exists. Still worth telling the user.
  if ((window as unknown as Record<string, unknown>).__qws_cleanup_community_hub) {
    console.warn(
      "[CommunityHub] An embedded Community Hub (old Arie's Mod) is present — " +
        "update Arie's Mod to its hub-less release to avoid duplicate backend traffic.",
    );
  }

  const bootHub = async () => {
    try {
      await renderCommunityHub();
    } catch (e) {
      console.error("[CommunityHub] renderCommunityHub failed:", e);
    }
  };
  if (document.head) {
    void bootHub();
  } else {
    document.addEventListener("DOMContentLoaded", () => void bootHub(), { once: true });
  }

  // Backend sync: heartbeat (collect-state) + SSE/long-poll streams.
  startPlayerStateReportingWhenGameReady();
  initializeStreamsWhenReady();
})();

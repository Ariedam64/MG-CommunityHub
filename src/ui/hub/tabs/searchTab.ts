// src/ui/menus/communityHub/tabs/searchTab.ts
// Admin-style "Search any player" tab. Uses the leaderboard/coins endpoint
// (which accepts a `query` matching name OR playerId) to find any player —
// even ones not in the user's friend list — and opens the standard player
// detail view on click.

import { fetchLeaderboardCoins, fetchPlayerDetailsComplete } from "@/api";
import type { LeaderboardRow } from "@/api";
import { createPlayerDetailView } from "./playerDetailView";
import { stopAnyPreview } from "./playerViewActions";
import {
  style,
  ensureSharedStyles,
  createKeyBlocker,
  createLoadingView,
  createErrorView,
} from "../shared";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SEARCH_LIMIT = 20;

export function createSearchTab() {
  ensureSharedStyles();

  const root = document.createElement("div");
  style(root, {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    gap: "10px",
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastQuery = "";
  let inFlight = false;
  let currentDetailView: HTMLElement | null = null;

  /* ── Search input ─────────────────────────────────────────────────────────*/
  const searchBar = document.createElement("input");
  searchBar.type = "text";
  searchBar.placeholder = "Search any player by name or id…";
  style(searchBar, {
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.04)",
    color: "#e7eef7",
    fontSize: "13px",
    outline: "none",
    transition: "border-color 150ms ease",
  });
  searchBar.onfocus = () => style(searchBar, { borderColor: "rgba(94,234,212,0.35)" });
  searchBar.onblur = () => style(searchBar, { borderColor: "rgba(255,255,255,0.12)" });

  // Block game keys while typing in the search input.
  const keyBlocker = createKeyBlocker(() => document.activeElement === searchBar);
  keyBlocker.attach();

  /* ── Status line ──────────────────────────────────────────────────────────*/
  const status = document.createElement("div");
  style(status, {
    fontSize: "11px",
    color: "rgba(226,232,240,0.5)",
    padding: "0 2px",
  });
  status.textContent = `Type at least ${MIN_QUERY_LENGTH} characters.`;

  /* ── Results list ─────────────────────────────────────────────────────────*/
  const list = document.createElement("div");
  list.className = "qws-ch-scrollable";
  style(list, {
    flex: "1",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingRight: "4px",
    minHeight: "0",
  });

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function clearList(): void {
    list.innerHTML = "";
  }

  function buildResultRow(row: LeaderboardRow): HTMLElement {
    const item = document.createElement("button");
    style(item, {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "10px 12px",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.03)",
      color: "#e7eef7",
      cursor: "pointer",
      transition: "all 120ms ease",
      width: "100%",
      textAlign: "left",
    });
    item.onmouseenter = () =>
      style(item, { background: "rgba(255,255,255,0.06)", borderColor: "rgba(94,234,212,0.25)" });
    item.onmouseleave = () =>
      style(item, { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" });

    const avatar = document.createElement("div");
    style(avatar, {
      width: "36px",
      height: "36px",
      borderRadius: "10px",
      flexShrink: "0",
      background: row.avatarUrl
        ? `url(${row.avatarUrl}) center/cover`
        : "linear-gradient(135deg, rgba(94,234,212,0.3), rgba(59,130,246,0.3))",
      border: "1px solid rgba(255,255,255,0.08)",
    });

    const info = document.createElement("div");
    style(info, { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" });

    const name = document.createElement("div");
    style(name, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#e7eef7",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    name.textContent = row.playerName || row.playerId || "Unknown";

    const sub = document.createElement("div");
    style(sub, {
      fontSize: "10px",
      color: "rgba(226,232,240,0.45)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    sub.textContent = row.playerId || "";

    info.append(name, sub);
    item.append(avatar, info);

    item.onclick = () => {
      void openPlayerDetail(row.playerId, row.playerName);
    };
    return item;
  }

  /* ── Detail view swap ─────────────────────────────────────────────────────*/
  const hideListView = (): void => {
    style(searchBar, { display: "none" });
    style(status, { display: "none" });
    style(list, { display: "none" });
  };

  const showListView = (): void => {
    style(searchBar, { display: "" });
    style(status, { display: "" });
    style(list, { display: "" });
  };

  const backToList = async (): Promise<void> => {
    await stopAnyPreview();
    if (currentDetailView) {
      currentDetailView.remove();
      currentDetailView = null;
    }
    showListView();
    searchBar.focus();
  };

  async function openPlayerDetail(playerId: string, playerName?: string): Promise<void> {
    if (!playerId) return;
    hideListView();

    const loadingView = createLoadingView(backToList);
    currentDetailView = loadingView;
    root.appendChild(loadingView);

    const details = await fetchPlayerDetailsComplete(playerId);
    if (currentDetailView !== loadingView) {
      // The user navigated away (back / new search) while we were loading.
      return;
    }
    if (!details) {
      loadingView.remove();
      const errView = createErrorView(
        playerName ? `Failed to load ${playerName}` : "Failed to load player details",
        backToList,
      );
      currentDetailView = errView;
      root.appendChild(errView);
      return;
    }

    const detail = await createPlayerDetailView({ player: details, onBack: backToList });
    if (currentDetailView !== loadingView) {
      // Another navigation happened during the detail-view build.
      return;
    }
    loadingView.remove();
    currentDetailView = detail;
    root.appendChild(detail);
  }

  /* ── Search execution ─────────────────────────────────────────────────────*/
  async function runSearch(): Promise<void> {
    const query = searchBar.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      lastQuery = query;
      clearList();
      setStatus(`Type at least ${MIN_QUERY_LENGTH} characters.`);
      return;
    }
    if (query === lastQuery && !inFlight) return;
    lastQuery = query;
    inFlight = true;
    setStatus("Searching…");
    try {
      const { rows } = await fetchLeaderboardCoins({ query, limit: SEARCH_LIMIT });
      // Discard stale responses (user kept typing).
      if (searchBar.value.trim() !== query) return;
      clearList();
      if (!rows.length) {
        setStatus(`No players match "${query}".`);
        return;
      }
      setStatus(`${rows.length} result${rows.length > 1 ? "s" : ""} for "${query}".`);
      for (const row of rows) list.appendChild(buildResultRow(row));
    } catch {
      setStatus("Search failed. Try again.");
    } finally {
      inFlight = false;
    }
  }

  searchBar.oninput = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
  };
  searchBar.onkeydown = (event) => {
    if (event.key === "Enter") {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      void runSearch();
    }
  };

  root.append(searchBar, status, list);

  return {
    id: "search" as const,
    root,
    show: () => {
      style(root, { display: "flex" });
      // Defer focus until after the tab is laid out (the display: flex toggle
      // races the focus otherwise).
      setTimeout(() => {
        if (root.isConnected && root.offsetParent !== null) searchBar.focus();
      }, 0);
    },
    hide: () => style(root, { display: "none" }),
    destroy: () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      keyBlocker.detach();
      if (currentDetailView) {
        currentDetailView.remove();
        currentDetailView = null;
      }
    },
  };
}

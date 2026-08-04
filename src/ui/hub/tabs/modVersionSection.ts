// src/ui/hub/tabs/modVersionSection.ts
// "Mod version" card for the My Profile tab: which version is running, whether
// a newer one is published, and a way to get it. Deliberately compact — it is
// the least interesting card on the tab until there is an update to install.

import {
  MOD_UPDATE_EVENT,
  checkForUpdates,
  getUpdateState,
  getUpdateUrl,
  openUpdatePage,
  type ModUpdateState,
} from "@/platform/modUpdate";
import { style } from "../shared";

const ACCENT = "#5eead4";
const WARN = "#fbbf24";
const DANGER = "#f87171";
const TEXT = "#e7eef7";
const TEXT_DIM = "rgba(226,232,240,0.6)";

const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "6px 12px",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: "600",
  cursor: "pointer",
  transition: "all 120ms ease",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  color: TEXT,
};

export interface ModVersionSection {
  root: HTMLElement;
  destroy: () => void;
}

export function createModVersionSection(): ModVersionSection {
  const section = document.createElement("div");
  style(section, {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px 16px",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
  });

  // Title and the running version share a line — no need for a labelled row.
  const titleRow = document.createElement("div");
  style(titleRow, { display: "flex", alignItems: "center", gap: "8px" });

  const title = document.createElement("div");
  style(title, { flex: "1", fontSize: "14px", fontWeight: "700", color: TEXT });
  title.textContent = "Mod version";

  const installedEl = document.createElement("div");
  style(installedEl, {
    fontSize: "12px",
    fontFamily: "monospace",
    color: "rgba(226,232,240,0.75)",
  });

  titleRow.append(title, installedEl);

  const statusLine = document.createElement("div");
  style(statusLine, { fontSize: "12px", lineHeight: "1.4", color: TEXT_DIM });

  const actions = document.createElement("div");
  style(actions, { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" });

  const checkBtn = document.createElement("button");
  style(checkBtn, BUTTON_STYLE);
  checkBtn.textContent = "Check for updates";

  const updateBtn = document.createElement("button");
  style(updateBtn, {
    ...BUTTON_STYLE,
    background: "rgba(94,234,212,0.15)",
    borderColor: "rgba(94,234,212,0.4)",
    color: ACCENT,
  });
  updateBtn.textContent = "Update now";

  addHover(checkBtn, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)");
  addHover(updateBtn, "rgba(94,234,212,0.15)", "rgba(94,234,212,0.25)");

  actions.append(checkBtn, updateBtn);

  // Only shown if the tab could not be opened (sandboxed frame, blocked popup).
  const fallback = document.createElement("div");
  style(fallback, { display: "none", flexDirection: "column", gap: "6px" });

  const fallbackText = document.createElement("div");
  style(fallbackText, { fontSize: "11px", color: TEXT_DIM, lineHeight: "1.4" });
  fallbackText.textContent = "Your browser blocked the tab. Open this address yourself:";

  const fallbackUrl = document.createElement("input");
  fallbackUrl.readOnly = true;
  fallbackUrl.value = getUpdateUrl();
  style(fallbackUrl, {
    width: "100%",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "rgba(226,232,240,0.8)",
    fontSize: "11px",
    fontFamily: "monospace",
  });
  fallbackUrl.onclick = () => fallbackUrl.select();

  fallback.append(fallbackText, fallbackUrl);

  section.append(titleRow, statusLine, actions, fallback);

  const apply = (state: ModUpdateState): void => {
    installedEl.textContent = state.installed ?? "unknown";

    const isChecking = state.status === "checking";
    checkBtn.disabled = isChecking;
    style(checkBtn, {
      opacity: isChecking ? "0.6" : "1",
      cursor: isChecking ? "default" : "pointer",
    });
    checkBtn.textContent = isChecking ? "Checking…" : "Check for updates";

    const showUpdate = state.status === "updateAvailable";
    style(updateBtn, { display: showUpdate ? "block" : "none" });
    if (!showUpdate) style(fallback, { display: "none" });

    switch (state.status) {
      case "checking":
        style(statusLine, { color: TEXT_DIM });
        statusLine.textContent = "Looking for a newer version…";
        break;
      case "updateAvailable":
        style(statusLine, { color: WARN });
        statusLine.textContent =
          `Version ${state.latest} is out. Your script manager will ask you ` +
          `to confirm, then reload the game to finish.`;
        break;
      case "upToDate":
        style(statusLine, { color: ACCENT });
        statusLine.textContent = "You are running the latest version.";
        break;
      case "error":
        style(statusLine, { color: DANGER });
        statusLine.textContent = "Couldn't reach GitHub. Try again in a moment.";
        break;
      default:
        style(statusLine, { color: TEXT_DIM });
        statusLine.textContent = "Not checked yet.";
        break;
    }
  };

  checkBtn.onclick = () => {
    void checkForUpdates({ force: true });
  };

  updateBtn.onclick = () => {
    const result = openUpdatePage();
    style(fallback, { display: result === "blocked" ? "flex" : "none" });
    if (result === "blocked") fallbackUrl.select();
  };

  const handleUpdateEvent = (event: Event) => {
    const detail = (event as CustomEvent<ModUpdateState>).detail;
    apply(detail ?? getUpdateState());
  };

  window.addEventListener(MOD_UPDATE_EVENT, handleUpdateEvent);
  apply(getUpdateState());

  return {
    root: section,
    destroy: () => {
      window.removeEventListener(MOD_UPDATE_EVENT, handleUpdateEvent);
      section.remove();
    },
  };
}

function addHover(button: HTMLButtonElement, base: string, hovered: string): void {
  button.onmouseenter = () => {
    if (!button.disabled) style(button, { background: hovered });
  };
  button.onmouseleave = () => style(button, { background: base });
}

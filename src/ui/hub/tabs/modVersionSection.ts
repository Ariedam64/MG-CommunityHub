// src/ui/hub/tabs/modVersionSection.ts
// "Mod version" card for the My Profile tab: which version is running, whether
// a newer one is published, and a way to get it.

import {
  MOD_UPDATE_EVENT,
  checkForUpdates,
  getUpdateState,
  openUpdatePage,
  type ModUpdateState,
} from "@/platform/modUpdate";
import { style } from "../shared";

const ACCENT = "#5eead4";
const WARN = "#fbbf24";
const DANGER = "#f87171";
const TEXT = "#e7eef7";
const TEXT_DIM = "rgba(226,232,240,0.6)";

const CARD_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "16px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
};

const ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "12px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "8px",
};

const BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "8px 14px",
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
  style(section, CARD_STYLE);

  const title = document.createElement("div");
  style(title, { fontSize: "16px", fontWeight: "700", color: TEXT });
  title.textContent = "Mod version";

  const description = document.createElement("div");
  style(description, { fontSize: "12px", color: TEXT_DIM, lineHeight: "1.5" });
  description.textContent =
    "Check whether a newer build of the Community Hub has been published.";

  const installedRow = createValueRow("Installed");
  const latestRow = createValueRow("Latest");

  const statusLine = document.createElement("div");
  style(statusLine, { fontSize: "12px", lineHeight: "1.5", color: TEXT_DIM });

  const actions = document.createElement("div");
  style(actions, { display: "flex", gap: "8px", flexWrap: "wrap" });

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

  const hint = document.createElement("div");
  style(hint, { fontSize: "11px", color: TEXT_DIM, lineHeight: "1.5" });
  hint.textContent =
    "Your script manager will ask you to confirm, then reload the game to finish.";

  section.append(title, description, installedRow.row, latestRow.row, statusLine, actions, hint);

  const apply = (state: ModUpdateState): void => {
    installedRow.setValue(state.installed ?? "unknown");
    latestRow.setValue(state.latest ?? "—");

    const isChecking = state.status === "checking";
    checkBtn.disabled = isChecking;
    style(checkBtn, { opacity: isChecking ? "0.6" : "1", cursor: isChecking ? "default" : "pointer" });
    checkBtn.textContent = isChecking ? "Checking…" : "Check for updates";

    const showUpdate = state.status === "updateAvailable";
    style(updateBtn, { display: showUpdate ? "block" : "none" });
    style(hint, { display: showUpdate ? "block" : "none" });

    switch (state.status) {
      case "checking":
        style(statusLine, { color: TEXT_DIM });
        statusLine.textContent = "Looking for a newer version…";
        break;
      case "updateAvailable":
        style(statusLine, { color: WARN });
        statusLine.textContent = `Version ${state.latest} is available.`;
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
    openUpdatePage();
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

function createValueRow(label: string): { row: HTMLElement; setValue: (value: string) => void } {
  const row = document.createElement("div");
  style(row, ROW_STYLE);

  const labelEl = document.createElement("div");
  style(labelEl, { flex: "1", fontSize: "13px", fontWeight: "600", color: TEXT });
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  style(valueEl, {
    fontSize: "12px",
    fontFamily: "monospace",
    color: "rgba(226,232,240,0.75)",
  });

  row.append(labelEl, valueEl);

  return {
    row,
    setValue: (value: string) => {
      valueEl.textContent = value;
    },
  };
}

function addHover(button: HTMLButtonElement, base: string, hovered: string): void {
  button.onmouseenter = () => {
    if (!button.disabled) style(button, { background: hovered });
  };
  button.onmouseleave = () => style(button, { background: base });
}

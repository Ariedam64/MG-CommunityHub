// src/ui/hub/tabs/apiKeySection.ts
// "API key" card for the My Profile tab: shows the stored Community Hub key,
// masked, and lets you replace it by hand.
//
// The key is only ever written once the server has accepted it. Saving first
// and rolling back on failure would leave the heartbeat sending an unvalidated
// key in between, and a typo would silently sign you out.

import { setApiKey, verifyApiKey, type ApiKeyCheck } from "@/api/auth";
import { getApiKey } from "@/storage/storage";
import { style } from "../shared";

const ACCENT = "#5eead4";
const WARN = "#fbbf24";
const DANGER = "#f87171";
const TEXT = "#e7eef7";
const TEXT_DIM = "rgba(226,232,240,0.6)";

const AUTH_UPDATE_EVENT = "qws-friend-overlay-auth-update";

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
  whiteSpace: "nowrap",
};

/** Square icon button: same skin as the others, sized for a glyph. */
const ICON_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  ...BUTTON_STYLE,
  padding: "6px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: "0",
};

const ICON_EYE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;

const ICON_EYE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7c1.6 0 3 .4 4.3 1.1M22 12s-3.6 7-10 7c-1.6 0-3-.4-4.3-1.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

type Mode = "view" | "editing" | "saving";

export interface ApiKeySection {
  root: HTMLElement;
  destroy: () => void;
}

export function createApiKeySection(): ApiKeySection {
  let mode: Mode = "view";
  let revealed = false;

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

  const title = document.createElement("div");
  style(title, { fontSize: "14px", fontWeight: "700", color: TEXT });
  title.textContent = "API key";

  const description = document.createElement("div");
  style(description, { fontSize: "12px", lineHeight: "1.4", color: TEXT_DIM });
  description.textContent =
    "The key that identifies you to the Community Hub. Keep it to yourself.";

  const row = document.createElement("div");
  style(row, { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" });

  const input = document.createElement("input");
  input.type = "password";
  input.readOnly = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "No key stored";
  style(input, {
    flex: "1",
    minWidth: "160px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "rgba(226,232,240,0.8)",
    fontSize: "11px",
    fontFamily: "monospace",
  });

  const revealBtn = document.createElement("button");
  style(revealBtn, ICON_BUTTON_STYLE);

  const editBtn = document.createElement("button");
  style(editBtn, BUTTON_STYLE);

  // Only visible while editing; sits next to the primary button.
  const cancelBtn = document.createElement("button");
  style(cancelBtn, BUTTON_STYLE);
  cancelBtn.textContent = "Cancel";

  addHover(revealBtn, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)");
  addHover(editBtn, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)");
  addHover(cancelBtn, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)");

  row.append(input, revealBtn, editBtn, cancelBtn);

  const statusLine = document.createElement("div");
  style(statusLine, { display: "none", fontSize: "12px", lineHeight: "1.4" });

  section.append(title, description, row, statusLine);

  const setStatus = (text: string | null, color: string = TEXT_DIM): void => {
    style(statusLine, { display: text ? "block" : "none", color });
    statusLine.textContent = text ?? "";
  };

  /** Everything the three modes change about the row, in one place. */
  const apply = (): void => {
    const storedKey = getApiKey() ?? "";
    const isEditing = mode === "editing";
    const isSaving = mode === "saving";

    if (!isEditing && !isSaving) input.value = storedKey;
    input.readOnly = !isEditing;

    // Editing always shows the characters: you cannot check what you paste
    // through dots. The eye only has a job outside edit, so it goes away there
    // rather than sitting on a field it no longer controls.
    const isOpen = isEditing || isSaving;
    input.type = isOpen || revealed ? "text" : "password";

    style(revealBtn, { display: isOpen ? "none" : "flex" });
    revealBtn.disabled = storedKey.length === 0;
    revealBtn.innerHTML = revealed ? ICON_EYE_OFF : ICON_EYE;
    revealBtn.title = revealed ? "Hide the key" : "Show the key";
    revealBtn.setAttribute("aria-label", revealBtn.title);

    editBtn.disabled = isSaving;
    editBtn.textContent = isEditing || isSaving ? "Save" : "Edit";

    style(cancelBtn, { display: isEditing || isSaving ? "block" : "none" });
    cancelBtn.disabled = isSaving;

    for (const button of [revealBtn, editBtn, cancelBtn]) {
      style(button, {
        opacity: button.disabled ? "0.5" : "1",
        cursor: button.disabled ? "default" : "pointer",
      });
    }
  };

  const enterView = (): void => {
    mode = "view";
    revealed = false;
    apply();
  };

  const enterEdit = (): void => {
    mode = "editing";
    setStatus(null);
    apply();
    input.focus();
    input.select();
  };

  const save = async (): Promise<void> => {
    const candidate = input.value.trim();

    if (!candidate) {
      setStatus("Type a key first.", DANGER);
      return;
    }
    if (candidate === (getApiKey() ?? "")) {
      enterView();
      setStatus(null);
      return;
    }

    mode = "saving";
    apply();
    setStatus("Checking the key…", TEXT_DIM);

    let result: ApiKeyCheck;
    try {
      result = await verifyApiKey(candidate);
    } catch {
      result = "unreachable";
    }

    if (result === "valid") {
      setApiKey(candidate);
      enterView();
      setStatus("Key saved.", ACCENT);
      // What the rest of the mod listens to when auth changes: the hub reveals
      // its tabs and the streams reconnect on the new key.
      window.dispatchEvent(new CustomEvent(AUTH_UPDATE_EVENT));
      return;
    }

    // The stored key is untouched in both failure cases, so staying in edit
    // lets the field be corrected without retyping it.
    mode = "editing";
    apply();
    if (result === "invalid") {
      setStatus("The server refused that key. Your old one is still in place.", DANGER);
    } else {
      setStatus("Couldn't reach the server. Your key was not changed.", WARN);
    }
  };

  revealBtn.onclick = () => {
    if (revealBtn.disabled) return;
    revealed = !revealed;
    apply();
  };

  editBtn.onclick = () => {
    if (editBtn.disabled) return;
    if (mode === "view") {
      enterEdit();
      return;
    }
    void save();
  };

  cancelBtn.onclick = () => {
    if (cancelBtn.disabled) return;
    enterView();
    setStatus(null);
  };

  input.onkeydown = (event: KeyboardEvent) => {
    if (mode !== "editing") return;
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      enterView();
      setStatus(null);
    }
  };

  apply();

  return {
    root: section,
    destroy: () => {
      // Never leave a revealed key behind in a detached node.
      input.value = "";
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

// src/ui/hub/bugReport/modal.ts
// The Report a bug modal, opened from the nav entry under the tabs: New
// report and My reports. It lives inside the hub panel like the Ko-fi modal,
// but closing it only hides it, so a half written report and its screenshots
// are still there when the player comes back with more to add.

import { createKeyBlocker, style } from "../shared";
import { el } from "./dom";
import { createMyReportsTab } from "./myReportsTab";
import { createReportTab } from "./reportTab";
import { ensureBugReportStyles } from "./styles";

const BUG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`;

const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

type TabId = "new" | "mine";

export interface BugReportModal {
  root: HTMLElement;
  show(): void;
  hide(): void;
  isShown(): boolean;
  destroy(): void;
}

export function createBugReportModal(onClose: () => void): BugReportModal {
  ensureBugReportStyles();

  const overlay = el("div", "qws-ch-bug-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) onClose();
  });

  const card = el("div", "qws-ch-bug-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Report a bug");
  // Focusable, so a click anywhere in the form lets Ctrl+V paste an image here.
  card.tabIndex = -1;

  const head = el("div", "qws-ch-bug-head");
  const icon = el("div", "qws-ch-bug-head-icon");
  icon.innerHTML = BUG_SVG;
  const headText = el("div", "qws-ch-bug-head-text");
  headText.append(
    el("div", "qws-ch-bug-title", "Report a bug"),
    el("div", "qws-ch-bug-subtitle", "Something wrong with the Community Hub? Tell the developer."),
  );
  const closeBtn = el("button", "qws-ch-bug-x");
  closeBtn.type = "button";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = CLOSE_SVG;
  closeBtn.addEventListener("click", onClose);
  head.append(icon, headText, closeBtn);

  const tabsBar = el("div", "qws-ch-bug-tabs");
  tabsBar.setAttribute("role", "tablist");
  const body = el("div", "qws-ch-bug-body qws-ch-scrollable");

  const isShown = () => overlay.isConnected && overlay.style.display !== "none" && overlay.offsetParent !== null;
  // Opening the modal is almost always to report something.
  let activeTab: TabId = "new";

  const reportTab = createReportTab({
    card,
    // The whole hub panel steps aside, so the capture shows the game.
    hideForCapture: (hidden) => {
      const panel = overlay.closest<HTMLElement>(".qws-ch-panel") ?? overlay;
      panel.style.visibility = hidden ? "hidden" : "";
    },
    showMyReports: () => switchTab("mine"),
    scrollTop: () => body.scrollTo({ top: 0 }),
  });
  const myReportsTab = createMyReportsTab(() => isShown() && activeTab === "mine");

  const views: Record<TabId, HTMLElement> = { new: reportTab.root, mine: myReportsTab.root };
  const tabButtons: Record<TabId, HTMLButtonElement> = {
    new: tabButton("New report", () => switchTab("new")),
    mine: tabButton("My reports", () => switchTab("mine")),
  };
  tabsBar.append(tabButtons.new, tabButtons.mine);
  body.append(reportTab.root, myReportsTab.root);

  myReportsTab.root.hidden = true;
  tabButtons.new.classList.add("active");
  tabButtons.new.setAttribute("aria-selected", "true");

  function switchTab(id: TabId): void {
    if (activeTab !== id) {
      views[activeTab].hidden = true;
      tabButtons[activeTab].classList.remove("active");
      tabButtons[activeTab].setAttribute("aria-selected", "false");
      activeTab = id;
      views[id].hidden = false;
      tabButtons[id].classList.add("active");
      tabButtons[id].setAttribute("aria-selected", "true");
      body.scrollTo({ top: 0 });
    }
    if (id === "mine") myReportsTab.show();
  }

  card.addEventListener("paste", (event) => {
    if (activeTab === "new") reportTab.handlePaste(event);
  });

  card.append(head, tabsBar, body);
  overlay.appendChild(card);

  // The game reads its shortcuts from window key events: while the player
  // types here, or has clicked into the modal, they stop at the window.
  const keyBlocker = createKeyBlocker(() => isShown() && overlay.contains(document.activeElement));
  keyBlocker.attach();

  return {
    root: overlay,
    show() {
      style(overlay, { display: "flex" });
      if (activeTab === "mine") myReportsTab.show();
    },
    hide() {
      style(overlay, { display: "none" });
      // Focus left inside a hidden modal would keep the game's keys away.
      if (overlay.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    },
    isShown,
    destroy() {
      keyBlocker.detach();
      reportTab.destroy();
      myReportsTab.destroy();
      overlay.remove();
    },
  };
}

function tabButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el("button", "qws-ch-bug-tab", label);
  btn.type = "button";
  btn.setAttribute("role", "tab");
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * The Report a bug entry for the hub's nav, shown just above the Ko-fi one.
 * Like it, it opens a modal and works whether or not the player signed in.
 */
export function createBugReportNavEntry(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "qws-ch-nav-btn";

  const iconWrap = document.createElement("div");
  iconWrap.className = "qws-ch-nav-icon";
  iconWrap.innerHTML = BUG_SVG;
  style(iconWrap, {
    background: "rgba(251,191,36,0.12)",
    color: "#fbbf24",
  });

  const label = document.createElement("span");
  label.textContent = "Report a bug";

  btn.style.justifyContent = "center";

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(251,191,36,0.10)";
    btn.style.borderColor = "rgba(251,191,36,0.22)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "transparent";
    btn.style.borderColor = "transparent";
  });
  btn.addEventListener("click", onClick);

  btn.append(iconWrap, label);
  return btn;
}

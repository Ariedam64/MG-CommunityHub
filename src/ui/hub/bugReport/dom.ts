// src/ui/hub/bugReport/dom.ts
// Small builders shared by the Report a bug modal: elements with a class and
// a text, buttons, banners, and the dialog that opens over the modal (the
// JSON preview, a screenshot at full size). Text always goes in as text,
// never as markup: most of what these show was typed by a player.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export type ButtonOptions = {
  variant?: "primary" | "ghost";
  big?: boolean;
  title?: string;
  /** Disabled until the promise the click returns settles, so a second click cannot send twice. */
  lockWhilePending?: boolean;
  onClick?: () => unknown;
};

export function button(label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const btn = el("button", `qws-ch-bug-btn${opts.variant === "primary" ? " primary" : ""}${opts.big ? " big" : ""}`, label);
  btn.type = "button";
  if (opts.title) btn.title = opts.title;
  btn.addEventListener("click", () => {
    if (btn.disabled || !opts.onClick) return;
    const result = opts.onClick();
    if (!opts.lockWhilePending || !(result instanceof Promise)) return;
    btn.disabled = true;
    result
      .catch((error) => console.error("[CommunityHub] bug report action failed:", error))
      .finally(() => {
        btn.disabled = false;
      });
  });
  return btn;
}

export type Notice = {
  el: HTMLElement;
  show(text: string, ...actions: HTMLElement[]): void;
  hide(): void;
};

/** A banner with a sentence and optional buttons, hidden until `show`. */
export function notice(tone: "warn" | "info" | "error"): Notice {
  const box = el("div", `qws-ch-bug-notice ${tone}`);
  box.hidden = true;
  box.setAttribute("role", tone === "error" ? "alert" : "status");
  return {
    el: box,
    show(text, ...actions) {
      box.replaceChildren(el("span", undefined, text), ...actions);
      box.hidden = false;
    },
    hide() {
      box.hidden = true;
      box.replaceChildren();
    },
  };
}

export type Dialog = { body: HTMLElement; footer: HTMLElement; close(): void };

/** A panel over the whole modal card, closed by its own buttons. */
export function openDialog(host: HTMLElement, title: string): Dialog {
  const root = el("div", "qws-ch-bug-dialog");
  const head = el("div", "qws-ch-bug-dialog-head");
  head.appendChild(el("div", "qws-ch-bug-dialog-title", title));
  const body = el("div", "qws-ch-bug-dialog-body qws-ch-scrollable");
  const footer = el("div", "qws-ch-bug-dialog-foot");
  root.append(head, body, footer);
  host.appendChild(root);
  return { body, footer, close: () => root.remove() };
}

/** A checkbox drawn as the hub's toggle switch. */
export function switchInput(checked: boolean, label: string): { root: HTMLElement; input: HTMLInputElement } {
  const root = el("label", "qws-ch-bug-switch");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("role", "switch");
  input.setAttribute("aria-label", label);
  root.append(input, el("span"));
  return { root, input };
}

/** Copies `text`, through the clipboard API or, where a frame refuses it, the old selection way. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** Hands the player a file to keep, here the JSON of a report that could not be sent. */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = el("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toLocaleString();
  }
}

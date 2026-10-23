// src/ui/hub/bugReport/screenshots.ts
// The report's screenshots, at most three: images added from a file, dropped
// or pasted, and a capture of the tab where the browser allows it. The hub
// has no access to the game's renderer, so nothing is taken without the
// player asking. Every image is shrunk by the core's normalizer before it
// shows here, so what the player sees is exactly what gets sent.

import type { BugReportAttachment } from "@/bugReport/core/client";
import { ImageNormalizeError, normalizeImage, normalizedImageBlob, type ImageSource, type NormalizedImage } from "@/bugReport/core/image";
import { BUG_REPORT_LIMITS } from "@/bugReport/core/limits";
import { canCaptureScreen, captureScreenFrame } from "@/bugReport/core/screenCapture";
import type { AttachmentKind } from "@/bugReport/core/types";
import { isDiscordSurface } from "@/platform/api";
import { isDiscordActivityContext } from "@/platform/discordCsp";
import { button, el, openDialog } from "./dom";

type Shot = { id: number; kind: AttachmentKind; image: NormalizedImage; url: string };

export type ScreenshotStrip = {
  root: HTMLElement;
  attachments(): BugReportAttachment[];
  /** What the preview shows in place of the image bytes. */
  summary(): Array<{ kind: AttachmentKind; mime: string; width: number; height: number; bytes: number }>;
  /** Images still being prepared. The report waits for them. */
  pending(): number;
  handlePaste(event: ClipboardEvent): void;
  /** Takes images dropped anywhere on `zone`, with a visible cue while dragging. */
  acceptDrops(zone: HTMLElement): void;
  clear(): void;
};

export type ScreenshotHost = {
  /** Where the full size view opens: the modal card. */
  dialogHost(): HTMLElement | null;
  /** Hidden while the tab is captured, so the picture shows the game. */
  hideForCapture(hidden: boolean): void;
};

const MAX = BUG_REPORT_LIMITS.attachments;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";
const KIND_LABELS: Record<AttachmentKind, string> = { game: "Game view", screen: "Screen capture", upload: "Image" };
const REMOVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const isTextField = (target: EventTarget | null) => {
  const node = target as HTMLElement | null;
  return !!node && (node.isContentEditable || /^(input|textarea)$/i.test(node.tagName ?? ""));
};

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = "getAsFile" in item ? (item.kind === "file" ? item.getAsFile() : null) : item;
    if (file && file.type.startsWith("image/")) out.push(file);
  }
  return out;
}

export function buildScreenshotStrip(host: ScreenshotHost): ScreenshotStrip {
  let nextId = 0;
  let shots: Shot[] = [];
  let pendingCount = 0;
  /** A tab capture is waiting on the browser's prompt. */
  let capturing = false;

  const grid = el("div", "qws-ch-bug-shots");
  const message = el("p", "qws-ch-bug-hint");
  message.setAttribute("role", "status");
  const counter = el("span", "qws-ch-bug-hint");

  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ACCEPT;
  fileInput.multiple = true;
  fileInput.hidden = true;

  const room = () => MAX - shots.length - pendingCount;

  const addButton = button("Add image", { onClick: () => fileInput.click() });
  const screenButton = button("Capture screen", {
    title: "Takes a picture of this tab, game menus included. Your browser asks first.",
    onClick: () => captureScreen(),
  });
  // Inside the Discord activity the capture API is blocked, and would show
  // Discord itself anyway. Only Chromium offers this tab first; elsewhere the
  // picker lists whole screens and windows, easy to share by mistake.
  const isChromium = /\bChrom(e|ium)\//.test(navigator.userAgent);
  const screenAvailable = canCaptureScreen() && isChromium && !isDiscordActivityContext() && !isDiscordSurface();

  const bar = el("div", "qws-ch-bug-shot-bar");
  bar.append(addButton);
  if (screenAvailable) bar.append(screenButton);
  bar.append(counter);

  const root = el("div", "qws-ch-bug-view");
  root.append(grid, bar, message, fileInput);

  const say = (text: string) => (message.textContent = text);

  function render(): void {
    const tiles: HTMLElement[] = shots.map(tile);
    for (let i = 0; i < pendingCount; i++) tiles.push(el("div", "qws-ch-bug-shot pending", "Preparing..."));
    grid.replaceChildren(...tiles);
    const full = room() <= 0;
    addButton.disabled = full;
    screenButton.disabled = full || capturing;
    counter.textContent = shots.length
      ? `${shots.length} of ${MAX}.${full ? "" : " You can also paste an image with Ctrl+V."}`
      : "Paste an image with Ctrl+V, drop one here, or add one.";
  }

  function tile(shot: Shot): HTMLElement {
    const box = el("div", "qws-ch-bug-shot");
    const open = el("button", "qws-ch-bug-shot-open");
    open.type = "button";
    open.title = "See it full size";
    const img = el("img");
    img.src = shot.url;
    img.alt = KIND_LABELS[shot.kind];
    open.appendChild(img);
    open.addEventListener("click", () => showFull(shot));
    const remove = el("button", "qws-ch-bug-shot-remove");
    remove.type = "button";
    remove.title = "Remove this screenshot";
    remove.setAttribute("aria-label", "Remove this screenshot");
    remove.innerHTML = REMOVE_SVG;
    remove.addEventListener("click", () => removeShot(shot.id));
    const label = el("span", "qws-ch-bug-shot-label", `${KIND_LABELS[shot.kind]}, ${Math.max(1, Math.round(shot.image.bytes / 1024))} KB`);
    box.append(open, label, remove);
    return box;
  }

  function showFull(shot: Shot): void {
    const target = host.dialogHost();
    if (!target) return;
    const dialog = openDialog(target, KIND_LABELS[shot.kind]);
    const img = el("img", "qws-ch-bug-full");
    img.src = shot.url;
    img.alt = KIND_LABELS[shot.kind];
    dialog.body.append(
      img,
      el(
        "p",
        "qws-ch-bug-hint",
        `${shot.image.width} x ${shot.image.height}, ${Math.round(shot.image.bytes / 1024)} KB. Check that nothing private shows before you send it.`,
      ),
    );
    dialog.footer.append(
      button("Remove", {
        onClick: () => {
          removeShot(shot.id);
          dialog.close();
        },
      }),
      button("Close", { variant: "primary", onClick: () => dialog.close() }),
    );
  }

  function removeShot(id: number): void {
    const shot = shots.find((entry) => entry.id === id);
    if (!shot) return;
    URL.revokeObjectURL(shot.url);
    shots = shots.filter((entry) => entry.id !== id);
    render();
  }

  /** Normalizes `source` and adds it, with a placeholder meanwhile. */
  async function addSource(source: ImageSource, kind: AttachmentKind): Promise<boolean> {
    if (room() <= 0) {
      say(`At most ${MAX} screenshots per report.`);
      return false;
    }
    pendingCount++;
    render();
    try {
      const image = await normalizeImage(source);
      pendingCount--;
      shots = [...shots, { id: ++nextId, kind, image, url: URL.createObjectURL(normalizedImageBlob(image)) }];
      say("");
      return true;
    } catch (error) {
      pendingCount--;
      say(error instanceof ImageNormalizeError ? error.message : "This image could not be read.");
      return false;
    } finally {
      render();
    }
  }

  async function addFiles(files: File[]): Promise<void> {
    const fits = Math.max(0, room());
    for (const file of files.slice(0, fits)) await addSource(file, "upload");
    // Said last, or the next image ready would clear it.
    if (files.length > fits) say(`Only ${MAX} screenshots fit in a report, so ${files.length - fits} ${files.length - fits > 1 ? "were" : "was"} left out.`);
  }

  async function captureScreen(): Promise<void> {
    if (room() <= 0 || capturing) return;
    capturing = true;
    render();
    try {
      // Straight from the click: the browser only allows the prompt then.
      const frame = await captureScreenFrame({
        beforeFrame: () => host.hideForCapture(true),
        afterFrame: () => host.hideForCapture(false),
      });
      await addSource(frame, "screen");
    } catch (error) {
      const name = (error as { name?: string })?.name;
      say(name === "NotAllowedError" ? "Screen capture was cancelled." : "Screen capture is not available in this browser.");
    } finally {
      capturing = false;
      render();
    }
  }

  fileInput.addEventListener("change", () => {
    const files = imageFiles(fileInput.files);
    fileInput.value = "";
    void addFiles(files);
  });

  render();

  return {
    root,
    attachments: () => shots.map((shot) => ({ ...shot.image, kind: shot.kind })),
    summary: () =>
      shots.map(({ kind, image }) => ({ kind, mime: image.mime, width: image.width, height: image.height, bytes: image.bytes })),
    pending: () => pendingCount,
    handlePaste(event) {
      const files = imageFiles(event.clipboardData?.items ?? event.clipboardData?.files);
      if (!files.length) return;
      // Text pasted into a field stays text; an image alone is taken from anywhere in the form.
      if (isTextField(event.target) && event.clipboardData?.types.includes("text/plain")) return;
      event.preventDefault();
      void addFiles(files.slice(0, 1));
    },
    acceptDrops(zone) {
      let depth = 0;
      const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
      zone.addEventListener("dragenter", (event) => {
        if (!hasFiles(event)) return;
        depth++;
        zone.classList.add("dragging");
      });
      zone.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (!depth) zone.classList.remove("dragging");
      });
      zone.addEventListener("dragover", (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      });
      zone.addEventListener("drop", (event) => {
        depth = 0;
        zone.classList.remove("dragging");
        if (!hasFiles(event)) return;
        // Left to the browser, a dropped file would replace the game in the tab.
        event.preventDefault();
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length) void addFiles(files);
        else say("Only images can be added to a report.");
      });
    },
    clear() {
      for (const shot of shots) URL.revokeObjectURL(shot.url);
      shots = [];
      say("");
      render();
    },
  };
}

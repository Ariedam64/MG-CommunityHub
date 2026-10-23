// src/ui/hub/bugReport/formFields.ts
// The fields the player fills in: category, title, what happened, which part
// of the hub, the optional details and a contact. Reading and filling them
// goes through one handle, which the draft and the submit both use.

import { BUG_REPORT_LIMITS as L } from "@/bugReport/core/limits";
import type { BugReportCategory, BugReportFrequency, BugReportWithoutMod } from "@/bugReport/core/types";
import { DRAFT_FIELDS, type Draft } from "@/bugReport/draft";
import { readHubPath, writeHubPath } from "@/storage/storage";
import { el } from "./dom";

const CATEGORIES: Array<[BugReportCategory, string]> = [
  ["bug", "Bug"],
  ["crash", "Crash or error"],
  ["visual", "Visual"],
  ["performance", "Performance"],
  ["feature", "Feature idea"],
  ["question", "Question"],
  ["other", "Other"],
];

const FREQUENCIES: Array<[BugReportFrequency, string]> = [
  ["unknown", "Not sure"],
  ["always", "Every time"],
  ["often", "Often"],
  ["sometimes", "Sometimes"],
  ["once", "Only once"],
];

const WITHOUT_MOD: Array<[BugReportWithoutMod, string]> = [
  ["yes", "Yes"],
  ["no", "No"],
  ["unknown", "Not sure"],
];

/** The hub's parts, as the nav and the game show them. */
const AREAS = [
  "Messages",
  "Friends",
  "Rooms",
  "Groups",
  "Leaderboard",
  "My Profile",
  "Chess",
  "Garden preview",
  "Sign-in with Discord",
  "Hub button or panel",
];
const OTHER_AREA = "Other";
const DETAILS_OPEN_PATH = "bugReport.detailsOpen";

export type FormValues = {
  category: BugReportCategory;
  title: string;
  description: string;
  feature: string;
  steps: string;
  expected: string;
  actual: string;
  frequency: BugReportFrequency;
  withoutMod: BugReportWithoutMod;
  contact: string;
};

export type ValidatedField = "title" | "description";

export type ReportFields = {
  root: HTMLElement;
  read(): FormValues;
  /** Puts a draft back, leaving untouched any field it does not mention. */
  fill(draft: Draft): void;
  reset(keepContact: boolean): void;
  /** Flags one field with a message under it, or clears every flag with null. */
  markInvalid(field: ValidatedField | null, message?: string): void;
  focus(field: ValidatedField): void;
  /** Called on every change of any field. */
  onChange(cb: () => void): void;
};

let uid = 0;

function field(labelText: string, control: HTMLElement, opts: { optional?: boolean; hint?: string } = {}) {
  const root = el("label", "qws-ch-bug-field");
  const label = el("span", "qws-ch-bug-label", labelText);
  if (opts.optional) label.append(" ", el("span", "qws-ch-bug-optional", "(optional)"));
  const hint = el("span", "qws-ch-bug-hint", opts.hint ?? "");
  root.append(label, control, hint);
  return { root, hint, defaultHint: opts.hint ?? "" };
}

function option(label: string, value: string): HTMLOptionElement {
  const opt = el("option", undefined, label);
  opt.value = value;
  return opt;
}

function textInput(placeholder: string, max: number): HTMLInputElement {
  const input = el("input", "qws-ch-bug-input");
  input.type = "text";
  input.placeholder = placeholder;
  input.maxLength = max;
  return input;
}

function textArea(placeholder: string, max: number, rows: number, short = false): HTMLTextAreaElement {
  const area = el("textarea", short ? "qws-ch-bug-input short" : "qws-ch-bug-input");
  area.placeholder = placeholder;
  area.maxLength = max;
  area.rows = rows;
  return area;
}

/** Radio buttons drawn as chips. */
function chips<T extends string>(group: string, ariaLabel: string, entries: Array<[T, string]>, checked: T) {
  const root = el("div", "qws-ch-bug-chips");
  root.setAttribute("role", "radiogroup");
  root.setAttribute("aria-label", ariaLabel);
  const name = `qws-ch-bug-${group}-${++uid}`;
  const inputs = entries.map(([value, label]) => {
    const chip = el("label", "qws-ch-bug-chip");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = value === checked;
    chip.append(input, el("span", undefined, label));
    root.appendChild(chip);
    return input;
  });
  return {
    root,
    inputs,
    get: () => (inputs.find((input) => input.checked)?.value as T | undefined) ?? checked,
    set: (value: string) => inputs.forEach((input) => (input.checked = input.value === value)),
  };
}

export function buildReportFields(): ReportFields {
  const listeners: Array<() => void> = [];
  const changed = () => listeners.forEach((cb) => cb());

  const category = chips("category", "Category", CATEGORIES, "bug");
  const categoryRow = el("div", "qws-ch-bug-field");
  categoryRow.append(el("span", "qws-ch-bug-label", "What kind of report?"), category.root);

  const title = textInput("Short summary, e.g. Friend requests never arrive", L.title.max);
  const titleField = field("Title", title);

  const description = textArea("What were you doing, what went wrong, and since when?", L.description.max, 5);
  const descriptionField = field("What happened?", description, { hint: `At least ${L.description.min} characters.` });

  const area = el("select", "qws-ch-bug-input");
  const placeholder = option("Pick a part of the hub", "");
  area.append(placeholder);
  for (const name of AREAS) area.append(option(name, name));
  area.append(option("Something else, or not sure", OTHER_AREA));
  const areaField = field("Which part of the hub?", area, { optional: true });

  const steps = textArea("1. Open Messages\n2. Pick a friend\n3. ...", L.steps, 3);
  const expected = textArea("What should have happened?", L.expected, 2, true);
  const actual = textArea("What happened instead?", L.actual, 2, true);
  const frequency = el("select", "qws-ch-bug-input");
  for (const [value, label] of FREQUENCIES) frequency.append(option(label, value));
  const withoutMod = chips("without-mod", "Does it happen without the hub?", WITHOUT_MOD, "unknown");

  const details = el("details", "qws-ch-bug-details");
  details.open = readHubPath<boolean>(DETAILS_OPEN_PATH) === true;
  details.addEventListener("toggle", () => writeHubPath(DETAILS_OPEN_PATH, details.open ? true : undefined));
  const summary = el("summary", "qws-ch-bug-summary", "More details");
  summary.append(el("span", "qws-ch-bug-summary-hint", "Steps, what you expected, how often. Optional, but it helps a lot."));
  const detailsBody = el("div", "qws-ch-bug-details-body");
  const pair = el("div", "qws-ch-bug-row");
  pair.append(field("Expected", expected).root, field("Actual", actual).root);
  const withoutModField = el("div", "qws-ch-bug-field");
  withoutModField.append(
    el("span", "qws-ch-bug-label", "Does it happen without the hub?"),
    withoutMod.root,
    el("span", "qws-ch-bug-hint", "If you can, turn the Community Hub off in your userscript manager, reload, and try again."),
  );
  detailsBody.append(field("Steps to make it happen", steps).root, pair, field("How often?", frequency).root, withoutModField);
  details.append(summary, detailsBody);

  const contact = textInput("Discord name or email", L.contact);
  const contactField = field("Contact", contact, {
    optional: true,
    hint: "Only if you are happy to be contacted about this report.",
  });

  for (const input of [title, description, steps, expected, actual, contact]) input.addEventListener("input", changed);
  for (const input of [area, frequency, ...category.inputs, ...withoutMod.inputs]) input.addEventListener("change", changed);

  const root = el("div", "qws-ch-bug-view");
  root.append(categoryRow, titleField.root, descriptionField.root, areaField.root, details, contactField.root);

  const texts: Record<string, HTMLInputElement | HTMLTextAreaElement> = { title, description, steps, expected, actual, contact };
  const setSelect = (sel: HTMLSelectElement, value: string | undefined) => {
    if (value !== undefined && Array.from(sel.options).some((opt) => opt.value === value)) sel.value = value;
  };
  const invalid = { title: titleField, description: descriptionField };

  const handle: ReportFields = {
    root,
    read() {
      return {
        category: category.get(),
        title: title.value,
        description: description.value,
        feature: area.value,
        steps: steps.value,
        expected: expected.value,
        actual: actual.value,
        frequency: (frequency.value as BugReportFrequency) || "unknown",
        withoutMod: withoutMod.get(),
        contact: contact.value,
      };
    },
    fill(draft) {
      for (const key of DRAFT_FIELDS) {
        const value = draft[key];
        if (value !== undefined && key in texts) texts[key].value = value;
      }
      if (draft.category && CATEGORIES.some(([value]) => value === draft.category)) category.set(draft.category);
      setSelect(area, draft.feature);
      setSelect(frequency, draft.frequency);
      if (draft.withoutMod && WITHOUT_MOD.some(([value]) => value === draft.withoutMod)) withoutMod.set(draft.withoutMod);
      // Details already written stay in sight.
      if (draft.steps || draft.expected || draft.actual) details.open = true;
    },
    reset(keepContact) {
      for (const [key, input] of Object.entries(texts)) if (key !== "contact" || !keepContact) input.value = "";
      category.set("bug");
      area.value = "";
      frequency.value = "unknown";
      withoutMod.set("unknown");
      handle.markInvalid(null);
    },
    markInvalid(which, message) {
      for (const [key, entry] of Object.entries(invalid)) {
        const on = key === which;
        entry.root.classList.toggle("invalid", on);
        entry.hint.textContent = on && message ? message : entry.defaultHint;
      }
    },
    focus(which) {
      (which === "title" ? title : description).focus();
    },
    onChange(cb) {
      listeners.push(cb);
    },
  };
  return handle;
}

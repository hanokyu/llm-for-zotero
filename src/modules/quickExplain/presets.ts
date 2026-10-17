import { config } from "../../../package.json";

/** One reader popup action; `modelEntryId` pins it to a configured model. */
export type QuickExplainPreset = {
  id: string;
  label: string;
  prompt: string;
  modelEntryId?: string;
};

const PREF = (name: string) => `${config.prefsPrefix}.${name}`;
const SYSTEM_PREF = PREF("quickExplainSystemPrompt");
const EXPLAIN_PREF = PREF("quickExplainExplainPrompt");
const EXTRA_PREF = PREF("quickExplainPresetsText");
const SHOW_MENU_PREF = PREF("quickExplainShowPresets");
const MODEL_MAP_PREF = PREF("quickExplainPresetModels");

export const DEFAULT_SYSTEM_PROMPT =
  "Answer in Vietnamese; keep technical terms in English. Ground claims in the paper; say explicitly if the paper doesn't cover it. No filler.";

export const DEFAULT_EXPLAIN_PROMPT =
  "Explain the selected passage in the context of this paper: (1) what it says plainly; (2) why it matters for the paper's argument; (3) define jargon/abbreviations/equations with variables and units; (4) unstated assumptions. Under 200 words.";

export const DEFAULT_EXTRA_PRESETS_TEXT = `## Figure
Explain this figure/table: axes, units, groups; key trend; significance shown; conclusion supported; anything misleading (axis scaling, missing error bars, n).

## Methods critique
Evaluate sample prep, analytical technique, calibration/validation (linearity, LLOQ, accuracy, precision, matrix effect, recovery, stability vs ICH M10), controls, statistics, reproducibility gaps; flag what a reviewer would ask for.

## PK table
Extract all PK/PD parameters (Cmax, Tmax, AUC, t1/2, CL, Vd, F…) into a table: parameter, value ± variability, units, dose/route, species/population, NCA vs compartmental. Note inconsistencies/missing units.

## Emulsion
Ingredients/concentrations, processing (temperature, shear, time), measured properties (overrun, foam stability, particle size, rheology, fat crystallization); relate to mechanism and to a clean-label whippable emulsion with cocoa powder and hydrogenated fat.
`;

function getString(key: string, fallback: string): string {
  const raw = Zotero.Prefs.get(key, true);
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

function readModelMap(): Record<string, string> {
  try {
    const raw = Zotero.Prefs.get(MODEL_MAP_PREF, true);
    return typeof raw === "string" && raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "preset"
  );
}

/** "## Name" starts a preset; the lines below it are its prompt. */
export function parsePresetsText(text: string): QuickExplainPreset[] {
  const presets: QuickExplainPreset[] = [];
  let current: QuickExplainPreset | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { id: slug(heading[1]), label: heading[1], prompt: "" };
      presets.push(current);
    } else if (current) {
      current.prompt += `${line}\n`;
    }
  }
  return presets
    .map((p) => ({ ...p, prompt: p.prompt.trim() }))
    .filter((p) => p.prompt && p.id !== "explain");
}

export function getQuickExplainSystemPrompt(): string {
  return getString(SYSTEM_PREF, DEFAULT_SYSTEM_PROMPT);
}

export function isQuickExplainPresetsMenuEnabled(): boolean {
  return Zotero.Prefs.get(SHOW_MENU_PREF, true) === true;
}

/** Explain first, then the user's extra presets, each with its pinned model. */
export function getQuickExplainPresets(): QuickExplainPreset[] {
  const models = readModelMap();
  const explain: QuickExplainPreset = {
    id: "explain",
    label: "Explain",
    prompt: getString(EXPLAIN_PREF, DEFAULT_EXPLAIN_PROMPT),
  };
  const extras = parsePresetsText(
    getString(EXTRA_PREF, DEFAULT_EXTRA_PRESETS_TEXT),
  );
  return [explain, ...extras].map((p) => ({
    ...p,
    modelEntryId: models[p.id] || undefined,
  }));
}

export function setQuickExplainPresetModel(
  presetId: string,
  modelEntryId: string,
): void {
  const models = readModelMap();
  models[presetId] = modelEntryId;
  Zotero.Prefs.set(MODEL_MAP_PREF, JSON.stringify(models), true);
}

/** Wires the Quick Explain block of the preferences pane. */
export function initQuickExplainPrefs(doc: Document): void {
  const q = <T extends Element>(id: string) =>
    doc.getElementById(`${config.addonRef}-${id}`) as T | null;
  const system = q<HTMLTextAreaElement>("qe-system");
  const explain = q<HTMLTextAreaElement>("qe-explain");
  const extras = q<HTMLTextAreaElement>("qe-presets");
  const showMenu = q<HTMLInputElement>("qe-show-presets");
  const reset = q<HTMLButtonElement>("qe-reset");
  if (!system || !explain || !extras || !showMenu) return;

  const load = () => {
    system.value = getQuickExplainSystemPrompt();
    explain.value = getString(EXPLAIN_PREF, DEFAULT_EXPLAIN_PROMPT);
    extras.value = getString(EXTRA_PREF, DEFAULT_EXTRA_PRESETS_TEXT);
    showMenu.checked = isQuickExplainPresetsMenuEnabled();
  };
  const bind = (el: HTMLTextAreaElement, key: string) =>
    el.addEventListener("input", () => Zotero.Prefs.set(key, el.value, true));
  bind(system, SYSTEM_PREF);
  bind(explain, EXPLAIN_PREF);
  bind(extras, EXTRA_PREF);
  showMenu.addEventListener("change", () =>
    Zotero.Prefs.set(SHOW_MENU_PREF, showMenu.checked, true),
  );
  reset?.addEventListener("click", () => {
    for (const key of [SYSTEM_PREF, EXPLAIN_PREF, EXTRA_PREF, SHOW_MENU_PREF]) {
      Zotero.Prefs.clear(key, true);
    }
    load();
  });
  load();
}

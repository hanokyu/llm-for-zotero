import type { ChatMessage, ReasoningConfig } from "../../shared/llm";
import type { RuntimeModelEntry } from "../../utils/modelProviders";
import {
  callDirectChatTurnWithRecovery,
  resolveEmptyModelOutcomeMessage,
} from "../contextPanel/directChatCompletion";
import {
  detectReasoningProvider,
  getReasoningOptions,
} from "../contextPanel/chat";
import { getQuickExplainSystemPrompt } from "./presets";

const REASONING_PREF = "extensions.zotero.llmforzotero.quickExplainReasoning";

/** "fast": the lightest level the model offers, picked from this order. */
const FAST_REASONING_LEVELS = ["minimal", "low", "off", "none"];

function modelReasoningLevels(entry: RuntimeModelEntry) {
  if (entry.authMode === "webchat") return null;
  const provider = detectReasoningProvider(entry.model, entry.apiBase);
  if (provider === "unsupported") return null;
  const options = getReasoningOptions(
    provider,
    entry.model,
    entry.apiBase,
    entry.providerProtocol,
    entry.advanced.profileOverride,
  ).filter((o) => o.enabled && o.level !== "auto");
  return { provider, options };
}

/** Choices for the popup's reasoning menu: Nhanh, Auto, then the model's own. */
export function quickExplainReasoningOptions(
  entry: RuntimeModelEntry | null,
): { level: string; label: string }[] {
  const base = [
    { level: "fast", label: "Nhanh" },
    { level: "auto", label: "Auto" },
  ];
  const levels = entry ? modelReasoningLevels(entry) : null;
  if (!levels?.options.length) return base;
  return [
    ...base,
    ...levels.options.map((o) => ({
      level: o.level,
      label: o.label || o.level,
    })),
  ];
}

function readChoices(): Record<string, string> {
  try {
    const raw = Zotero.Prefs.get(REASONING_PREF, true);
    return typeof raw === "string" && raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** The level chosen for this model in the popup; "fast" until changed. */
export function getQuickExplainReasoning(modelId: string): string {
  return readChoices()[modelId] || "fast";
}

export function setQuickExplainReasoning(modelId: string, level: string): void {
  const choices = readChoices();
  choices[modelId] = level;
  Zotero.Prefs.set(REASONING_PREF, JSON.stringify(choices), true);
}

function resolveReasoning(
  entry: RuntimeModelEntry,
  choice: string,
): ReasoningConfig | undefined {
  if (choice === "auto") return undefined;
  const levels = modelReasoningLevels(entry);
  if (!levels) return undefined;
  const wanted = choice === "fast" ? FAST_REASONING_LEVELS : [choice];
  for (const level of wanted) {
    if (levels.options.some((o) => o.level === level)) {
      return {
        provider: levels.provider as ReasoningConfig["provider"],
        level: level as ReasoningConfig["level"],
      };
    }
  }
  return undefined;
}

/** Models the popup can call directly; web-chat targets need the sidebar. */
export function isQuickExplainModel(entry: RuntimeModelEntry): boolean {
  return entry.authMode !== "webchat";
}

export async function streamQuickExplainTurn(params: {
  entry: RuntimeModelEntry;
  prompt: string;
  context: string;
  history: ChatMessage[];
  reasoning: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}): Promise<string> {
  const { entry } = params;
  if (entry.authMode === "webchat") {
    throw new Error("Web chat models are not supported in the popup");
  }
  const outcome = await callDirectChatTurnWithRecovery({
    request: {
      prompt: params.prompt,
      context: params.context,
      history: params.history,
      signal: params.signal,
      model: entry.model,
      apiBase: entry.apiBase,
      apiKey: entry.apiKey,
      authMode: entry.authMode,
      providerProtocol: entry.providerProtocol,
      temperature: entry.advanced.temperature,
      outputTokenLimit: entry.advanced.outputTokenLimit,
      inputTokenCap: entry.advanced.inputTokenCap,
      inputMode: entry.advanced.inputMode,
      profileOverride: entry.advanced.profileOverride,
      reasoning: resolveReasoning(entry, params.reasoning),
      systemMessages: [getQuickExplainSystemPrompt()],
    },
    onDelta: params.onDelta,
  });
  return (
    outcome.text.trim() || resolveEmptyModelOutcomeMessage(outcome.completion)
  );
}

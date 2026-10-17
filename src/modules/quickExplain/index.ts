import { appLogger } from "../../core/logging";
import {
  getModelEntryById,
  getRuntimeModelEntries,
} from "../../utils/modelProviders";
import { getSelectedModelEntry } from "../contextPanel/prefHelpers";
import {
  openQuickExplainOverlay,
  type QuickExplainAnchor,
} from "./explainOverlay";
import {
  getQuickExplainPresets,
  isQuickExplainPresetsMenuEnabled,
  setQuickExplainPresetModel,
} from "./presets";
import {
  getQuickExplainReasoning,
  isQuickExplainModel,
  quickExplainReasoningOptions,
  setQuickExplainReasoning,
  streamQuickExplainTurn,
} from "./runner";
import { annotateSelection, type SelectionAnnotation } from "./annotate";
import {
  buildQuickExplainContext,
  formatQuickExplainContext,
} from "./selectionContext";

export {
  closeAllQuickExplainOverlays,
  closeQuickExplainOverlay,
} from "./explainOverlay";

/** Opens the answer card for a reader selection and runs the first preset. */
export function openQuickExplainForSelection(params: {
  doc: Document;
  anchor: QuickExplainAnchor;
  reader: any;
  item: Zotero.Item | null;
  selectedText: string;
  /** The reader popup's selection (position, page), for highlighting it. */
  selection?: SelectionAnnotation | null;
  presetId?: string;
  /** Hands the selection (and an optional question) to the sidebar chat. */
  openInSidebar: (question: string) => void;
}): void {
  const entries = getRuntimeModelEntries().filter(isQuickExplainModel);
  const fallbackId =
    getSelectedModelEntry()?.entryId || entries[0]?.entryId || "";
  const presets = getQuickExplainPresets();
  // Built once per card; follow-ups reuse it.
  let contextPromise: Promise<string> | null = null;
  const getContext = () =>
    (contextPromise ??= buildQuickExplainContext(
      params.reader,
      params.item,
      params.selectedText,
    ).then((ctx) => formatQuickExplainContext(ctx, params.selectedText)));

  openQuickExplainOverlay({
    doc: params.doc,
    anchor: params.anchor,
    presets,
    initialPresetId: params.presetId || presets[0]?.id || "",
    showPresetsMenu: isQuickExplainPresetsMenuEnabled(),
    models: entries.map((e) => ({
      id: e.entryId,
      label: e.displayModelLabel || e.model,
    })),
    modelForPreset: (preset) =>
      preset.modelEntryId &&
      getRuntimeModelEntries().some((e) => e.entryId === preset.modelEntryId)
        ? preset.modelEntryId
        : fallbackId,
    onModelChange: (presetId, modelId) => {
      setQuickExplainPresetModel(presetId, modelId);
      const p = presets.find((x) => x.id === presetId);
      if (p) p.modelEntryId = modelId;
    },
    reasoningOptions: (modelId) =>
      quickExplainReasoningOptions(getModelEntryById(modelId)),
    getReasoning: getQuickExplainReasoning,
    onReasoningChange: setQuickExplainReasoning,
    ask: async (turn) => {
      const entry = getModelEntryById(turn.modelId);
      if (!entry) {
        throw new Error("Chưa cấu hình model (Settings → llm-for-zotero)");
      }
      return streamQuickExplainTurn({
        entry,
        prompt: turn.prompt,
        context: await getContext(),
        history: turn.history,
        reasoning: turn.reasoning,
        signal: turn.signal,
        onDelta: turn.onDelta,
      });
    },
    onAnnotate: async (markdown) => {
      if (!params.item || !params.selection) return false;
      try {
        await annotateSelection(params.item, params.selection, markdown);
        return true;
      } catch (err) {
        appLogger.warn("LLM: quick explain annotation failed", err);
        return false;
      }
    },
    onOpenInSidebar: params.openInSidebar,
  });
}

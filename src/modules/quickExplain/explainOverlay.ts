import type { ChatMessage } from "../../shared/llm";
import { renderRenderedMarkdownInto } from "../contextPanel/renderedMarkdown";
import { copyTextToClipboard } from "../contextPanel/clipboard";
import type { QuickExplainPreset } from "./presets";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const OVERLAY_KEY = "__llmQuickExplainOverlay";
const MARGIN = 8;
const GAP = 6;
const WIDTH = 420;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
/** Last size the user dragged the card to; reused for every new card. */
const SIZE_PREF = "extensions.zotero.llmforzotero.quickExplainSize";
const MIN_BELOW = 260;

export type QuickExplainAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type QuickExplainAsk = {
  prompt: string;
  history: ChatMessage[];
  modelId: string;
  /** "fast", "auto", or a level the model offers. */
  reasoning: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
};

export type QuickExplainOverlayInput = {
  /** Reader popup document (the renderTextSelectionPopup event's doc). */
  doc: Document;
  anchor: QuickExplainAnchor;
  presets: QuickExplainPreset[];
  initialPresetId: string;
  models: { id: string; label: string }[];
  /** Model the preset runs on: its pinned model or the sidebar's. */
  modelForPreset: (preset: QuickExplainPreset) => string;
  onModelChange: (presetId: string, modelId: string) => void;
  ask: (turn: QuickExplainAsk) => Promise<string>;
  /** Highlights the selection in the PDF with the answer as its comment. */
  onAnnotate: (markdown: string) => Promise<boolean>;
  showPresetsMenu: boolean;
  /** Reasoning choices for a model, "fast"/"auto" first. */
  reasoningOptions: (modelId: string) => { level: string; label: string }[];
  getReasoning: (modelId: string) => string;
  onReasoningChange: (modelId: string, level: string) => void;
  /** Adds the selection to the sidebar chat, where the full paper is in context. */
  onOpenInSidebar: (question: string) => void;
};

type Handle = { close(): void };
type DocWithOverlay = Document & { [OVERLAY_KEY]?: Handle };

const openOverlays = new Set<Handle>();

function isDark(doc: Document): boolean {
  try {
    return Boolean(
      doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)")?.matches,
    );
  } catch {
    return false;
  }
}

/** Same reasoning as the selection prompt overlay: the PDF page is a nested iframe. */
function collectPointerDocuments(doc: Document, depth = 3): Document[] {
  const docs: Document[] = [doc];
  if (depth <= 0) return docs;
  let frames: ArrayLike<HTMLIFrameElement> = [];
  try {
    frames = doc.querySelectorAll?.("iframe") ?? [];
  } catch {
    return docs;
  }
  for (const frame of Array.from(frames)) {
    try {
      const inner = frame.contentDocument;
      if (inner) {
        for (const d of collectPointerDocuments(inner, depth - 1)) {
          if (!docs.includes(d)) docs.push(d);
        }
      }
    } catch {
      // cross-origin
    }
  }
  return docs;
}

function markdownCss(muted: string, border: string, codeBg: string): string {
  const s = "[data-llm-quick-explain] .llm-rendered-markdown";
  return [
    `${s}{overflow-wrap:anywhere}`,
    `${s} p,${s} ul,${s} ol,${s} pre,${s} table,${s} blockquote{margin:0 0 6px}`,
    `${s} > :last-child{margin-bottom:0}`,
    `${s} ul,${s} ol{padding-left:18px}`,
    `${s} h1,${s} h2,${s} h3,${s} h4{font-size:inherit;margin:8px 0 4px}`,
    `${s} code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.92em;background:${codeBg};padding:0 3px;border-radius:3px}`,
    `${s} pre{background:${codeBg};padding:6px;border-radius:4px;overflow:auto}`,
    `${s} pre code{padding:0;background:none}`,
    `${s} table{border-collapse:collapse;display:block;overflow-x:auto}`,
    `${s} th,${s} td{border:1px solid ${border};padding:2px 6px;text-align:left}`,
    `${s} blockquote{border-left:2px solid ${border};padding-left:8px;color:${muted}}`,
    `${s} a{color:inherit}`,
  ].join("\n");
}

/**
 * KOReader-style answer card next to the selection. One per document;
 * a new one replaces the old. Plugin CSS never reaches reader documents,
 * so styles are inline (plus one scoped <style> for rendered Markdown).
 */
export function openQuickExplainOverlay(
  input: QuickExplainOverlayInput,
): Handle {
  const { doc, anchor } = input;
  (doc as DocWithOverlay)[OVERLAY_KEY]?.close();

  const dark = isDark(doc);
  const bg = dark ? "#2a2a2a" : "#ffffff";
  const fg = dark ? "#e8e8e8" : "#1f1f1f";
  const muted = dark ? "#9a9a9a" : "#6e6e6e";
  const border = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)";
  const codeBg = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
  const hover = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const el = <K extends string>(tag: K, css: string[] = []) => {
    const node = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
    if (css.length) node.style.cssText = css.join(";");
    return node;
  };
  const textButton = (label: string, title?: string) => {
    const b = el("button", [
      "border:none",
      "background:none",
      `color:${muted}`,
      "font:inherit",
      "font-size:12px",
      "padding:2px 6px",
      "border-radius:4px",
      "cursor:pointer",
    ]) as HTMLButtonElement;
    b.type = "button";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("mouseenter", () => (b.style.background = hover));
    b.addEventListener("mouseleave", () => (b.style.background = "none"));
    return b;
  };

  const root = el("div", [
    "position:fixed",
    "z-index:10000",
    "display:flex",
    "flex-direction:column",
    `width:${WIDTH}px`,
    "max-width:calc(100vw - 16px)",
    "box-sizing:border-box",
    `background:${bg}`,
    `color:${fg}`,
    `border:1px solid ${border}`,
    "border-radius:6px",
    "box-shadow:0 4px 14px rgba(0,0,0,0.18)",
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
    "font-size:13px",
    "line-height:1.45",
    "user-select:text",
    "-moz-user-select:text",
    "overflow:hidden",
    `min-width:${MIN_WIDTH}px`,
    `min-height:${MIN_HEIGHT}px`,
  ]);
  root.setAttribute("data-llm-quick-explain", "true");
  const style = el("style");
  style.textContent = markdownCss(muted, border, codeBg);
  root.append(style);

  // Header: preset menu · model · close.
  const header = el("div", [
    "display:flex",
    "align-items:center",
    "gap:4px",
    "padding:4px 6px",
    `border-bottom:1px solid ${border}`,
    "flex:0 0 auto",
  ]);
  const presetLabel = el("span", ["font-weight:600", "padding:2px 4px"]);
  const spacer = el("div", ["flex:1 1 auto"]);
  const modelSelect = el("select", [
    "max-width:170px",
    "font:inherit",
    "font-size:12px",
    `color:${muted}`,
    "background:transparent",
    "border:none",
    "cursor:pointer",
  ]) as HTMLSelectElement;
  modelSelect.title = "Model cho preset này (được nhớ)";
  for (const m of input.models) {
    const opt = el("option") as HTMLOptionElement;
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.append(opt);
  }
  const reasoningSelect = el("select", [
    "max-width:90px",
    "font:inherit",
    "font-size:12px",
    `color:${muted}`,
    "background:transparent",
    "border:none",
    "cursor:pointer",
  ]) as HTMLSelectElement;
  reasoningSelect.title = "Mức reasoning (được nhớ theo model)";
  const closeBtn = textButton("✕", "Đóng (Esc)");
  header.append(presetLabel, spacer, modelSelect, reasoningSelect, closeBtn);

  const transcript = el("div", [
    "flex:1 1 auto",
    "min-height:40px",
    "overflow-y:auto",
    "padding:8px 10px",
  ]);

  // Follow-up box, always under the answer. contenteditable, not
  // <textarea>: the reader's capture-phase shortcuts skip only it.
  const footer = el("div", [
    "position:relative",
    "display:flex",
    "align-items:flex-end",
    "gap:4px",
    "padding:6px 8px",
    `border-top:1px solid ${border}`,
    "flex:0 0 auto",
  ]);
  const field = el("div", [
    "position:relative",
    "flex:1 1 auto",
    "min-width:0",
  ]);
  const editor = el("div", [
    "min-height:20px",
    "max-height:100px",
    "overflow-y:auto",
    "padding:2px 6px",
    `border:1px solid ${border}`,
    "border-radius:4px",
    "outline:none",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "cursor:text",
  ]);
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("role", "textbox");
  const placeholder = el("span", [
    "position:absolute",
    "left:7px",
    "top:3px",
    "right:7px",
    "overflow:hidden",
    "white-space:nowrap",
    "text-overflow:ellipsis",
    "pointer-events:none",
    `color:${muted}`,
  ]);
  placeholder.setAttribute("aria-hidden", "true");
  field.append(editor, placeholder);
  const SVG_NS = "http://www.w3.org/2000/svg";
  // 16px stroke icons drawn from path data, in the muted text colour.
  const iconButton = (paths: string[], title: string) => {
    const b = textButton("", title);
    b.style.padding = "3px";
    b.style.lineHeight = "0";
    b.setAttribute("aria-label", title);
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.3");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of paths) {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    b.append(svg);
    return b;
  };
  const copyBtn = iconButton(
    ["M5.5 5.5h7v8h-7z", "M3.5 10.5v-8h7"],
    "Copy câu trả lời",
  );
  const noteBtn = iconButton(
    ["M9.5 2.5 13.5 6.5 7 13H3v-4z", "M8 4l4 4", "M2.5 14.5h11"],
    "Highlight đoạn đã chọn, kèm câu trả lời làm comment",
  );
  const sidebarBtn = iconButton(
    ["M2.5 2.5h11v11h-11z", "M9.5 2.5v11", "M4.5 8h3", "M6 6.5 7.5 8 6 9.5"],
    "Mở trong sidebar (có toàn bộ paper)",
  );
  const presetsBtn = iconButton(["M4 6.5 8 10.5 12 6.5"], "Preset có sẵn");
  // Ready-made questions, opened upward from the ▾ button.
  const menu = el("div", [
    "position:absolute",
    "right:6px",
    "bottom:calc(100% + 2px)",
    "display:none",
    "flex-direction:column",
    "min-width:170px",
    "padding:4px",
    `background:${bg}`,
    `border:1px solid ${border}`,
    "border-radius:5px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.16)",
  ]);
  footer.append(field, copyBtn, noteBtn, sidebarBtn, presetsBtn, menu);
  if (!input.showPresetsMenu) presetsBtn.style.display = "none";

  root.append(header, transcript, footer);

  // ── state ───────────────────────────────────────────────────────────
  const history: ChatMessage[] = [];
  const answers: { label: string; text: string }[] = [];
  let preset =
    input.presets.find((p) => p.id === input.initialPresetId) ??
    input.presets[0];
  let controller: AbortController | null = null;
  let closed = false;
  const view = doc.defaultView;
  const raf = (fn: () => void) =>
    view?.requestAnimationFrame ? view.requestAnimationFrame(fn) : fn();

  const syncPresetUi = () => {
    presetLabel.textContent = preset.label;
    const id = input.modelForPreset(preset);
    if (id) modelSelect.value = id;
    syncReasoning();
  };
  const ASK_HINT = "Hỏi thêm về đoạn này… (Enter gửi)";
  const syncPlaceholder = () => {
    placeholder.style.display = editor.textContent ? "none" : "";
  };
  const setStatus = (text: string) => {
    placeholder.textContent = text || ASK_HINT;
  };
  const setBusy = (busy: boolean) => {
    setStatus(busy ? "Đang trả lời…" : "");
    noteBtn.disabled = busy || !answers.length;
    copyBtn.disabled = busy || !answers.length;
  };

  const appendSection = (label: string) => {
    if (answers.length) {
      const q = el("div", [
        `color:${muted}`,
        "font-size:12px",
        `border-top:1px solid ${border}`,
        "margin-top:8px",
        "padding-top:6px",
      ]);
      q.textContent = `▸ ${label}`;
      transcript.append(q);
    }
    const out = el("div");
    transcript.append(out);
    return out;
  };
  function syncReasoning() {
    reasoningSelect.textContent = "";
    for (const o of input.reasoningOptions(modelSelect.value)) {
      const opt = el("option") as HTMLOptionElement;
      opt.value = o.level;
      opt.textContent = o.label;
      reasoningSelect.append(opt);
    }
    reasoningSelect.value = input.getReasoning(modelSelect.value);
    if (!reasoningSelect.value && reasoningSelect.options.length) {
      reasoningSelect.selectedIndex = 0;
    }
  }
  const run = async (label: string, prompt: string) => {
    controller?.abort();
    const Ctor =
      (globalThis as any).AbortController ??
      (ztoolkit.getGlobal("AbortController") as typeof AbortController);
    const ctrl: AbortController = new Ctor();
    controller = ctrl;
    const out = appendSection(label);
    let text = "";
    let scheduled = false;
    const paint = () => {
      scheduled = false;
      if (closed) return;
      renderRenderedMarkdownInto(out, text, doc, { deferEnrichment: true });
      transcript.scrollTop = transcript.scrollHeight;
    };
    setBusy(true);
    try {
      const final = await input.ask({
        prompt,
        history: history.slice(),
        modelId: modelSelect.value,
        reasoning: reasoningSelect.value || "fast",
        signal: ctrl.signal,
        onDelta: (d) => {
          text += d;
          if (!scheduled) {
            scheduled = true;
            raf(paint);
          }
        },
      });
      if (closed || controller !== ctrl) return;
      text = final || text;
      paint();
      history.push({ role: "user", content: prompt });
      history.push({ role: "assistant", content: text });
      answers.push({ label, text });
    } catch (err) {
      if (closed || ctrl.signal.aborted) return;
      out.style.color = dark ? "#ff8a80" : "#b3261e";
      out.textContent = `Lỗi: ${(err as Error)?.message || err}`;
    } finally {
      if (!closed && controller === ctrl) setBusy(false);
    }
  };

  const hideMenu = () => (menu.style.display = "none");
  const buildMenu = () => {
    menu.textContent = "";
    for (const p of input.presets) {
      const b = textButton(p.label);
      b.style.textAlign = "left";
      b.style.color = fg;
      b.addEventListener("click", () => {
        hideMenu();
        preset = p;
        syncPresetUi();
        void run(p.label, p.prompt);
      });
      menu.append(b);
    }
  };

  // ── events ──────────────────────────────────────────────────────────
  presetsBtn.addEventListener("click", () => {
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
  });
  editor.addEventListener("input", syncPlaceholder);
  modelSelect.addEventListener("change", () => {
    input.onModelChange(preset.id, modelSelect.value);
    syncReasoning();
  });
  reasoningSelect.addEventListener("change", () => {
    input.onReasoningChange(modelSelect.value, reasoningSelect.value);
  });
  closeBtn.addEventListener("click", () => close());
  copyBtn.addEventListener("click", () => {
    const last = answers[answers.length - 1];
    if (!last) return;
    void copyTextToClipboard(root, last.text);
    setStatus("Đã copy");
  });
  noteBtn.addEventListener("click", async () => {
    if (!answers.length) return;
    const md = answers
      .map((a, i) => (i ? `**${a.label}**\n\n${a.text}` : a.text))
      .join("\n\n---\n\n");
    noteBtn.disabled = true;
    const ok = await input.onAnnotate(md).catch(() => false);
    setStatus(ok ? "Đã highlight kèm comment" : "Không tạo được annotation");
    noteBtn.disabled = false;
  });
  sidebarBtn.addEventListener("click", () => {
    const q = (editor.innerText || "").trim();
    input.onOpenInSidebar(q);
    close();
  });
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (menu.style.display !== "none") {
        hideMenu();
        return;
      }
      close();
      return;
    }
  };
  const submitAsk = () => {
    const q = (editor.innerText || "").trim();
    if (!q) return;
    editor.textContent = "";
    syncPlaceholder();
    void run(q, q);
  };
  // Enter is taken on the window in the capture phase: the reader's own
  // capture listeners run there too and can swallow it before the box.
  const onWinKeyDown = (e: KeyboardEvent) => {
    if (closed || doc.activeElement !== editor) return;
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229)
      return;
    e.preventDefault();
    e.stopPropagation();
    submitAsk();
  };
  // Last resort when no keydown arrives: Enter still asks the editor for a
  // new paragraph.
  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType !== "insertParagraph") return;
    e.preventDefault();
    submitAsk();
  };
  const stop = (e: Event) => e.stopPropagation();
  const onDocPointerDown = (e: Event) => {
    const target = e.target as Node | null;
    if (target && root.contains(target)) return;
    close();
  };

  let pointerDocs: Document[] = [];
  function close() {
    if (closed) return;
    closed = true;
    controller?.abort();
    try {
      view?.removeEventListener("keydown", onWinKeyDown, true);
    } catch {
      // window gone
    }
    root.remove();
    openOverlays.delete(handle);
    if ((doc as DocWithOverlay)[OVERLAY_KEY] === handle) {
      delete (doc as DocWithOverlay)[OVERLAY_KEY];
    }
    for (const d of pointerDocs) {
      try {
        d.removeEventListener("pointerdown", onDocPointerDown, true);
      } catch {
        // view recreated
      }
    }
  }
  const handle: Handle = { close };

  // ── mount & position ────────────────────────────────────────────────
  buildMenu();
  syncPresetUi();
  setBusy(false);
  (doc.body || doc.documentElement).appendChild(root);
  (doc as DocWithOverlay)[OVERLAY_KEY] = handle;
  openOverlays.add(handle);

  const vw = view?.innerWidth ?? 800;
  const vh = view?.innerHeight ?? 600;
  let saved: { w?: number; h?: number } = {};
  try {
    saved = JSON.parse(`${Zotero.Prefs.get(SIZE_PREF, true) || "{}"}`);
  } catch {
    saved = {};
  }
  const width = Math.min(
    Math.max(MIN_WIDTH, Number(saved.w) || WIDTH),
    vw - 2 * MARGIN,
  );
  root.style.width = `${Math.round(width)}px`;
  if (Number(saved.h) >= MIN_HEIGHT) {
    root.style.height = `${Math.round(Math.min(Number(saved.h), vh - 2 * MARGIN))}px`;
  }
  const left = Math.max(MARGIN, Math.min(anchor.left, vw - MARGIN - width));
  const below = vh - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  root.style.left = `${Math.round(left)}px`;
  if (below >= MIN_BELOW || below >= above) {
    root.style.top = `${Math.round(anchor.bottom + GAP)}px`;
    root.style.maxHeight = `${Math.round(Math.max(160, below))}px`;
  } else {
    root.style.bottom = `${Math.round(vh - anchor.top + GAP)}px`;
    root.style.maxHeight = `${Math.round(Math.max(160, above))}px`;
  }

  // Pin by top-left before the user moves or resizes, so neither fights
  // the bottom anchor or the fit-below max-height.
  const pinTopLeft = () => {
    const r = root.getBoundingClientRect();
    root.style.top = `${Math.round(r.top)}px`;
    root.style.left = `${Math.round(r.left)}px`;
    root.style.bottom = "auto";
    root.style.maxHeight = `${Math.round(vh - MARGIN - r.top)}px`;
  };
  // Drag by the header, away from its controls.
  header.style.cursor = "move";
  header.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element)?.closest?.("button,select,input")) return;
    e.preventDefault();
    pinTopLeft();
    const start = root.getBoundingClientRect();
    const dx = e.clientX - start.left;
    const dy = e.clientY - start.top;
    header.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const w = root.offsetWidth;
      const left = Math.max(0, Math.min(ev.clientX - dx, vw - w));
      const top = Math.max(0, Math.min(ev.clientY - dy, vh - 40));
      root.style.left = `${Math.round(left)}px`;
      root.style.top = `${Math.round(top)}px`;
      root.style.maxHeight = `${Math.round(vh - MARGIN - top)}px`;
    };
    const onUp = () => {
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onUp);
    };
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  });
  // Corner grip, drawn above the footer so it stays reachable.
  const grip = el("div", [
    "position:absolute",
    "right:0",
    "bottom:0",
    "width:14px",
    "height:14px",
    "cursor:nwse-resize",
    "z-index:2",
    `background:linear-gradient(135deg, transparent 50%, ${border} 50%, ${border} 60%, transparent 60%, transparent 75%, ${border} 75%, ${border} 85%, transparent 85%)`,
  ]);
  grip.title = "Kéo để đổi kích thước";
  root.append(grip);
  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pinTopLeft();
    const start = root.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    grip.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(
        MIN_WIDTH,
        Math.min(start.width + ev.clientX - x0, vw - start.left - MARGIN),
      );
      const h = Math.max(
        MIN_HEIGHT,
        Math.min(start.height + ev.clientY - y0, vh - start.top - MARGIN),
      );
      root.style.width = `${Math.round(w)}px`;
      root.style.height = `${Math.round(h)}px`;
    };
    const onUp = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      Zotero.Prefs.set(
        SIZE_PREF,
        JSON.stringify({ w: root.offsetWidth, h: root.offsetHeight }),
        true,
      );
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });

  pointerDocs = collectPointerDocuments(doc);
  for (const d of pointerDocs) {
    d.addEventListener("pointerdown", onDocPointerDown, true);
  }
  root.addEventListener("keydown", onKeyDown as EventListener);
  view?.addEventListener("keydown", onWinKeyDown, true);
  editor.addEventListener("beforeinput", onBeforeInput as EventListener);
  root.addEventListener("keyup", stop);
  root.addEventListener("keypress", stop);

  void run(preset.label, preset.prompt);
  return handle;
}

export function closeQuickExplainOverlay(doc: Document): void {
  (doc as DocWithOverlay)[OVERLAY_KEY]?.close();
}

export function closeAllQuickExplainOverlays(): void {
  for (const h of Array.from(openOverlays)) {
    try {
      h.close();
    } catch {
      // torn-down reader document
    }
  }
  openOverlays.clear();
}

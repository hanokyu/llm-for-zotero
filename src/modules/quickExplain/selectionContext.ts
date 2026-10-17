import { getPdfViewerApplication } from "../../services/pdf/pdfPageCapture";
import { getCurrentSelectionPageLocationFromReader } from "../../services/pdf/livePdfSelectionLocator";

/** Characters of page text kept on each side of the selection. */
const SURROUNDING_CHARS = 1800;

export type QuickExplainContext = {
  title: string;
  abstract: string;
  surrounding: string;
  pageLabel?: string;
};

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function readPageText(app: any, pageIndex: number): Promise<string> {
  const doc = app?.pdfDocument;
  if (!doc || pageIndex < 0 || pageIndex >= (doc.numPages ?? 0)) return "";
  try {
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content?.items ?? []) {
      if (typeof item?.str === "string") parts.push(item.str);
      if (item?.hasEOL) parts.push("\n");
    }
    return parts.join(" ");
  } catch {
    return "";
  }
}

/** Cut at a sentence boundary near the window edge when one is close. */
function trimToSentences(text: string, cutStart: boolean, cutEnd: boolean) {
  let out = text;
  if (cutStart) {
    const i = out.search(/[.!?]\s+[A-Z(]/);
    if (i >= 0 && i < 300) out = out.slice(i + 2);
  }
  if (cutEnd) {
    const j = out.slice(-300).search(/[.!?]\s/);
    if (j >= 0) out = out.slice(0, out.length - 300 + j + 1);
  }
  return out.trim();
}

/**
 * Selection's page plus its neighbours, cut to a window around the
 * selection. Empty when the reader exposes no pdf.js text (EPUB, snapshot).
 */
export async function getSurroundingText(
  reader: any,
  selectedText: string,
): Promise<{ text: string; pageLabel?: string }> {
  const location = getCurrentSelectionPageLocationFromReader(
    reader,
    selectedText,
  );
  const app = getPdfViewerApplication(reader);
  if (!location || !app) return { text: "" };
  const idx = location.pageIndex;
  const [prev, cur, next] = await Promise.all([
    readPageText(app, idx - 1),
    readPageText(app, idx),
    readPageText(app, idx + 1),
  ]);
  const joined = squash([prev, cur, next].filter(Boolean).join(" "));
  const needle = squash(selectedText).slice(0, 80);
  const at = needle ? joined.indexOf(needle) : -1;
  if (at < 0) {
    return {
      text: trimToSentences(squash(cur), false, false),
      pageLabel: location.pageLabel,
    };
  }
  const start = Math.max(0, at - SURROUNDING_CHARS);
  const end = Math.min(
    joined.length,
    at + squash(selectedText).length + SURROUNDING_CHARS,
  );
  return {
    text: trimToSentences(
      joined.slice(start, end),
      start > 0,
      end < joined.length,
    ),
    pageLabel: location.pageLabel,
  };
}

export async function buildQuickExplainContext(
  reader: any,
  item: Zotero.Item | null,
  selectedText: string,
): Promise<QuickExplainContext> {
  const parent = item?.parentItem ?? item;
  let title = "";
  let abstract = "";
  try {
    title = `${parent?.getField?.("title") || ""}`.trim();
    abstract = `${parent?.getField?.("abstractNote") || ""}`.trim();
  } catch {
    // Attachments without a regular parent have no such fields.
  }
  let surrounding = { text: "" } as { text: string; pageLabel?: string };
  try {
    surrounding = await getSurroundingText(reader, selectedText);
  } catch {
    // Selection-only context still works.
  }
  return {
    title,
    abstract,
    surrounding: surrounding.text,
    pageLabel: surrounding.pageLabel,
  };
}

export function formatQuickExplainContext(
  ctx: QuickExplainContext,
  selectedText: string,
): string {
  const parts: string[] = [];
  if (ctx.title) parts.push(`Paper title: ${ctx.title}`);
  if (ctx.abstract) parts.push(`Abstract:\n${ctx.abstract}`);
  if (ctx.surrounding) {
    parts.push(
      `Surrounding text${ctx.pageLabel ? ` (around page ${ctx.pageLabel})` : ""}:\n${ctx.surrounding}`,
    );
  }
  parts.push(`Selected passage:\n"""\n${selectedText}\n"""`);
  return parts.join("\n\n");
}

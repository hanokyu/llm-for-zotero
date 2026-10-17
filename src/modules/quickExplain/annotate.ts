/** The selection as the reader's text-selection popup describes it. */
export type SelectionAnnotation = {
  text?: string;
  position?: unknown;
  pageLabel?: string;
  sortIndex?: string;
};

const HIGHLIGHT_COLOR = "#ffd400";

/**
 * Saves the selection as a highlight on the PDF attachment, with the answer
 * as its comment, exactly where the user selected it.
 */
export async function annotateSelection(
  attachment: Zotero.Item,
  selection: SelectionAnnotation,
  comment: string,
): Promise<void> {
  if (!selection.position || !selection.sortIndex) {
    throw new Error("Selection has no position");
  }
  const json = {
    key: (
      Zotero as unknown as {
        DataObjectUtilities: { generateKey: () => string };
      }
    ).DataObjectUtilities.generateKey(),
    type: "highlight",
    color: HIGHLIGHT_COLOR,
    text: selection.text || "",
    comment,
    pageLabel: selection.pageLabel || "",
    sortIndex: selection.sortIndex,
    position: selection.position,
  };
  await (
    Zotero as unknown as {
      Annotations: {
        saveFromJSON: (attachment: unknown, json: unknown) => Promise<unknown>;
      };
    }
  ).Annotations.saveFromJSON(attachment, json);
}

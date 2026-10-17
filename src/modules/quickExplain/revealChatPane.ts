type Sidenav = Element & {
  _collapsed?: boolean;
  container?: { getPane: (id: string) => Element | null };
};

/**
 * Opens the reader's right pane on the chat section, as if the user clicked
 * its rail icon. A no-op when the chat view is already showing (a second
 * click on the icon would close it).
 */
export function revealReaderChatPane(doc: Document | null): void {
  if (!doc) return;
  const win = doc.defaultView as
    | (Window & { ZoteroContextPane?: { collapsed: boolean } })
    | null;
  const contextPane = win?.ZoteroContextPane;
  const paneWasCollapsed = Boolean(contextPane?.collapsed);
  if (contextPane && paneWasCollapsed) contextPane.collapsed = false;

  const view = doc.documentElement.getAttribute("data-llm-pane-view");
  for (const sidenav of Array.from(
    doc.querySelectorAll("#zotero-context-pane item-pane-sidenav"),
  ) as Sidenav[]) {
    for (const button of Array.from(
      sidenav.querySelectorAll("[data-pane]"),
    ) as HTMLElement[]) {
      const id = button.getAttribute("data-pane");
      const pane = id ? sidenav.container?.getPane(id) : null;
      if (!pane?.classList.contains("llm-dedicated-chat-pane")) continue;
      if (!button.getClientRects().length) continue; // another tab's sidenav
      const showing =
        !paneWasCollapsed && !sidenav._collapsed && view === "chat";
      if (!showing) button.click();
      return;
    }
  }
}

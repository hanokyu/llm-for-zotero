import { addOpenRouterModel, fetchOpenRouterModels } from "./openRouter";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

let catalogue: { id: string; name: string; note: string }[] | null = null;

/**
 * Adds "Duyệt OpenRouter…" to the sidebar model menu. Picking it turns the
 * menu into a searchable OpenRouter catalogue; choosing a model adds it to
 * the OpenRouter provider in Settings and hands its entry id to `onPick`.
 */
export function appendOpenRouterBrowseItem(
  menu: HTMLElement,
  onPick: (entryId: string) => void,
): void {
  const doc = menu.ownerDocument;
  const el = (tag: string, className: string) => {
    const node = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
    node.className = className;
    return node;
  };
  const browse = el(
    "button",
    "llm-response-menu-item llm-model-option",
  ) as HTMLButtonElement;
  browse.type = "button";
  browse.textContent = "Duyệt OpenRouter…";
  browse.title = "Tìm và thêm model từ OpenRouter";
  menu.append(browse);

  let opened = false;
  const open = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    // pointerdown and click both arrive; build the picker once.
    if (opened) return;
    opened = true;
    menu.textContent = "";
    const search = el("input", "llm-min-or-search") as HTMLInputElement;
    search.type = "text";
    search.placeholder = "Tìm model (vd: claude, gemini flash, :free)…";
    const list = el("div", "llm-min-or-list");
    menu.append(search, list);
    const render = () => {
      list.textContent = "";
      const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = (catalogue ?? [])
        .filter((m) =>
          terms.every((t) => `${m.id} ${m.name}`.toLowerCase().includes(t)),
        )
        .slice(0, 100);
      for (const m of rows) {
        const b = el(
          "button",
          "llm-response-menu-item llm-model-option",
        ) as HTMLButtonElement;
        b.type = "button";
        b.title = m.id;
        const name = el("span", "llm-min-or-name");
        name.textContent = m.name;
        const note = el("span", "llm-min-or-note");
        note.textContent = m.note;
        b.append(name, note);
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const added = addOpenRouterModel(m.id);
          if (!added) {
            list.textContent =
              "Chưa có provider OpenRouter — thêm trong Settings → llm-for-zotero.";
            return;
          }
          onPick(added.id);
        });
        list.append(b);
      }
      if (!rows.length) {
        const empty = el("div", "llm-min-or-empty");
        empty.textContent = catalogue ? "Không có model khớp" : "Đang tải…";
        list.append(empty);
      }
    };
    search.addEventListener("input", render);
    search.addEventListener("keydown", (ev) => ev.stopPropagation());
    render();
    doc.defaultView?.setTimeout(() => search.focus(), 0);
    if (!catalogue) {
      fetchOpenRouterModels()
        .then((rows) => {
          catalogue = rows;
          render();
        })
        .catch((err) => {
          list.textContent = `Lỗi tải danh sách: ${(err as Error)?.message || err}`;
        });
    }
  };
  browse.addEventListener("pointerdown", open);
  browse.addEventListener("click", open);
}

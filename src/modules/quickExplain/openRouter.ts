import {
  createProviderModelEntry,
  getModelProviderGroups,
  getRuntimeModelEntries,
  setModelProviderGroups,
} from "../../utils/modelProviders";

const MODELS_URL = "https://openrouter.ai/api/v1/models";

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
};

function perMillion(price?: string): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "free";
  return `$${(n * 1e6).toFixed(2)}`;
}

/** Public catalogue (no key needed), with in/out price per 1M tokens. */
export async function fetchOpenRouterModels(): Promise<
  { id: string; name: string; note: string }[]
> {
  const fetchFn = ztoolkit.getGlobal("fetch") as typeof fetch;
  const res = await fetchFn(MODELS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  return (body.data ?? []).map((m) => {
    const ctx = m.context_length
      ? `${Math.round(m.context_length / 1000)}k ctx`
      : "";
    const price = `${perMillion(m.pricing?.prompt)}/${perMillion(m.pricing?.completion)}`;
    return {
      id: m.id,
      name: m.name || m.id,
      note: [price, ctx].filter(Boolean).join(" · "),
    };
  });
}

/**
 * Adds the model to the first OpenRouter provider in Settings (or finds it
 * there already). Null when no OpenRouter provider is configured.
 */
export function addOpenRouterModel(
  openRouterId: string,
): { id: string; label: string } | null {
  const groups = getModelProviderGroups();
  const group = groups.find(
    (g) =>
      "apiBase" in g &&
      /openrouter\.ai/i.test(g.apiBase || "") &&
      g.authMode !== "webchat" &&
      g.authMode !== "codex_auth",
  );
  if (!group || !("models" in group)) return null;
  const models = group.models as { id: string; model: string }[];
  let row = models.find((m) => m.model === openRouterId);
  if (!row) {
    row = createProviderModelEntry(openRouterId, { temperature: 0.3 });
    models.push(row as never);
    setModelProviderGroups(groups);
  }
  const entry = getRuntimeModelEntries().find((e) => e.entryId === row!.id);
  return {
    id: row.id,
    label: entry?.displayModelLabel || openRouterId,
  };
}

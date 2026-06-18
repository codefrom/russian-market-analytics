// .pi/extensions/russian-analytics/lookup.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execAsync, parseJsonSafe } from "./common";

interface LookupResult {
  original: string;
  found: boolean;
  ticker?: string;
  type?: "stock" | "bond" | "etf";
  name?: string;
}

// ============== Вспомогательные функции ==============

/** fetch с таймаутом */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Проверка тикера как акции на TQBR. Возвращает null, если не найдена. */
async function checkStock(ticker: string, timeoutMs = 5000): Promise<{ ticker: string; name: string } | null> {
  const url = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker.toUpperCase()}.json`;
  const r = await fetchWithTimeout(url, timeoutMs);
  if (!r || !r.ok) return null;
  try {
    const j = await r.json();
    const secData = j?.securities?.data;
    if (secData?.length > 0) {
      const name = secData[0][2] || secData[0][1] || ticker.toUpperCase();
      return { ticker: ticker.toUpperCase(), name };
    }
  } catch {}
  return null;
}

/** Поиск акции по названию */
async function lookupStockByName(query: string, timeoutMs = 7000): Promise<{ ticker: string; name: string } | null> {
  const url = `https://iss.moex.com/iss/securities.json?q=${encodeURIComponent(query)}&limit=5`;
  const r = await fetchWithTimeout(url, timeoutMs);
  if (!r || !r.ok) return null;
  try {
    const j = await r.json();
    const securities = j?.securities?.data ?? [];
    for (const sec of securities) {
      const secId = sec[0];
      const secName = sec[2] || sec[1];
      if (await checkStock(secId, 3000)) {
        return { ticker: secId, name: secName };
      }
    }
  } catch {}
  return null;
}

/** Проверка ETF. Возвращает null, если не найдена. */
async function checkEtf(ticker: string, timeoutMs = 5000): Promise<{ ticker: string; name: string } | null> {
  try {
    const { stdout } = await execAsync(`tools/venv/bin/python tools/fetch_moex_etf.py ${ticker}`, { timeout: timeoutMs });
    const d = parseJsonSafe(stdout);
    if (d?.exists) {
      return { ticker: ticker.toUpperCase(), name: d.name || d.shortname || ticker.toUpperCase() };
    }
  } catch {}
  return null;
}

/** Поиск облигации по названию (через MOEX API) */
async function lookupBondByName(query: string, timeoutMs = 7000): Promise<{ ticker: string; name: string } | null> {
  const url = `https://iss.moex.com/iss/securities.json?q=${encodeURIComponent(query)}&limit=5`;
  const r = await fetchWithTimeout(url, timeoutMs);
  if (!r || !r.ok) return null;
  try {
    const j = await r.json();
    const securities = j?.securities?.data ?? [];
    for (const sec of securities) {
      const secId = sec[0];
      const checkUrl = `https://iss.moex.com/iss/engines/stock/markets/bonds/boards/TQCB/securities/${secId}.json`;
      const cr = await fetchWithTimeout(checkUrl, 3000);
      if (!cr || !cr.ok) continue;
      const cj = await cr.json();
      if ((cj?.securities?.data?.length ?? 0) > 0) {
        const name = sec[2] || sec[1];
        return { ticker: secId, name };
      }
    }
  } catch {}
  return null;
}

// ============== Массовый поиск облигаций ==============

interface BondRecord {
  ticker: string;
  shortname: string;
  name: string;
}

async function fetchBondsBatch(queries: string[]): Promise<BondRecord[]> {
  if (queries.length === 0) return [];
  const escapedQueries = queries
    .map(q => `'${q.replace(/'/g, "'\\''")}'`)
    .join(' ');
  try {
    const cmd = `tools/venv/bin/python tools/fetch_moex_bonds.py --queries ${escapedQueries} --json`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const sanitized = stdout.replace(/\bNaN\b/g, "null");
    const data = parseJsonSafe(sanitized);
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        ticker: item.ticker || item.SECID,
        shortname: item.shortname || item.SHORTNAME || '',
        name: item.name || item.SECNAME || '',
      }));
    }
  } catch (e) {
    console.error("fetchBondsBatch error:", e);
  }
  return [];
}

function findBestBondMatch(original: string, bonds: BondRecord[]): BondRecord | null {
  const upper = original.toUpperCase();
  const exact = bonds.find(b => b.ticker.toUpperCase() === upper);
  if (exact) return exact;
  const partial = bonds.find(b =>
    b.shortname.toUpperCase().includes(upper) ||
    b.name.toUpperCase().includes(upper)
  );
  return partial || null;
}

// ============== Приоритет совпадений ==============

interface Candidate {
  type: "stock" | "bond" | "etf";
  ticker: string;
  name: string;
  source: "exact_ticker" | "exact_name" | "partial" | "fallback";
}

function scoreCandidate(c: Candidate, original: string): number {
  const upper = original.toUpperCase();
  const tickerUpper = c.ticker.toUpperCase();
  const nameUpper = c.name.toUpperCase();

  if (tickerUpper === upper) return 0; // точное совпадение тикера
  if (nameUpper === upper) return 1;   // точное совпадение названия
  if (nameUpper.includes(upper) || upper.includes(nameUpper)) return 2; // частичное
  return 3; // fallback
}

/** Выбирает лучшего кандидата из нескольких */
function pickBest(candidates: Candidate[], original: string): Candidate | null {
  if (candidates.length === 0) return null;
  // сортируем по score, затем по приоритету типа: stock > etf > bond
  const typeOrder: Record<string, number> = { stock: 0, etf: 1, bond: 2 };
  candidates.sort((a, b) => {
    const scoreA = scoreCandidate(a, original);
    const scoreB = scoreCandidate(b, original);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return (typeOrder[a.type] ?? 0) - (typeOrder[b.type] ?? 0);
  });
  return candidates[0];
}

// ============== Основной поиск одного идентификатора ==============

async function lookupOne(
  original: string,
  allBonds: BondRecord[]
): Promise<LookupResult> {
  const trimmed = original.trim();
  if (!trimmed) return { original, found: false };

  const candidates: Candidate[] = [];

  // Параллельный запуск всех проверок
  const [stockResult, etfResult, stockByName, bondByName] = await Promise.all([
    checkStock(trimmed),
    checkEtf(trimmed),
    lookupStockByName(trimmed),
    lookupBondByName(trimmed),
  ]);

  // Акция (точный тикер)
  if (stockResult) {
    candidates.push({ type: "stock", ticker: stockResult.ticker, name: stockResult.name, source: "exact_ticker" });
  }
  // ETF
  if (etfResult) {
    candidates.push({ type: "etf", ticker: etfResult.ticker, name: etfResult.name, source: "exact_ticker" });
  }
  // Облигация из пакетного поиска
  const bondMatch = findBestBondMatch(trimmed, allBonds);
  if (bondMatch) {
    candidates.push({ type: "bond", ticker: bondMatch.ticker, name: bondMatch.shortname || bondMatch.name, source: "partial" });
  }
  // Поиск акции по названию
  if (stockByName) {
    candidates.push({ type: "stock", ticker: stockByName.ticker, name: stockByName.name, source: "fallback" });
  }
  // Поиск облигации по названию
  if (bondByName) {
    candidates.push({ type: "bond", ticker: bondByName.ticker, name: bondByName.name, source: "fallback" });
  }

  const best = pickBest(candidates, trimmed);
  if (best) {
    return {
      original,
      found: true,
      ticker: best.ticker,
      type: best.type,
      name: best.name,
    };
  }
  return { original, found: false };
}

// ============== Публичный API ==============

export async function lookupInstruments(identifiers: string[]): Promise<LookupResult[]> {
  const cleaned = identifiers.map(s => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  // Один раз получаем все облигации для всех идентификаторов
  const allBonds = await fetchBondsBatch(cleaned);

  const results = await Promise.all(
    cleaned.map(id => lookupOne(id, allBonds))
  );
  return results;
}

export function registerLookup(pi: ExtensionAPI) {
  pi.registerTool({
    name: "lookup_instruments",
    label: "Lookup Instruments",
    description: "Находит тикеры и типы инструментов на MOEX по списку строк (тикеры, названия, ISIN).",
    parameters: Type.Object({
      identifiers: Type.Array(Type.String()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { identifiers } = params;
      const results = await lookupInstruments(identifiers);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  });
}
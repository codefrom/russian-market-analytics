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
      // Поля: SECID, SHORTNAME, SECNAME...
      const name = secData[0][2] || secData[0][1] || ticker.toUpperCase(); // SECNAME или SHORTNAME
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

// ============== Массовый поиск облигаций ==============

interface BondRecord {
  ticker: string;
  shortname: string;
  name: string;
}

/**
 * Выполняет один вызов fetch_moex_bonds.py с массивом queries и возвращает список всех найденных облигаций.
 * Каждый запрос оборачивается в одинарные кавычки для безопасной передачи в shell.
 */
async function fetchBondsBatch(queries: string[]): Promise<BondRecord[]> {
  if (queries.length === 0) return [];
  // Экранируем: заменяем все одинарные кавычки внутри строки на '\'', чтобы не сломать оболочку
  const escapedQueries = queries
    .map(q => `'${q.replace(/'/g, "'\\''")}'`)
    .join(' ');
  try {
    const cmd = `tools/venv/bin/python tools/fetch_moex_bonds.py --queries ${escapedQueries} --json`;
    const { stdout } = await execAsync(
      cmd,
      { timeout: 30000 } // увеличенный таймаут
    );
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

/**
 * Сопоставляет исходный идентификатор с наилучшим совпадением из списка облигаций.
 * Приоритет: точное совпадение тикера (ticker), затем частичное совпадение с shortname или name.
 */
function findBestBondMatch(original: string, bonds: BondRecord[]): BondRecord | null {
  const upperOriginal = original.toUpperCase();
  // 1. Точное совпадение по тикеру
  const exact = bonds.find(b => b.ticker.toUpperCase() === upperOriginal);
  if (exact) return exact;
  // 2. Совпадение по shortname или name (содержит original)
  const partial = bonds.find(b =>
    b.shortname.toUpperCase().includes(upperOriginal) ||
    b.name.toUpperCase().includes(upperOriginal)
  );
  return partial || null;
}

/**
 * Массовый поиск облигаций для всех идентификаторов.
 * Возвращает Map: исходная строка -> LookupResult (если найдена) или null.
 */
async function batchLookupBonds(identifiers: string[]): Promise<Map<string, LookupResult | null>> {
  const resultMap = new Map<string, LookupResult | null>();
  if (identifiers.length === 0) return resultMap;

  const allBonds = await fetchBondsBatch(identifiers);

  for (const id of identifiers) {
    const match = findBestBondMatch(id, allBonds);
    if (match) {
      resultMap.set(id, {
        original: id,
        found: true,
        ticker: match.ticker,
        type: "bond",
        name: match.shortname || match.name
      });
    } else {
      resultMap.set(id, null);
    }
  }
  return resultMap;
}

// ============== Кэш и основная логика ==============

const lookupCache = new Map<string, LookupResult>();

/** Индивидуальный поиск акций и ETF */
async function lookupStockOrEtf(trimmed: string): Promise<LookupResult | null> {
  // Акция (точный тикер) – теперь возвращает имя
  const stock = await checkStock(trimmed);
  if (stock) {
    return { original: trimmed, found: true, ticker: stock.ticker, type: "stock", name: stock.name };
  }
  // ETF – теперь возвращает имя
  const etf = await checkEtf(trimmed);
  if (etf) {
    return { original: trimmed, found: true, ticker: etf.ticker, type: "etf", name: etf.name };
  }
  // Поиск акции по названию
  const stockByName = await lookupStockByName(trimmed);
  if (stockByName) {
    return { original: trimmed, found: true, ticker: stockByName.ticker, type: "stock", name: stockByName.name };
  }
  return null;
}

function store(key: string, val: LookupResult): LookupResult {
  lookupCache.set(key, val);
  return val;
}

// ============== Публичный API ==============

export async function lookupInstruments(identifiers: string[]): Promise<LookupResult[]> {
  lookupCache.clear();
  const cleaned = identifiers.map(s => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  // Шаг 1: массовый поиск облигаций
  const bondResults = await batchLookupBonds(cleaned);

  // Шаг 2: для тех, кто не найден в облигациях, ищем акции/ETF параллельно
  const unresolved = cleaned.filter(id => {
    const r = bondResults.get(id);
    return r === null; // null означает "не найдено"
  });

  const stockResults = new Map<string, LookupResult>();
  if (unresolved.length > 0) {
    const stockPromises = unresolved.map(async (id) => {
      const result = await lookupStockOrEtf(id);
      if (result) stockResults.set(id, result);
      else stockResults.set(id, { original: id, found: false });
    });
    await Promise.all(stockPromises);
  }

  // Шаг 3: собрать итоговый массив, сохраняя порядок исходных идентификаторов
  const finalResults: LookupResult[] = [];
  for (const id of cleaned) {
    const bondRes = bondResults.get(id);
    if (bondRes !== null && bondRes !== undefined) {
      finalResults.push(bondRes);
    } else {
      finalResults.push(stockResults.get(id) || { original: id, found: false });
    }
  }

  return finalResults;
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
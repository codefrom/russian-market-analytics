// .pi/extensions/russian-analytics/bond.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, spawnAgent, parseJsonSafe, registerStandardWorker } from "./common";

// Получаем ключевую ставку для оценки процентного риска
async function getKeyRate(): Promise<string> {
    try {
        const { stdout } = await execAsync("tools/venv/bin/python tools/cbr_data.py keyrate");
        const parsed = JSON.parse(stdout);
        return parsed.rate ?? parsed;
    } catch {
        return "не удалось получить";
    }
}

// Массовый поиск облигаций через fetch_moex_bonds.py --queries
async function batchFetchBonds(identifiers: string[]): Promise<any[]> {
    if (identifiers.length === 0) return [];
    const escaped = identifiers.map(id => `"${id.replace(/"/g, '\\"')}"`).join(' ');
    try {
        const { stdout } = await execAsync(
            `tools/venv/bin/python tools/fetch_moex_bonds.py --queries ${escaped} --json`,
            { timeout: 15000 }
        );
        const data = parseJsonSafe(stdout);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

// Поиск наилучшего совпадения среди результатов batch-запроса
function findBestBondMatch(original: string, bonds: any[]): any | null {
    const upper = original.toUpperCase();
    // 1. Точное совпадение по SECID (ticker)
    const exact = bonds.find(b => b.ticker?.toUpperCase() === upper);
    if (exact) return exact;
    // 2. Совпадение по SHORTNAME или SECNAME (содержит original)
    const partial = bonds.find(b =>
        b.shortname?.toUpperCase().includes(upper) ||
        b.name?.toUpperCase().includes(upper)
    );
    return partial || null;
}

// Получение детальных параметров облигации через moex_bonds.py (оставлено без изменений)
async function getBondDetails(ticker: string, bondInfo: any): Promise<{ ytm: string; duration: string; coupon: string; price: string; maturity: string }> {
    let ytm = "нет данных", duration = "нет данных", coupon = "нет данных", price = "нет данных", maturity = "нет данных";
    try {
        const { stdout } = await execAsync(`tools/venv/bin/python tools/moex_bonds.py ${ticker}`);
        const details = parseJsonSafe(stdout);
        if (details) {
            ytm = details.yield ? String(details.yield) : (bondInfo?.yield ?? "нет данных");
            if (details.duration && details.duration !== null) {
                duration = (details.duration / 365).toFixed(2);
            } else if (bondInfo?.matdate) {
                const years = (new Date(bondInfo.matdate).getTime() - Date.now()) / (365 * 86400000);
                duration = years.toFixed(2);
            }
            coupon = details.coupon_value ?? bondInfo?.couponvalue ?? "нет данных";
            price = details.last_price ?? bondInfo?.price ?? "нет данных";
            maturity = bondInfo?.matdate ?? "нет данных";
        } else {
            // fallback
            ytm = bondInfo?.yield ?? "нет данных";
            coupon = bondInfo?.couponvalue ?? "нет данных";
            price = bondInfo?.price ?? "нет данных";
            maturity = bondInfo?.matdate ?? "нет данных";
        }
    } catch (e) {
        // fallback
        ytm = bondInfo?.yield ?? "нет данных";
        coupon = bondInfo?.couponvalue ?? "нет данных";
        price = bondInfo?.price ?? "нет данных";
        maturity = bondInfo?.matdate ?? "нет данных";
    }
    return { ytm, duration, coupon, price, maturity };
}

export async function runBondWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionAPI,
    runDir: string,
    identifiers: string[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Анализ облигаций (${identifiers.length} выпусков)...`);
        const keyrate = await getKeyRate();
        const results: { id: string; output: string }[] = [];

        // Массовый поиск облигаций
        const allBonds = await batchFetchBonds(identifiers);

        for (const id of identifiers) {
            onProgress(`[${id}] Поиск облигации...`);
            const bondInfo = findBestBondMatch(id, allBonds);
            if (!bondInfo) {
                onProgress(`[${id}] Облигация не найдена`);
                results.push({ id, output: `# Анализ облигации ${id}\n\nОблигация не найдена на MOEX.` });
                continue;
            }
            const ticker = bondInfo.ticker;
            onProgress(`[${id}] Найден тикер: ${ticker}`);

            const { ytm, duration, coupon, price, maturity } = await getBondDetails(ticker, bondInfo);

            const prompt = `Идентификатор: ${id}
Тикер: ${ticker}
Ключевая ставка ЦБ: ${keyrate}%

Данные облигации:
- YTM: ${ytm}
- Дюрация: ${duration} лет
- Купон: ${coupon}%
- Цена: ${price}
- Погашение: ${maturity}

Задача: проведи анализ облигации (найди кредитный рейтинг, оцени риски) и верни результат в формате, описанном в твоей инструкции.`;

            const output = await spawnAgent(pi, ctx, "russian-bond-worker", prompt, id, onProgress);
            results.push({ id, output });
            onProgress(`[${id}] Анализ завершён`);
        }

        let summary = "# Сводный анализ облигаций\n\n";
        for (const { id, output } of results) {
            summary += `## ${id}\n${output}\n\n`;
        }
        const summaryFile = path.join(runDir, "bond_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Анализ облигаций завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerBond(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "bond",
    label: "Run Bond Workers",
    toolDescription: "Запускает анализ облигаций по ISIN или названию.",
    commandDescription: "Запустить анализ облигаций.",
    commandExample: "/bond.run_all artifacts/bond_test SU26238RMFS5",
    parameters: Type.Object({
      runDir: Type.String(),
      identifiers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runBondWorkers(pi, ctx, params.runDir, params.identifiers, onProgress);
    },
  });
}
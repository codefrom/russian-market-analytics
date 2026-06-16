import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, spawnAgent, parseJsonSafe, registerStandardWorker } from "./common";

export async function runEtfWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    tickers: string[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Анализ ETF (${tickers.length} фондов)...`);
        const results: { ticker: string; output: string }[] = [];

        for (const ticker of tickers) {
            onProgress(`[${ticker}] Получение данных с MOEX...`);
            let exists = false;
            let price = "нет данных";
            let volume = "нет данных";
            let board = "";
            let errorMsg = "";

            try {
                const { stdout } = await execAsync(`tools/venv/bin/python tools/fetch_moex_etf.py ${ticker}`);
                const data = parseJsonSafe(stdout);
                if (data && data.exists) {
                    exists = true;
                    price = data.last_price ?? "нет данных";
                    volume = data.volume ?? "нет данных";
                    board = data.board ?? "";
                } else {
                    errorMsg = data?.error ?? "Тикер не найден";
                }
                onProgress(`[${ticker}] ${exists ? `Найден на доске ${board}, цена: ${price}, объём: ${volume}` : `Не найден: ${errorMsg}`}`);
            } catch (e) {
                onProgress(`[${ticker}] Ошибка получения данных: ${e}`);
                exists = false;
                errorMsg = String(e);
            }

            const prompt = `Тикер: ${ticker}
Существует на MOEX: ${exists ? "да" : "нет"}
${exists ? `Цена: ${price}\nОбъём: ${volume}\nДоска: ${board}` : `Ошибка: ${errorMsg}`}

Задача: проведи анализ ETF (TER, СЧА, структура, стратегия, альтернативы) и верни результат в формате, описанном в твоей инструкции.`;

            const output = await spawnAgent(pi, ctx, "russian-etf-worker", prompt, ticker, onProgress);
            results.push({ ticker, output });
            onProgress(`[${ticker}] Анализ завершён`);
        }

        let summary = "# Сводный анализ ETF\n\n";
        for (const { ticker, output } of results) {
            summary += `## ${ticker}\n${output}\n\n`;
        }
        const summaryFile = path.join(runDir, "etf_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Анализ ETF завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerEtf(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "etf",
    label: "Run ETF Workers",
    toolDescription: "Запускает анализ ETF (БПИФ).",
    commandDescription: "Запустить анализ ETF.",
    commandExample: "/etf.run_all artifacts/etf_test SBMM FXCN",
    parameters: Type.Object({
      runDir: Type.String(),
      tickers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runEtfWorkers(pi, ctx, params.runDir, params.tickers, onProgress);
    },
  });
}
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, registerStandardWorker, spawnAgent } from "./common";

export async function runTechnicalWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    tickers: string[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Технический анализ (${tickers.length} тикеров)...`);
        const results: { ticker: string; output: string }[] = [];

        for (const ticker of tickers) {
            const csvPath = path.join(runDir, `${ticker}_90d.csv`);
            onProgress(`[${ticker}] Загрузка котировок...`);
            try {
                await execAsync(`tools/venv/bin/python tools/fetch_moex_stock.py ${ticker} 90 --output "${csvPath}"`);
            } catch (e: any) {
                onProgress(`[${ticker}] Ошибка загрузки: ${e.message}`);
                // продолжим без данных, воркер это обработает
            }

            const prompt = `TICKER: ${ticker}\nRUN_DIR: ${runDir}\nCSV_PATH: ${csvPath}`;

            const output = await spawnAgent(pi, ctx, "russian-technical-worker", prompt, ticker, onProgress);
            if (!output || output.trim() === '') {
                results.push({ ticker, output: `## ${ticker}\n\nНет данных для технического анализа.` });
                onProgress(`[${ticker}] Результат пуст, добавлено сообщение по умолчанию.`);
            } else {
                results.push({ ticker, output });
                onProgress(`[${ticker}] Анализ завершён`);
            }
        }

        let summary = "# Сводный технический анализ\n\n";
        for (const { ticker, output } of results) {
            summary += `## ${ticker}\n${output}\n\n`;
        }
        const summaryFile = path.join(runDir, "technical_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Технический анализ завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerTechnical(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "technical",
    label: "Run Technical Workers",
    toolDescription: "Запускает технический анализ для указанных тикеров.",
    commandDescription: "Запустить технический анализ.",
    commandExample: "/technical.run_all artifacts/tech_test [SBER, VTBR]",
    parameters: Type.Object({
      runDir: Type.String(),
      tickers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runTechnicalWorkers(pi, ctx, params.runDir, params.tickers, onProgress);
    },
  });
}
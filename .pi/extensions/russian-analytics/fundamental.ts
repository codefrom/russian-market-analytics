import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, registerStandardWorker, spawnAgent } from "./common";

// Основная логика
export async function runFundamentalWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    tickers: string[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Фундаментальный анализ (${tickers.length} тикеров)...`);
        const results: { ticker: string; output: string }[] = [];

        for (const ticker of tickers) {
            onProgress(`[${ticker}] Получение данных...`);
            let stockData = "", fundamentalData = "";
            try {
                const { stdout } = await execAsync(`tools/venv/bin/python tools/fetch_moex_stock.py ${ticker} 365`);
                stockData = stdout;
            } catch (e) { stockData = `Ошибка: ${e}`; }
            try {
                const { stdout } = await execAsync(`tools/venv/bin/python tools/fetch_smartlab_fundamental.py ${ticker}`);
                fundamentalData = stdout;
            } catch (e) { fundamentalData = `Ошибка: ${e}`; }

            const prompt = `Тикер: ${ticker}
Данные котировок (fetch_moex_stock.py за 365 дней):
${stockData}

Фундаментальные показатели (fetch_smartlab_fundamental.py):
${fundamentalData}

Задача: проведи фундаментальный анализ и верни результат в формате, описанном в твоей инструкции.`;

            const output = await spawnAgent(pi, ctx, "russian-fundamental-worker", prompt, ticker, onProgress);
            if (!output || output.trim() === '') {
                results.push({ ticker, output: `# Фундаментальный анализ ${ticker}\n\nНет данных для анализа.` });
                onProgress(`[${ticker}] Результат пуст, добавлено сообщение по умолчанию.`);
            } else {
                results.push({ ticker, output });
                onProgress(`[${ticker}] Анализ завершён`);
            }
        }

        let summary = "# Сводный фундаментальный анализ\n\n";
        for (const { ticker, output } of results) {
            summary += `## ${ticker}\n${output}\n\n`;
        }
        const summaryFile = path.join(runDir, "fundamental_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Фундаментальный анализ завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerFundamental(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "fundamental",
    label: "Run Fundamental Workers",
    toolDescription: "Запускает фундаментальный анализ для указанных тикеров.",
    commandDescription: "Запустить фундаментальный анализ.",
    commandExample: "/fund.run_all artifacts/fund_test SBER VTBR",
    parameters: Type.Object({
      runDir: Type.String(),
      tickers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runFundamentalWorkers(pi, ctx, params.runDir, params.tickers, onProgress);
    },
  });
}
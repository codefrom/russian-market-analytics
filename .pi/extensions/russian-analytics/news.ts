import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerStandardWorker, spawnAgent } from "./common";

// Элемент для передачи в runNewsWorkers
export interface NewsItem {
  ticker: string;
  name?: string;
  type?: "stock" | "bond" | "etf";
}

// Основная логика
export async function runNewsWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    items: NewsItem[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Новостной анализ (${items.length} тикеров)...`);
        const results: { ticker: string; output: string }[] = [];

        for (const item of items) {
            const ticker = item.ticker;
            const name = item.name || ticker;
            const type = item.type || "актив";
            // Формируем расширенный промпт с названием и типом
            const prompt = `Тикер: ${ticker}\nНазвание: ${name}\nТип: ${type}\nRUN_DIR: ${runDir}\nЗадача: найди 1-3 актуальные новости по указанному инструменту. Верни результат в формате, описанном в твоей инструкции.`;
            const output = await spawnAgent(pi, ctx, "russian-news-worker", prompt, ticker, onProgress);
            if (!output || output.trim() === '') {
                results.push({ ticker, output: `Новости по тикеру ${ticker}: не удалось получить данные.` });
                onProgress(`[${ticker}] Результат пуст, добавлено сообщение по умолчанию.`);
            } else {
                results.push({ ticker, output });
                onProgress(`[${ticker}] Анализ завершён`);
            }
        }

        let summary = "# Новостной бюллетень\n\n";
        for (const { ticker, output } of results) {
            summary += `## ${ticker}\n${output}\n\n`;
        }
        const summaryFile = path.join(runDir, "news_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Новостной анализ завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerNews(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "news",
    label: "Run News Workers",
    toolDescription: "Запускает новостных воркеров для указанных тикеров.",
    commandDescription: "Запустить новостной анализ.",
    commandExample: "/news.run_all artifacts/news_test [SBER, VTBR]",
    parameters: Type.Object({
      runDir: Type.String(),
      tickers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      // Параметр tickers — массив строк, преобразуем в NewsItem без name/type
      const items: NewsItem[] = (params.tickers as string[]).map(t => ({ ticker: t }));
      return await runNewsWorkers(pi, ctx, params.runDir, items, onProgress);
    },
  });
}
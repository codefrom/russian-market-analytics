import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, registerStandardWorker } from "./common";

export interface NewsItem {
  ticker: string;
  name?: string;
  type?: "stock" | "bond" | "etf";
}

function formatNewsEntry(item: any): string {
  // Экранируем возможные спецсимволы в названии/заголовке
  const title = item.title.replace(/\|/g, "\\|");
  const summary = item.summary.replace(/\|/g, "\\|");
  return `- [${item.date}] smart-lab: ${title} — ${summary}`;
}

export async function runNewsWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    items: NewsItem[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Новостной анализ (${items.length} тикеров)...`);
        const results: { ticker: string; name: string; output: string }[] = [];

        for (const item of items) {
            const ticker = item.ticker;
            const name = item.name || ticker;
            onProgress(`[${ticker}] Поиск новостей через smart-lab...`);

            let newsData: any;
            try {
                const cmd = `tools/venv/bin/python tools/fetch_smartlab_news.py "${ticker}" "${name.replace(/"/g, '\\"')}"`;
                const { stdout } = await execAsync(cmd);
                newsData = JSON.parse(stdout);
            } catch (e: any) {
                onProgress(`[${ticker}] Ошибка скрипта: ${e.message}`);
                newsData = { news: [] };
            }

            if (newsData.news && newsData.news.length > 0) {
                const lines = [`Новости по тикеру ${ticker} (${name}):`];
                for (const entry of newsData.news) {
                    lines.push(formatNewsEntry(entry));
                }
                results.push({ ticker, name, output: lines.join("\n") });
                onProgress(`[${ticker}] Найдено ${newsData.news.length} новостей`);
            } else {
                results.push({ ticker, name, output: `Новости по тикеру ${ticker} (${name}): на момент анализа значимых новостей не обнаружено.` });
                onProgress(`[${ticker}] Новостей не найдено`);
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
    toolDescription: "Запускает новостной анализ через smart-lab.",
    commandDescription: "Запустить новостной анализ.",
    commandExample: "/news.run_all artifacts/news_test [SBER, VTBR]",
    parameters: Type.Object({
      runDir: Type.String(),
      tickers: Type.Array(Type.String()),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      const items: NewsItem[] = (params.tickers as string[]).map(t => ({ ticker: t }));
      return await runNewsWorkers(pi, ctx, params.runDir, items, onProgress);
    },
  });
}
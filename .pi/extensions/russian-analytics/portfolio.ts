import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerStandardWorker, spawnAgent } from "./common";

export async function runPortfolioAnalyst(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress("Запуск портфельного аналитика...");
        const prompt = `RUN_DIR: ${runDir}
Задача: проанализируй текущий портфель и все сводные отчёты, предложи план сделок для ребалансировки. Верни результат в формате, описанном в твоей инструкции.`;
        const output = await spawnAgent(pi, ctx, "russian-portfolio-worker", prompt, "portfolio", onProgress);
        const summaryFile = path.join(runDir, "portfolio_summary.md");
        await fs.writeFile(summaryFile, output);
        onProgress(`Портфельный анализ сохранён в ${summaryFile}`);
        return { success: true, message: "Портфельный анализ завершён", summaryFile };
    } catch (err: any) {
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerPortfolio(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "portfolio",
    label: "Run Portfolio Analyst",
    toolDescription: "Анализирует портфель и предлагает ребалансировку.",
    commandDescription: "Запустить портфельный анализ.",
    commandExample: "/portfolio.analyze artifacts/run_xxx",
    parameters: Type.Object({
      runDir: Type.String(),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runPortfolioAnalyst(pi, ctx, params.runDir, onProgress);
    },
  });
}
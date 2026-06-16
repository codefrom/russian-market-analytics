import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerStandardWorker, spawnAgent } from "./common";

export async function runTaxAnalysis(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress("Налоговый анализ...");
        const prompt = `RUN_DIR: ${runDir}
Задача: проведи налоговый анализ на основе портфельного плана (portfolio_summary.md). Верни результат в формате, описанном в твоей инструкции.`;
        const output = await spawnAgent(pi, ctx, "russian-tax-worker", prompt, "tax", onProgress);
        const summaryFile = path.join(runDir, "tax_summary.md");
        await fs.writeFile(summaryFile, output);
        onProgress(`Налоговый анализ сохранён в ${summaryFile}`);
        return { success: true, message: "Налоговый анализ завершён", summaryFile };
    } catch (err: any) {
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerTax(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "tax",
    label: "Run Tax Analysis",
    toolDescription: "Рассчитывает налоги по сделкам.",
    commandDescription: "Запустить налоговый анализ.",
    commandExample: "/tax.run_all artifacts/run_xxx",
    parameters: Type.Object({
      runDir: Type.String(),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runTaxAnalysis(pi, ctx, params.runDir, onProgress);
    },
  });
}
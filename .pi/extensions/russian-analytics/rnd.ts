import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerStandardWorker, spawnAgent } from "./common";

export async function runRndWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    count: number,
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress(`Генерация ${count} инвестиционных идей...`);
        const prompt = `RUN_DIR: ${runDir}
COUNT: ${count}
Задача: сгенерируй ровно ${count} инвестиционных идей на основе всех сводных отчётов (macro_summary.md, news_summary.md, fundamental_summary.md, technical_summary.md, bond_summary.md, etf_summary.md). Формат ответа описан в твоей инструкции.`;
        const output = await spawnAgent(pi, ctx, "russian-rnd-worker", prompt, `rnd_${count}ideas`, onProgress);
        const summaryFile = path.join(runDir, "rnd_summary.md");
        await fs.writeFile(summaryFile, output);
        onProgress(`Идеи сохранены в ${summaryFile}`);
        return { success: true, message: `Генерация ${count} идей завершена`, summaryFile };
    } catch (err: any) {
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerRnd(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "rnd",
    label: "Run RND Workers",
    toolDescription: "Генерирует инвестиционные идеи на основе всех отчётов.",
    commandDescription: "Сгенерировать инвестиционные идеи.",
    commandExample: "/rnd.run_all artifacts/run_xxx 5",
    parameters: Type.Object({
      runDir: Type.String(),
      count: Type.Number({ default: 3, description: "Количество идей" }),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runRndWorkers(pi, ctx, params.runDir, params.count, onProgress);
    },
  });
}
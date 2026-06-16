import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerStandardWorker, spawnAgent } from "./common";

export async function runQaCheck(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; errors?: string[]; warnings?: string[] }> {
    try {
        onProgress("Запуск QA-проверки...");
        const prompt = `RUN_DIR: ${runDir}`;
        const output = await spawnAgent(pi, ctx, "russian-qa-worker", prompt, "qa", onProgress);
        
        // Парсим JSON из ответа агента
        let qaResult: { passed: boolean; errors: string[]; warnings: string[] } = {
            passed: false,
            errors: ["Не удалось распарсить ответ агента"],
            warnings: []
        };
        try {
            // Убираем возможные markdown-обёртки
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                qaResult = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            onProgress(`Ошибка парсинга QA-ответа: ${e}`);
        }

        // Сохраняем отчёт в markdown для совместимости
        const reportMd = `# QA Report\n\n**Статус:** ${qaResult.passed ? 'ПРОЙДЕНО' : 'НЕ ПРОЙДЕНО'}\n\n## Ошибки\n${qaResult.errors.map(e => `- ${e}`).join('\n') || 'Нет'}\n\n## Предупреждения\n${qaResult.warnings.map(w => `- ${w}`).join('\n') || 'Нет'}`;
        const reportFile = path.join(runDir, "qa_report.md");
        await fs.writeFile(reportFile, reportMd);
        
        // Также сохраняем JSON для возможной автоматической обработки
        await fs.writeFile(path.join(runDir, "qa_report.json"), JSON.stringify(qaResult, null, 2));

        onProgress(`QA-отчёт сохранён: ${reportFile}`);
        return {
            success: qaResult.passed,
            message: qaResult.passed ? "Проверка пройдена" : "Найдены ошибки",
            errors: qaResult.errors,
            warnings: qaResult.warnings
        };
    } catch (err: any) {
        onProgress(`Ошибка QA: ${err.message}`);
        return { success: false, message: err.message, errors: [err.message] };
    }
}

export function registerQa(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "qa",
    label: "Run QA Check",
    toolDescription: "Проверяет итоговый отчёт на ошибки.",
    commandDescription: "Запустить QA-проверку.",
    commandExample: "/qa.run_all artifacts/run_xxx",
    parameters: Type.Object({
      runDir: Type.String(),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      return await runQaCheck(pi, ctx, params.runDir, onProgress);
    },
  });
}
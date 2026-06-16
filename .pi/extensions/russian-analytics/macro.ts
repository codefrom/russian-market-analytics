// .pi/extensions/russian-analytics/macro.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execAsync, registerStandardWorker, spawnAgent } from "./common";

// Получение макроконтекста
async function getMacroContext() {
    const commands = {
        keyrate: "tools/venv/bin/python tools/cbr_data.py keyrate",
        ruonia: "tools/venv/bin/python tools/cbr_data.py ruonia",
        inflation: "tools/venv/bin/python tools/cbr_data.py inflation",
        usd: "tools/venv/bin/python tools/cbr_data.py currency USD",
        cny: "tools/venv/bin/python tools/cbr_data.py currency CNY",
        eur: "tools/venv/bin/python tools/cbr_data.py currency EUR"
    };
    const results: Record<string, any> = {};
    for (const [key, cmd] of Object.entries(commands)) {
        try {
            const { stdout } = await execAsync(cmd);
            const parsed = JSON.parse(stdout);
            // Нормализуем поле в зависимости от команды
            if (key === "keyrate" || key === "ruonia") {
                results[key] = parsed.rate ?? parsed;
            } else if (key === "inflation") {
                results[key] = parsed.cpi_yoy_pct ?? parsed;
            } else {
                results[key] = parsed.rate_rub ?? parsed;
            }
        } catch (err) {
            results[key] = `Ошибка: ${err}`;
        }
    }
    results.updatedAt = new Date().toISOString();

    let surveyTable = "";
    try {
        const { stdout } = await execAsync("tools/venv/bin/python tools/fetch_cbr_survey.py");
        surveyTable = stdout;
    } catch (e) {
        surveyTable = "Ошибка получения таблицы прогнозов: " + e;
    }

    let cbrStatistics = "";
    try {
        const { stdout } = await execAsync("tools/venv/bin/python tools/fetch_cbr_dataservice.py");
        cbrStatistics = stdout;
    } catch (e) {
        cbrStatistics = "Ошибка получения статистика БР: " + e;
    }

    // Измените возвращаемое значение:
    return { macroContext: results, surveyTable, cbrStatistics };
}

function formatMacroContextMarkdown(ctx: any): string {
    const keyrate = typeof ctx.keyrate === 'object' ? ctx.keyrate.rate : ctx.keyrate;
    const ruonia = typeof ctx.ruonia === 'object' ? ctx.ruonia.rate : ctx.ruonia;
    const inflation = typeof ctx.inflation === 'object' ? ctx.inflation.cpi_yoy_pct : ctx.inflation;
    const usd = typeof ctx.usd === 'object' ? ctx.usd : ctx.usd;
    const cny = typeof ctx.cny === 'object' ? ctx.cny : ctx.cny;
    const eur = typeof ctx.eur === 'object' ? ctx.eur : ctx.eur;

    return `| Показатель | Значение |
|------------|----------|
| Ключевая ставка | ${keyrate}% |
| RUONIA | ${ruonia}% |
| Инфляция (ИПЦ, г/г) | ${inflation}% |
| USD/RUB | ${usd} |
| CNY/RUB | ${cny} |
| EUR/RUB | ${eur} |
*Данные получены ${ctx.updatedAt}*`;
}

// Основная логика, экспортируемая для использования в туле и команде
export async function runMacroWorkers(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    runDir: string,
    topics: string[],
    onProgress: (msg: string) => void
): Promise<{ success: boolean; message: string; summaryFile?: string }> {
    try {
        onProgress("Получение макроконтекста...");
        const { macroContext, surveyTable, cbrStatistics} = await getMacroContext();
        const macroContextFormatted = formatMacroContextMarkdown(macroContext);

        const results: { topic: string; output: string }[] = [];
        for (const topic of topics) {
            const prompt = `Тема: ${topic}\nRUN_DIR: ${runDir}\nМакро-показатели:\n${macroContextFormatted}\nМакропрогноз ЦБ:\n${surveyTable}\nСтатистика Банка России:\n${cbrStatistics}\nЗадача: проведи макроэкономический анализ по теме и верни результат в формате, описанном в твоей инструкции.`;
            const output = await spawnAgent(pi, ctx, "russian-macro-worker", prompt, topic, onProgress);
            results.push({ topic, output });
        }

        let summary = "# Макроэкономический анализ\n\n## Ключевые показатели\n";
        summary += macroContextFormatted;
        summary += "\n\n## Детальный анализ по темам\n";
        for (const { topic, output } of results) {
            summary += `\n${output}\n`;
        }
        const summaryFile = path.join(runDir, "macro_summary.md");
        await fs.writeFile(summaryFile, summary);
        onProgress(`Сводный отчёт сохранён: ${summaryFile}`);
        return { success: true, message: `Макро-анализ завершён.`, summaryFile };
    } catch (err: any) {
        console.error(err);
        onProgress(`Ошибка: ${err.message}`);
        return { success: false, message: err.message };
    }
}

export function registerMacro(pi: ExtensionAPI) {
  registerStandardWorker(pi, {
    name: "macro",
    label: "Run Macro Workers",
    toolDescription: "Запускает макро-воркеров через RPC.",
    commandDescription: "Запустить макро-анализ.",
    commandExample: "/macro.run_all artifacts/macro_test monetary budget balance gdp",
    parameters: Type.Object({
      runDir: Type.String(),
      topics: Type.Array(
        Type.Union([
          Type.Literal("monetary"),
          Type.Literal("budget"),
          Type.Literal("balance"),
          Type.Literal("gdp"),
        ])
      ),
    }),
    runFn: async (pi, ctx, params, onProgress) => {
      const topics = params.topics as string[];
      const validTopics = ["monetary", "budget", "balance", "gdp"];
      const filtered = topics.filter((t) => validTopics.includes(t));
      if (filtered.length === 0) {
        return { success: false, message: "Нет корректных тем" };
      }
      return await runMacroWorkers(pi, ctx, params.runDir, filtered, onProgress);
    },
  });
}
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawnAgent } from "./common";
import { lookupInstruments } from "./lookup";
import { runMacroWorkers } from "./macro";
import { runNewsWorkers } from "./news";
import { runFundamentalWorkers } from "./fundamental";
import { runTechnicalWorkers } from "./technical";
import { runBondWorkers } from "./bond";
import { runEtfWorkers } from "./etf";
import { runRndWorkers } from "./rnd";
import { runPortfolioAnalyst } from "./portfolio";
import { runTaxAnalysis } from "./tax";
import { runQaCheck } from "./qa";

interface PipelineResult {
  success: boolean;
  reportPath?: string;
  errors: string[];
  warnings: string[];
}

// Специальная ошибка для прерывания пайплайна
class AbortPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortPipelineError';
  }
}

export async function runPipeline(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  userQuery: string,
  onProgress: (msg: string) => void
): Promise<PipelineResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const signal = ctx.signal;

  // Функция для проверки сигнала отмены
  const checkAborted = () => {
    if (signal.aborted) {
      throw new AbortPipelineError("Operation aborted by user");
    }
  };

  // Вспомогательная обёртка, которая прерывается при abort
  const safeCall = async (name: string, fn: () => Promise<any>) => {
    checkAborted();
    try {
      await fn();
      checkAborted(); // после выполнения тоже проверяем
    } catch (e: any) {
      if (e.name === 'AbortPipelineError' || (signal.aborted && (e.message?.includes('abort') || e.message?.includes('aborted')))) {
        throw e; // пробрасываем отмену дальше
      }
      errors.push(`Ошибка в ${name}: ${e.message}`);
      onProgress(`❌ ${name}: ${e.message}`);
    }
  };

  try {
    // Шаг: создание папки артефактов
    checkAborted();
    const runDir = `artifacts/run_${new Date().toISOString().replace(/[-:T.]/g, '_')}`;
    await fs.mkdir(runDir, { recursive: true });
    onProgress(`Папка создана: ${runDir}`);

    // Шаг: сохранение запроса
    checkAborted();
    await fs.writeFile(path.join(runDir, "00_request.md"), userQuery);

    // Шаг: извлечение идентификаторов через агента-экстрактора
    onProgress("Извлечение тикеров...");
    let rawIdentifiers: string[] = [];
    try {
      const extractOutput = await spawnAgent(pi, ctx, "ticker-extractor-worker", `USER_MESSAGE:\n${userQuery}`, "extract", onProgress);
      const trimmed = extractOutput.trim();
      if (trimmed.startsWith("[")) {
        rawIdentifiers = JSON.parse(trimmed);
      } else {
        const match = trimmed.match(/\[.*\]/s);
        if (match) rawIdentifiers = JSON.parse(match[0]);
      }
    } catch (e) {
      onProgress("Не удалось извлечь тикеры, попробуем вручную.");
      rawIdentifiers = [];
    }

    checkAborted();

    // Шаг: нормализация через lookup + запрос недостающих у пользователя
    let foundInstruments: any[] = [];
    let notFoundIds: string[] = [];

    if (rawIdentifiers.length > 0) {
      const results = await lookupInstruments(rawIdentifiers);
      await fs.writeFile(path.join(runDir, "lookup_results.json"), JSON.stringify(results, null, 2));

      for (const r of results) {
        if (r.found) foundInstruments.push(r);
        else notFoundIds.push(r.original);
      }
    }

    // Интерактивный запрос недостающих тикеров
    while (notFoundIds.length > 0) {
      checkAborted();
      const missingList = notFoundIds.join(", ");
      const userInput = await ctx.ui.editor(
        `Следующие идентификаторы не удалось найти на MOEX:\n${missingList}\n\nВведите корректные тикеры через запятую (или нажмите Cancel, чтобы пропустить):`,
        ""
      );
      if (!userInput || userInput.trim() === "") {
        for (const id of notFoundIds) {
          warnings.push(`⚠️ Инструмент пропущен пользователем: ${id}`);
        }
        notFoundIds = [];
      } else {
        const newIds = userInput.split(",").map(s => s.trim()).filter(Boolean);
        const newResults = await lookupInstruments(newIds);
        const stillNotFound: string[] = [];
        for (const r of newResults) {
          if (r.found) {
            foundInstruments.push(r);
            warnings.push(`✅ Добавлен пользователем: ${r.original} -> ${r.ticker}`);
          } else {
            stillNotFound.push(r.original);
          }
        }
        notFoundIds = stillNotFound;
      }
    }

    // Формирование списков тикеров
    let stockTickers = foundInstruments.filter(i => i.type === "stock").map(i => i.ticker);
    let bondTickers = foundInstruments.filter(i => i.type === "bond").map(i => i.ticker);
    let etfTickers = foundInstruments.filter(i => i.type === "etf").map(i => i.ticker);
    let allTickers = [...stockTickers, ...bondTickers, ...etfTickers];

    // Шаг: Макро-анализ (до RND)
    await safeCall("macro", () => runMacroWorkers(pi, ctx, runDir, ["monetary","budget","balance","gdp"], onProgress));
    checkAborted();

    // Шаг: RND (всегда)
    onProgress("Генерация инвестиционных идей...");
    let rndOutput = "";
    try {
      checkAborted();
      const tickerListStr = allTickers.length > 0 ? allTickers.join(", ") : "нет";
      const rndPrompt = `RUN_DIR: ${runDir}\nCOUNT: 5\nUSER_REQUEST: ${userQuery}\nFOUND_TICKERS: ${tickerListStr}\nИнструкция: сгенерируй ровно 5 инвестиционных идей. Используй макро-сводку из ${runDir}/macro_summary.md (прочитай её через cat), запрос пользователя и список найденных тикеров. Не предлагай идеи, дублирующие уже перечисленные тикеры, если только они не являются частью новой стратегии. В конце каждой идеи обязательно укажи строку "Тикер: <тикер1>, <тикер2>, ..." с реальными тикерами MOEX.`;
      rndOutput = await spawnAgent(pi, ctx, "russian-rnd-worker", rndPrompt, "rnd_ideas", onProgress);
      await fs.writeFile(path.join(runDir, "rnd_summary.md"), rndOutput);
      onProgress("Идеи сгенерированы.");
    } catch (e: any) {
      if (e.name === 'AbortPipelineError' || signal.aborted) throw e;
      errors.push(`Ошибка RND: ${e.message}`);
      onProgress(`❌ RND: ${e.message}`);
    }

    checkAborted();
    // Извлечение тикеров из RND
    const rndTickers = extractTickersFromRndOutput(rndOutput);
    if (rndTickers.length > 0) {
      onProgress(`Тикеры из идей: ${rndTickers.join(", ")}`);
      const rndLookup = await lookupInstruments(rndTickers);
      for (const r of rndLookup) {
        if (r.found) {
          if (!foundInstruments.some(i => i.ticker === r.ticker)) {
            foundInstruments.push(r);
            warnings.push(`✅ Добавлен из RND: ${r.original} → ${r.ticker}`);
          }
        } else {
          warnings.push(`⚠️ Тикер из RND не найден: ${r.original}`);
        }
      }
      // Обновляем списки
      stockTickers = foundInstruments.filter(i => i.type === "stock").map(i => i.ticker);
      bondTickers = foundInstruments.filter(i => i.type === "bond").map(i => i.ticker);
      etfTickers = foundInstruments.filter(i => i.type === "etf").map(i => i.ticker);
      allTickers = [...stockTickers, ...bondTickers, ...etfTickers];
    }

    // В lookup_results.json кладём ВСЕ найденные инструменты (foundInstruments)
    await fs.writeFile(
      path.join(runDir, "lookup_results.json"),
      JSON.stringify(foundInstruments, null, 2)
    );
    // В warnings.md записываем все накопленные предупреждения
    await fs.writeFile(
      path.join(runDir, "warnings.md"),
      warnings.map(w => w + "\n").join("")
    );

    checkAborted();

    // Новостной анализ
    if (allTickers.length > 0) {
      onProgress("Запуск новостного анализа...");
      const newsItems = foundInstruments.map(i => ({
        ticker: i.ticker!,
        name: i.name && i.name !== i.ticker ? i.name : i.ticker,
        type: i.type
      }));
      await safeCall("news", () => runNewsWorkers(pi, ctx, runDir, newsItems, onProgress));
    }

    checkAborted();

    // Фундаментальный анализ
    if (stockTickers.length > 0) {
      onProgress("Запуск фундаментального анализа...");
      await safeCall("fundamental", () => runFundamentalWorkers(pi, ctx, runDir, stockTickers, onProgress));
    }

    checkAborted();

    // Технический анализ
    if (stockTickers.length > 0) {
      onProgress("Запуск технического анализа...");
      await safeCall("technical", () => runTechnicalWorkers(pi, ctx, runDir, stockTickers, onProgress));
    }

    checkAborted();

    // Анализ облигаций
    if (bondTickers.length > 0) {
      onProgress("Запуск анализа облигаций...");
      await safeCall("bond", () => runBondWorkers(pi, ctx, runDir, bondTickers, onProgress));
    }

    checkAborted();

    // Анализ ETF
    if (etfTickers.length > 0) {
      onProgress("Запуск анализа ETF...");
      await safeCall("etf", () => runEtfWorkers(pi, ctx, runDir, etfTickers, onProgress));
    }

    checkAborted();

    // Портфельный аналитик
    onProgress("Запуск портфельного анализа...");
    await safeCall("portfolio", () => runPortfolioAnalyst(pi, ctx, runDir, onProgress));

    checkAborted();

    // Налоговый анализ
    onProgress("Запуск налогового анализа...");
    await safeCall("tax", () => runTaxAnalysis(pi, ctx, runDir, onProgress));

    checkAborted();

    // Генерация резюме
    let summaryText = "Автоматически сгенерировано.";
    try {
      onProgress("Генерация резюме...");
      checkAborted();
      const summaryPrompt = `RUN_DIR: ${runDir}\nПрочитай все сводные отчёты в ${runDir} и составь резюме по инструкции.`;
      summaryText = await spawnAgent(pi, ctx, "summary-worker", summaryPrompt, "summary", onProgress);
    } catch (e: any) {
      if (e.name === 'AbortPipelineError' || signal.aborted) throw e;
      errors.push(`Ошибка генерации резюме: ${e.message}`);
      onProgress(`❌ Резюме: ${e.message}`);
    }

    checkAborted();

    // Сборка финального отчёта
    onProgress("Сборка финального отчёта...");
    const reportPath = path.join(runDir, "99_final_report.md");
    let report = `# Инвестиционный отчёт\n\n## Резюме\n${summaryText}\n\n`;
    report += `## Сводка рекомендаций\n- Акции: ${stockTickers.join(', ') || 'нет'}\n- Облигации: ${bondTickers.join(', ') || 'нет'}\n- ETF: ${etfTickers.join(', ') || 'нет'}\n\n`;
    report += `## План сделок\n*см. portfolio_summary.md*\n\n## Налоговые последствия\n*см. tax_summary.md*\n\n`;

    const summaryFiles = [
      "macro_summary.md","news_summary.md","fundamental_summary.md","technical_summary.md",
      "bond_summary.md","etf_summary.md","rnd_summary.md","portfolio_summary.md","tax_summary.md"
    ];
    for (const f of summaryFiles) {
      checkAborted();
      try {
        const content = await fs.readFile(path.join(runDir, f), "utf-8");
        report += `\n\n${content}`;
      } catch {}
    }
    await fs.writeFile(reportPath, report);

    // QA-проверка
    await safeCall("qa", () => runQaCheck(pi, ctx, runDir, onProgress));

    return { success: errors.length === 0, reportPath, errors, warnings };

  } catch (e: any) {
    if (e.name === 'AbortPipelineError' || signal.aborted) {
      onProgress("⏹️ Операция прервана пользователем.");
      return { success: false, reportPath: undefined, errors: ["Operation aborted by user"], warnings };
    }
    throw e; // другие ошибки пробрасываем
  }
}

export function registerPipeline(pi: ExtensionAPI) {
  pi.registerTool({
    name: "run_pipeline",
    label: "Run Investment Pipeline",
    description: "Запускает полный цикл анализа по запросу пользователя.",
    parameters: Type.Object({
      userQuery: Type.String()
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { userQuery } = params;
      let fullLog = "";
      const result = await runPipeline(pi, ctx, userQuery, (msg) => {
        fullLog += msg + "\n";
        onUpdate?.({ content: [{ type: "text", text: fullLog }] });
      });
      const summary = result.success
        ? `✅ Анализ завершён. Отчёт: ${result.reportPath}\nПредупреждения: ${result.warnings.join(', ') || 'нет'}`
        : `❌ Ошибки: ${result.errors.join('; ')}`;
      return { 
        content: [{ type: "text", text: summary }],
        terminate: true 
      };
    }
  });
}

function extractTickersFromRndOutput(text: string): string[] {
  const tickers: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^Тикер:\s*(.+)$/i);
    if (match) {
      const raw = match[1].trim();
      const parts = raw.split(/[;,]/).map(s => s.trim()).filter(Boolean);
      tickers.push(...parts);
    }
  }
  return tickers;
}
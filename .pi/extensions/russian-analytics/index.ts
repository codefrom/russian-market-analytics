import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMacro } from "./macro";
import { registerNews } from "./news";
import { registerFundamental } from "./fundamental";
import { registerTechnical } from "./technical";
import { registerBond } from "./bond";
import { registerEtf } from "./etf";
import { registerRnd } from "./rnd";
import { registerPortfolio } from "./portfolio";
import { registerTax } from "./tax";
import { registerQa } from "./qa";
import { registerLookup } from "./lookup";
import { registerPipeline } from "./pipeline";
import { registerWebTools } from "./webtools";
import * as fs from "fs";

// Типы для входных данных (можно расширить при необходимости)
interface ContentItem {
  type?: string;
  text?: string;
  thinking?: string;
  arguments?: any;
  content?: ContentItem[]; // для вложенных массивов
  [key: string]: any;     // другие поля (toolCallId, toolName и т.п.)
}

interface Message {
  role: string;
  content: ContentItem[] | string; // может быть массивом или строкой
  [key: string]: any;
}

/**
 * Извлекает текст из одного элемента content.
 * Поддерживает: text, thinking, arguments (JSON), рекурсивный обход content.
 */
function extractText(item: any): string {
  if (item.text !== undefined && typeof item.text === 'string') {
    return item.text;
  }
  if (item.thinking !== undefined && typeof item.thinking === 'string') {
    return item.thinking;
  }
  if (item.arguments !== undefined) {
    return JSON.stringify(item.arguments, null, 2);
  }
  if (Array.isArray(item.content)) {
    return item.content.map((sub: any) => extractText(sub)).join('\n');
  }
  // fallback – преобразуем в строку
  return String(item);
}

/**
 * Основной метод: принимает _event.messages и возвращает Markdown-строку.
 */
export function generateMarkdownFromMessages(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role || '';
    let content = msg.content;

    // Приводим content к массиву, если пришла строка
    if (!Array.isArray(content)) {
      content = [{ type: 'unknown', text: String(content) }];
    }

    for (const item of content) {
      const type = item.type || 'unknown';
      const text = extractText(item);

      lines.push(`## ${role} ${type}`);
      lines.push('');
      lines.push('```');
      lines.push(text);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export default function (pi: ExtensionAPI) {
    // Чтобы включить запись логов агентских сессий в sessionLogs/ - нужно разремить:
    /*pi.on("agent_end", (_event: any, ctx: any) => {
        const sessionName = ctx.sessionManager.getSessionName();
        const sessionId = ctx.sessionManager.getSessionId();
        if (sessionName) {
            const logFile = `sessionLogs/${sessionName}_${sessionId}.json`
            fs.appendFileSync(logFile, `${JSON.stringify(_event.messages)}\n`);
            const renderFile = `sessionLogs/${sessionName}_${sessionId}.md`
            fs.appendFileSync(renderFile, `# SESSION LOG\n`);
            fs.appendFileSync(renderFile, `${generateMarkdownFromMessages(_event.messages)}\n`);
        }
    });*/
    
    registerWebTools(pi);
    registerPipeline(pi);
    registerLookup(pi);
    registerMacro(pi);
    registerNews(pi);
    registerFundamental(pi);
    registerTechnical(pi);
    registerBond(pi);
    registerEtf(pi);
    registerRnd(pi);
    registerPortfolio(pi);
    registerTax(pi);
    registerQa(pi);
}
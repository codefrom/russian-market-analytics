// .pi/extensions/russian-analytics/common.ts
import type { ExtensionAPI, ExtensionContext, AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { Type, type TObject, type TSchema } from "typebox";

export const execAsync = promisify(exec);

// ---------- проверка типов схемы ----------
function isArrayType(schema: TSchema): boolean {
  const s = schema as any;
  if (s.type === "array") return true;
  if (s.anyOf) return s.anyOf.some((item: any) => item.type === "array");
  return false;
}

function isNumberType(schema: TSchema): boolean {
  const s = schema as any;
  return s.type === "number" || s.type === "integer";
}

// ---------- разбор аргументов команды по схеме ----------
function parseCommandArgs(rawArgs: string[], schema: TObject): Record<string, any> {
  const keys = Object.keys(schema.properties);
  const result: Record<string, any> = {};

  // 1. Склейка токенов, если массив разбит пробелом
  const mergedArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (token.startsWith("[") && !token.endsWith("]")) {
      let combined = token;
      while (i + 1 < rawArgs.length) {
        i++;
        combined += " " + rawArgs[i];
        if (rawArgs[i].endsWith("]")) break;
      }
      mergedArgs.push(combined);
    } else {
      mergedArgs.push(token);
    }
  }

  let idx = 0;
  for (const key of keys) {
    const field = schema.properties[key];
    if (isArrayType(field)) {
      if (idx >= mergedArgs.length) throw new Error(`Не указан массив для '${key}'`);
      const token = mergedArgs[idx];
      if (!token.startsWith("[") || !token.endsWith("]")) {
        throw new Error(`Параметр '${key}' должен быть массивом в формате [elem1, elem2, ...]`);
      }
      const inner = token.slice(1, -1).trim();
      result[key] = inner ? inner.split(",").map(s => s.trim()).filter(Boolean) : [];
      idx++;
    } else if (isNumberType(field)) {
      if (idx >= mergedArgs.length) throw new Error(`Не указано число для '${key}'`);
      const val = parseFloat(mergedArgs[idx]);
      if (isNaN(val)) throw new Error(`'${key}' должно быть числом, получено '${mergedArgs[idx]}'`);
      result[key] = val;
      idx++;
    } else {
      if (idx >= mergedArgs.length) throw new Error(`Не указано значение для '${key}'`);
      result[key] = mergedArgs[idx];
      idx++;
    }
  }
  if (idx < mergedArgs.length) {
    console.warn(`Лишние аргументы проигнорированы: ${mergedArgs.slice(idx).join(" ")}`);
  }
  return result;
}

// ---------- универсальная регистрация ----------
export interface WorkerConfig {
  name: string;
  label: string;
  toolDescription: string;
  commandDescription: string;
  commandExample: string;
  parameters: TObject;
  runFn: (
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    params: Record<string, any>,
    onProgress: (msg: string) => void
  ) => Promise<{ success: boolean; message: string }>;
}

export function registerStandardWorker(pi: ExtensionAPI, config: WorkerConfig) {
  const toolName = `run_${config.name}_workers`;

  pi.registerTool({
    name: toolName,
    label: config.label,
    description: config.toolDescription,
    parameters: config.parameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      let fullLog = "";
      const result = await config.runFn(pi, ctx, params, (msg) => {
        fullLog += msg + "\n";
        onUpdate?.({ content: [{ type: "text", text: fullLog }] });
      });
      const summary = result.success
        ? `✅ ${result.message}`
        : `❌ ${result.message}`;
      fullLog += summary;
      return { content: [{ type: "text", text: fullLog }] };
    },
  });

  const commandName = `${config.name}.run_all`;
  pi.registerCommand(commandName, {
    description:
      config.commandDescription + " Пример: " + config.commandExample,
    handler: async (args: string, ctx: any) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      let params: Record<string, any>;
      try {
        params = parseCommandArgs(parts, config.parameters);
      } catch (e: any) {
        ctx.ui.notify(`❌ Ошибка разбора аргументов: ${e.message}`, "error");
        return;
      }

      const result = await config.runFn(pi, params, (msg) =>
        ctx.ui.notify(msg, "info"), ctx
      );

      if (result.success) {
        ctx.ui.notify(`✅ ${result.message}`, "info");
        return result.message;
      } else {
        ctx.ui.notify(`❌ ${result.message}`, "error");
        throw new Error(result.message);
      }
    },
  });
}

function getLastAssistantText(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    const text = extractText(msg.content).trim();
    if (text) return text;
  }
  return "";
}

function extractText(content: unknown[]): string {
  return content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n");
}

/**
 * Запускает суб-агента через RPC и возвращает его результат (текст).
 * @param pi API расширения
 * @param ctx Контекст PI
 * @param type Имя агента (совпадает с именем файла .md в .pi/agents/)
 * @param prompt Текст промпта для агента
 * @param description Описание для отображения (используется в events)
 * @param onProgress Колбэк для уведомлений о прогрессе (опционально)
 * @returns Результат работы агента (строка)
 */
export async function spawnAgent(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: string,
    prompt: string,
    description: string,
    onProgress?: (msg: string) => void
): Promise<string> {
    const requestId = crypto.randomUUID();
    let agentId: string | null = null;
    let resolved = false;

    return new Promise((resolve, reject) => {
        ctx.signal?.addEventListener("abort", () => {
            resolved = true;
            reject(new Error(`Operation aborted`));
        })

        const unsubscribeReply = pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, (reply: any) => {
            unsubscribeReply();
            if (reply.success) {
                agentId = reply.data?.id;
                onProgress?.(`Агент ${type} запущен, id: ${agentId}`);
            } else {
                reject(new Error(`RPC spawn failed: ${reply.error}`));
            }
        });

        const unsubscribeCompleted = pi.events.on("subagents:completed", (payload: any) => {
            if (agentId && payload.id === agentId) {
                resolved = true;
                unsubscribeCompleted();
                let output = "Агент не вернул результат";
                if (payload.result) {
                    if (typeof payload.result === "string") output = payload.result;
                    else if (payload.result.content?.[0]?.text) output = payload.result.content[0].text;
                    else if (payload.result.text) output = payload.result.text;
                }
                resolve(output);
            }
        });

        pi.events.emit("subagents:rpc:spawn", {
            requestId,
            type,
            prompt,
            options: { 
                description, 
                isBackground: false,
                signal: ctx.signal,
                onSessionCreated: ((session: AgentSession) => {
                    session.subscribe((event : AgentSessionEvent) => {
                        if (event.type === "agent_end") {
                            resolved = true;
                            const output = getLastAssistantText(session)
                            resolve(output);
                        }
                    })
                })
            }
        });
    });
}

/**
 * Безопасное чтение файла, возвращает содержимое или пустую строку при ошибке.
 */
export async function readFileSafe(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return "";
    }
}

/**
 * Парсит JSON, при ошибке возвращает null и опционально логирует.
 */
export function parseJsonSafe(jsonString: string, logError = false): any | null {
    try {
        return JSON.parse(jsonString);
    } catch (err) {
        if (logError) console.error("JSON parse error:", err);
        return null;
    }
}

/**
 * Ожидает появления файла с проверкой каждые 1000 мс.
 * @param filePath Путь к файлу
 * @param timeoutMs Таймаут в миллисекундах
 * @param onProgress Колбэк для уведомлений (опционально)
 */
export async function waitForFile(
    filePath: string,
    timeoutMs = 60000,
    onProgress?: (msg: string) => void
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (existsSync(filePath)) return;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`File ${filePath} not created within ${timeoutMs}ms`);
}
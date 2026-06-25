import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execAsync } from "./common";

export function registerWebTools(pi: ExtensionAPI) {
    // web_search
    pi.registerTool({
        name: "web_search",
        label: "Web Search via DuckDuckGo",
        description: "Поиск в интернете через DuckDuckGo Lite. Возвращает массив результатов с title, url, snippet.",
        parameters: Type.Object({
            query: Type.String(),
            max_results: Type.Number({ default: 5 }),
        }),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const { stdout } = await execAsync(`tools/venv/bin/python tools/web_search.py "${params.query.replace(/"/g, '\\"')}" ${params.max_results}`, { timeout: 15000 });
            const results = JSON.parse(stdout);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        },
    });

    // web_read
    pi.registerTool({
        name: "web_read",
        label: "Web Read / Scraper",
        description: "Загружает и очищает веб-страницу. Возвращает title и текст в Markdown.",
        parameters: Type.Object({
            url: Type.String(),
        }),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const { stdout } = await execAsync(`tools/venv/bin/python tools/web_read.py "${params.url}"`, { timeout: 20000 });
            const result = JSON.parse(stdout);
            return { content: [{ type: "text", text: result.text || result.error }] };
        },
    });
}
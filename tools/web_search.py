#!/usr/bin/env python3
"""
web_search_exa.py — поиск через Exa MCP API (бесплатный)
Вывод: JSON-массив {title, url, snippet}
"""

import sys, json, uuid, os, requests

MCP_URL = "https://mcp.exa.ai/mcp"

def get_api_key():
    key = os.environ.get("EXA_API_KEY", "").strip()
    if not key:
        key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".exa_key")
        if os.path.exists(key_file):
            with open(key_file) as f:
                key = f.read().strip()
    return key

def parse_sse_response(text):
    data_lines = [line[6:] for line in text.splitlines() if line.strip().startswith("data: ")]
    if data_lines:
        for json_str in data_lines:
            try:
                parsed = json.loads(json_str)
                if "result" in parsed or "error" in parsed:
                    return parsed
            except json.JSONDecodeError:
                continue
        try:
            return json.loads("".join(data_lines))
        except json.JSONDecodeError:
            return {"error": "Не удалось извлечь JSON", "raw": text[:1000]}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Ответ не JSON", "raw": text[:1000]}

def send_request(method, params=None):
    key = get_api_key()
    url = f"{MCP_URL}?exaApiKey={key}" if key else MCP_URL
    payload = {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params or {}}
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    r = requests.post(url, json=payload, headers=headers, timeout=30)
    r.raise_for_status()
    r.encoding = 'utf-8'
    return parse_sse_response(r.text)

def initialize_mcp():
    return send_request("initialize", {
        "protocolVersion": "0.1.0",
        "clientInfo": {"name": "russian-analytics", "version": "1.0.0"}
    })

def web_search_exa(query, num_results=5):
    return send_request("tools/call", {
        "name": "web_search_exa",
        "arguments": {"query": query, "num_results": num_results}
    })

def extract_results(raw):
    if "result" in raw and "content" in raw["result"]:
        for item in raw["result"]["content"]:
            if item.get("type") == "text":
                text = item.get("text", "")
                results = []
                lines = text.split("\n")
                i = 0
                while i < len(lines):
                    line = lines[i].strip()
                    if line.startswith("Title: "):
                        title = line[7:]
                        url = ""
                        snippet = ""
                        i += 1
                        while i < len(lines):
                            nl = lines[i].strip()
                            if nl.startswith("Title: "):
                                i -= 1
                                break
                            elif nl.startswith("URL: "):
                                url = nl[5:]
                            elif nl.startswith("Highlights:"):
                                i += 1
                                parts = []
                                while i < len(lines):
                                    hl = lines[i].strip()
                                    if hl.startswith("Title: "):
                                        i -= 1
                                        break
                                    if hl and not hl.startswith(("Published:", "Author:", "URL: ")):
                                        parts.append(hl)
                                    i += 1
                                snippet = " ".join(parts)[:300]
                                break
                            i += 1
                        if title:
                            results.append({"title": title, "url": url, "snippet": snippet or title[:300]})
                    else:
                        i += 1
                return results[:5] or [{"title": "", "url": "", "snippet": text[:500]}]
    return [{"error": "Не удалось извлечь результаты"}]

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([{"error": "Укажите поисковый запрос"}], ensure_ascii=False))
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    try:
        initialize_mcp()
        raw = web_search_exa(query)
        results = extract_results(raw)
        print(json.dumps(results, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps([{"error": f"Ошибка Exa MCP: {e}"}], ensure_ascii=False))
        sys.exit(1)
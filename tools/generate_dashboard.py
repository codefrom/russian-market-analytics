#!/usr/bin/env python3
"""
Генерирует HTML-дашборд из папок с артефактами.
Запуск: tools/venv/bin/python tools/generate_dashboard.py
Результат: artifacts/DASHBOARD.html
"""

import os
import json
from datetime import datetime

ARTIFACTS_DIR = "artifacts"
OUTPUT_FILE = os.path.join(ARTIFACTS_DIR, "DASHBOARD.html")

def parse_artifact_folder(folder_path):
    """Извлекает информацию из папки артефакта."""
    folder_name = os.path.basename(folder_path)
    parts = folder_name.split("_", 2)
    date_str = f"{parts[0]}_{parts[1]}" if len(parts) >= 2 else folder_name
    topic = parts[2] if len(parts) > 2 else ""

    request_file = os.path.join(folder_path, "00_request.md")
    report_file = os.path.join(folder_path, "04_coordinator-report.md")
    log_file = os.path.join(folder_path, "_log.json")

    request = ""
    if os.path.exists(request_file):
        with open(request_file, "r", encoding="utf-8") as f:
            request = f.read()[:200] + "..." if len(f.read()) > 200 else f.read()

    summary = ""
    if os.path.exists(report_file):
        with open(report_file, "r", encoding="utf-8") as f:
            content = f.read()
            # Берём первое предложение после заголовка "Резюме"
            if "**Резюме" in content:
                summary = content.split("**Резюме")[1].split("\n")[0].strip(" *:.")
            else:
                summary = content[:150] + "..." if len(content) > 150 else content

    agents_used = []
    if os.path.exists(log_file):
        with open(log_file, "r", encoding="utf-8") as f:
            log_data = json.load(f)
            agents_used = log_data.get("agents_used", [])

    return {
        "folder": folder_name,
        "date": date_str,
        "topic": topic,
        "request": request,
        "summary": summary,
        "agents_used": agents_used
    }

def generate_dashboard():
    items = []
    if not os.path.exists(ARTIFACTS_DIR):
        os.makedirs(ARTIFACTS_DIR)

    for entry in sorted(os.listdir(ARTIFACTS_DIR), reverse=True):
        path = os.path.join(ARTIFACTS_DIR, entry)
        if os.path.isdir(path) and not entry.startswith("."):
            item = parse_artifact_folder(path)
            items.append(item)

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>AI Investment Dashboard</title>
    <style>
        body {{ font-family: -apple-system, sans-serif; max-width: 1000px; margin: 20px auto; background: #f5f5f5; }}
        .card {{ background: white; border-radius: 8px; padding: 15px; margin: 10px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .date {{ color: #666; font-size: 0.9em; }}
        .agents {{ display: flex; gap: 5px; flex-wrap: wrap; margin: 5px 0; }}
        .agent-tag {{ background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }}
        h1 {{ color: #333; }}
        a {{ color: #1565c0; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <h1>📊 Investment AI Dashboard</h1>
    <p>Всего записей: {len(items)} | Сгенерировано: {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>
"""
    for item in items:
        agents_html = " ".join([f'<span class="agent-tag">{a}</span>' for a in item["agents_used"]])
        html += f"""
    <div class="card">
        <div class="date">{item["date"]}</div>
        <strong><a href="{item["folder"]}/04_coordinator-report.md">{item["topic"] or "Без темы"}</a></strong>
        <p>{item["summary"]}</p>
        <div class="agents">{agents_html}</div>
    </div>"""

    html += """
</body>
</html>"""

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Dashboard saved to {OUTPUT_FILE} with {len(items)} entries")

if __name__ == "__main__":
    generate_dashboard()
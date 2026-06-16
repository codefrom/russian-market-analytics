#!/usr/bin/env python3
"""
Получает таблицу #survey со страницы https://www.cbr.ru/statistics/ddkp/mo_br/
и выводит её в формате Markdown.
"""

import sys
import json
import requests
from bs4 import BeautifulSoup

def fetch_survey_table():
    url = "https://www.cbr.ru/statistics/ddkp/mo_br/"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", id="survey")
    if not table:
        raise ValueError("Таблица #survey не найдена")

    # Преобразуем в Markdown
    rows = table.find_all("tr")
    md_lines = []
    first_row = True
    for row in rows:
        cols = row.find_all(["th", "td"])
        # пропускаем пустые строки
        if not cols:
            continue
        col_texts = []
        for col in cols:
            # убираем лишние пробелы и переносы
            text = col.get_text(" ", strip=True).replace("\xa0", " ")
            col_texts.append(text)
        # объединяем colspan'ы, но для простоты оставим как есть
        md_lines.append("| " + " | ".join(col_texts) + " |")
        if first_row:
            # добавляем разделитель заголовка
            md_lines.append("|" + "|".join(["---"] * len(col_texts)) + "|")
            first_row = False

    return "\n".join(md_lines)

if __name__ == "__main__":
    try:
        md_table = fetch_survey_table()
        print(md_table)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
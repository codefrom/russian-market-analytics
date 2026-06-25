#!/usr/bin/env python3
"""
fetch_cbr_extdebt.py — получает данные по внешнему долгу, внутреннему долгу и ФНБ

Источники:
  - Внешний долг: https://www.cbr.ru/statistics/macro_itm/external_sector/ed/ext-debt/
  - Внутренний долг: https://minfin.gov.ru/ru/opendata/7710168360-DomesticDebt/7710168360-DomesticDebt-visual/
  - ФНБ: https://minfin.gov.ru/opendata/7710168360-NationalWealthFund/7710168360-NationalWealthFund-visual/

Вывод: Markdown-текст с таблицами.
"""

import sys
import json
import re
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

def fetch_external_debt():
    """Внешний долг РФ с сайта ЦБ"""
    url = "https://www.cbr.ru/statistics/macro_itm/external_sector/ed/ext-debt/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return f"**Внешний долг (ЦБ РФ):** ошибка — {e}\n"

    soup = BeautifulSoup(resp.text, "html.parser")
    landing_text = soup.find("div", class_="landing-text")

    if not landing_text:
        return "**Внешний долг (ЦБ РФ):** данные не найдены.\n"

    text = landing_text.get_text("\n", strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return f"## Внешний долг РФ (ЦБ РФ)\n\n{text}\n\n"

def fetch_domestic_debt():
    """Внутренний долг РФ с сайта Минфина"""
    url = "https://minfin.gov.ru/ru/opendata/7710168360-DomesticDebt/7710168360-DomesticDebt-visual/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return f"**Внутренний долг (Минфин):** ошибка — {e}\n"

    soup = BeautifulSoup(resp.text, "html.parser")
    container = soup.find("div", class_="opendata_data") or soup.find("div", class_="block_container")
    if not container:
        return "**Внутренний долг (Минфин):** таблица не найдена.\n"

    table = container.find("table")
    if not table:
        return "**Внутренний долг (Минфин):** таблица не найдена.\n"

    rows = []
    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) >= 5:
            rows.append([c.get_text(strip=True) for c in cells])

    if not rows:
        return "**Внутренний долг (Минфин):** данные не найдены.\n"

    md = "## Внутренний долг РФ (Минфин)\n\n"
    md += "| Показатель | Значение (млрд руб.) | Дата |\n"
    md += "| --- | --- | --- |\n"
    for row in rows[:10]:
        name = row[0]
        try:
            val = float(row[1]) / 1_000_000
            val_str = f"{val:,.2f}"
        except:
            val_str = row[1]
        date = row[4] if len(row) > 4 else ""
        md += f"| {name} | {val_str} | {date} |\n"
    md += "\n"
    return md

def fetch_fnb():
    """Фонд национального благосостояния с сайта Минфина"""
    url = "https://minfin.gov.ru/opendata/7710168360-NationalWealthFund/7710168360-NationalWealthFund-visual/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return f"**ФНБ (Минфин):** ошибка — {e}\n"

    soup = BeautifulSoup(resp.text, "html.parser")
    container = soup.find("div", class_="opendata_data") or soup.find("div", class_="block_container")
    if not container:
        return "**ФНБ (Минфин):** таблица не найдена.\n"

    table = container.find("table")
    if not table:
        return "**ФНБ (Минфин):** таблица не найдена.\n"

    rows = []
    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) >= 3:
            rows.append([c.get_text(strip=True) for c in cells])

    if not rows:
        return "**ФНБ (Минфин):** данные не найдены.\n"

    recent = rows[-5:]

    md = "## Фонд национального благосостояния (Минфин)\n\n"
    md += "| Год | Период | Значение (млрд руб.) |\n"
    md += "| --- | --- | --- |\n"
    for row in recent:
        year, period, value = row[0], row[1], row[2]
        try:
            val = float(value) / 1_000_000
            val_str = f"{val:,.2f}"
        except:
            val_str = value
        md += f"| {year} | {period} | {val_str} |\n"
    md += "\n"
    return md

def main():
    print(fetch_external_debt())
    print(fetch_domestic_debt())
    print(fetch_fnb())

if __name__ == "__main__":
    main()
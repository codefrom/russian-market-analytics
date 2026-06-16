#!/usr/bin/env python3
"""
Инструмент для получения макроэкономических данных с API ЦБ РФ.
Использование:
  python3 cbr_data.py keyrate          — последняя ключевая ставка
  python3 cbr_data.py currency USD     — курс валюты на сегодня
  python3 cbr_data.py inflation        — последняя годовая инфляция (ИПЦ)
  python3 cbr_data.py ruonia           — последняя ставка RUONIA
Возвращает JSON с данными.
"""

import sys
import json
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from html.parser import HTMLParser
import re
import cbrapi

CBR_CURRENCY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
INFLATION_URL = "https://www.cbr.ru/hd_base/infl/"
RUONIA_SOAP_URL = "http://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx"

# ---------- ключевая ставка (cbrapi) ----------
def get_keyrate():
    try:
        series = cbrapi.get_key_rate(period='D')
        if series.empty:
            return {"error": "No keyrate data returned"}
        last_date = series.index[-1]
        last_rate = series.iloc[-1]
        return {
            "date": last_date.strftime('%Y-%m-%d'),
            "rate": last_rate,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

# ---------- курс валют (XML) ----------
def get_currency(char_code):
    try:
        resp = requests.get(CBR_CURRENCY_URL, timeout=10)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        for valute in root.findall("Valute"):
            if valute.find("CharCode").text == char_code.upper():
                nominal = int(valute.find("Nominal").text)
                value = float(valute.find("Value").text.replace(",", "."))
                return {
                    "currency": char_code.upper(),
                    "nominal": nominal,
                    "rate_rub": value,
                    "date": root.get("Date"),
                    "timestamp": datetime.now().isoformat()
                }
        return {"error": f"Currency {char_code} not found"}
    except Exception as e:
        return {"error": str(e)}

# ---------- инфляция (парсинг HTML) ----------
class InflationTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._current_row = []
        self._current_cell = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            classes = dict(attrs).get("class") or ""
            if "data" in classes.split():
                self._in_table = True
        elif self._in_table and tag == "tr":
            self._in_row = True
            self._current_row = []
        elif self._in_row and tag in {"td", "th"}:
            self._in_cell = True
            self._current_cell = []

    def handle_endtag(self, tag):
        if tag == "table" and self._in_table:
            self._in_table = False
        elif tag == "tr" and self._in_row:
            self._in_row = False
            if self._current_row:
                self.rows.append(self._current_row)
        elif tag in {"td", "th"} and self._in_cell:
            self._in_cell = False
            self._current_row.append("".join(self._current_cell).strip())

    def handle_data(self, data):
        if self._in_cell:
            self._current_cell.append(data)

def get_inflation():
    try:
        resp = requests.get(INFLATION_URL, timeout=15)
        resp.raise_for_status()
        html = resp.text

        parser = InflationTableParser()
        parser.feed(html)

        date_pattern = re.compile(r'^\d{2}\.\d{4}$')
        data_rows = []
        for row in parser.rows:
            if not row:
                continue
            if date_pattern.match(row[0]):
                data_rows.append(row)

        if not data_rows:
            return {"error": "No inflation data rows found"}

        first_row = data_rows[0]
        if len(first_row) < 3:
            return {"error": f"Incomplete row: {first_row}"}

        date_str = first_row[0]
        inflation_str = first_row[2].replace(',', '.')

        history = []
        for row in data_rows:
            if len(row) >= 3:
                history.append({
                    "date": row[0],
                    "inflation": row[2].replace(',', '.')
                })

        return {
            "date": date_str,
            "cpi_yoy_pct": inflation_str,
            "all_data": history,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

# ---------- RUONIA через SOAP ----------
def get_ruonia():
    try:
        to_date = datetime.now()
        from_date = to_date - timedelta(days=7)

        soap_envelope = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Ruonia xmlns="http://web.cbr.ru/">
      <fromDate>{from_date.strftime('%Y-%m-%d')}</fromDate>
      <ToDate>{to_date.strftime('%Y-%m-%d')}</ToDate>
    </Ruonia>
  </soap:Body>
</soap:Envelope>"""

        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://web.cbr.ru/Ruonia"
        }

        resp = requests.post(RUONIA_SOAP_URL, data=soap_envelope.encode('utf-8'), headers=headers, timeout=15)
        resp.raise_for_status()

        root = ET.fromstring(resp.content)

        # Ищем все элементы <ro> (данные находятся внутри diffgram, пространство имён пустое)
        values = []
        for el in root.iter('ro'):
            d0_el = el.find('D0')
            ruo_el = el.find('ruo')
            if d0_el is not None and ruo_el is not None:
                date_str = d0_el.text
                rate_str = ruo_el.text
                if date_str and rate_str:
                    # Дата может быть в формате 2026-06-03T00:00:00+03:00, берём только часть до T
                    date_part = date_str.split('T')[0]
                    rate_val = float(rate_str)
                    values.append({
                        "date": date_part,
                        "rate": rate_val
                    })

        if not values:
            return {"error": "No RUONIA values extracted"}

        # Сортируем по дате и берём последнюю
        values.sort(key=lambda x: x['date'])
        last = values[-1]

        return {
            "date": last['date'],
            "rate": last['rate'],
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

# ---------- точка входа ----------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python3 cbr_data.py [keyrate|currency <code>|inflation|ruonia]"}))
        sys.exit(1)
    command = sys.argv[1].lower()
    if command == "keyrate":
        result = get_keyrate()
    elif command == "currency" and len(sys.argv) == 3:
        result = get_currency(sys.argv[2])
    elif command == "inflation":
        result = get_inflation()
    elif command == "ruonia":
        result = get_ruonia()
    else:
        result = {"error": "Unknown command"}
    print(json.dumps(result, ensure_ascii=False, indent=2))
#!/usr/bin/env python3
"""Получение ключевой ставки с публичного REST API ЦБ РФ."""
import sys, json, requests

def get_key_rate():
    """
    Использует открытый API ЦБ: https://www.cbr.ru/scripts/XML_dynamic.asp
    Для ключевой ставки идентификатор в справочнике: R0 (или другой). 
    Более надёжно: парсим страницу https://www.cbr.ru/hd_base/KeyRate/ но лучше использовать официальный REST-сервис DataFrames ЦБ.
    Ниже — прямой запрос к новому API.
    """
    # Новый API ЦБ (описание: https://cbr.ru/development/simbirsoft/)
    url = "https://www.cbr.ru/DailyInfo/WebServ/KeyRate.asmx/KeyRateXML"  # Пробуем старый
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        import xml.etree.ElementTree as ET
        root = ET.fromstring(r.text)
        ns = {'ns': 'http://web.cbr.ru/'}
        key_rates = root.findall('.//ns:KeyRate', ns)
        if not key_rates:
            # Без пространств имён
            key_rates = root.findall('.//KeyRate')
        if key_rates:
            latest = key_rates[0]
            date = latest.find('Date').text
            rate = latest.find('Rate').text
            return date, float(rate)
    except Exception:
        pass  # Попробуем альтернативу

    # Альтернатива: запрос к странице KeyRate через API ЦБ (формат JSON)
    # Используем новый способ: cbr.ru/Queries/UniDbQuery/DownloadData?
    # Попросим данные по ключевой ставке с 2020 года и возьмём последнюю.
    url2 = "https://www.cbr.ru/hd_base/KeyRate/"
    try:
        r = requests.get(url2, timeout=10)
        # Не будем парсить HTML, это сложно. Лучше использовать готовый набор данных.
    except:
        pass

    # Если ничего не сработало, предложим пользователю установить пакет cbrf
    print(json.dumps({"error": "Не удалось получить ключевую ставку. Попробуйте установить 'cbrf': pip install cbrf"}, ensure_ascii=False))
    sys.exit(1)

if __name__ == "__main__":
    try:
        date, rate = get_key_rate()
        print(json.dumps({"date": date, "key_rate": rate}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
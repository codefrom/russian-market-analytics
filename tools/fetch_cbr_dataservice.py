#!/usr/bin/env python3
"""
Получает денежные агрегаты и платёжный баланс через DataService ЦБ РФ.
Выводит таблицу в Markdown.
"""
import requests
from datetime import datetime

BASE_URL = "http://www.cbr.ru/dataservice"

PUBLICATIONS = {
    5: {"name": "Денежные агрегаты", "datasets": [5, 6, 7, 8]},
    8: {"name": "Платежный баланс", "datasets": [9, 10, 11, 12]},
    20: {"name": "Кредиты физлиц", "datasets": [41, 42], "measure" : 22},
    22: {"name": "Кредиты юрлиц", "datasets": [49, 50], "measure" : 22}
}

DATASET_NAMES = {
    5: "Денежный агрегат М0",
    6: "Денежный агрегат М1",
    7: "Денежный агрегат М2",
    8: "Широкая денежная масса",
    9: "Сальдо счета текущих операций",
    10: "Сальдо счета операций с капиталом",
    11: "Сальдо финансового счета",
    12: "Чистые ошибки и пропуски",
    41: "Объём кредитов физлиц",
    42: "Задолженность по кредитам физлиц",
    49: "Объём кредитов юрлиц",
    50: "Задолженность по кредитам юрлиц"
}

def fetch_data(dataset_id, publication_id, measure_id=-1):
    years_url = f"{BASE_URL}/years"
    years_params = {"datasetId": dataset_id, "measureId": measure_id}
    years_response = requests.get(years_url, params=years_params)
    if years_response.status_code != 200:
        return None
    years_data = years_response.json()

    y_min = y_max = None
    if isinstance(years_data, list) and years_data:
        first = years_data[0]
        if isinstance(first, dict):
            y_min = first.get('FromYear')
            y_max = first.get('ToYear')
    elif isinstance(years_data, dict):
        y_min = years_data.get('FromYear') or years_data.get('yMin')
        y_max = years_data.get('ToYear') or years_data.get('yMax')

    if y_min is None or y_max is None:
        cur = datetime.now().year
        y_min, y_max = cur - 10, cur

    data_url = f"{BASE_URL}/data"
    params = {
        "publicationId": publication_id,
        "datasetId": dataset_id,
        "measureId": measure_id,
        "y1": y_min,
        "y2": y_max
    }
    resp = requests.get(data_url, params=params)
    if resp.status_code != 200:
        return None

    data = resp.json()
    headers = data.get('headerData', [])
    raw_data = data.get('RawData', [])
    units = data.get('units', [])

    if not (headers and raw_data and units):
        return None
    
    # берём только первую колонку
    first_col_id = headers[0].get('id')
    raw_data = [row for row in raw_data if row.get('colId') == first_col_id]
    raw_data = max(raw_data, key=lambda x: x.get('date', ''))
    unit_id = raw_data.get('unit_id')
    unit = [unit for unit in units if unit.get('id') == unit_id][0]
    result = {
        "value": f"{float(raw_data.get('obs_val')):.1f} {unit.get('val')}",
        "date": raw_data.get('dt', '')
    }
    return result

if __name__ == "__main__":
    rows = []
    for pub_id, pub in PUBLICATIONS.items():
        masure_id = pub.get("measure", -1)
        for ds_id in pub['datasets']:
            rec = fetch_data(ds_id, pub_id, masure_id)
            if rec:
                rows.append({
                    "name": DATASET_NAMES[ds_id],
                    "value": rec.get('value'),
                    "date": rec.get('date')
                })

    print("| Название показателя | Значение | Дата |")
    print("|---------------------|----------|------|")
    for r in rows:
        print(f"| {r['name']} | {r['value']} | {r['date']} |")
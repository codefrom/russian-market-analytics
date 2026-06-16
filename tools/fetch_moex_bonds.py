#!/usr/bin/env python3
"""
Поиск облигаций на MOEX (доски TQOB и TQCB).
Использование:
  python3 fetch_moex_bonds.py --bond_type government --json
  python3 fetch_moex_bonds.py --queries "ОФЗ 26238" "ОФЗ 26244" --bond_type government --json
  python3 fetch_moex_bonds.py --bond_type government --matdate-from 2028-01-01 --matdate-to 2029-12-31 --sort-yield --json
"""

import sys, json, argparse, requests, pandas as pd, math

BOARD_TYPE_MAP = {
    'TQOB': 'government',
    'TQCB': 'corporate',
}

def fetch_board_bonds(board, bond_type_name):
    url = f"https://iss.moex.com/iss/engines/stock/markets/bonds/boards/{board}/securities.json"
    resp = requests.get(url)
    resp.raise_for_status()
    data = resp.json()
    sec_cols = data['securities']['columns']
    sec_data = data['securities']['data']
    bonds = pd.DataFrame(sec_data, columns=sec_cols)
    market_cols = data['marketdata']['columns']
    market_data = data['marketdata']['data']
    market = pd.DataFrame(market_data, columns=market_cols)
    if not bonds.empty:
        bonds = bonds.merge(market, on='SECID', how='left')
        bonds['type'] = bond_type_name
    return bonds

def fetch_all_bonds():
    all_rows = []
    for board, type_name in BOARD_TYPE_MAP.items():
        try:
            df = fetch_board_bonds(board, type_name)
            if not df.empty:
                all_rows.extend(df.to_dict('records'))
        except Exception:
            pass
    if not all_rows:
        return pd.DataFrame()
    return pd.DataFrame(all_rows)

def fetch_bonds_info(queries=None, bond_type=None, matdate_from=None, matdate_to=None, sort_yield=False):
    bonds = fetch_all_bonds()
    if bonds.empty:
        return bonds

    if bond_type:
        bonds = bonds[bonds['type'] == bond_type]

    if queries:
        q = '|'.join([query.upper() for query in queries])
        bonds = bonds[
            bonds['SECID'].str.contains(q, case=False, na=False) |
            bonds['SHORTNAME'].str.contains(q, case=False, na=False) |
            bonds['SECNAME'].str.contains(q, case=False, na=False)
        ]

    # Преобразуем MATDATE в datetime для фильтрации
    if 'MATDATE' in bonds.columns:
        bonds['MATDATE'] = pd.to_datetime(bonds['MATDATE'], errors='coerce')
        if matdate_from:
            bonds = bonds[bonds['MATDATE'] >= pd.Timestamp(matdate_from)]
        if matdate_to:
            bonds = bonds[bonds['MATDATE'] <= pd.Timestamp(matdate_to)]

    # Сортировка по доходности (по убыванию)
    if sort_yield and 'YIELDATPREVWAPRICE' in bonds.columns:
        bonds = bonds.sort_values('YIELDATPREVWAPRICE', ascending=False)

    columns_needed = {
        'SECID': 'ticker',
        'SHORTNAME': 'shortname',
        'SECNAME': 'name',
        'ISIN': 'isin',
        'type': 'type',
        'FACEVALUE': 'facevalue',
        'COUPONVALUE': 'couponvalue',
        'COUPONPERIOD': 'couponperiod',
        'MATDATE': 'matdate',
        'OFFERDATE': 'offerdate',
        'LCURRENTPRICE': 'price',
        'YIELDATPREVWAPRICE': 'yield',
    }
    existing = {k: v for k, v in columns_needed.items() if k in bonds.columns}
    bonds = bonds[list(existing.keys())].rename(columns=existing)
    return bonds

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Поиск облигаций на MOEX')
    parser.add_argument('--queries', nargs='+', default=None, help='Массив строк для текстового поиска (тикер, название)')
    parser.add_argument('--bond_type', nargs='?', default=None, choices=['government', 'corporate'], help='Тип облигаций')
    parser.add_argument('--matdate-from', help='Дата погашения ОТ (ГГГГ-ММ-ДД)')
    parser.add_argument('--matdate-to', help='Дата погашения ДО (ГГГГ-ММ-ДД)')
    parser.add_argument('--sort-yield', action='store_true', help='Отсортировать по убыванию доходности')
    parser.add_argument('--json', action='store_true', help='Вывести результат в формате JSON')
    args = parser.parse_args()

    try:
        df = fetch_bonds_info(
            queries=args.queries,
            bond_type=args.bond_type,
            matdate_from=args.matdate_from,
            matdate_to=args.matdate_to,
            sort_yield=args.sort_yield
        )
        if df.empty:
            if args.json:
                print(json.dumps([]))
            else:
                print("Облигации не найдены")
        else:
            if args.json:
                # Конвертируем даты в строки
                records = df.to_dict(orient='records')
                for rec in records:
                    if isinstance(rec.get('matdate'), pd.Timestamp):
                        rec['matdate'] = rec['matdate'].strftime('%Y-%m-%d')
                    if isinstance(rec.get('offerdate'), pd.Timestamp):
                        rec['offerdate'] = rec['offerdate'].strftime('%Y-%m-%d')
                    # Замена NaN на None (в JSON станет null)
                    for k, v in rec.items():
                        if isinstance(v, float) and math.isnan(v):
                            rec[k] = None
                print(json.dumps(records, ensure_ascii=False, indent=2))
            else:
                print(df.to_string())
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(json.dumps({"error": str(e)}))
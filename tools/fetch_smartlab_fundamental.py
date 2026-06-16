#!/usr/bin/env python3
"""
Парсинг фундаментальных показателей с Smart-lab.ru, включая LTM.
"""

import sys, json, requests, re
from bs4 import BeautifulSoup

KEEP_FIELDS = {
    'net_operating_income', 'net_interest_income', 'commission_income',
    'net_income', 'ocf', 'dividend', 'dividend_pr', 'dividend_payout',
    'opex', 'bank_assets', 'capital', 'loan_portfolio',
    'corporate_loans', 'retail_loans', 'deposits',
    'corporate_deposits', 'retail_deposits',
    'provision_for_loan_impairment',
    'net_intertest_margin', 'bank_margin',
    'cost_of_risk_ratio', 'cost_to_income',
    'loan_to_deposit_ratio', 'share_of_non_performing_loans',
    'common_share', 'priv_share', 'number_of_shares', 'number_of_priv_shares',
    'eps', 'roe', 'roa', 'p_e', 'p_b', 'market_cap', 'ev',
    'div_yield', 'div_yield_priv', 'div_payout_ratio',
    'free_float', 'employees',
}

def clean_number(text):
    if not text or not text.strip():
        return None
    text = text.strip().replace(' ', '').replace('\xa0', '')
    text = text.replace('%', '').replace(',', '.')
    text = re.sub(r'[^\d.\-]', '', text)
    if not text or text == '-':
        return None
    try:
        return float(text) if '.' in text else int(text)
    except ValueError:
        return None

def parse_smartlab(ticker):
    url = f"https://smart-lab.ru/q/{ticker.upper()}/f/y/"
    headers = {'User-Agent': 'Mozilla/5.0'}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    table = soup.find('table', class_='simple-little-table')
    if not table:
        return {"error": "Financial table not found"}

    # Годы
    years = []
    header_row = table.find('tr', class_='header_row')
    if header_row:
        for cell in header_row.find_all('td'):
            if 'chartrow' in (cell.get('class') or []) or 'ltm_spc' in (cell.get('class') or []):
                continue
            text = cell.get_text(strip=True)
            if text.isdigit():
                years.append(text)

    financials = {}
    multipliers = {}
    ltm_data = {}

    rows = table.find_all('tr', attrs={'field': True})
    for row in rows:
        field = row.get('field')
        if field not in KEEP_FIELDS:
            continue

        th = row.find('th')
        if not th:
            continue
        link = th.find('a')
        indicator = link.get_text(strip=True) if link else th.get_text(strip=True)
        indicator = indicator.rstrip(', ').strip()

        cells = row.find_all('td')
        values = []
        ltm_value = None
        for idx, cell in enumerate(cells):
            if 'chartrow' in (cell.get('class') or []) or 'ltm_spc' in (cell.get('class') or []):
                continue
            if 'editrow' in (cell.get('class') or []):
                # Это заголовок LTM, не числовое значение
                continue
            val = clean_number(cell.get_text())
            values.append(val)

        # LTM — обычно последний <td> перед закрытием строки (последняя значащая ячейка)
        # В структуре таблицы LTM идёт после колонок годов, перед ней <td class="ltm_spc">.
        # Мы уже пропустили ltm_spc и editrow, значит последнее значение в values — LTM.
        if values:
            ltm_value = values.pop()  # забираем последний элемент как LTM
            # Если values пуст (нет годовых данных), то это не LTM, а просто значение; вернём обратно
            if not values:
                values.append(ltm_value)
                ltm_value = None

        # Формируем годовой словарь
        if years and len(values) >= len(years):
            year_data = {yr: values[i] for i, yr in enumerate(years) if i < len(values)}
        else:
            year_data = values

        # LTM
        if ltm_value is not None:
            ltm_data[indicator] = ltm_value

        # Распределение по категориям
        if field in {'p_e', 'p_b', 'p_s', 'ev_ebitda', 'eps', 'roe', 'roa',
                     'market_cap', 'ev', 'div_yield', 'div_yield_priv',
                     'div_payout_ratio', 'free_float'}:
            multipliers[indicator] = year_data
        else:
            financials[indicator] = year_data

    return {
        "ticker": ticker.upper(),
        "source": url,
        "years": years,
        "financials": financials,
        "multipliers": multipliers,
        "ltm": ltm_data,
        "note": "Yearly data (MSFO by default) + LTM (Last Twelve Months)."
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: fetch_smartlab_fundamental.py <TICKER>"}, ensure_ascii=False))
        sys.exit(1)
    try:
        data = parse_smartlab(sys.argv[1])
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
#!/usr/bin/env python3
"""
Получение данных по ETF/БПИФ с MOEX (доски TQTF, TQTD).
Использование: python3 fetch_moex_etf.py <TICKER>
Возвращает JSON с полями: exists, ticker, board, last_price, volume, timestamp
"""

import sys
import json
import requests
from datetime import datetime

def fetch_etf_info(ticker):
    # Доски для ETF: TQTF (БПИФ), TQTD (ETP)
    boards = ['TQTF', 'TQTD']
    for board in boards:
        url = f"https://iss.moex.com/iss/engines/stock/markets/shares/boards/{board}/securities/{ticker}.json"
        try:
            r = requests.get(url, timeout=10)
            if r.status_code == 200:
                data = r.json()
                # Проверяем наличие данных
                if 'securities' in data and data['securities']['data']:
                    sec_data = data['securities']['data'][0]
                    sec_cols = data['securities']['columns']
                    sec_info = dict(zip(sec_cols, sec_data))
                    
                    # Рыночные данные
                    mkt_data = {}
                    if 'marketdata' in data and data['marketdata']['data']:
                        mkt_row = data['marketdata']['data'][0]
                        mkt_cols = data['marketdata']['columns']
                        mkt_data = dict(zip(mkt_cols, mkt_row))
                    
                    last_price = mkt_data.get('LAST') or mkt_data.get('LCURRENTPRICE')
                    volume = mkt_data.get('VOLTODAY')
                    
                    return {
                        "exists": True,
                        "ticker": ticker.upper(),
                        "board": board,
                        "last_price": last_price,
                        "volume": volume,
                        "timestamp": datetime.now().isoformat()
                    }
        except Exception as e:
            continue
    return {
        "exists": False,
        "ticker": ticker.upper(),
        "error": "Тикер не найден на MOEX",
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python3 fetch_moex_etf.py <TICKER>"}))
        sys.exit(1)
    ticker = sys.argv[1].upper()
    result = fetch_etf_info(ticker)
    print(json.dumps(result, ensure_ascii=False, indent=2))
#!/usr/bin/env python3
"""
Инструмент для получения параметров облигаций с MOEX ISS API.
Использование:
  python3 moex_bonds.py <тикер>
  python3 moex_bonds.py SU26238RMFS4
Возвращает JSON с ценой, доходностью, дюрацией, купоном, НКД.
"""

import sys
import json
import requests
from datetime import datetime

MOEX_API_URL = "https://iss.moex.com/iss/engines/stock/markets/bonds/securities/{ticker}.json"

def get_bond_info(ticker):
    url = MOEX_API_URL.format(ticker=ticker.upper())
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Секция с основными параметрами бумаги
        securities = data.get("securities", {}).get("data", [])
        securities_cols = data["securities"]["columns"]
        sec_data = dict(zip(securities_cols, securities[0])) if securities else {}

        # Рыночные данные
        marketdata = data.get("marketdata", {}).get("data", [])
        marketdata_cols = data["marketdata"]["columns"]
        mkt_data = dict(zip(marketdata_cols, marketdata[0])) if marketdata else {}

        result = {
            "ticker": ticker.upper(),
            "board": sec_data.get("BOARDID"),
            "face_value": sec_data.get("FACEVALUE"),
            "coupon_value": sec_data.get("COUPONVALUE"),
            "coupon_period": sec_data.get("COUPONPERIOD"),
            "next_coupon": sec_data.get("NEXTCOUPON"),
            "maturity_date": sec_data.get("MATDATE"),
            "offer_date": sec_data.get("OFFERDATE"),
            "last_price": mkt_data.get("LCURRENTPRICE") or mkt_data.get("LAST"),
            "yield": mkt_data.get("YIELD"),  # доходность к погашению/оферте
            "duration": mkt_data.get("DURATION"),  # дюрация (дней)
            "zcyc_price": mkt_data.get("ZCYCPRICE"),  # "грязная" цена с НКД
            "currency": sec_data.get("FACEUNIT", "RUB"),
            "timestamp": datetime.now().isoformat()
        }
        return result
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python3 moex_bonds.py <TICKER>"}))
        sys.exit(1)
    ticker = sys.argv[1]
    result = get_bond_info(ticker)
    print(json.dumps(result, ensure_ascii=False, indent=2))
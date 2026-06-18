#!/usr/bin/env python3
"""Получение исторических котировок акций с MOEX ISS API и сохранение в CSV."""
import sys
import json
import argparse
import requests
import pandas as pd
from datetime import datetime, timedelta

def fetch_stock_history(ticker, days=90):
    """
    ticker: тикер на Мосбирже (SBER, GAZP, LKOH и т.п.)
    days: глубина истории в днях
    Возвращает DataFrame с колонками: date, open, high, low, close, volume
    """
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    url = f"https://iss.moex.com/iss/history/engines/stock/markets/shares/boards/TQBR/securities/{ticker}.json"
    params = {
        'from': start_date.strftime('%Y-%m-%d'),
        'till': end_date.strftime('%Y-%m-%d'),
        'history.columns': 'TRADEDATE,OPEN,HIGH,LOW,CLOSE,VOLUME',
        'limit': 100,  # максимальный размер страницы
        'start': 0      # начнём с первой строки
    }
    
    all_data = []
    while True:
        r = requests.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        
        history = data['history']['data']
        if not history:
            break
            
        all_data.extend(history)
        
        # Если количество полученных записей меньше запрошенного лимита — пагинация завершена
        if len(history) < params['limit']:
            break
            
        params['start'] += len(history)
    
    if not all_data:
        return pd.DataFrame()
    
    columns = data['history']['columns']
    df = pd.DataFrame(all_data, columns=columns)
    df.columns = ['date', 'open', 'high', 'low', 'close', 'volume']
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date')
    return df

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Скачать историю котировок акций MOEX")
    parser.add_argument("ticker", help="Тикер (SBER, GAZP, ...)")
    parser.add_argument("days", nargs="?", type=int, default=90, help="Глубина истории в днях (по умолчанию 90)")
    parser.add_argument("--output", "-o", help="Путь для сохранения CSV (по умолчанию <TICKER>_history.csv)")
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    days = args.days
    
    try:
        df = fetch_stock_history(ticker, days)
        if df.empty:
            print(json.dumps({"error": f"Нет данных для {ticker}"}))
            sys.exit(1)
        
        # Определяем путь для сохранения
        output_path = args.output if args.output else f"{ticker}_history.csv"
        df.to_csv(output_path, index=False)
        
        # Краткая информация для пользователя
        last_date = df['date'].iloc[-1].strftime('%Y-%m-%d')
        print(f"Данные сохранены в {output_path}")
        print(df.tail(3).to_string(index=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
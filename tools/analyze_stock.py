#!/usr/bin/env python3
"""Технический анализ котировок из CSV. Вывод – Markdown-раздел."""
import sys
import pandas as pd
import numpy as np

def analyze(csv_path):
    df = pd.read_csv(csv_path)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)

    if len(df) < 30:
        print("Недостаточно данных для анализа (требуется минимум 30 строк).")
        return

    close = df['close']
    df['SMA50'] = close.rolling(50).mean()
    df['SMA200'] = close.rolling(200).mean()

    # RSI
    delta = close.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = -delta.where(delta < 0, 0).rolling(14).mean()
    rs = gain / loss
    df['RSI'] = 100 - (100 / (1 + rs))

    # MACD
    exp12 = close.ewm(span=12, adjust=False).mean()
    exp26 = close.ewm(span=26, adjust=False).mean()
    df['MACD'] = exp12 - exp26
    df['Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    df['Histogram'] = df['MACD'] - df['Signal']

    # Уровни за последние 30 дней
    window = df.iloc[-30:]
    local_max = window['high'].nlargest(3).iloc[-1]
    local_min = window['low'].nsmallest(3).iloc[-1]

    last = df.iloc[-1]
    rsi = last['RSI']
    macd_hist = last['Histogram']
    avg_vol20 = df['volume'].rolling(20).mean().iloc[-1]
    last_vol = last['volume']

    # Определение тренда
    if pd.notna(last.get('SMA200')):
        trend = "Восходящий" if last['close'] > last['SMA200'] else "Нисходящий"
    else:
        trend = "Восходящий" if last['close'] > last['SMA50'] else "Нисходящий"

    rsi_sig = "перекупленность" if rsi > 70 else ("перепроданность" if rsi < 30 else "нейтрально")
    macd_sig = "положительная" if macd_hist > 0 else "отрицательная"
    vol_sig = "выше среднего" if last_vol > avg_vol20 else "ниже среднего"

    # Вывод в формате Markdown
    ticker = csv_path.split("/")[-1].replace("_90d.csv", "")
    report = f"""## {ticker}

**Тренд:** {trend}
**Уровни:** Поддержка {local_min:.4f}, Сопротивление {local_max:.4f}
**RSI (14):** {rsi:.1f} ({rsi_sig})
**MACD:** гистограмма {macd_sig}
**Объёмы:** {vol_sig}

**Вывод:** """
    if rsi_sig == "перекупленность" and macd_sig == "отрицательная":
        report += "Возможна коррекция. Рекомендуется фиксация прибыли."
    elif rsi_sig == "перепроданность" and macd_sig == "положительная":
        report += "Возможен разворот вверх. Рассмотрите покупку у поддержки."
    else:
        report += "Сигналы неоднозначны, рекомендуется ожидание."

    print(report)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: analyze_stock.py <csv_file>")
        sys.exit(1)
    analyze(sys.argv[1])
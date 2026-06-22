#!/usr/bin/env python3
"""
fetch_smartlab_news.py — поиск новостей по тикеру на smart-lab.ru

Источники (пробуются последовательно):
  1. Форум: https://smart-lab.ru/forum/news/<TICKER>/
  2. Поиск: https://smart-lab.ru/search/topics/?q=<ticker+name>&blog=news
  3. Поиск только по имени (если тикер не дал результатов)

Использование:
  python tools/fetch_smartlab_news.py <ticker> [name]
"""

import sys
import json
import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
}

def parse_smartlab_date(date_text: str, today: datetime) -> str:
    """Парсит дату из форматов smart-lab"""
    date_text = date_text.strip()
    
    # "19/06" или "19.06" -> "2026-06-19"
    short_match = re.match(r"(\d{1,2})[/.](\d{1,2})$", date_text)
    if short_match:
        day, month = short_match.groups()
        return f"{today.year}-{month.zfill(2)}-{day.zfill(2)}"
    
    # "HH:MM" — сегодня
    if re.match(r"^\d{1,2}:\d{2}$", date_text):
        return today.strftime("%Y-%m-%d")
    
    # "сегодня HH:MM" или "вчера HH:MM"
    if "сегодня" in date_text.lower():
        return today.strftime("%Y-%m-%d")
    if "вчера" in date_text.lower():
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")
    
    # "DD.MM.YYYY" или "DD.MM.YYYY HH:MM"
    full_match = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", date_text)
    if full_match:
        return f"{full_match.group(3)}-{full_match.group(2)}-{full_match.group(1)}"
    
    # "DD месяц YYYY"
    months = {
        "января": "01", "февраля": "02", "марта": "03", "апреля": "04",
        "мая": "05", "июня": "06", "июля": "07", "августа": "08",
        "сентября": "09", "октября": "10", "ноября": "11", "декабря": "12"
    }
    for month_name, month_num in months.items():
        if month_name in date_text.lower():
            day_match = re.search(r"(\d{1,2})", date_text)
            year_match = re.search(r"(\d{4})", date_text)
            if day_match and year_match:
                return f"{year_match.group(1)}-{month_num}-{day_match.group(1).zfill(2)}"
    
    return today.strftime("%Y-%m-%d")

def fetch_forum_news(ticker: str) -> dict:
    """Парсит /forum/news/<TICKER>/"""
    url = f"https://smart-lab.ru/forum/news/{ticker.upper()}/"
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 404:
            return {"error": "Страница не найдена (404)", "news": []}
        resp.raise_for_status()
    except Exception as e:
        return {"error": f"Ошибка запроса форума: {e}", "news": []}
    
    soup = BeautifulSoup(resp.text, "html.parser")
    news_items = []
    today = datetime.now()
    
    # Основной список: ul.temp_headers > li
    temp_headers = soup.find("ul", class_="temp_headers")
    if temp_headers:
        items = temp_headers.find_all("li")
        for li in items:
            try:
                # Ссылка
                title_elem = li.find("a")
                if not title_elem:
                    continue
                
                title = title_elem.get_text(strip=True)
                link = title_elem.get("href", "")
                if link and not link.startswith("http"):
                    link = "https://smart-lab.ru" + link
                
                # Дата: ищем паттерн DD/MM во всём тексте li
                full_text = li.get_text(" ", strip=True)
                date_match = re.search(r"(\d{1,2})[/.](\d{1,2})", full_text)
                
                if date_match:
                    day, month = date_match.groups()
                    date_str = f"{today.year}-{month.zfill(2)}-{day.zfill(2)}"
                else:
                    # Альтернатива: время HH:MM
                    time_match = re.search(r"(\d{1,2}:\d{2})", full_text)
                    if time_match:
                        date_str = today.strftime("%Y-%m-%d")
                    else:
                        date_str = today.strftime("%Y-%m-%d")
                
                # Краткое содержание — сам заголовок
                summary = title[:200]
                
                news_items.append({
                    "date": date_str,
                    "title": title,
                    "url": link,
                    "summary": summary
                })
            except Exception:
                continue
    
    # Сортируем по дате (свежие первее) и берём 3
    news_items.sort(key=lambda x: x["date"], reverse=True)
    return {"news": news_items[:3]}

def fetch_search_news(query: str) -> dict:
    """Парсит /search/topics/?q=...&blog=news"""
    url = "https://smart-lab.ru/search/topics/"
    params = {"q": query, "blog": "news"}
    
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return {"error": f"Ошибка запроса поиска: {e}", "news": []}
    
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # Проверяем, есть ли сообщение "поиск не дал результатов"
    no_results = soup.find("h2", string=re.compile("поиск не дал результатов", re.IGNORECASE))
    if no_results:
        return {"news": []}
    
    news_items = []
    today = datetime.now()
    
    # Контейнер: div.topic
    topics = soup.find_all("div", class_="topic")
    
    for topic in topics[:5]:
        try:
            # Заголовок: h2.title a
            title_elem = topic.find("h2", class_="title")
            if not title_elem:
                continue
            title_link = title_elem.find("a")
            if not title_link:
                continue
            
            title = title_link.get_text(strip=True)
            link = title_link.get("href", "")
            if link and not link.startswith("http"):
                link = "https://smart-lab.ru" + link
            
            # Дата: ul.action li.date
            date_elem = topic.find("li", class_="date")
            date_str = today.strftime("%Y-%m-%d")
            if date_elem:
                date_str = parse_smartlab_date(date_elem.get_text(strip=True), today)
            
            # Содержание: div.content
            content_elem = topic.find("div", class_="content")
            summary = ""
            if content_elem:
                summary = content_elem.get_text(strip=True)[:300]
            if not summary:
                summary = title
            
            news_items.append({
                "date": date_str,
                "title": title,
                "url": link,
                "summary": summary
            })
        except Exception:
            continue
    
    # Сортируем по дате и берём 3
    news_items.sort(key=lambda x: x["date"], reverse=True)
    return {"news": news_items[:3]}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Укажите ticker"}, ensure_ascii=False))
        sys.exit(1)
    
    ticker = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else None
    
    result = None
    
    # 1. Пробуем форум по тикеру
    forum_result = fetch_forum_news(ticker)
    if forum_result.get("news"):
        result = forum_result
        result["source"] = f"smart-lab.ru/forum/news/{ticker.upper()}/"
    
    # 2. Поиск по тикеру + имени (если не нашли)
    if not result:
        query = ticker
        if name and name != ticker:
            query = f"{ticker} {name}"
        search_result = fetch_search_news(query)
        if search_result.get("news"):
            result = search_result
            result["source"] = "smart-lab.ru/search/topics"
    
    # 3. Поиск только по имени (фолбэк для облигаций и т.д.)
    if not result and name and name != ticker:
        search_result = fetch_search_news(name)
        if search_result.get("news"):
            result = search_result
            result["source"] = "smart-lab.ru/search/topics (по имени)"
    
    # Если совсем ничего не нашли
    if not result:
        result = {"news": [], "source": "smart-lab.ru (все источники пусты)"}
    
    result["ticker"] = ticker
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
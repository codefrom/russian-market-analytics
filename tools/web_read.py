#!/usr/bin/env python3
"""
web_read.py — загрузка и очистка веб-страницы
Вывод: JSON с полями title, text (Markdown), error (если ошибка)
Использование: python tools/web_read.py "https://example.com"
"""

import sys, json, re, requests
from bs4 import BeautifulSoup

def clean_text(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        return {"title": "", "text": "", "error": str(e)}

    soup = BeautifulSoup(resp.text, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Удаляем скрипты, стили, навигацию, футеры, рекламу
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"]):
        tag.decompose()

    # Удаляем популярные рекламные/баннерные блоки
    for ad_class in ["advertisement", "adfox", "banner", "sidebar", "popup", "cookie", "social-share"]:
        for div in soup.find_all(["div", "section"], class_=re.compile(ad_class, re.I)):
            div.decompose()

    body = soup.find("body")
    if not body:
        body = soup

    # Извлекаем текст с базовым Markdown-форматированием
    lines = []
    for el in body.descendants:
        if el.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(el.name[1])
            text = el.get_text(" ", strip=True)
            if text:
                lines.append(f"\n{'#' * level} {text}\n")
        elif el.name == "p":
            text = el.get_text(" ", strip=True)
            if text and len(text) > 20:
                lines.append(text + "\n")
        elif el.name == "li":
            text = el.get_text(" ", strip=True)
            if text:
                lines.append(f"- {text}")
        elif el.name == "a":
            text = el.get_text(" ", strip=True)
            href = el.get("href", "")
            if text and href and not href.startswith("#"):
                lines.append(f"[{text}]({href})")

    text = "\n".join(lines)
    # Убираем пустые строки
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Ограничиваем размер
    if len(text) > 8000:
        text = text[:8000] + "\n\n[... truncated]"

    return {"title": title, "text": text.strip(), "error": ""}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Укажите URL"}, ensure_ascii=False))
        sys.exit(1)
    url = sys.argv[1]
    result = clean_text(url)
    print(json.dumps(result, ensure_ascii=False, indent=2))
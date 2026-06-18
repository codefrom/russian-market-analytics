#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
import argparse


def extract_text(item: dict) -> str:
    """
    Извлекает текстовое содержимое из элемента content.
    Поддерживает поля: text, thinking, arguments (форматирует как JSON),
    а также рекурсивно обрабатывает вложенные content-массивы.
    """
    if "text" in item:
        return item["text"]
    if "thinking" in item:
        return item["thinking"]
    if "arguments" in item:
        return json.dumps(item["arguments"], indent=2, ensure_ascii=False)
    if "content" in item and isinstance(item["content"], list):
        parts = []
        for sub in item["content"]:
            parts.append(extract_text(sub))
        return "\n".join(parts)
    # если ничего не подошло — возвращаем строковое представление
    return str(item)


def convert_json_to_markdown(data: list) -> str:
    """
    Принимает список сообщений (из JSON) и возвращает строку в формате Markdown.
    Текст каждого элемента content оборачивается в блок кода ``` ... ```.
    """
    lines = []
    for msg in data:
        role = msg.get("role", "")
        content = msg.get("content", [])
        if not isinstance(content, list):
            content = [{"type": "unknown", "text": str(content)}]

        for item in content:
            type_ = item.get("type", "unknown")
            text = extract_text(item)
            if text is None:
                text = ""
            lines.append(f"## {role} {type_}")
            lines.append("")
            lines.append("```")
            lines.append(text)
            lines.append("```")
            lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Преобразует JSON-лог чата в Markdown с блоками кода"
    )
    parser.add_argument(
        "input", nargs="?", help="Путь к входному JSON-файлу"
    )
    parser.add_argument(
        "-o", "--output", help="Путь для сохранения выходного Markdown-файла"
    )
    args = parser.parse_args()

    # Чтение данных
    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    md = convert_json_to_markdown(data)

    # Запись результата
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(md)
    else:
        print(md)


if __name__ == "__main__":
    main()
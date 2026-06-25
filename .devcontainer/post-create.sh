#!/bin/bash
sudo chown -R node:node /home/node/.pi
sudo chown -R node:node /home/node/.pi/agent
# Установка глобальных npm-пакетов
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Установка плагинов PI по умолчанию
pi install npm:@tintinweb/pi-subagents

# Создание виртуального окружения Python для проекта
python3 -m venv tools/venv
tools/venv/bin/pip install -r tools/requirements.txt

# Дополнительная настройка (опционально)
echo "PI Dev Container готов к работе!"
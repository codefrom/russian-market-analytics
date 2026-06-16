#!/bin/bash
sudo chown -R node:node /home/node/.pi
sudo chown -R node:node /home/node/.pi/agent
# Установка глобальных npm-пакетов
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Установка плагинов PI по умолчанию
pi install npm:npm:pi-search-hub
pi install npm:@tintinweb/pi-subagents

pip install --break-system-packages ddgs

# Создание виртуального окружения Python для проекта
python3 -m venv tools/venv
tools/venv/bin/pip install -r tools/requirements.txt

# Дополнительная настройка (опционально)
echo "PI Dev Container готов к работе!"
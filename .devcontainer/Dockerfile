FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# Дополнительные пакеты (Python и пр.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*
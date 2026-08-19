#!/bin/zsh
cd "/Users/bobby/Documents/Codex/2026-08-17/zhe-sh" || exit 1
mkdir -p work
if ! curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
  nohup node local-assistant/server.mjs >work/local-assistant.log 2>&1 &
fi
if ! curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
  nohup npm run dev >work/local-site.log 2>&1 &
fi
for attempt in {1..30}; do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    open http://localhost:3000/
    exit 0
  fi
  sleep 1
done
echo "芯探启动失败，请把 work/local-site.log 发给开发者。"
read -k 1 "?按任意键关闭"

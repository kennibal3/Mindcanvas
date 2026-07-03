#!/bin/bash
# MindCanvas 部署脚本 —— 只从 GitHub main 部署（2026-07-03 改造）
set -e
cd /opt/mindcanvas

echo "== 1/6 检查工作区 =="
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区有未提交改动，禁止部署（服务器上不应直接改代码）"
  git status --short | head -10
  exit 1
fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || { echo "❌ 当前在 $BRANCH 分支，只允许从 main 部署"; exit 1; }

echo "== 2/6 拉取最新 main =="
git fetch origin
OLD=$(git rev-parse --short HEAD)
git merge --ff-only origin/main
NEW=$(git rev-parse --short HEAD)
echo "   版本：$OLD → $NEW"

echo "== 3/6 编译后端 =="
cd server && go build -o mindcanvas-server . && cd ..

echo "== 4/6 构建前端 =="
cd web && npm run build && cd ..

echo "== 5/6 发布前端静态文件 =="
cp -r web/dist/* /var/www/mindcanvas/

echo "== 6/6 重启服务 =="
systemctl restart mindcanvas
sleep 2
systemctl is-active mindcanvas && echo "✅ 部署完成：main @ $NEW"

#!/bin/bash
# MDLibrary 开发环境启动脚本
# 后端: 8801  前端: 8802

cd "$(dirname "$0")"

# 杀掉旧进程
lsof -ti :8801 | xargs kill 2>/dev/null
lsof -ti :8802 | xargs kill 2>/dev/null
sleep 1

# 启动后端
DATA_DIR=./data DOCS_DIR=./docs PORT=8801 nohup backend/mdlibrary-server > backend/backend.log 2>&1 &
echo "后端启动 PID=$! 端口=8801"

# 启动前端
cd frontend && npx vite --port 8802 --host &
echo "前端启动 端口=8802"

echo ""
echo "✓ 后端: http://localhost:8801"
echo "✓ 前端: http://localhost:8802"
echo ""
echo "按 Ctrl+C 停止前端 (后端需手动 kill)"

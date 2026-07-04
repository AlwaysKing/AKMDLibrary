#!/bin/bash
set -e

# ===== 模式判断 =====
if [ -z "$USER_NAME" ] && [ -z "$USER_ID" ] && [ -z "$GROUP_NAME" ] && [ -z "$GROUP_ID" ]; then
    echo "[entrypoint] 未配置 USER_*/GROUP_* 环境变量，以当前用户直接启动"
    exec "$@"
fi

# 部分设置时拒绝启动
if [ -z "$USER_NAME" ] || [ -z "$USER_ID" ] || [ -z "$GROUP_NAME" ] || [ -z "$GROUP_ID" ]; then
    echo "错误: USER_NAME/USER_ID/GROUP_NAME/GROUP_ID 必须同时设置或同时留空" >&2
    exit 1
fi

echo "[entrypoint] 切换到用户 $USER_NAME (UID=$USER_ID) / 组 $GROUP_NAME (GID=$GROUP_ID)"

# ===== 创建/调整 group =====
if ! getent group "$GROUP_NAME" >/dev/null 2>&1; then
    groupadd -g "$GROUP_ID" "$GROUP_NAME"
    echo "[entrypoint] 创建组 $GROUP_NAME"
else
    groupmod -g "$GROUP_ID" "$GROUP_NAME"
fi

# ===== 创建/调整 user =====
HOME_DIR="/home/$USER_NAME"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    useradd -u "$USER_ID" -g "$GROUP_ID" -m -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
    echo "[entrypoint] 创建用户 $USER_NAME"
else
    usermod -u "$USER_ID" -g "$GROUP_ID" -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
fi

# ===== 建立 ~/.claude 软链（指向 data/claude，admin 改完立即生效） =====
mkdir -p "$HOME_DIR/.claude"
mkdir -p /app/data/claude

# settings.json symlink（不存在则先创建空骨架）
if [ ! -f /app/data/claude/settings.json ]; then
    echo '{ "env": {} }' > /app/data/claude/settings.json
fi
if [ ! -f /app/data/claude/system-prompt.md ]; then
    touch /app/data/claude/system-prompt.md
fi

rm -f "$HOME_DIR/.claude/settings.json"
ln -sf /app/data/claude/settings.json "$HOME_DIR/.claude/settings.json"

# ===== 修正权限（含 symlink 自身） =====
chown -h "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude/settings.json"
chown -R "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude"
chown -R "$USER_NAME:$GROUP_NAME" /app/data /app/docs

# ===== 切换用户后执行原 command =====
exec su "$USER_NAME" -c 'exec "$@"' su-exec "$@"

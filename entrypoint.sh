#!/bin/bash
set -e

# ===== claude 二进制可访问性预检（fail fast） =====
# 验证 claude 真的能被运行用户 exec。参考 DocAgent 项目踩过的坑：
#  - claude 装在 /opt/claude 下，目录权限不对非 root 用户读不到 → ENOENT
#  - install.sh 装的是 launcher 软链，realpath 才是真实二进制，两路径都要可 exec
CLAUDE_BIN="${CLAUDE_BIN:-/usr/local/bin/claude}"

preflight_claude() {
    local AS_USER="$1"  # 空 = 当前用户
    if [ ! -e "$CLAUDE_BIN" ]; then
        echo "[entrypoint] 警告: $CLAUDE_BIN 不存在，claude 集成不可用" >&2
        return 0
    fi
    local REAL; REAL=$(readlink -f "$CLAUDE_BIN")
    if [ -z "$AS_USER" ] || [ "$(id -un)" = "$AS_USER" ]; then
        if "$CLAUDE_BIN" --version >/dev/null 2>&1; then
            echo "[entrypoint] claude 预检 OK（当前用户 exec $CLAUDE_BIN）"
            return 0
        fi
    else
        # 用 su 切到目标用户跑一次 --version
        if su -s /bin/bash "$AS_USER" -c "$CLAUDE_BIN --version >/dev/null 2>&1"; then
            echo "[entrypoint] claude 预检 OK（用户 $AS_USER 可 exec $CLAUDE_BIN）"
            return 0
        fi
    fi
    echo "错误: claude 二进制预检失败" >&2
    echo "--- 诊断信息 ---" >&2
    echo "symlink: $CLAUDE_BIN" >&2
    ls -la "$CLAUDE_BIN" >&2 || true
    echo "realpath: $REAL" >&2
    ls -la "$REAL" >&2 || true
    echo "ldd $REAL:" >&2
    ldd "$REAL" >&2 || true
    echo "file $REAL:" >&2
    file "$REAL" >&2 || true
    exit 1
}

# ===== 模式判断 =====
if [ -z "$USER_NAME" ] && [ -z "$USER_ID" ] && [ -z "$GROUP_NAME" ] && [ -z "$GROUP_ID" ]; then
    echo "[entrypoint] 未配置 USER_*/GROUP_* 环境变量，以当前用户直接启动"
    # 把内置 CLAUDE.md 放到当前用户的 ~/.claude/，claude 启动时自动读取
    CURRENT_HOME="${HOME:-/root}"
    mkdir -p "$CURRENT_HOME/.claude"
    if [ -f /app/CLAUDE.md ]; then
        cp -f /app/CLAUDE.md "$CURRENT_HOME/.claude/CLAUDE.md"
        echo "[entrypoint] 已部署内置 CLAUDE.md 到 $CURRENT_HOME/.claude/CLAUDE.md"
    fi
    preflight_claude ""
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

# ===== 部署内置 CLAUDE.md（FORMATS.md + STRUCTURE.md，构建时拼好） =====
# 每次容器启动用 /app/CLAUDE.md 覆盖一次，保证和镜像版本一致
if [ -f /app/CLAUDE.md ]; then
    cp -f /app/CLAUDE.md "$HOME_DIR/.claude/CLAUDE.md"
    echo "[entrypoint] 已部署内置 CLAUDE.md 到 $HOME_DIR/.claude/CLAUDE.md"
fi

# ===== 修正权限（含 symlink 自身） =====
chown -h "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude/settings.json"
chown -R "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude"
chown -R "$USER_NAME:$GROUP_NAME" /app/data /app/docs

# ===== 切换用户前预检（用目标用户验证 claude 可 exec） =====
preflight_claude "$USER_NAME"

# ===== 切换用户后执行原 command =====
exec su "$USER_NAME" -c 'exec "$@"' su-exec "$@"

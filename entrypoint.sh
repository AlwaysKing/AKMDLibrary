#!/bin/bash
set -e

# ===== 启动横幅 & 环境变量转储 =====
echo "=========================================================="
echo "[entrypoint] 启动 entrypoint.sh (pid=$$, ppid=$PPID)"
echo "[entrypoint] 当前身份: $(id)"
echo "[entrypoint] 工作目录: $(pwd)"
echo "[entrypoint] 参数 (\$@): $*"
echo "[entrypoint] USER_* / GROUP_* 环境变量:"
echo "  USER_NAME  = '${USER_NAME:-<empty>}'"
echo "  USER_ID    = '${USER_ID:-<empty>}'"
echo "  GROUP_NAME = '${GROUP_NAME:-<empty>}'"
echo "  GROUP_ID   = '${GROUP_ID:-<empty>}'"
echo "  HOME       = '${HOME:-<empty>}'"
echo "  CLAUDE_BIN = '${CLAUDE_BIN:-<unset, will default to /usr/local/bin/claude>}'"
echo "=========================================================="

# ===== claude 二进制可访问性预检（fail fast） =====
# 验证 claude 真的能被运行用户 exec。参考 DocAgent 项目踩过的坑：
#  - claude 装在 /opt/claude 下，目录权限不对非 root 用户读不到 → ENOENT
#  - install.sh 装的是 launcher 软链，realpath 才是真实二进制，两路径都要可 exec
CLAUDE_BIN="${CLAUDE_BIN:-/usr/local/bin/claude}"
echo "[entrypoint] 使用 CLAUDE_BIN=$CLAUDE_BIN"

preflight_claude() {
    local AS_USER="$1"  # 空 = 当前用户
    echo "[entrypoint] >>> preflight_claude(as_user='${AS_USER:-<current>}')"
    if [ ! -e "$CLAUDE_BIN" ]; then
        echo "[entrypoint]     警告: $CLAUDE_BIN 不存在，claude 集成不可用" >&2
        echo "[entrypoint]     （这是软警告，预检返回 0 继续启动）"
        return 0
    fi
    local REAL; REAL=$(readlink -f "$CLAUDE_BIN")
    echo "[entrypoint]     symlink = $CLAUDE_BIN"
    echo "[entrypoint]     realpath = $REAL"
    if [ -z "$AS_USER" ] || [ "$(id -un)" = "$AS_USER" ]; then
        echo "[entrypoint]     以当前用户 $(id -un) 执行 $CLAUDE_BIN --version"
        if "$CLAUDE_BIN" --version >/dev/null 2>&1; then
            echo "[entrypoint]     ✓ 当前用户可 exec $CLAUDE_BIN（预检通过）"
            return 0
        fi
    else
        echo "[entrypoint]     用 su 切到 '$AS_USER' 执行 $CLAUDE_BIN --version"
        if su -s /bin/bash "$AS_USER" -c "$CLAUDE_BIN --version >/dev/null 2>&1"; then
            echo "[entrypoint]     ✓ 用户 $AS_USER 可 exec $CLAUDE_BIN（预检通过）"
            return 0
        fi
    fi
    echo "[entrypoint] ✗ 错误: claude 二进制预检失败" >&2
    echo "[entrypoint] --- 诊断信息 ---" >&2
    echo "[entrypoint] symlink: $CLAUDE_BIN" >&2
    ls -la "$CLAUDE_BIN" >&2 || true
    echo "[entrypoint] realpath: $REAL" >&2
    ls -la "$REAL" >&2 || true
    echo "[entrypoint] ldd $REAL:" >&2
    ldd "$REAL" >&2 || true
    echo "[entrypoint] file $REAL:" >&2
    file "$REAL" >&2 || true
    exit 1
}

# ===== 模式判断 =====
echo "[entrypoint] --- 模式判断 ---"
echo "[entrypoint] 检查 USER_*/GROUP_* 是否全部为空..."
if [ -z "$USER_NAME" ] && [ -z "$USER_ID" ] && [ -z "$GROUP_NAME" ] && [ -z "$GROUP_ID" ]; then
    echo "[entrypoint] 全部为空 → 进入「无用户切换」分支（以当前身份启动）"
    CURRENT_HOME="${HOME:-/root}"
    echo "[entrypoint] CURRENT_HOME=$CURRENT_HOME"
    echo "[entrypoint] mkdir -p $CURRENT_HOME/.claude"
    mkdir -p "$CURRENT_HOME/.claude"
    if [ -f /app/CLAUDE.md ]; then
        echo "[entrypoint] cp -f /app/CLAUDE.md → $CURRENT_HOME/.claude/CLAUDE.md"
        cp -f /app/CLAUDE.md "$CURRENT_HOME/.claude/CLAUDE.md"
        echo "[entrypoint]     ✓ 已部署内置 CLAUDE.md"
    else
        echo "[entrypoint]     （/app/CLAUDE.md 不存在，跳过部署）"
    fi
    echo "[entrypoint] --- 调用 preflight_claude（无用户切换） ---"
    preflight_claude ""
    echo "[entrypoint] === 无用户分支准备完毕，exec \"$@\" ==="
    exec "$@"
fi
echo "[entrypoint] 至少一个变量非空，进入「用户切换」分支"

# 部分设置时拒绝启动
if [ -z "$USER_NAME" ] || [ -z "$USER_ID" ] || [ -z "$GROUP_NAME" ] || [ -z "$GROUP_ID" ]; then
    echo "[entrypoint] ✗ 错误: USER_*/GROUP_* 必须同时设置或同时留空" >&2
    echo "[entrypoint]     USER_NAME='$USER_NAME' USER_ID='$USER_ID' GROUP_NAME='$GROUP_NAME' GROUP_ID='$GROUP_ID'" >&2
    exit 1
fi

echo "[entrypoint] =========================================================="
echo "[entrypoint] 切换到用户 $USER_NAME (UID=$USER_ID) / 组 $GROUP_NAME (GID=$GROUP_ID)"
echo "[entrypoint] =========================================================="

# ===== 创建/调整 group =====
echo "[entrypoint] --- 组管理 ---"
echo "[entrypoint] 检查组 '$GROUP_NAME' 是否已存在..."
if ! getent group "$GROUP_NAME" >/dev/null 2>&1; then
    echo "[entrypoint]     组不存在，执行: groupadd -g $GROUP_ID $GROUP_NAME"
    groupadd -g "$GROUP_ID" "$GROUP_NAME"
    RC=$?
    echo "[entrypoint]     groupadd 退出码=$RC"
    if [ $RC -ne 0 ]; then
        echo "[entrypoint] ✗ groupadd 失败" >&2
        exit $RC
    fi
    echo "[entrypoint]     ✓ 已创建组 $GROUP_NAME (GID=$GROUP_ID)"
else
    EXISTING_GID=$(getent group "$GROUP_NAME" | cut -d: -f3)
    echo "[entrypoint]     组已存在，当前 GID=$EXISTING_GID，目标 GID=$GROUP_ID"
    echo "[entrypoint]     执行: groupmod -g $GROUP_ID $GROUP_NAME"
    groupmod -g "$GROUP_ID" "$GROUP_NAME"
    RC=$?
    echo "[entrypoint]     groupmod 退出码=$RC"
fi
echo "[entrypoint]     组当前状态: $(getent group "$GROUP_NAME")"

# ===== 创建/调整 user =====
echo "[entrypoint] --- 用户管理 ---"
HOME_DIR="/home/$USER_NAME"
echo "[entrypoint] 目标 HOME_DIR=$HOME_DIR"
echo "[entrypoint] 检查用户 '$USER_NAME' 是否已存在..."
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
    echo "[entrypoint]     用户不存在，执行: useradd -u $USER_ID -g $GROUP_ID -m -d $HOME_DIR -s /bin/bash $USER_NAME"
    useradd -u "$USER_ID" -g "$GROUP_ID" -m -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
    RC=$?
    echo "[entrypoint]     useradd 退出码=$RC"
    if [ $RC -ne 0 ]; then
        echo "[entrypoint] ✗ useradd 失败" >&2
        exit $RC
    fi
    echo "[entrypoint]     ✓ 已创建用户 $USER_NAME (UID=$USER_ID)"
else
    echo "[entrypoint]     用户已存在: $(id "$USER_NAME")"
    echo "[entrypoint]     执行: usermod -u $USER_ID -g $GROUP_ID -d $HOME_DIR -s /bin/bash $USER_NAME"
    usermod -u "$USER_ID" -g "$GROUP_ID" -d "$HOME_DIR" -s /bin/bash "$USER_NAME"
    RC=$?
    echo "[entrypoint]     usermod 退出码=$RC"
fi
echo "[entrypoint]     用户当前状态: $(id "$USER_NAME")"

# ===== 建立 ~/.claude 软链（指向 data/claude，admin 改完立即生效） =====
echo "[entrypoint] --- ~/.claude 设置 ---"
echo "[entrypoint] mkdir -p $HOME_DIR/.claude"
mkdir -p "$HOME_DIR/.claude"
echo "[entrypoint] mkdir -p /app/data/claude"
mkdir -p /app/data/claude

# settings.json symlink（不存在则先创建空骨架）
if [ ! -f /app/data/claude/settings.json ]; then
    echo "[entrypoint]     /app/data/claude/settings.json 不存在，写入空骨架 '{ \"env\": {} }'"
    echo '{ "env": {} }' > /app/data/claude/settings.json
fi
if [ ! -f /app/data/claude/system-prompt.md ]; then
    echo "[entrypoint]     /app/data/claude/system-prompt.md 不存在，touch 创建空文件"
    touch /app/data/claude/system-prompt.md
fi

echo "[entrypoint]     rm -f $HOME_DIR/.claude/settings.json (清理可能的旧文件/软链)"
rm -f "$HOME_DIR/.claude/settings.json"
echo "[entrypoint]     ln -sf /app/data/claude/settings.json → $HOME_DIR/.claude/settings.json"
ln -sf /app/data/claude/settings.json "$HOME_DIR/.claude/settings.json"
RC=$?
echo "[entrypoint]     ln 退出码=$RC"

# ===== 部署内置 CLAUDE.md（FORMATS.md + STRUCTURE.md，构建时拼好） =====
echo "[entrypoint] --- 内置 CLAUDE.md 部署 ---"
if [ -f /app/CLAUDE.md ]; then
    echo "[entrypoint]     cp -f /app/CLAUDE.md → $HOME_DIR/.claude/CLAUDE.md"
    cp -f /app/CLAUDE.md "$HOME_DIR/.claude/CLAUDE.md"
    RC=$?
    echo "[entrypoint]     cp 退出码=$RC"
    echo "[entrypoint]     ✓ 已部署内置 CLAUDE.md 到 $HOME_DIR/.claude/CLAUDE.md"
else
    echo "[entrypoint]     警告: /app/CLAUDE.md 不存在，跳过部署" >&2
fi

# ===== 修正权限（含 symlink 自身） =====
echo "[entrypoint] --- 权限修正 ---"
echo "[entrypoint]     chown -h $USER_NAME:$GROUP_NAME $HOME_DIR/.claude/settings.json"
chown -h "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude/settings.json"
RC=$?
echo "[entrypoint]     chown (symlink) 退出码=$RC"
echo "[entrypoint]     chown -R $USER_NAME:$GROUP_NAME $HOME_DIR/.claude"
chown -R "$USER_NAME:$GROUP_NAME" "$HOME_DIR/.claude"
RC=$?
echo "[entrypoint]     chown (~/.claude) 退出码=$RC"
echo "[entrypoint]     chown -R $USER_NAME:$GROUP_NAME /app/data /app/docs"
chown -R "$USER_NAME:$GROUP_NAME" /app/data /app/docs
RC=$?
echo "[entrypoint]     chown (/app/data /app/docs) 退出码=$RC"

# ===== 切换用户前预检（用目标用户验证 claude 可 exec） =====
echo "[entrypoint] --- 调用 preflight_claude（用户=$USER_NAME） ---"
preflight_claude "$USER_NAME"

# ===== 切换用户后执行原 command =====
echo "[entrypoint] =========================================================="
echo "[entrypoint] 一切就绪，exec su 切换到 $USER_NAME 执行: $*"
echo "[entrypoint] ==========================================================="
exec su "$USER_NAME" -c 'exec "$@"' su-exec "$@"

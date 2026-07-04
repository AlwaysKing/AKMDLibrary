# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

# postinstall 脚本用 bash，alpine 默认只有 ash
RUN apk add --no-cache bash

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# postinstall 会跑 bash scripts/apply-patches.sh，必须先把 scripts/ 一起 COPY 进来，
# 否则 npm install 时找不到脚本会报 code 127
COPY frontend/scripts/ ./scripts/
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM golang:1.25-alpine AS backend-builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./

RUN CGO_ENABLED=1 GOOS=linux go build -o akmdlibrary ./cmd/server

# Stage 3: Runtime
FROM debian:12-slim

# ca-certificates: TLS for HTTPS git remotes / API calls
# tzdata: localized timestamps
# git: per-space git operations (commit/push/pull) + claude 内部使用
# ripgrep: claude Grep 工具依赖 rg
# openssh-client: ssh binary for git over SSH remotes
# curl: claude install.sh 下载器
# bash: entrypoint.sh + claude 安装脚本
# procps: pkill 等，进程管理
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        tzdata \
        git \
        ripgrep \
        openssh-client \
        curl \
        bash \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Per-space repos are bind-mounted from the host and typically owned by a
# different UID than the container process. Since git 2.35+, this triggers
# "fatal: detected dubious ownership" which breaks every git command. Marking
# all repos as safe (system-wide, applies to every user) avoids needing to
# know the exact repo paths ahead of time.
RUN git config --system --add safe.directory '*'

# 安装 Claude Code 原生二进制（不需要 Node.js）
# install.sh 把 launcher 放在 ~/.local/bin/claude（symlink → versions/<ver>），
# 真实二进制和依赖都在 ~/.local/share/claude/ 下。需要整个目录树对所有用户可读，
# 否则非 root 用户 exec 会拿到 ENOENT（root 700 权限问题）。所以用 /opt/claude 作为 HOME。
# HOME 必须用 export 才能跨管道传给 bash。
RUN set -eux; \
    mkdir -p /opt/claude; \
    export HOME=/opt/claude; \
    curl -fsSL https://claude.ai/install.sh | bash; \
    chmod -R a+rX /opt/claude; \
    ls -la /opt/claude/.local/bin/claude; \
    ln -sf /opt/claude/.local/bin/claude /usr/local/bin/claude; \
    /usr/local/bin/claude --version

WORKDIR /app

COPY --from=backend-builder /app/akmdlibrary /app/akmdlibrary
COPY --from=frontend-builder /app/frontend/dist /app/html

# Entrypoint for runtime user/group switching (USER_NAME/USER_ID/GROUP_NAME/GROUP_ID env vars)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Built-in CLAUDE.md: 拼接 FORMATS.md + STRUCTURE.md
# entrypoint.sh 会把它复制到运行用户的 ~/.claude/CLAUDE.md，claude 启动时自动读取
# 这是与 admin UI 配置（--append-system-prompt）并行的内置层
COPY docs/FORMATS.md /tmp/claude/FORMATS.md
COPY docs/STRUCTURE.md /tmp/claude/STRUCTURE.md
RUN printf '\n\n---\n\n' >> /tmp/claude/FORMATS.md \
 && cat /tmp/claude/FORMATS.md /tmp/claude/STRUCTURE.md > /app/CLAUDE.md \
 && rm -rf /tmp/claude

# Create data and docs directories
RUN mkdir -p /app/docs /app/data

# JWT_SECRET: 生产环境请通过 -e / docker-compose 覆盖
ENV JWT_SECRET=change-me-in-production

EXPOSE 8080

VOLUME ["/app/docs", "/app/data"]

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/akmdlibrary"]

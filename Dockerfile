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
FROM alpine:3.20

# ca-certificates: TLS for HTTPS git remotes / API calls
# tzdata: localized timestamps
# git: per-space git operations (commit/push/pull)
# openssh-client: ssh binary for git over SSH remotes
RUN apk add --no-cache ca-certificates tzdata git openssh-client

# TODO: install Claude Code CLI (e.g., npm install -g @anthropic/claude-code) once Node.js runtime is added

# Per-space repos are bind-mounted from the host and typically owned by a
# different UID than the container process. Since git 2.35+, this triggers
# "fatal: detected dubious ownership" which breaks every git command. Marking
# all repos as safe (system-wide, applies to every user) avoids needing to
# know the exact repo paths ahead of time.
RUN git config --system --add safe.directory '*'

WORKDIR /app

COPY --from=backend-builder /app/akmdlibrary /app/akmdlibrary
COPY --from=frontend-builder /app/frontend/dist /app/html

# Entrypoint for runtime user/group switching (USER_NAME/USER_ID/GROUP_NAME/GROUP_ID env vars)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create data and docs directories
RUN mkdir -p /app/docs /app/data

# JWT_SECRET: 生产环境请通过 -e / docker-compose 覆盖
ENV JWT_SECRET=change-me-in-production

EXPOSE 8080

VOLUME ["/app/docs", "/app/data"]

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/akmdlibrary"]

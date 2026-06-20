# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
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

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=backend-builder /app/akmdlibrary /app/akmdlibrary
COPY --from=frontend-builder /app/frontend/dist /app/html

# Create data and docs directories
RUN mkdir -p /app/docs /app/data

# JWT_SECRET: 生产环境请通过 -e / docker-compose 覆盖
ENV JWT_SECRET=change-me-in-production

EXPOSE 8080

VOLUME ["/app/docs", "/app/data"]

CMD ["/app/akmdlibrary"]

# MD Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Notion-style knowledge base system that stores content as Markdown files on the filesystem.

**Architecture:** Go backend serves REST API + embedded React SPA. SQLite for users/metadata, filesystem for MD content. BlockNote editor for WYSIWYG editing. Single Docker container deployment.

**Tech Stack:** Go (Chi/Echo), React 18 + TypeScript + Vite + Zustand + Tailwind CSS, BlockNote (Fork), SQLite, Playwright (testing)

**Project Root:** `./` (MDLibrary 项目根目录)

**Spec:** `docs/superpowers/specs/2026-05-07-knowledge-base-design.md`

---

## Phase 1: Project Scaffolding

### Task 1.1: Create project structure

**Files:**
- Create: `MDLibrary/` root directory
- Create: `MDLibrary/backend/` Go module
- Create: `MDLibrary/frontend/` React app
- Create: `MDLibrary/docs/` documentation root (MD files go here)
- Create: `MDLibrary/data/` system data (SQLite + uploads)

- [ ] **Step 1: Create root project directory**
```bash
mkdir -p {backend,frontend,docs,data/uploads}
```

- [ ] **Step 2: Initialize Go module**
```bash
cd backend
go mod init github.com/yourname/mdlibrary
```

- [ ] **Step 3: Create React app with Vite**
```bash
cd frontend
npm create vite@latest . -- --template react-ts
```

- [ ] **Step 4: Install frontend dependencies**
```bash
cd frontend
npm install axios zustand react-router-dom lucide-react
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 5: Initialize Git repo**
```bash
git init
```

- [ ] **Step 6: Create .gitignore**
Create file with node_modules, dist, data.db, .DS_Store etc.

---

## Phase 2: Go Backend (Parallel Track A)

### Task 2.1: Backend foundation — models + SQLite

**Files:**
- Create: `backend/internal/model/user.go`
- Create: `backend/internal/model/space.go`
- Create: `backend/internal/model/page.go`
- Create: `backend/internal/model/space_member.go`
- Create: `backend/internal/repository/db.go` — SQLite init + migrations
- Create: `backend/internal/repository/user_repo.go`
- Create: `backend/internal/repository/space_repo.go`
- Create: `backend/internal/repository/page_repo.go`
- Create: `backend/internal/repository/member_repo.go`

- [ ] **Step 1: Install Go dependencies**
```bash
cd backend
go get github.com/golang-jwt/jwt/v5
go get golang.org/x/crypto/bcrypt
go get github.com/mattn/go-sqlite3
go get github.com/go-chi/chi/v5
go get github.com/go-chi/cors
```

- [ ] **Step 2: Create data models** — User, Space, Page, SpaceMember structs matching the spec tables

- [ ] **Step 3: Create SQLite initialization** — Auto-create tables, auto-seed admin user

- [ ] **Step 4: Create repository layer** — CRUD operations for each model

- [ ] **Step 5: Write Go tests for repository layer**
```bash
go test ./internal/repository/...
```

- [ ] **Step 6: Commit**

### Task 2.2: Auth system — JWT + middleware

**Files:**
- Create: `backend/internal/middleware/auth.go` — JWT middleware
- Create: `backend/internal/handler/auth_handler.go` — login/logout/me

- [ ] **Step 1: Implement JWT token generation and validation**

- [ ] **Step 2: Implement auth middleware** — Extract JWT from Authorization header, inject user into context

- [ ] **Step 3: Implement auth handler** — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me

- [ ] **Step 4: Write tests for auth flow**

- [ ] **Step 5: Commit**

### Task 2.3: Filesystem scanner — docs/ → page tree

**Files:**
- Create: `backend/pkg/filesystem/scanner.go` — recursive directory scanner

- [ ] **Step 1: Implement directory scanner** — Read docs/, skip public/ and dotfiles, build tree of spaces and pages. Map rules: folder=space, .md=page, same-name folder=children

- [ ] **Step 2: Implement Markdown read/write** — Read .md file content, write .md content

- [ ] **Step 3: Write tests with sample docs/ structure**

- [ ] **Step 4: Commit**

### Task 2.4: Space + Page API handlers

**Files:**
- Create: `backend/internal/handler/space_handler.go`
- Create: `backend/internal/handler/page_handler.go`
- Create: `backend/internal/handler/user_handler.go`
- Create: `backend/internal/handler/upload_handler.go`
- Create: `backend/internal/service/space_service.go`
- Create: `backend/internal/service/page_service.go`

- [ ] **Step 1: Implement space service** — List spaces (scan docs/), create/delete space (mkdir/rmdir + DB), members CRUD

- [ ] **Step 2: Implement page service** — List page tree, get page (read MD), create page (write MD + DB), update page (write MD), delete page, update metadata

- [ ] **Step 3: Implement space handler** — Wire routes to service

- [ ] **Step 4: Implement page handler** — Wire routes to service, including assets serving for public/ directories

- [ ] **Step 5: Implement user handler** — Admin-only CRUD for users

- [ ] **Step 6: Implement upload handler** — Upload to public/{uuid}/{uuid}/, return relative path

- [ ] **Step 7: Write API tests**

- [ ] **Step 8: Commit**

### Task 2.5: Server main — routing + static file serving

**Files:**
- Create: `backend/cmd/server/main.go`

- [ ] **Step 1: Implement main.go** — Chi router, CORS, mount all handlers, serve frontend static files via embed, SPA fallback

- [ ] **Step 2: Verify server starts and responds**
```bash
go run cmd/server/main.go
curl http://localhost:8080/api/auth/me
```

- [ ] **Step 3: Commit**

---

## Phase 3: React Frontend (Parallel Track B)

### Task 3.1: Frontend foundation — Vite + Tailwind + Router

**Files:**
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles/globals.css`
- Modify: `frontend/vite.config.ts` — add proxy for /api

- [ ] **Step 1: Configure Tailwind CSS** — Import in globals.css, configure Vite plugin

- [ ] **Step 2: Configure Vite proxy** — /api → http://localhost:8080

- [ ] **Step 3: Set up React Router** — Define routes: /login, /s/:slug, /s/:slug/p/:id, /admin

- [ ] **Step 4: Verify dev server works**
```bash
npm run dev
```

- [ ] **Step 5: Commit**

### Task 3.2: API client + Zustand stores

**Files:**
- Create: `frontend/src/api/client.ts` — Axios instance with JWT interceptor
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/spaces.ts`
- Create: `frontend/src/api/pages.ts`
- Create: `frontend/src/api/users.ts`
- Create: `frontend/src/api/upload.ts`
- Create: `frontend/src/stores/authStore.ts`
- Create: `frontend/src/stores/spaceStore.ts`
- Create: `frontend/src/stores/pageStore.ts`

- [ ] **Step 1: Implement API client** — Axios with baseURL, JWT from localStorage, 401 redirect to login

- [ ] **Step 2: Implement auth API + store** — login, logout, me, persist token

- [ ] **Step 3: Implement spaces API + store** — list spaces, current space

- [ ] **Step 4: Implement pages API + store** — page tree, current page content

- [ ] **Step 5: Commit**

### Task 3.3: Auth pages — Login + route guard

**Files:**
- Create: `frontend/src/components/Auth/LoginPage.tsx`
- Create: `frontend/src/components/Auth/ProtectedRoute.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Implement LoginPage** — Username/password form, call login API, redirect to first space

- [ ] **Step 2: Implement ProtectedRoute** — Check auth state, redirect to /login if not authenticated

- [ ] **Step 3: Style login page** — Clean, centered, Notion-like minimal style

- [ ] **Step 4: Commit**

### Task 3.4: App Layout + Sidebar

**Files:**
- Create: `frontend/src/components/Layout/AppLayout.tsx`
- Create: `frontend/src/components/Layout/Sidebar.tsx`
- Create: `frontend/src/components/Sidebar/SpaceSelector.tsx`
- Create: `frontend/src/components/Sidebar/PageTree.tsx`
- Create: `frontend/src/components/Sidebar/PageTreeItem.tsx`
- Create: `frontend/src/components/Sidebar/NewPageButton.tsx`

- [ ] **Step 1: Implement AppLayout** — Left sidebar (collapsible, Notion width ~240px) + right content area

- [ ] **Step 2: Implement SpaceSelector** — Dropdown to switch between spaces

- [ ] **Step 3: Implement PageTree + PageTreeItem** — Recursive tree rendering, expand/collapse, active state highlight

- [ ] **Step 4: Implement NewPageButton** — Create new page in current space

- [ ] **Step 5: Style sidebar** — Notion colors: #f7f6f3 sidebar bg, #37352f text, hover states

- [ ] **Step 6: Commit**

### Task 3.5: Page view + Breadcrumb

**Files:**
- Create: `frontend/src/components/Editor/Breadcrumb.tsx`
- Create: `frontend/src/components/Editor/CoverImage.tsx`
- Create: `frontend/src/components/Editor/PageIcon.tsx`
- Create: `frontend/src/pages/SpacePage.tsx`
- Create: `frontend/src/pages/PageViewPage.tsx`

- [ ] **Step 1: Implement Breadcrumb** — Show space > parent > current page path

- [ ] **Step 2: Implement CoverImage** — Optional cover banner, click to add/upload/change/remove. Default hidden.

- [ ] **Step 3: Implement PageIcon** — Optional emoji picker, click to add/change/remove. Default hidden.

- [ ] **Step 4: Implement PageViewPage** — Assemble: cover + icon + title + editor placeholder

- [ ] **Step 5: Commit**

### Task 3.6: BlockNote Editor Integration

**Files:**
- Create: `frontend/src/components/Editor/PageEditor.tsx`
- Modify: `frontend/package.json` — add @blocknote dependencies

- [ ] **Step 1: Install BlockNote**
```bash
npm install @blocknote/core @blocknote/react
```

- [ ] **Step 2: Implement PageEditor** — Initialize BlockNote with default schema, load content from API, auto-save on change (debounced 2s)

- [ ] **Step 3: Wire save flow** — BlockNote JSON → Markdown → PUT /api/pages/:id

- [ ] **Step 4: Wire load flow** — GET /api/pages/:id → Markdown → BlockNote blocks → editor

- [ ] **Step 5: Test editor works end-to-end** — Type content, save, refresh, content persists

- [ ] **Step 6: Commit**

### Task 3.7: Admin page

**Files:**
- Create: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Implement AdminPage** — User management table (list, create, edit, delete), space member management

- [ ] **Step 2: Commit**

---

## Phase 4: Integration + Polish

### Task 4.1: Go embed frontend + Docker

**Files:**
- Create: `backend/Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Configure Go embed** — Embed frontend/dist/ into Go binary, serve as static files, SPA fallback

- [ ] **Step 2: Create multi-stage Dockerfile** — Stage 1: npm build, Stage 2: go build with embed, Stage 3: minimal runtime

- [ ] **Step 3: Create docker-compose.yml** — Single service with volume mounts for docs/ and data/

- [ ] **Step 4: Test Docker build**
```bash
docker-compose up --build
```

- [ ] **Step 5: Commit**

### Task 4.2: Playwright acceptance tests

**Files:**
- Create: `tests/acceptance/auth.spec.ts`
- Create: `tests/acceptance/space.spec.ts`
- Create: `tests/acceptance/page.spec.ts`
- Create: `tests/acceptance/editor.spec.ts`
- Create: `playwright.config.ts`

- [ ] **Step 1: Install Playwright in project**
```bash
npm init playwright@latest
```

- [ ] **Step 2: Write auth tests** — Login with admin, verify redirect, verify /me returns user

- [ ] **Step 3: Write space tests** — List spaces, create space, verify folder created, delete space

- [ ] **Step 4: Write page tests** — List page tree, create page, verify .md file created, read page content

- [ ] **Step 5: Write editor tests** — Open page, type content, save, refresh, verify content persists

- [ ] **Step 6: Run full test suite**
```bash
npx playwright test
```

- [ ] **Step 7: Commit**

---

## Phase 5: Final Verification

### Task 5.1: End-to-end smoke test

- [ ] **Step 1: Start backend** — `go run cmd/server/main.go`
- [ ] **Step 2: Start frontend dev server** — `npm run dev`
- [ ] **Step 3: Run Playwright tests against running app**
- [ ] **Step 4: Fix any issues found**
- [ ] **Step 5: Take screenshots for verification**
- [ ] **Step 6: Final commit with all changes**

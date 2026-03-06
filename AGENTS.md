# Repository Guidelines

## Project Structure & Module Organization
This repository is a Bun workspace with two apps under `apps/`. `apps/server/src` contains the Bun backend (`server.ts`, review orchestration, Ollama client, SSE handlers). `apps/web/app` contains the Next.js App Router frontend (`page.tsx`, `layout.tsx`, `globals.css`). Root files such as `README.md`, `package.json`, `tsconfig.json`, and the `lfmagent0*.png` screenshots support setup and documentation.

## Build, Test, and Development Commands
Install dependencies once with `bun install`.

- `bun run dev`: starts both apps in workspace dev mode.
- `bun run dev:server`: runs the backend on port `3001`.
- `bun run dev:web`: runs the frontend on port `3002`.
- `bun run build`: builds both workspace apps.
- `bun run start:server`: starts the built backend.
- `bun run start:web`: starts the built frontend.

For a quick smoke check, open `http://localhost:3002` and confirm `http://localhost:3001/health` returns `ok`.

## Coding Style & Naming Conventions
Use TypeScript with strict typing enabled. Keep existing naming patterns: `camelCase` for variables/functions, `PascalCase` for React components and types, and descriptive file names such as `findingConsolidator.ts` or `reviewPrompt.ts`. Favor small modules with one clear responsibility. Use 2-space indentation in new code and match the surrounding file’s semicolon style when editing existing files.

## Testing Guidelines
There is no committed automated test suite yet. Until one is added, validate changes with `bun run build`, targeted manual checks in both apps, and backend endpoint smoke tests. When adding tests, place them beside the feature or under an adjacent `__tests__` folder, and name them `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Recent history uses short, direct commit subjects such as `readme edit`, `more accurate outputs`, and `Markdown/Json support`. Keep commit titles brief, imperative, and focused on one change. Pull requests should include a clear summary, manual verification steps, linked issues when relevant, and screenshots for frontend changes.

## Security & Configuration Tips
The backend expects Ollama to be available locally; document any new environment variables in `README.md`. Do not hardcode secrets. Keep default local URLs aligned with the current setup: frontend `3002`, backend `3001`, Ollama at `http://localhost:11434`.

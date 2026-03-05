# Local Code Review Assistant

A monorepo for local AI-powered code review using Ollama and Next.js.

## Architecture

- **apps/server**: Bun HTTP server that walks codebases and communicates with Ollama
- **apps/web**: Next.js dashboard for viewing code review results

## Prerequisites

- [Bun](https://bun.sh/) installed
- [Ollama](https://ollama.ai/) running locally with `lfm2:latest` model

## Quick Start

```bash
# Install dependencies
bun install

# Run both apps in development mode
bun run dev

# Or run individually
bun run dev:server  # Server on port 3001
bun run dev:web     # Web on port 3000
```

## Structure

```
.
├── apps/
│   ├── server/     # Bun HTTP server (port 3001)
│   └── web/        # Next.js dashboard (port 3000)
├── package.json    # Workspace configuration
└── tsconfig.json   # TypeScript configuration
```

## Technology Stack

- **Server**: Bun, TypeScript, SSE (Server-Sent Events)
- **Web**: Next.js 14, React, TypeScript, Tailwind CSS
- **AI**: Ollama with lfm2:latest model (OpenAI-compatible API)

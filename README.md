# Agent Kanban

A desktop application for managing Claude Code terminal sessions as a visual Kanban board. Jobs flow through **Planning → Development → Done** columns, letting you orchestrate multiple AI coding sessions from a single interface.

## Features

- **Kanban workflow** — Create jobs and watch them progress through planning, development, and completion stages
- **Claude Code integration** — Spawns Claude CLI sessions via `node-pty` with streaming JSON output
- **Project management** — Register directories as projects and manage jobs per project
- **Real-time streaming logs** — View live output from each Claude session
- **Light & dark themes** — System-aware theming with semantic color tokens
- **Persistent state** — Jobs and projects saved locally via `electron-store`

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) v8.7.5+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Getting Started

```bash
# Install dependencies
pnpm install

# Start in development mode (with HMR)
pnpm start
```

## Scripts

| Command            | Description                     |
| ------------------ | ------------------------------- |
| `pnpm start`       | Run in dev mode with hot reload |
| `pnpm run package` | Package the app for distribution |
| `pnpm run make`    | Build distributable (DMG/ZIP)   |

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.ts             # App entry point & window creation
│   ├── session-manager.ts  # Manages Claude CLI sessions
│   ├── claude-session.ts   # Individual session wrapper (node-pty)
│   ├── ipc-handlers.ts     # IPC request/response handlers
│   ├── store.ts            # Persistence via electron-store
│   └── notifications.ts    # System notifications
├── preload/
│   └── preload.ts          # Context bridge (window.electronAPI)
├── renderer/       # React UI
│   ├── App.tsx             # Root component
│   ├── components/         # KanbanBoard, JobCard, JobDetailPanel, etc.
│   ├── hooks/              # Custom React hooks
│   ├── store/              # Zustand state management
│   ├── types/              # Re-exported shared types
│   └── utils/              # Utility functions
└── shared/
    └── types.ts            # Types shared between main & renderer
```

## Tech Stack

- **Electron 34** + Electron Forge + Vite
- **React 19** + TypeScript + Zustand
- **Tailwind CSS 3** with CSS custom properties for theming
- **node-pty** for terminal session management

## License

MIT

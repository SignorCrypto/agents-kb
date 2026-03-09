# Agent Kanban

Electron desktop app for managing Codex sessions as a Kanban board. Jobs flow through **planning → development → done**.

## Commands

```bash
pnpm start       # dev mode with HMR
pnpm run package # package the app
pnpm run make    # build DMG/ZIP
```

## Structure

- `src/main/` — Electron main process (IPC handlers, session management, persistence via electron-store)
- `src/main/job-step-history.ts` — Per-job development step snapshots, stored diff reconstruction, and rollback target planning
- `src/preload/preload.ts` — Context bridge (`window.electronAPI`)
- `src/renderer/` — React UI (Zustand store, components, hooks)
- `src/shared/types.ts` — Shared types used by both processes

## Key Patterns

- **IPC**: `ipcMain.handle`/`ipcRenderer.invoke` for requests; `webContents.send`/`ipcRenderer.on` for push events
- **State**: Zustand with individual selectors — `useKanbanStore((s) => s.field)`
- **Sessions**: `Codex` CLI spawned via `node-pty` with `--output-format stream-json`. Planning uses `--permission-mode plan`, development uses `--dangerously-skip-permissions`
- **Job history**: Git jobs keep lightweight git snapshots for safe fast-path restore, but job details and rollback context come from persisted per-step file snapshots (`stepSnapshots`)
- **Styling**: Tailwind CSS 3 with CSS custom properties in `src/renderer/index.css` for light/dark theming. Semantic color tokens mapped in `tailwind.config.ts`
- **Types**: Shared types in `src/shared/types.ts`, re-exported for renderer via `src/renderer/types/index.ts`
- **Prompts**: Global prompt configs in Settings now cover commit, title, and rollback flows
- **Git cleanup**: App-wide Settings can auto-delete completed jobs for the current project branch after a successful git commit

## To remember

- build and use reusable components for the UI
- use color theme colors, do not hardcode them. If you need another color, add it to the theme as well
- always use frontend design skills when doing UI/UX tasks

## Maintenance

When you add new files, change architecture, introduce new patterns, or modify the build setup, update this file to reflect those changes. Keep it concise.

# Agent Kanban

Electron desktop app for managing Claude Code sessions as a Kanban board. Jobs flow through **planning → development → done**.

## Commands

```bash
pnpm start       # dev mode with HMR
pnpm run package # package the app
pnpm run make    # build DMG/ZIP
```

## Structure

- `src/main/` — Electron main process (IPC handlers, session management, persistence via electron-store)
- `src/preload/preload.ts` — Context bridge (`window.electronAPI`)
- `src/renderer/` — React UI (Zustand store, components, hooks)
- `src/shared/types.ts` — Shared types used by both processes

## Key Patterns

- **IPC**: `ipcMain.handle`/`ipcRenderer.invoke` for requests; `webContents.send`/`ipcRenderer.on` for push events
- **State**: Zustand with individual selectors — `useKanbanStore((s) => s.field)`
- **Sessions**: `claude` CLI spawned via `node-pty` with `--output-format stream-json`. Planning uses `--permission-mode plan`, development uses `--dangerously-skip-permissions`
- **Styling**: Tailwind CSS 3 with CSS custom properties in `src/renderer/index.css` for light/dark theming. Semantic color tokens mapped in `tailwind.config.ts`
- **Types**: Shared types in `src/shared/types.ts`, re-exported for renderer via `src/renderer/types/index.ts`

## Maintenance

When you add new files, change architecture, introduce new patterns, or modify the build setup, update this file to reflect those changes. Keep it concise.

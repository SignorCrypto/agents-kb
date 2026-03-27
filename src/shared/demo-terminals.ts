import type { TerminalTab } from "./types";

/** Fixed IDs so demo main + renderer agree on welcome scripts */
export const DEMO_TERMINAL_TABS: TerminalTab[] = [
  {
    id: "demo-term-agents-main",
    projectId: "demo-proj-agents-kb",
    name: "zsh",
    createdAt: "2026-03-10T10:00:00.000Z",
  },
  {
    id: "demo-term-agents-ci",
    projectId: "demo-proj-agents-kb",
    name: "pnpm test",
    createdAt: "2026-03-10T10:01:00.000Z",
  },
];

const WELCOME: Record<string, string> = {
  "demo-term-agents-main": [
    "Last login: Mon Mar 10 09:42:03 on ttys001",
    "",
    "\x1b[36m~/projects/agents-kb\x1b[0m \x1b[33mdev\x1b[0m",
    "$ git status --short",
    " M src/renderer/index.css",
    " M src/renderer/components/SettingsDialog.tsx",
    "?? src/renderer/hooks/useThemePreference.ts",
    "",
    "$ pnpm run build",
    "",
    "> agents-kb@0.4.0 build",
    "> electron-vite build",
    "",
    "vite v6.2.0 building for production...",
    "✓ 124 modules transformed.",
    "out/main/index.js        48.2 kB",
    "out/renderer/index.html  0.42 kB",
    "✓ built in 2.1s",
    "",
    "$ ",
  ].join("\r\n"),

  "demo-term-agents-ci": [
    "> agents-kb@0.4.0 test /Users/demo/projects/agents-kb",
    "> vitest run",
    "",
    " ✓ src/shared/git-branch.test.ts  (3 tests) 12ms",
    " ✓ src/renderer/store.test.ts  (5 tests) 45ms",
    " ✓ src/main/job-projection.test.ts  (8 tests) 892ms",
    "",
    " Test Files  3 passed (3)",
    "      Tests  16 passed (16)",
    "   Start at  09:18:22",
    "   Duration  1.42s",
    "",
    "$ ",
  ].join("\r\n"),
};

export function getDemoTerminalWelcome(terminalId: string): string {
  const script = WELCOME[terminalId];
  if (script !== undefined) return script;
  return "\x1b[90mDemo mode — this terminal has no scripted output.\x1b[0m\r\n$ ";
}

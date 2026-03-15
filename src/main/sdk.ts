/**
 * Wrapped re-export of the Claude Agent SDK query function.
 *
 * In packaged Electron apps the SDK resolves its cli.js from the asar archive,
 * but the executable lives in app.asar.unpacked. This wrapper transparently
 * injects `pathToClaudeCodeExecutable` so every call site is covered.
 *
 * All main-process code must import `query` from this module (or "./sdk")
 * rather than directly from "@anthropic-ai/claude-agent-sdk".
 * Type-only imports from the SDK are fine.
 */
import fs from "fs";
import path from "path";
import { app } from "electron";
import { query as rawQuery } from "@anthropic-ai/claude-agent-sdk";

let cachedPackagedCliPath: string | undefined;

function getPackagedCliPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  if (cachedPackagedCliPath === undefined) {
    const sdkEntryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkDir = path.dirname(sdkEntryPath);
    const unpackedSdkDir = sdkDir.replace("app.asar", "app.asar.unpacked");
    const cliPath = path.join(unpackedSdkDir, "cli.js");

    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `[claude-sdk] Packaged Claude CLI not found at "${cliPath}". ` +
          `Ensure electron-builder unpacks node_modules/@anthropic-ai/claude-agent-sdk/**.`,
      );
    }

    cachedPackagedCliPath = cliPath;
  }
  return cachedPackagedCliPath;
}

type QueryArgs = Parameters<typeof rawQuery>[0];

export function query(args: QueryArgs): ReturnType<typeof rawQuery> {
  const cliPath = getPackagedCliPath();
  if (cliPath) {
    const opts = { ...(args.options ?? {}) };
    if (!opts.pathToClaudeCodeExecutable) {
      opts.pathToClaudeCodeExecutable = cliPath;
    }
    args = { ...args, options: opts };
  }
  return rawQuery(args);
}

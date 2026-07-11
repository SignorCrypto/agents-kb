/**
 * Wrapped re-export of the Claude Agent SDK query function.
 *
 * In packaged Electron apps the SDK may resolve its bundled Claude executable
 * from the asar archive, but executables must live in app.asar.unpacked. This
 * wrapper transparently injects `pathToClaudeCodeExecutable` so every call site
 * is covered.
 *
 * All main-process code must import `query` from this module (or "./sdk")
 * rather than directly from "@anthropic-ai/claude-agent-sdk".
 * Type-only imports from the SDK are fine.
 */
import fs from "fs";
import path from "path";
import { app } from "electron";
import { query as rawQuery } from "@anthropic-ai/claude-agent-sdk";

let cachedPackagedExecutablePath: string | null | undefined;

function getPlatformBinarySpecifiers(): string[] {
  const suffix = process.platform === "win32" ? "/claude.exe" : "/claude";
  const arch = process.arch;

  if (process.platform === "linux") {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl${suffix}`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}${suffix}`,
    ];
  }

  return [`@anthropic-ai/claude-agent-sdk-${process.platform}-${arch}${suffix}`];
}

function resolveUnpackedPath(specifier: string): string | undefined {
  try {
    const resolved = require.resolve(specifier);
    const unpacked = resolved.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) return unpacked;
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    // Optional platform packages are only installed for the current target.
  }
  return undefined;
}

function getPackagedExecutablePath(): string | undefined {
  if (!app.isPackaged) return undefined;
  if (cachedPackagedExecutablePath === undefined) {
    for (const specifier of getPlatformBinarySpecifiers()) {
      const binaryPath = resolveUnpackedPath(specifier);
      if (binaryPath) {
        cachedPackagedExecutablePath = binaryPath;
        return binaryPath;
      }
    }

    const sdkEntryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkDir = path.dirname(sdkEntryPath);
    const unpackedSdkDir = sdkDir.replace("app.asar", "app.asar.unpacked");
    const cliPath = path.join(unpackedSdkDir, "cli.js");

    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `[claude-sdk] Packaged Claude executable not found. ` +
          `Ensure electron-builder unpacks node_modules/@anthropic-ai/claude-agent-sdk*/**.`,
      );
    }

    cachedPackagedExecutablePath = cliPath;
  }
  return cachedPackagedExecutablePath ?? undefined;
}

type QueryArgs = Parameters<typeof rawQuery>[0];
type QueryOptions = NonNullable<QueryArgs["options"]>;

function withPackagedCliPath<T extends Record<string, unknown>>(options: T): T {
  const executablePath = getPackagedExecutablePath();
  if (!executablePath || options.pathToClaudeCodeExecutable) {
    return options;
  }
  return { ...options, pathToClaudeCodeExecutable: executablePath };
}

export function withProjectScopedClaudeCodeOptions<T extends Record<string, unknown>>(options: T): T {
  return withPackagedCliPath({
    ...options,
    systemPrompt: options.systemPrompt ?? { type: "preset", preset: "claude_code" },
  });
}

export function query(args: QueryArgs): ReturnType<typeof rawQuery> {
  const opts = withPackagedCliPath({ ...((args.options ?? {}) as QueryOptions) });
  args = { ...args, options: opts };
  return rawQuery(args);
}

/**
 * Fetch the list of supported models from the SDK without starting a real session.
 * Spawns a lightweight query, grabs initializationResult (or supportedModels),
 * and immediately closes it.
 */
export async function fetchSupportedModels(): Promise<
  {
    value: string;
    displayName: string;
    description: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: string[];
    supportsAdaptiveThinking?: boolean;
  }[]
> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const q = query({ prompt: "", options: { maxTurns: 0, env } });
  try {
    const initResult = await q.initializationResult();
    if (initResult?.models?.length) {
      return initResult.models;
    }
    // Fallback to dedicated method
    const models = await q.supportedModels();
    return models ?? [];
  } finally {
    q.close();
  }
}

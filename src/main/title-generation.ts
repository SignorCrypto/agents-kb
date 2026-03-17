import { query } from "./sdk";
import type { EffortLevel, ModelChoice } from "../shared/types";

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A very short task title (3-8 words), no quotes or punctuation at the end" },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

interface TitleQueryResult {
  title: string;
}

export interface TitleGenerationRequest {
  jobId: string;
  prompt: string;
  model: ModelChoice;
  effort?: EffortLevel;
  followUpIndex?: number;
  onSuccess: (title: string) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

interface QueuedTitleRequest extends TitleGenerationRequest {
  canceled: boolean;
}

export async function runClaudeTitleQuery(
  prompt: string,
  options: { model: ModelChoice; effort?: EffortLevel },
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkOptions: Record<string, any> = {
    outputFormat: { type: "json_schema", schema: TITLE_SCHEMA },
    model: options.model,
  };

  if (options.effort) {
    sdkOptions.effort = options.effort;
  } else {
    sdkOptions.thinking = { type: "disabled" };
  }

  for await (const msg of query({
    prompt,
    options: sdkOptions,
  })) {
    const m = msg as {
      type?: string;
      subtype?: string;
      structured_output?: TitleQueryResult | null;
      result?: string;
    };

    if (m.type !== "result") continue;

    if (m.subtype === "success") {
      const structuredTitle = m.structured_output?.title?.trim();
      if (structuredTitle) return structuredTitle;

      const text = m.result?.trim();
      if (text) {
        try {
          const parsed = JSON.parse(text) as TitleQueryResult;
          const parsedTitle = parsed.title?.trim();
          if (parsedTitle) return parsedTitle;
        } catch {
          return null;
        }
      }
      return null;
    }

    if (m.subtype?.startsWith("error")) {
      throw new Error(`Claude query failed: ${m.result || m.subtype}`);
    }
  }

  return null;
}

export class TitleGenerationQueue {
  private pending: QueuedTitleRequest[] = [];
  private active: QueuedTitleRequest | null = null;

  enqueue(request: TitleGenerationRequest): void {
    const queued: QueuedTitleRequest = {
      ...request,
      canceled: false,
    };

    this.cancel(request.jobId, request.followUpIndex);
    this.pending.push(queued);
    void this.drain();
  }

  cancel(jobId: string, followUpIndex?: number): void {
    this.pending = this.pending.filter((request) => {
      const matchesJob = request.jobId === jobId;
      const matchesFollowUp = followUpIndex === undefined || request.followUpIndex === followUpIndex;
      const shouldCancel = matchesJob && matchesFollowUp;
      if (shouldCancel) {
        request.canceled = true;
      }
      return !shouldCancel;
    });

    if (this.active) {
      const matchesJob = this.active.jobId === jobId;
      const matchesFollowUp = followUpIndex === undefined || this.active.followUpIndex === followUpIndex;
      if (matchesJob && matchesFollowUp) {
        this.active.canceled = true;
      }
    }
  }

  private async drain(): Promise<void> {
    if (this.active) return;

    let next = this.pending.shift();
    while (next && next.canceled) {
      next = this.pending.shift();
    }
    if (!next) return;

    this.active = next;

    try {
      const title = await runClaudeTitleQuery(next.prompt, {
        model: next.model,
        effort: next.effort,
      });

      if (!next.canceled && title) {
        await next.onSuccess(title);
      }
    } catch (error) {
      if (!next.canceled) {
        await next.onError?.(error);
      }
    } finally {
      if (this.active === next) {
        this.active = null;
      }
      void this.drain();
    }
  }
}

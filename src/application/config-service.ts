import { z } from "zod";
import type { ConfigUpdate, ConfigView } from "../shared/api.js";
import { configLimits, type ModelConfig } from "../domain/model.js";
import type { ConfigStore } from "../infrastructure/persistence/config-store.js";
import type { AppEvents } from "./events.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const bounded = ([min, max]: readonly [number, number]) =>
  z.number().int().min(min).max(max).optional();

export const configUpdateSchema = z.object({
  baseUrl: z
    .url({ protocol: /^https?$/, error: "Invalid model URL" })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, "Invalid model URL")
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" || LOCAL_HOSTS.includes(url.hostname);
    }, "Remote model endpoints must use HTTPS"),
  model: z.string().trim(),
  apiKey: z.string().optional(),
  concurrency: bounded(configLimits.concurrency),
  maxFilesPerTopic: bounded(configLimits.maxFilesPerTopic),
  timeoutMs: bounded(configLimits.timeoutMs),
}) satisfies z.ZodType<ConfigUpdate>;

export class ConfigService {
  constructor(
    private store: ConfigStore,
    private events: AppEvents,
  ) {}
  /** The API key is write-only: it is never returned to clients. */
  view(): ConfigView {
    const { apiKey, ...rest } = this.store.get();
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }
  update(input: unknown) {
    const update = configUpdateSchema.parse(input);
    const next: ModelConfig = { ...this.store.get() };
    for (const [key, value] of Object.entries(update))
      if (value !== undefined) (next as any)[key] = value;
    this.store.save(next);
    this.events.changed("config");
  }
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ConfigUpdate,
  ConfigView,
  ModelDiscovery,
  ModelTest,
  ProviderCreated,
  ProviderInput,
} from "../shared/api.js";
import { badRequest, notFound } from "../domain/errors.js";
import {
  configLimits,
  connectionOf,
  resolveModel,
  type Provider,
  type Settings,
} from "../domain/model.js";
import { completeText, listModels } from "../infrastructure/llm/client.js";
import type { ConfigStore } from "../infrastructure/persistence/config-store.js";
import type { AppEvents } from "./events.js";

const bounded = ([min, max]: readonly [number, number]) =>
  z.number().int().min(min).max(max).optional();

// Plain HTTP is allowed (local proxies, intranet gateways); the settings page warns about it.
const baseUrl = z
  .url({ protocol: /^https?$/, error: "Invalid model URL" })
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, "Invalid model URL");

const modelId = z.string().trim().min(1).max(200);

export const configUpdateSchema = z.object({
  active: z
    .object({ provider: z.string(), model: modelId })
    .nullable()
    .optional(),
  concurrency: bounded(configLimits.concurrency),
  maxFilesPerTopic: bounded(configLimits.maxFilesPerTopic),
  timeoutMs: bounded(configLimits.timeoutMs),
}) satisfies z.ZodType<ConfigUpdate>;

export const providerSchema = z.object({
  name: z.string().trim().min(1, "请填写名称").max(40).optional(),
  enabled: z.boolean().optional(),
  format: z.enum(["openai-chat", "anthropic-messages"]).optional(),
  baseUrl: baseUrl.optional(),
  apiKey: z.string().max(1000).optional(),
  models: z
    .array(z.object({ id: modelId, enabled: z.boolean() }))
    .max(500)
    .refine(
      (models) => new Set(models.map((m) => m.id)).size === models.length,
      "模型重复",
    )
    .optional(),
}) satisfies z.ZodType<ProviderInput>;

const testSchema = z.object({ model: modelId });

export class ConfigService {
  constructor(
    private store: ConfigStore,
    private events: AppEvents,
  ) {}

  /** API keys are write-only: they are never returned to clients. */
  view(): ConfigView {
    const s = this.store.settings();
    return {
      providers: s.providers.map(({ apiKey, ...p }) => ({
        ...p,
        hasApiKey: Boolean(apiKey),
      })),
      active: s.active,
      model: resolveModel(s).model,
      concurrency: s.concurrency,
      maxFilesPerTopic: s.maxFilesPerTopic,
      timeoutMs: s.timeoutMs,
    };
  }

  update(input: unknown) {
    const update = configUpdateSchema.parse(input);
    const s = this.store.settings();
    if (update.active) {
      const p = this.provider(s, update.active.provider);
      if (!p.models.some((m) => m.id === update.active!.model))
        throw badRequest("该供应商下没有这个模型");
    }
    for (const [key, value] of Object.entries(update))
      if (value !== undefined) (s as any)[key] = value;
    this.save(s);
  }

  createProvider(input: unknown): ProviderCreated {
    const v = providerSchema.parse(input);
    if (!v.name || !v.baseUrl) throw badRequest("请填写名称和 Base URL");
    const s = this.store.settings();
    const p: Provider = {
      id: randomUUID(),
      name: v.name,
      enabled: v.enabled ?? true,
      format: v.format ?? "openai-chat",
      baseUrl: v.baseUrl,
      apiKey: v.apiKey ?? "",
      models: v.models ?? [],
    };
    s.providers.push(p);
    this.save(s);
    return { id: p.id };
  }

  updateProvider(id: string, input: unknown) {
    const v = providerSchema.parse(input);
    const s = this.store.settings();
    const p = this.provider(s, id);
    for (const [key, value] of Object.entries(v))
      if (value !== undefined) (p as any)[key] = value;
    // The active model was removed from the list: nothing is selected any more.
    if (
      s.active?.provider === id &&
      !p.models.some((m) => m.id === s.active!.model)
    )
      s.active = null;
    this.save(s);
  }

  removeProvider(id: string) {
    const s = this.store.settings();
    this.provider(s, id);
    s.providers = s.providers.filter((p) => p.id !== id);
    if (s.active?.provider === id) s.active = null;
    this.save(s);
  }

  /** Sends a tiny prompt with the saved credentials; errors never include response bodies. */
  async test(id: string, input: unknown): Promise<ModelTest> {
    const { model } = testSchema.parse(input);
    const s = this.store.settings();
    const conn = connectionOf(
      this.provider(s, id),
      model,
      Math.min(s.timeoutMs, 30000),
    );
    const start = Date.now();
    try {
      // Any text proves the connection; whether a model follows JSON instructions shows up in real jobs.
      await completeText(conn, [
        { role: "system", content: "这是连接测试，回复 ok 即可。" },
        { role: "user", content: "ping" },
      ]);
      return { ok: true, ms: Date.now() - start, error: null };
    } catch (e) {
      return { ok: false, ms: Date.now() - start, error: (e as Error).message };
    }
  }

  async discover(id: string): Promise<ModelDiscovery> {
    const s = this.store.settings();
    const conn = connectionOf(this.provider(s, id), "", 15000);
    try {
      return { models: await listModels(conn) };
    } catch (e) {
      throw badRequest(`获取模型列表失败：${(e as Error).message}`);
    }
  }

  private provider(s: Settings, id: string) {
    const p = s.providers.find((p) => p.id === id);
    if (!p) throw notFound("供应商不存在");
    return p;
  }

  private save(s: Settings) {
    this.store.save(s);
    this.events.changed("config");
  }
}

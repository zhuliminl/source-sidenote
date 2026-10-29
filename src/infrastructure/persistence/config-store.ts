import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  defaultSettings,
  resolveModel,
  type ModelConfig,
  type Provider,
  type Settings,
} from "../../domain/model.js";

/** Reads config.json, upgrading the single-model layout used before providers existed. */
function load(stored: any): Settings {
  const settings: Settings = structuredClone(defaultSettings);
  for (const key of ["concurrency", "maxFilesPerTopic", "timeoutMs"] as const)
    if (typeof stored[key] === "number") settings[key] = stored[key];
  if (Array.isArray(stored.providers)) {
    settings.providers = stored.providers as Provider[];
    settings.active = stored.active ?? null;
  } else if (typeof stored.baseUrl === "string" && stored.baseUrl) {
    const id = randomUUID();
    const model = typeof stored.model === "string" ? stored.model : "";
    let name = "默认";
    try {
      name = new URL(stored.baseUrl).host;
    } catch {}
    settings.providers = [
      {
        id,
        name,
        enabled: true,
        format: "openai-chat",
        baseUrl: stored.baseUrl,
        apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
        models: model ? [{ id: model, enabled: true }] : [],
      },
    ];
    settings.active = model ? { provider: id, model } : null;
  }
  return settings;
}

/** File-backed settings (0600). This process is the only writer, so reads are cached. */
export class ConfigStore {
  private path: string;
  private cached?: Settings;
  constructor(home: string) {
    this.path = join(home, "config.json");
  }
  settings(): Settings {
    if (!this.cached) {
      try {
        this.cached = load(JSON.parse(readFileSync(this.path, "utf8")));
      } catch {
        this.cached = structuredClone(defaultSettings);
      }
    }
    return structuredClone(this.cached);
  }
  /** The active model as jobs use it. */
  get(): ModelConfig {
    return resolveModel(this.settings());
  }
  save(settings: Settings) {
    writeFileSync(this.path + ".tmp", JSON.stringify(settings, null, 2), {
      mode: 0o600,
    });
    renameSync(this.path + ".tmp", this.path);
    this.cached = structuredClone(settings);
  }
}

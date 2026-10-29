import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig, type ModelConfig } from "../../domain/model.js";

/** File-backed model config (0600). This process is the only writer, so reads are cached. */
export class ConfigStore {
  private path: string;
  private cached?: ModelConfig;
  constructor(home: string) {
    this.path = join(home, "config.json");
  }
  get(): ModelConfig {
    if (!this.cached) {
      try {
        const stored = JSON.parse(readFileSync(this.path, "utf8"));
        // Keep only known keys so settings retired by upgrades do not leak into views.
        this.cached = { ...defaultConfig };
        for (const key of Object.keys(defaultConfig) as (keyof ModelConfig)[])
          if (stored[key] !== undefined)
            (this.cached as any)[key] = stored[key];
      } catch {
        this.cached = { ...defaultConfig };
      }
    }
    return { ...this.cached! };
  }
  save(config: ModelConfig) {
    writeFileSync(this.path + ".tmp", JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    renameSync(this.path + ".tmp", this.path);
    this.cached = { ...config };
  }
}

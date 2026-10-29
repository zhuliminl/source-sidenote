import { Link } from "react-router";
import type { ActiveModel, ConfigView } from "@shared/api";
import { useConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";

const SEP = "\u0000";
const key = (m: ActiveModel) => `${m.provider}${SEP}${m.model}`;

/** Whether a choice points at an enabled model of an enabled provider. */
export function usable(config: ConfigView, m: ActiveModel | null) {
  const p = m && config.providers.find((p) => p.id === m.provider);
  return Boolean(
    p?.enabled && p.models.some((x) => x.id === m!.model && x.enabled),
  );
}

/** Picks a model grouped by provider; only enabled models are offered. */
export function ModelSelect({
  value,
  onChange,
  id,
  className,
}: {
  value: ActiveModel | null;
  onChange: (m: ActiveModel) => void;
  id?: string;
  className?: string;
}) {
  const config = useConfig();
  const providers = (config.data?.providers ?? []).filter(
    (p) => p.enabled && p.models.some((m) => m.enabled),
  );
  if (config.data && !providers.length)
    return (
      <p className="text-sm text-muted-foreground">
        还没有可用的模型，
        <Link to="/settings/models" className="underline underline-offset-4">
          去设置里添加
        </Link>
        。
      </p>
    );
  const broken = value && config.data && !usable(config.data, value);
  return (
    <select
      id={id}
      value={value ? key(value) : ""}
      onChange={(e) => {
        const [provider, model] = e.target.value.split(SEP);
        onChange({ provider, model });
      }}
      className={cn(
        "h-9 w-full rounded-lg border bg-transparent px-3 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30",
        className,
      )}
    >
      {!value && <option value="">选择模型</option>}
      {broken && (
        <option value={key(value)} disabled>
          {value.model}（已关闭或被删除）
        </option>
      )}
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.models
            .filter((m) => m.enabled)
            .map((m) => (
              <option key={m.id} value={key({ provider: p.id, model: m.id })}>
                {m.id}
                {config.data?.active?.provider === p.id &&
                config.data.active.model === m.id
                  ? "（默认）"
                  : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import {
  Boxes,
  Gauge,
  Loader2,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { ConfigView } from "@shared/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { ModelSettings } from "./model-settings";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { useConfig, useSaveConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "models", label: "模型", icon: Boxes },
  { id: "generation", label: "生成偏好", icon: Gauge },
] as const;

export type SettingsTab = (typeof tabs)[number]["id"];

/** Settings as a page; the tab lives in the URL (/settings/models) so it can be linked to. */
export function SettingsPage() {
  const { tab: param } = useParams();
  const tab: SettingsTab = tabs.find((t) => t.id === param)?.id ?? "general";
  return (
    <>
      <PageHeader>
        <h1 className="px-2.5 text-lg font-medium">设置</h1>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <nav
            aria-label="设置分类"
            className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto bg-background px-1 pt-1 pb-4"
          >
            {tabs.map((t) => (
              <NavLink
                key={t.id}
                to={`/settings/${t.id}`}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  tab === t.id && "bg-accent text-foreground",
                )}
              >
                <t.icon className="size-4" />
                {t.label}
              </NavLink>
            ))}
          </nav>
          {tab === "general" ? (
            <section className="max-w-2xl">
              <GeneralSettings />
            </section>
          ) : tab === "models" ? (
            <ModelSettings />
          ) : (
            <section className="max-w-2xl">
              <ConfigForm />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function GeneralSettings() {
  const { preference, setPreference } = useTheme();
  const options: [ThemePreference, string, typeof Sun][] = [
    ["system", "跟随系统", Monitor],
    ["light", "浅色", Sun],
    ["dark", "深色", Moon],
  ];
  return (
    <Row label="外观">
      <div className="flex rounded-full bg-muted p-0.5">
        {options.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            aria-pressed={preference === value}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors",
              preference === value && "bg-background text-foreground shadow-sm",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </Row>
  );
}

type Draft = Pick<ConfigView, "concurrency" | "maxFilesPerTopic" | "timeoutMs">;

function ConfigForm() {
  const config = useConfig();
  const save = useSaveConfig();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (config.data && !draft) {
      const { concurrency, maxFilesPerTopic, timeoutMs } = config.data;
      setDraft({ concurrency, maxFilesPerTopic, timeoutMs });
    }
  }, [config.data, draft]);

  if (!draft)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-subtle-foreground" />
      </div>
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(draft);
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <Row label="并发请求" hint="同时进行的模型请求，1–4">
        <NumberField
          value={draft.concurrency}
          min={1}
          max={4}
          onChange={(v) => set("concurrency", v)}
        />
      </Row>
      <Row label="每个主题的文件上限" hint="规划时 AI 最多挑选的文件数，1–60">
        <NumberField
          value={draft.maxFilesPerTopic}
          min={1}
          max={60}
          onChange={(v) => set("maxFilesPerTopic", v)}
        />
      </Row>
      <Row label="请求超时" hint="毫秒，1,000–180,000">
        <NumberField
          value={draft.timeoutMs}
          min={1000}
          max={180000}
          step={1000}
          onChange={(v) => set("timeoutMs", v)}
        />
      </Row>
      <p className="mt-5 text-xs leading-5 text-subtle-foreground">
        这些是请求范围限制，不是费用预算保证。
      </p>
      <div className="mt-auto flex justify-end pt-8">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          保存
        </Button>
      </div>
    </form>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b py-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && (
          <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>
        )}
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

function NumberField({
  value,
  onChange,
  ...props
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Input
      type="number"
      required
      value={value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      className="h-9 rounded-lg bg-transparent tabular-nums"
      {...props}
    />
  );
}

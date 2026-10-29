import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Gauge,
  Loader2,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { ConfigView } from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SettingsTab } from "@/components/layout/ui-state";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { useConfig, useSaveConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tabs: { id: SettingsTab; label: string; icon: typeof Gauge }[] = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "generation", label: "生成偏好", icon: Gauge },
];

export function SettingsDialog({
  tab,
  onTabChange,
  onOpenChange,
}: {
  tab: SettingsTab | null;
  onTabChange: (tab: SettingsTab) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={tab !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <DialogTitle className="border-b px-6 py-4 text-lg font-medium">
          设置
        </DialogTitle>
        <DialogDescription className="sr-only">
          外观与生成偏好
        </DialogDescription>
        <div className="flex min-h-[420px] max-sm:flex-col">
          <nav className="flex shrink-0 gap-0.5 p-2 sm:w-44 sm:flex-col max-sm:border-b">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent",
                  tab === t.id && "bg-accent",
                )}
              >
                <t.icon className="size-4 text-muted-foreground" />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 px-6 pb-6">
            {tab === "general" ? <GeneralSettings /> : tab && <ConfigForm />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        这些是请求范围限制，不是费用预算保证。模型供应商在左侧栏“模型”页管理。
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

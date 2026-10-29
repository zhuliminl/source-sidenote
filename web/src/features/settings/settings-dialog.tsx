import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Gauge,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Plug,
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

const tabs: { id: SettingsTab; label: string; icon: typeof Plug }[] = [
  { id: "general", label: "常规", icon: SlidersHorizontal },
  { id: "model", label: "模型连接", icon: Plug },
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
          外观、模型连接与生成偏好
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
            {tab === "general" ? (
              <GeneralSettings />
            ) : (
              tab && <ConfigForm tab={tab} />
            )}
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

type Draft = Omit<ConfigView, "hasApiKey"> & { apiKey: string };

/** One form for both config tabs so switching tabs keeps unsaved edits. */
function ConfigForm({ tab }: { tab: Exclude<SettingsTab, "general"> }) {
  const config = useConfig();
  const save = useSaveConfig();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (config.data && !draft) {
      const { hasApiKey: _, ...rest } = config.data;
      setDraft({ ...rest, apiKey: "" });
    }
  }, [config.data, draft]);

  if (!draft || !config.data)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-subtle-foreground" />
      </div>
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { apiKey, ...rest } = draft;
    // An empty key field means "keep the stored key".
    save.mutate(apiKey ? { ...rest, apiKey } : rest, {
      onSuccess: () => set("apiKey", ""),
    });
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className={cn(tab !== "model" && "hidden")}>
        <Row label="接口地址" hint="OpenAI Chat Completions 兼容接口">
          <Field
            type="url"
            required
            value={draft.baseUrl}
            onChange={(v) => set("baseUrl", v)}
            placeholder="https://api.example.com/v1"
          />
        </Row>
        <Row label="模型" hint="服务商提供的模型 ID">
          <Field
            required
            value={draft.model}
            onChange={(v) => set("model", v)}
            placeholder="例如 gpt-5.5-mini"
          />
        </Row>
        <Row
          label="API 密钥"
          hint={
            config.data.hasApiKey ? "已保存，留空则保持不变" : "本地模型可留空"
          }
        >
          <Field
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            onChange={(v) => set("apiKey", v)}
            placeholder={config.data.hasApiKey ? "••••••••" : "sk-…"}
          />
        </Row>
        <p className="mt-5 flex gap-2 text-xs leading-5 text-subtle-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          密钥以 0600
          权限保存在本机配置文件中，不会回传浏览器。使用云端模型时，纳入范围的代码会发送给对应服务商。
        </p>
      </div>
      <div className={cn(tab !== "generation" && "hidden")}>
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
      </div>
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

function Field({
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange"> & {
  onChange: (v: string) => void;
}) {
  return (
    <Input
      {...props}
      spellCheck={false}
      autoComplete={props.autoComplete ?? "off"}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg bg-transparent"
    />
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

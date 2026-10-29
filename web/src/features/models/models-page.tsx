import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  Ellipsis,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ApiFormat,
  ConfigView,
  ModelTest,
  ProviderView,
} from "@shared/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useConfig,
  useCreateProvider,
  useDiscoverModels,
  useRemoveProvider,
  useSaveConfig,
  useTestModel,
  useUpdateProvider,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const formats: { value: ApiFormat; label: string; hint: string }[] = [
  {
    value: "openai-chat",
    label: "Chat Completions (/chat/completions)",
    hint: "Base URL 含版本，如 https://api.openai.com/v1",
  },
  {
    value: "anthropic-messages",
    label: "Anthropic Messages (/v1/messages)",
    hint: "Base URL 不含 /v1，如 https://api.anthropic.com",
  },
];

/** Starting points for the add dialog; every field stays editable. */
const presets: { name: string; format: ApiFormat; baseUrl: string }[] = [
  {
    name: "OpenAI",
    format: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    name: "Anthropic",
    format: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
  },
  {
    name: "DeepSeek",
    format: "openai-chat",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    name: "智谱 BigModel",
    format: "openai-chat",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    name: "本地代理",
    format: "openai-chat",
    baseUrl: "http://127.0.0.1:8399/v1",
  },
];

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Remote plain-HTTP endpoints see the key and the source code unencrypted. */
function plaintext(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && !LOCAL_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function ModelsPage() {
  const config = useConfig();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const providers = config.data?.providers ?? [];
  const current =
    providers.find((p) => p.id === selected) ??
    providers.find((p) => p.id === config.data?.active?.provider) ??
    providers[0];

  return (
    <>
      <PageHeader>
        <h1 className="px-2.5 text-lg font-medium">模型</h1>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl px-4 pt-2 pb-16 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[15px] leading-7 text-muted-foreground">
              可以配置多个供应商和模型，选其中一个用来生成说明。
            </p>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              添加供应商
            </Button>
          </div>

          {config.data ? (
            <>
              <ActiveBanner config={config.data} />
              {providers.length ? (
                <div className="mt-4 flex overflow-hidden rounded-2xl border bg-card max-md:flex-col">
                  <ProviderList
                    providers={providers}
                    config={config.data}
                    current={current?.id}
                    onSelect={setSelected}
                  />
                  {current && (
                    <ProviderDetail
                      key={current.id}
                      provider={current}
                      config={config.data}
                    />
                  )}
                </div>
              ) : (
                <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
                  <Boxes className="size-6 text-subtle-foreground" />
                  <p className="text-sm text-muted-foreground">
                    还没有模型供应商。添加一个兼容 OpenAI 或 Anthropic
                    接口的服务即可开始。
                  </p>
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus />
                    添加供应商
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Skeleton className="mt-4 h-96 rounded-2xl" />
          )}
        </div>
      </div>
      <AddProviderDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={setSelected}
      />
    </>
  );
}

function ActiveBanner({ config }: { config: ConfigView }) {
  const provider = config.providers.find(
    (p) => p.id === config.active?.provider,
  );
  const ok = Boolean(config.model && provider);
  return (
    <div
      className={cn(
        "mt-4 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm",
        ok ? "bg-muted" : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      {ok ? (
        <>
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
          正在使用
          <span className="font-medium">{provider!.name}</span>
          <span className="text-subtle-foreground">/</span>
          <span className="truncate font-mono text-[13px]">{config.model}</span>
        </>
      ) : (
        <>
          <AlertTriangle className="size-4 shrink-0" />
          {config.active
            ? "当前选择的模型已关闭或被移除，生成任务已暂停。请重新选择一个模型。"
            : "还没有选择模型：在模型列表里点“使用”。"}
        </>
      )}
    </div>
  );
}

function ProviderList({
  providers,
  config,
  current,
  onSelect,
}: {
  providers: ProviderView[];
  config: ConfigView;
  current: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      aria-label="供应商"
      className="flex shrink-0 gap-1 border-r p-2 md:w-60 md:flex-col max-md:overflow-x-auto max-md:border-r-0 max-md:border-b"
    >
      {providers.map((p) => {
        const enabled = p.models.filter((m) => m.enabled).length;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-current={p.id === current ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
              p.id === current && "bg-accent",
            )}
          >
            <span
              title={p.enabled ? "已启用" : "已关闭"}
              className={cn(
                "size-2 shrink-0 rounded-full",
                p.enabled && enabled
                  ? "bg-emerald-500"
                  : "border border-subtle-foreground/60",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {config.active?.provider === p.id ? (
              <span className="rounded-full bg-foreground px-1.5 py-px text-[10px] text-background">
                使用中
              </span>
            ) : (
              <span className="text-xs text-subtle-foreground tabular-nums">
                {enabled}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function ProviderDetail({
  provider,
  config,
}: {
  provider: ProviderView;
  config: ConfigView;
}) {
  const update = useUpdateProvider();
  const remove = useRemoveProvider();
  const [name, setName] = useState(provider.name);
  const [conn, setConn] = useState({
    format: provider.format,
    baseUrl: provider.baseUrl,
    apiKey: "",
  });
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    conn.format !== provider.format ||
    conn.baseUrl !== provider.baseUrl ||
    conn.apiKey !== "";

  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(provider.name);
    if (next !== provider.name) update.mutate({ id: provider.id, name: next });
  };
  const saveConnection = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      {
        id: provider.id,
        format: conn.format,
        baseUrl: conn.baseUrl.trim(),
        ...(conn.apiKey ? { apiKey: conn.apiKey } : {}),
      },
      {
        onSuccess: () => {
          setConn((c) => ({ ...c, apiKey: "" }));
          toast("连接已保存");
        },
      },
    );
  };

  return (
    <section className="min-w-0 flex-1 p-5 sm:p-6">
      <header className="flex items-center gap-2">
        <Input
          aria-label="供应商名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={40}
          className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 text-base font-medium shadow-none hover:border-input focus-visible:border-input"
        />
        <Switch
          checked={provider.enabled}
          onCheckedChange={(enabled) =>
            update.mutate({ id: provider.id, enabled })
          }
          aria-label="启用供应商"
          title={provider.enabled ? "已启用" : "已关闭"}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="更多操作"
              className="text-muted-foreground"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 />
              删除供应商
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <form onSubmit={saveConnection} className="mt-4 space-y-4">
        <Field
          label="API 格式"
          hint={formats.find((f) => f.value === conn.format)?.hint}
        >
          <select
            value={conn.format}
            onChange={(e) =>
              setConn({ ...conn, format: e.target.value as ApiFormat })
            }
            className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
          >
            {formats.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL">
          <Input
            type="url"
            required
            value={conn.baseUrl}
            onChange={(e) => setConn({ ...conn, baseUrl: e.target.value })}
            spellCheck={false}
            className="h-9 rounded-lg bg-transparent font-mono text-[13px]"
          />
          {plaintext(conn.baseUrl) && <PlaintextWarning />}
        </Field>
        <Field
          label="API Key"
          hint={
            provider.hasApiKey ? "已保存，留空则保持不变" : "本地模型可留空"
          }
        >
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              autoComplete="new-password"
              value={conn.apiKey}
              onChange={(e) => setConn({ ...conn, apiKey: e.target.value })}
              placeholder={provider.hasApiKey ? "••••••••••••" : "sk-…"}
              spellCheck={false}
              className="h-9 rounded-lg bg-transparent pr-9 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? "隐藏" : "显示"}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-subtle-foreground hover:text-foreground"
            >
              {showKey ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </Field>
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setConn({
                  format: provider.format,
                  baseUrl: provider.baseUrl,
                  apiKey: "",
                })
              }
            >
              还原
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />}
              保存连接
            </Button>
          </div>
        )}
      </form>

      <ModelList provider={provider} config={config} connectionDirty={dirty} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{provider.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              会删除它的连接信息、API Key 和模型列表。已生成的说明不受影响
              {config.active?.provider === provider.id &&
                "；它是当前使用的供应商，删除后生成任务会暂停，直到你选择新的模型"}
              。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-white hover:bg-destructive/90"
              onClick={() => remove.mutate(provider.id)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ModelList({
  provider,
  config,
  connectionDirty,
}: {
  provider: ProviderView;
  config: ConfigView;
  connectionDirty: boolean;
}) {
  const update = useUpdateProvider();
  const discover = useDiscoverModels();
  const [draft, setDraft] = useState<string | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const known = new Set(provider.models.map((m) => m.id));

  const setModels = (models: ProviderView["models"]) =>
    update.mutate({ id: provider.id, models });
  const add = (ids: string[]) =>
    setModels([
      ...provider.models,
      ...ids
        .filter((id) => !known.has(id))
        .map((id) => ({ id, enabled: true })),
    ]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ids = (draft ?? "")
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length) add(ids);
    setDraft(null);
  };

  return (
    <div className="mt-7">
      <div className="flex items-center gap-1.5">
        <h2 className="flex-1 text-sm font-medium">
          模型列表
          <span className="ml-1.5 font-normal text-subtle-foreground tabular-nums">
            {provider.models.length}
          </span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={discover.isPending || connectionDirty}
          title={connectionDirty ? "先保存连接" : "从供应商的 /models 接口获取"}
          onClick={() =>
            discover.mutate(provider.id, {
              onSuccess: (r) => setFound(r.models),
            })
          }
        >
          {discover.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          获取模型
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDraft("")}>
          <Plus />
          添加模型
        </Button>
      </div>

      {draft !== null && (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
            placeholder="模型 ID，多个用空格或逗号分隔"
            spellCheck={false}
            className="h-9 rounded-lg bg-transparent font-mono text-[13px]"
          />
          <Button type="submit" size="sm" className="h-9">
            添加
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="取消"
            onClick={() => setDraft(null)}
          >
            <X />
          </Button>
        </form>
      )}

      {provider.models.length ? (
        <ul className="mt-2 divide-y rounded-xl border">
          {provider.models.map((m, i) => (
            <ModelRow
              key={m.id}
              provider={provider}
              model={m}
              active={
                config.active?.provider === provider.id &&
                config.active.model === m.id
              }
              connectionDirty={connectionDirty}
              onToggle={(enabled) =>
                setModels(
                  provider.models.map((x, j) =>
                    j === i ? { ...x, enabled } : x,
                  ),
                )
              }
              onRemove={() =>
                setModels(provider.models.filter((_, j) => j !== i))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-subtle-foreground">
          还没有模型。点“获取模型”从供应商读取，或手动添加模型 ID。
        </p>
      )}

      <DiscoverDialog
        found={found}
        known={known}
        onClose={() => setFound(null)}
        onAdd={(ids) => {
          add(ids);
          setFound(null);
        }}
      />
    </div>
  );
}

function ModelRow({
  provider,
  model,
  active,
  connectionDirty,
  onToggle,
  onRemove,
}: {
  provider: ProviderView;
  model: ProviderView["models"][number];
  active: boolean;
  connectionDirty: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const save = useSaveConfig({ quiet: true });
  const test = useTestModel();
  const [result, setResult] = useState<ModelTest | null>(null);
  const usable = provider.enabled && model.enabled;

  useEffect(() => setResult(null), [provider.baseUrl, provider.format]);

  const use = () =>
    save.mutate(
      { active: { provider: provider.id, model: model.id } },
      {
        onSuccess: () =>
          toast(`已切换到 ${model.id}`, {
            description: "之前用其他模型生成的说明会标记为待更新。",
          }),
      },
    );

  return (
    <li className="group flex min-h-11 items-center gap-2 px-3 py-1.5">
      <span
        className={cn(
          "min-w-0 truncate font-mono text-[13px]",
          !model.enabled && "text-subtle-foreground",
        )}
      >
        {model.id}
      </span>
      {active && (
        <span className="shrink-0 rounded-full bg-foreground px-1.5 py-px text-[10px] text-background">
          使用中
        </span>
      )}
      {result && (
        <span
          title={result.error ?? undefined}
          className={cn(
            "flex min-w-0 shrink items-center gap-1 truncate text-xs",
            result.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
          )}
        >
          {result.ok ? (
            <Check className="size-3 shrink-0" />
          ) : (
            <X className="size-3 shrink-0" />
          )}
          {result.ok
            ? `${(result.ms / 1000).toFixed(1)}s`
            : (result.error ?? "失败")}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {!active && (
          <Button
            variant="outline"
            size="xs"
            disabled={!usable || save.isPending}
            title={usable ? "用这个模型生成说明" : "先启用供应商和模型"}
            onClick={use}
            className="mr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          >
            使用
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="测试连接"
          title={connectionDirty ? "先保存连接" : "发送一个很短的请求测试连接"}
          disabled={test.isPending || connectionDirty}
          onClick={() =>
            test.mutate(
              { provider: provider.id, model: model.id },
              { onSuccess: setResult },
            )
          }
          className="text-muted-foreground"
        >
          {test.isPending ? <Loader2 className="animate-spin" /> : <Plug />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="移除模型"
          title={active ? "移除后需要重新选择模型" : "移除"}
          onClick={onRemove}
          className="text-muted-foreground"
        >
          <Trash2 />
        </Button>
        <Switch
          checked={model.enabled}
          onCheckedChange={onToggle}
          aria-label="启用模型"
          className="ml-1"
        />
      </span>
    </li>
  );
}

function DiscoverDialog({
  found,
  known,
  onClose,
  onAdd,
}: {
  found: string[] | null;
  known: Set<string>;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const fresh = useMemo(
    () => (found ?? []).filter((id) => !known.has(id)),
    [found, known],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  useEffect(() => {
    setPicked(new Set());
    setFilter("");
  }, [found]);
  const shown = fresh.filter((id) =>
    id.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Dialog open={found !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogTitle>添加模型</DialogTitle>
        <DialogDescription>
          供应商返回了 {found?.length ?? 0} 个模型
          {found && fresh.length < found.length
            ? `，其中 ${found.length - fresh.length} 个已在列表中`
            : ""}
          。
        </DialogDescription>
        {fresh.length ? (
          <>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选"
              className="h-9 rounded-lg bg-transparent"
            />
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-xl border scrollbar-thin">
              {shown.map((id) => (
                <li key={id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={picked.has(id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        setPicked(next);
                      }}
                      className="size-4 accent-foreground"
                    />
                    <span className="truncate font-mono text-[13px]">{id}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPicked(
                    picked.size === shown.length ? new Set() : new Set(shown),
                  )
                }
              >
                {picked.size === shown.length ? "全不选" : "全选"}
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                disabled={!picked.size}
                onClick={() => onAdd([...picked])}
              >
                添加 {picked.size || ""} 个
              </Button>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-subtle-foreground">
            没有新的模型可以添加。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateProvider();
  const empty = {
    name: "",
    format: "openai-chat" as ApiFormat,
    baseUrl: "",
    apiKey: "",
  };
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (open) setForm(empty);
    // Reset only when the dialog opens.
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        name: form.name.trim(),
        format: form.format,
        baseUrl: form.baseUrl.trim(),
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      },
      {
        onSuccess: ({ id }) => {
          onCreated(id);
          onOpenChange(false);
          toast("供应商已添加", { description: "接下来获取或添加模型。" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>添加供应商</DialogTitle>
        <DialogDescription>
          任何兼容 OpenAI Chat Completions 或 Anthropic Messages 的服务都可以。
        </DialogDescription>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  name: p.name,
                  format: p.format,
                  baseUrl: p.baseUrl,
                })
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                form.baseUrl === p.baseUrl && "bg-accent text-foreground",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="名称">
            <Input
              required
              autoFocus
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如 XHub"
              className="h-9 rounded-lg bg-transparent"
            />
          </Field>
          <Field
            label="API 格式"
            hint={formats.find((f) => f.value === form.format)?.hint}
          >
            <select
              value={form.format}
              onChange={(e) =>
                setForm({ ...form, format: e.target.value as ApiFormat })
              }
              className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
            >
              {formats.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base URL">
            <Input
              type="url"
              required
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="h-9 rounded-lg bg-transparent font-mono text-[13px]"
            />
            {plaintext(form.baseUrl) && <PlaintextWarning />}
          </Field>
          <Field label="API Key" hint="本地模型可留空">
            <Input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-…"
              spellCheck={false}
              className="h-9 rounded-lg bg-transparent font-mono text-[13px]"
            />
          </Field>
          <p className="text-xs leading-5 text-subtle-foreground">
            API Key 以 0600
            权限保存在本机配置文件中，不会回传浏览器。使用云端模型时，主题涉及的代码会发送给对应服务商。
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              添加
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlaintextWarning() {
  return (
    <p className="mt-1.5 flex gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      这是远程的明文 HTTP 地址：API Key
      和源码会不加密地经过网络。只在可信的内网使用。
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-subtle-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

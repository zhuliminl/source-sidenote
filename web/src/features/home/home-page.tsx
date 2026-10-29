import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowUp, ChevronRight, Folder, Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/layout/ui-state";
import { useAddProject, useConfig, useProjects } from "@/lib/queries";
import { percent } from "@/lib/format";

export function HomePage() {
  const [root, setRoot] = useState("");
  const add = useAddProject();
  const navigate = useNavigate();
  const config = useConfig();
  const projects = useProjects();
  const { openSettings } = useUi();
  const needsModel = config.data && !config.data.model;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = root.trim();
    if (!value || add.isPending) return;
    add.mutate(value, {
      onSuccess: (r) => {
        setRoot("");
        navigate(`/projects/${r.project.id}`);
      },
    });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pt-16 pb-[14vh]">
      <div className="w-full max-w-[680px]">
        <h1 className="mb-7 text-center text-[28px] leading-tight font-normal tracking-tight text-balance">
          想读懂哪个项目？
        </h1>

        {needsModel && (
          <button
            type="button"
            onClick={() => openSettings("model")}
            className="mx-auto mb-4 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plug className="size-3.5" />
            先连接一个模型，才能生成说明
            <ChevronRight className="size-3.5" />
          </button>
        )}

        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-[28px] bg-composer p-2 pl-5 shadow-composer transition-shadow focus-within:shadow-[0_0_0_1px_var(--ring),0_4px_16px_rgb(0_0_0/0.06)]"
        >
          <Folder className="size-[18px] shrink-0 text-subtle-foreground" />
          <label htmlFor="project-root" className="sr-only">
            本地项目路径
          </label>
          <input
            id="project-root"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="粘贴本地项目的绝对路径，例如 /Users/me/projects/app"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle-foreground"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!root.trim() || add.isPending}
            aria-label="添加项目"
            className="size-9 disabled:bg-muted-foreground/25 disabled:opacity-100"
          >
            {add.isPending ? (
              <Loader2 className="size-[18px] animate-spin" />
            ) : (
              <ArrowUp className="size-[18px]" strokeWidth={2.4} />
            )}
          </Button>
        </form>

        <p className="mt-3 text-center text-xs text-subtle-foreground">
          只扫描源码并遵循 .gitignore · 也可以在项目目录运行{" "}
          <code className="font-mono">npx source-sidenote add</code>
        </p>

        {projects.data && projects.data.length > 0 && (
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {projects.data.slice(0, 4).map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors hover:bg-accent"
              >
                <Folder className="size-3.5 text-muted-foreground" />
                <span className="max-w-[12rem] truncate">{p.name}</span>
                <span className="text-xs text-subtle-foreground tabular-nums">
                  {percent(p.covered, p.total)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

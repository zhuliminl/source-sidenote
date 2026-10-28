import { KeyRound } from "lucide-react";
import { Logo } from "@/components/logo";

/** Shown when the page was opened without the one-time token fragment. */
export function Unauthorized() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo className="size-10" />
      <div className="space-y-2">
        <h1 className="text-2xl font-medium tracking-tight">需要本机授权</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          为保护本机代码，管理页只接受终端打开的授权链接。在终端运行下面的命令重新打开。
        </p>
      </div>
      <code className="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 font-mono text-sm">
        <KeyRound className="size-4 text-muted-foreground" />
        sidenote ui
      </code>
    </main>
  );
}

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { FolderSync, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectSummary } from "@shared/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useRemoveProject, useRescan, useRun } from "@/lib/queries";

/** Project-level commands, shared by the sidebar rows and the project header. */
export function ProjectActionsMenu({
  project,
  children,
  align = "start",
}: {
  project: Pick<ProjectSummary, "id" | "name" | "root">;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const run = useRun();
  const rescan = useRescan();
  const remove = useRemoveProject();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          <DropdownMenuItem
            onSelect={() =>
              run.mutate({ project: project.id, kind: "generate" })
            }
          >
            <Sparkles />
            更新缺失或过期的说明
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run.mutate({ project: project.id, kind: "review" })}
          >
            <ShieldCheck />
            复查当前说明
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rescan.mutate(project.id)}>
            <FolderSync />
            重新扫描文件
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirming(true)}
          >
            <Trash2 />
            移除项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>移除“{project.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除这个项目已生成的说明与任务记录。磁盘上的源码不会被修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(project.id, {
                  onSuccess: () => {
                    toast(`已移除 ${project.name}`);
                    navigate("/");
                  },
                })
              }
            >
              移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

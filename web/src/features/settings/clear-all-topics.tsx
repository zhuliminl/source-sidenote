import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { useClearAllTopics, useProjects } from "@/lib/queries";

/** Danger zone in General: delete every topic of every project (projects and source stay). */
export function ClearAllTopics() {
  const projects = useProjects();
  const clear = useClearAllTopics();
  const [open, setOpen] = useState(false);
  const count = projects.data?.reduce((n, p) => n + p.topics, 0) ?? 0;
  return (
    <div className="flex items-center justify-between gap-6 border-b py-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
      <div className="min-w-0">
        <p className="text-sm">清空所有主题</p>
        <p className="mt-0.5 text-xs text-subtle-foreground">
          删除全部项目里的 {count}{" "}
          个主题，以及它们的说明、导读和故事。项目和源码保留。
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!count || clear.isPending}
        onClick={() => setOpen(true)}
        className="shrink-0 text-destructive hover:text-destructive"
      >
        <Trash2 />
        清空所有主题
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删除全部 {count} 个主题？</AlertDialogTitle>
            <AlertDialogDescription>
              所有项目里的主题、说明、链路导读和故事都会删除，进行中的任务会被取消，无法恢复。项目、源码和模型设置不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-white hover:bg-destructive/90"
              onClick={() => clear.mutate()}
            >
              全部删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

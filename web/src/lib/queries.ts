import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConfigUpdate, JobKind, RunResult } from "@shared/api";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false },
    mutations: {
      onError: (error) => toast.error(error.message),
    },
  },
});

export const keys = {
  config: ["config"] as const,
  projects: ["projects"] as const,
  files: (project: string) => ["projects", project, "files"] as const,
  document: (project: string, path: string) =>
    ["projects", project, "document", path] as const,
  jobs: ["jobs"] as const,
};

export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: api.config });

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: api.projects });

export const useFiles = (project: string) =>
  useQuery({
    queryKey: keys.files(project),
    queryFn: () => api.files(project),
  });

export const useDocument = (project: string, path: string | null) =>
  useQuery({
    queryKey: keys.document(project, path ?? ""),
    queryFn: () => api.document(project, path!),
    enabled: Boolean(path),
  });

export const useJobs = () =>
  useQuery({ queryKey: keys.jobs, queryFn: api.jobs });

const runMessage = (r: RunResult, kind: JobKind) =>
  r.blocked ??
  (r.queued
    ? `已加入 ${r.queued} 个${kind === "review" ? "复查" : "生成"}任务`
    : kind === "review"
      ? "没有可复查的最新说明"
      : "所有说明都是最新的");

export function useRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { project: string; kind: JobKind; path?: string }) =>
      api.run(v.project, v.kind, v.path),
    onSuccess: (r, v) => {
      (r.blocked ? toast.warning : toast)(runMessage(r, v.kind));
      void qc.invalidateQueries({ queryKey: keys.jobs });
    },
  });
}

export function useAddProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.addProject,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      if (r.blocked) toast.warning(r.blocked);
      else toast(`已添加 ${r.project.name}，加入 ${r.queued} 个任务`);
    },
  });
}

export function useRescan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.rescan,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast("已重新扫描磁盘文件");
    },
  });
}

export function useRemoveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.removeProject,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.cancelJob,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.jobs }),
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: ConfigUpdate) => api.saveConfig(c),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config });
      toast("设置已保存");
    },
  });
}

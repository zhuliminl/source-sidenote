import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  ConfigUpdate,
  RunResult,
  TopicConfirm,
  TopicCreate,
} from "@shared/api";
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
  prompts: ["prompts"] as const,
  projects: ["projects"] as const,
  files: (project: string) => ["projects", project, "files"] as const,
  source: (project: string, path: string) =>
    ["projects", project, "source", path] as const,
  // Everything derived from topics lives under ["topics"] so one event refreshes it all.
  topicsRoot: ["topics"] as const,
  topics: (project: string) => ["topics", "project", project] as const,
  topic: (topic: string) => ["topics", topic] as const,
  document: (topic: string, path: string) =>
    ["topics", topic, "document", path] as const,
  jobs: ["jobs"] as const,
};

export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: api.config });

export const usePrompts = () =>
  useQuery({ queryKey: keys.prompts, queryFn: api.prompts });

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: api.projects });

export const useFiles = (project: string) =>
  useQuery({
    queryKey: keys.files(project),
    queryFn: () => api.files(project),
  });

export const useSource = (project: string, path: string | null) =>
  useQuery({
    queryKey: keys.source(project, path ?? ""),
    queryFn: () => api.source(project, path!),
    enabled: Boolean(path),
  });

export const useTopics = (project: string) =>
  useQuery({
    queryKey: keys.topics(project),
    queryFn: () => api.topics(project),
  });

export const useTopic = (topic: string | null) =>
  useQuery({
    queryKey: keys.topic(topic ?? ""),
    queryFn: () => api.topic(topic!),
    enabled: Boolean(topic),
  });

export const useDocument = (topic: string | null, path: string | null) =>
  useQuery({
    queryKey: keys.document(topic ?? "", path ?? ""),
    queryFn: () => api.document(topic!, path!),
    enabled: Boolean(topic && path),
  });

export const useJobs = () =>
  useQuery({ queryKey: keys.jobs, queryFn: api.jobs });

function useInvalidateTopics() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.topicsRoot });
    void qc.invalidateQueries({ queryKey: keys.projects });
    void qc.invalidateQueries({ queryKey: keys.jobs });
  };
}

const queuedMessage = (r: RunResult, what: string) =>
  r.blocked ??
  (r.queued ? `已加入 ${r.queued} 个${what}任务` : "没有需要更新的内容");

export function useCreateTopic(project: string) {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: (body: TopicCreate) => api.createTopic(project, body),
    onSuccess: invalidate,
  });
}

export function useReplan() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: (v: { topic: string; instructions?: string }) =>
      api.replan(v.topic, v.instructions),
    onSuccess: invalidate,
  });
}

export function useConfirmTopic() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: (v: { topic: string } & TopicConfirm) =>
      api.confirmTopic(v.topic, {
        files: v.files,
        instructions: v.instructions,
      }),
    onSuccess: (r) => {
      toast(queuedMessage(r, "生成"));
      invalidate();
    },
  });
}

export function useRefreshTopic() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: api.refreshTopic,
    onSuccess: (r) => {
      toast(queuedMessage(r, "生成"));
      invalidate();
    },
  });
}

export function useRunFile() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: (v: {
      topic: string;
      path: string;
      kind: "generate" | "review";
    }) => api.runFile(v.topic, v.path, v.kind),
    onSuccess: (r, v) => {
      toast(queuedMessage(r, v.kind === "review" ? "复查" : "生成"));
      invalidate();
    },
  });
}

export function useRemoveTopic() {
  const invalidate = useInvalidateTopics();
  return useMutation({ mutationFn: api.removeTopic, onSuccess: invalidate });
}

export function useAddProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.addProject,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      toast(`已添加 ${r.project.name}`);
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
      void qc.invalidateQueries({ queryKey: keys.prompts });
      // Freshness depends on the configured model.
      void qc.invalidateQueries({ queryKey: keys.topicsRoot });
      toast("设置已保存");
    },
  });
}

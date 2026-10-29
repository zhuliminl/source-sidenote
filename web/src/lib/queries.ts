import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  ConfigUpdate,
  ProviderInput,
  RunResult,
  StoryCreate,
  TopicConfirm,
  TopicReplan,
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
  status: ["status"] as const,
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
  stories: (topic: string) => ["topics", topic, "stories"] as const,
  document: (topic: string, path: string) =>
    ["topics", topic, "document", path] as const,
  jobs: ["jobs"] as const,
};

export const useStatus = () =>
  useQuery({ queryKey: keys.status, queryFn: api.status, staleTime: Infinity });

export function usePickFolder() {
  return useMutation({ mutationFn: api.pickFolder });
}

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
    mutationFn: ({ topic, ...body }: { topic: string } & TopicReplan) =>
      api.replan(topic, body),
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
        model: v.model,
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

export const useStories = (topic: string | null) =>
  useQuery({
    queryKey: keys.stories(topic ?? ""),
    queryFn: () => api.stories(topic!),
    enabled: Boolean(topic),
    // Poll while a story is being recorded; SSE also refreshes it when the job ends.
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.state === "generating") ? 4000 : false,
  });

export function useCreateStory(topic: string) {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: (body: StoryCreate) => api.createStory(topic, body),
    onSuccess: invalidate,
  });
}

export function useStoryIdeas() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: api.storyIdeas,
    onSuccess: (r) => {
      toast(r.queued ? "已让 AI 重新写导读并推荐故事" : "导读正在生成中");
      invalidate();
    },
  });
}

export function useRetryStory() {
  const invalidate = useInvalidateTopics();
  return useMutation({ mutationFn: api.retryStory, onSuccess: invalidate });
}

export function useRemoveStory() {
  const invalidate = useInvalidateTopics();
  return useMutation({ mutationFn: api.removeStory, onSuccess: invalidate });
}

export function useClearTopic() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: api.clearTopic,
    onSuccess: (r) => {
      toast(`已清空 ${r.docs} 份说明、${r.stories} 条故事和导读`);
      invalidate();
    },
  });
}

export function useClearAllTopics() {
  const invalidate = useInvalidateTopics();
  return useMutation({
    mutationFn: api.clearAllTopics,
    onSuccess: (r) => {
      toast(`已删除 ${r.topics} 个主题`);
      invalidate();
    },
  });
}

export const useAgentSetup = () =>
  useQuery({ queryKey: ["agent", "setup"], queryFn: api.agentSetup });
export const useAgentGuide = () =>
  useQuery({ queryKey: ["agent", "guide"], queryFn: api.agentGuide });

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

function useConfigChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.config });
    void qc.invalidateQueries({ queryKey: keys.prompts });
    // Freshness depends on the active model.
    void qc.invalidateQueries({ queryKey: keys.topicsRoot });
  };
}

export function useSaveConfig({ quiet = false } = {}) {
  const changed = useConfigChanged();
  return useMutation({
    mutationFn: (c: ConfigUpdate) => api.saveConfig(c),
    onSuccess: () => {
      changed();
      if (!quiet) toast("设置已保存");
    },
  });
}

export function useCreateProvider() {
  const changed = useConfigChanged();
  return useMutation({ mutationFn: api.createProvider, onSuccess: changed });
}

export function useUpdateProvider() {
  const changed = useConfigChanged();
  return useMutation({
    mutationFn: ({ id, ...input }: ProviderInput & { id: string }) =>
      api.updateProvider(id, input),
    onSuccess: changed,
  });
}

export function useRemoveProvider() {
  const changed = useConfigChanged();
  return useMutation({ mutationFn: api.removeProvider, onSuccess: changed });
}

export function useTestModel() {
  return useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      api.testModel(provider, model),
  });
}

export function useDiscoverModels() {
  return useMutation({ mutationFn: api.discoverModels });
}

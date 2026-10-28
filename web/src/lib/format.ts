const relative = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit);
  return "刚刚";
}

export const percent = (count: number, total: number) =>
  total ? `${Math.round((count / total) * 100)}%` : "—";

export function splitPath(path: string) {
  const i = path.lastIndexOf("/");
  return { dir: i < 0 ? "" : path.slice(0, i + 1), name: path.slice(i + 1) };
}

export function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

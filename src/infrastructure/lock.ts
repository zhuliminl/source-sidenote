import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
export function acquireLock(home: string): () => void {
  const path = join(home, "service.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (readFileSync(path, "utf8") === String(process.pid))
            unlinkSync(path);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: number;
      try {
        pid = Number(readFileSync(path, "utf8"));
      } catch {
        throw new Error("服务锁正在创建，请稍后重试");
      }
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error("服务锁无效；确认没有服务运行后删除 service.lock");
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") {
          unlinkSync(path);
          continue;
        }
        throw e;
      }
      throw new Error("同一数据目录的服务已经运行");
    }
  }
  throw new Error("无法获取服务锁");
}

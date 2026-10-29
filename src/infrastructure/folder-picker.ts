import { execFile, execFileSync } from "node:child_process";

const PROMPT = "选择要阅读的项目";

interface Picker {
  command: string;
  args: string[];
  /** Exit codes that mean the user closed the dialog without choosing. */
  cancelled: (code: number | null, stderr: string) => boolean;
}

function has(command: string) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The service runs on the user's machine, so it can show the OS folder dialog;
// a browser directory input never reveals the absolute path the service needs.
function resolvePicker(): Picker | null {
  if (process.platform === "darwin")
    return {
      command: "osascript",
      // Ask the frontmost app (the browser) to show the dialog so it is not hidden behind it;
      // fall back to a plain dialog when that app cannot host one.
      args: [
        "try",
        `tell application (path to frontmost application as text) to set f to choose folder with prompt "${PROMPT}"`,
        "on error number n",
        "if n is -128 then error number -128",
        `set f to choose folder with prompt "${PROMPT}"`,
        "end try",
        "POSIX path of f",
      ].flatMap((line) => ["-e", line]),
      cancelled: (_, stderr) => stderr.includes("-128"),
    };
  if (process.platform === "win32")
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='${PROMPT}'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}`,
      ],
      cancelled: () => false,
    };
  if (has("zenity"))
    return {
      command: "zenity",
      args: ["--file-selection", "--directory", `--title=${PROMPT}`],
      cancelled: (code) => code === 1,
    };
  if (has("kdialog"))
    return {
      command: "kdialog",
      args: [
        "--getexistingdirectory",
        process.env.HOME ?? "/",
        "--title",
        PROMPT,
      ],
      cancelled: (code) => code === 1,
    };
  return null;
}

let picker: Picker | null | undefined;
let open = false;

export function canPickFolder() {
  if (picker === undefined) picker = resolvePicker();
  return picker !== null;
}

/** Shows the native folder dialog; resolves to the chosen absolute path, or null if cancelled. */
export function pickFolder(): Promise<string | null> {
  if (!canPickFolder()) throw new Error("此系统不支持选择文件夹");
  if (open) throw new Error("文件夹选择窗口已经打开");
  const p = picker!;
  open = true;
  return new Promise<string | null>((resolve, reject) => {
    execFile(
      p.command,
      p.args,
      { timeout: 10 * 60_000, encoding: "utf8" },
      (error, stdout, stderr) => {
        open = false;
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          if (p.cancelled(code, stderr)) return resolve(null);
          return reject(new Error("无法打开文件夹选择窗口"));
        }
        const path = stdout.trim().replace(/(.)\/$/, "$1");
        resolve(path || null);
      },
    );
  });
}

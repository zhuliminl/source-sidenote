const $ = (s) => document.querySelector(s);
let token =
  location.hash.slice(1) || sessionStorage.getItem("sidenote-token") || "";
if (location.hash) {
  sessionStorage.setItem("sidenote-token", token);
  history.replaceState(null, "", location.pathname);
}
const message = (text) => ($("#message").textContent = text);
async function api(path, body, method) {
  const r = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function emptyState(title, description) {
  const box = el("div", undefined, "empty-state");
  const symbol = el("span", "◇", "empty-symbol");
  symbol.setAttribute("aria-hidden", "true");
  box.append(symbol, el("h3", title), el("p", description));
  return box;
}
function action(text, fn) {
  const b = el("button", text);
  b.onclick = () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => message(e.message));
  return b;
}
async function projects() {
  const rows = await api("projects");
  const list = $("#project-list");
  list.replaceChildren();
  $("#project-count").textContent = rows.length;
  if (!rows.length)
    list.append(
      emptyState("还没有项目", "添加一个本地目录，开始建立你的代码资料库。"),
    );
  for (const p of rows) {
    const card = el("article", undefined, "card");
    const head = el("div", undefined, "card-head");
    const mark = el("span", undefined, "folder-mark");
    mark.setAttribute("aria-hidden", "true");
    // Fixed, author-owned SVG; project content is always inserted with textContent.
    mark.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/></svg>';
    const title = el("div", undefined, "card-title");
    title.append(el("h3", p.name), el("div", p.root, "root"));
    head.append(
      mark,
      title,
      el(
        "span",
        p.unavailable
          ? "路径不可用"
          : !p.covered
            ? "等待生成"
            : p.fresh < p.covered
              ? "有待更新"
              : "说明已更新",
        "state-pill",
      ),
    );
    card.append(head);
    const metrics = el("div", undefined, "metrics");
    for (const [label, count, total] of [
      ["覆盖率", p.covered, p.total],
      ["新鲜率", p.fresh, p.covered],
      ["已复查通过", p.reviewed, p.total],
    ]) {
      const item = el("div");
      const bar = el("progress");
      bar.max = Math.max(total, 1);
      bar.value = count;
      bar.setAttribute("aria-label", `${label}：${count}/${total}`);
      item.append(
        el("span", label, "metric-label"),
        el("strong", total ? Math.round((count / total) * 100) + "%" : "—"),
        bar,
        el("span", `${count} / ${total} 个文件`, "metric-detail"),
      );
      metrics.append(item);
    }
    card.append(metrics);
    const actions = el("div", undefined, "actions");
    actions.append(
      action("阅读说明", () => details(p)),
      action("更新缺失 / 过期", () => run(p, "generate")),
      action("复查当前说明", () => run(p, "review")),
      action("重新扫描", async () => {
        await api(`projects/${p.id}/refresh`, {});
        await projects();
        message("已重新扫描磁盘文件");
      }),
    );
    card.append(actions);
    list.append(card);
  }
}
async function run(p, kind) {
  const r = await api(`projects/${p.id}/run`, { kind });
  message(r.blocked || `已加入 ${r.queued} 个任务`);
  await jobs();
}
async function details(p) {
  $("#details").hidden = false;
  $("#detail-title").textContent = p.name;
  const files = await api(`projects/${p.id}/files`);
  $("#files").replaceChildren(
    ...files.map((f) =>
      action(f.path, async () => {
        const d = await api(
          `projects/${p.id}/document?path=${encodeURIComponent(f.path)}`,
        );
        $("#document").textContent =
          (d.status === "stale" ? "⚠ 说明已过期\n\n" : "") +
          (d.markdown || "尚未生成说明") +
          (d.review
            ? "\n\n复查结果\n" + JSON.stringify(JSON.parse(d.review), null, 2)
            : "");
      }),
    ),
  );
}
async function jobs() {
  const rows = await api("jobs");
  const list = $("#job-list");
  list.replaceChildren();
  if (!rows.length)
    list.append(
      emptyState("一切就绪", "开始生成或复查后，任务进度会显示在这里。"),
    );
  const states = {
    queued: "等待中",
    running: "进行中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  for (const j of rows) {
    const row = el("div", undefined, "job");
    const content = el("div", undefined, "job-content");
    content.append(
      el("strong", j.path),
      el("small", j.kind === "review" ? "说明复查" : "生成说明"),
    );
    if (j.error) content.append(el("small", j.error, "error"));
    const state = el("span", states[j.state] || j.state, "job-state");
    state.dataset.state = j.state;
    row.append(content, state);
    if (["queued", "running"].includes(j.state))
      row.append(
        action("取消", async () => {
          await api(`jobs/${j.id}/cancel`, {});
          await jobs();
        }),
      );
    list.append(row);
  }
}

async function config() {
  const c = await api("config");
  for (const k of [
    "baseUrl",
    "model",
    "concurrency",
    "maxFilesPerRun",
    "timeoutMs",
  ])
    $("#settings-form").elements[k].value = c[k];
  $("#setup-notice").hidden = Boolean(c.model);
  $("#key-status").textContent = c.hasApiKey
    ? " 已保存密钥（不会回传浏览器）"
    : " 尚未配置密钥；本地模型可留空";
}
function selectTab(id) {
  for (const section of document.querySelectorAll("main>section"))
    section.hidden = section.id !== id;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === id;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
for (const button of document.querySelectorAll("[data-tab]"))
  button.onclick = () => selectTab(button.dataset.tab);
$("#go-settings").onclick = () => selectTab("settings");
$("#close-details").onclick = () => {
  $("#details").hidden = true;
};
$("#reload").onclick = () => projects().catch((e) => message(e.message));
$("#add-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    message("扫描中…");
    const r = await api("projects", { root: $("#root").value });
    message(r.blocked || `已收录，加入 ${r.queued} 个任务`);
    await projects();
  } catch (e) {
    message(e.message);
  }
};
$("#settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const c = Object.fromEntries(new FormData(e.target));
  if (!c.apiKey) delete c.apiKey;
  for (const k of ["concurrency", "maxFilesPerRun", "timeoutMs"])
    c[k] = Number(c[k]);
  try {
    await api("config", c, "PUT");
    e.target.elements.apiKey.value = "";
    message("配置已保存。回到项目页启动生成。");
    await config();
  } catch (e) {
    message(e.message);
  }
};
async function events() {
  const r = await fetch("/api/events", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) return;
  const reader = r.body.getReader();
  // Coalesce bursts of job events: each project refresh re-reads source files on the server.
  let pending;
  const refresh = () => {
    clearTimeout(pending);
    pending = setTimeout(
      () => Promise.all([projects(), jobs()]).catch((e) => message(e.message)),
      300,
    );
  };
  while (true) {
    const { done } = await reader.read();
    if (done) break;
    refresh();
  }
}
if (!token) message("请在终端运行 sidenote ui，打开带有本机授权的管理页。");
else
  Promise.all([projects(), jobs(), config()])
    .then(() => events())
    .catch((e) => message(e.message));

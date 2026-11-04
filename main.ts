import { ItemView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE = "knowledge-dashboard-view";
const TASK_TYPES = ["需要日拱的体系", "需要卡片化", "需要费曼输出", "需要部署"];
const TASK_COLORS: Record<string, string> = {
  需要日拱的体系: "#63B26B",
  需要卡片化: "#4E8CA6",
  需要费曼输出: "#D18A70",
  需要部署: "#C68F5F",
};
const REVIEW_PERIODS = [
  { key: "daily", imp: "每日看", title: "每日看", desc: "每天轮换 5 条" },
  { key: "weekly", imp: "每周看", title: "每周看", desc: "每周一轮换 5 条" },
  { key: "monthly", imp: "每月看", title: "每月看", desc: "每月 1 日轮换 5 条" },
  { key: "yearly", imp: "每年看", title: "每年看", desc: "每年 5 月 27 日轮换" },
];

interface NoteInfo {
  file: TFile;
  digest: string;
  status: string;
  topic: string;
  layer: string;
  importance: string;
}

interface RotationState {
  cycle: string;
  shown: string[];
  current: string[];
}

function fmStr(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(String).join("、");
  return String(v).trim();
}

function cycleKey(kind: string): string {
  const d = new Date();
  const y = d.getFullYear();
  if (kind === "daily") return d.toISOString().slice(0, 10);
  if (kind === "monthly") return `${y}-${d.getMonth() + 1}`;
  if (kind === "yearly") return `${y}`;
  const first = new Date(y, 0, 1);
  const week = Math.ceil(((d.getTime() - first.getTime()) / 86400000 + first.getDay() + 1) / 7);
  return `${y}-W${week}`;
}

export default class KnowledgeDashboardPlugin extends Plugin {
  rotation: Record<string, RotationState> = {};

  async onload() {
    this.rotation = (await this.loadData())?.rotation ?? {};
    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("gauge", "知识消化看板", () => this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "打开看板", callback: () => this.openDashboard() });
    this.addCommand({
      id: "refresh-dashboard",
      name: "刷新看板",
      callback: () => this.getView()?.render(),
    });
    this.app.workspace.onLayoutReady(() => this.openDashboard());
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.getView()?.scheduleRender())
    );
    this.registerEvent(this.app.vault.on("create", () => this.getView()?.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.getView()?.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.getView()?.scheduleRender()));
  }

  async saveRotation() {
    await this.saveData({ rotation: this.rotation });
  }

  getView(): DashboardView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    return leaves.length ? (leaves[0].view as DashboardView) : null;
  }

  async openDashboard() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
}

class DashboardView extends ItemView {
  private notes: NoteInfo[] = [];
  private renderTimer: number | null = null;
  private filters: Record<string, string> = { overview: "", suggest: "", todo: "", reference: "" };

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeDashboardPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "知识消化看板";
  }
  getIcon() {
    return "gauge";
  }

  async onOpen() {
    this.render();
  }

  scheduleRender() {
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 3000);
  }

  collect(): NoteInfo[] {
    const t0 = performance.now();
    const out: NoteInfo[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith("copilot/")) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      out.push({
        file,
        digest: fmStr(fm["消化方式"]),
        status: fmStr(fm["完成状态"]) || "未完成",
        topic: fmStr(fm["主题"]),
        layer: fmStr(fm["层"]),
        importance: fmStr(fm["重要度"]),
      });
    }
    console.log(`[KnowledgeDashboard] 扫描 ${out.length} 篇带属性笔记，耗时 ${(performance.now() - t0).toFixed(0)}ms`);
    return out;
  }

  render() {
    this.notes = this.collect();
    const el = this.contentEl;
    el.empty();
    el.addClass("kd-container");

    const header = el.createDiv("kd-header");
    header.createEl("h2", { text: "知识消化看板" });
    header.createDiv("kd-spacer");
    const moodBtn = header.createEl("button", { cls: "kd-btn kd-btn-mood", text: "心情不好：随机卡片" });
    moodBtn.onclick = () => this.openMoodNote();
    const bookBtn = header.createEl("button", { cls: "kd-btn kd-btn-mood", text: "心情不好：翻一本书" });
    bookBtn.onclick = () => this.openMoodBook();
    const btn = header.createEl("button", { cls: "kd-btn", text: "刷新" });
    btn.onclick = () => this.render();

    this.renderOverview(el);
    this.renderSuggestions(el);
    this.renderTodo(el);
    this.renderReview(el);
    this.renderReference(el);
    this.renderProjects(el);
  }

  private renderProjects(el: HTMLElement) {
    const sec = el.createDiv("kd-section");
    sec.createEl("h3", { text: "项目（00_Todo 文件夹）" });
    const root = "00_Todo";
    const folders = new Set<string>();
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f.parent?.path === root && f.path !== root) {
        folders.add(f.name);
      }
    }
    const row = sec.createDiv("kd-topic-row");
    [...folders].sort().forEach((name) => {
      const b = row.createEl("button", {
        cls: "kd-topic-btn" + (this.filters.project === name ? " kd-topic-active" : ""),
        text: name,
      });
      b.onclick = () => {
        this.filters.project = this.filters.project === name ? "" : name;
        this.render();
      };
    });
    const current = this.filters.project;
    if (!current) {
      sec.createDiv("kd-empty").setText("点击上方文件夹，查看该项目下的全部笔记");
      return;
    }
    const list = this.notes
      .filter((n) => n.file.path.startsWith(`${root}/${current}/`))
      .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
    const done = list.filter((n) => n.status === "已完成").length;
    sec.createDiv("kd-footnote").setText(`${current}：共 ${list.length} 篇，已完成 ${done} 篇`);
    list.slice(0, 5).forEach((n) => this.link(sec, n, n.digest));
  }

  private byTopic(list: NoteInfo[], section: string): NoteInfo[] {
    const t = this.filters[section];
    return t ? list.filter((n) => n.topic === t) : list;
  }

  private topicButtons(sec: HTMLElement, section: string, pool: NoteInfo[]) {
    const topics = [...new Set(pool.map((n) => n.topic).filter(Boolean))].sort();
    const row = sec.createDiv("kd-topic-row");
    const mk = (label: string, value: string) => {
      const b = row.createEl("button", {
        cls: "kd-topic-btn" + (this.filters[section] === value ? " kd-topic-active" : ""),
        text: label,
      });
      b.onclick = () => {
        this.filters[section] = value;
        this.render();
      };
    };
    mk("全部", "");
    topics.forEach((t) => mk(t, t));
  }

  private taskGroup(t: string): NoteInfo[] {
    return this.notes.filter((n) => n.digest.includes(t));
  }

  private renderOverview(el: HTMLElement) {
    const sec = el.createDiv("kd-section");
    sec.createEl("h3", { text: "任务进度" });
    this.topicButtons(sec, "overview", this.notes.filter((n) => TASK_TYPES.some((t) => n.digest.includes(t))));
    let allDone = 0, allTotal = 0;
    for (const t of TASK_TYPES) {
      const group = this.byTopic(this.taskGroup(t), "overview");
      const done = group.filter((n) => n.status === "已完成").length;
      const doing = group.filter((n) => n.status === "进行中").length;
      const todo = group.length - done - doing;
      allDone += done;
      allTotal += group.length;
      const row = sec.createDiv("kd-bar-row");
      const label = row.createDiv("kd-bar-label");
      label.createSpan("kd-task-name").setText(t);
      label.createSpan("kd-bar-count").setText(`已完成 ${done} · 进行中 ${doing} · 未完成 ${todo}`);
      const track = row.createDiv("kd-bar-track");
      const pct = group.length ? (done / group.length) * 100 : 0;
      const pctDoing = group.length ? (doing / group.length) * 100 : 0;
      const fill = track.createDiv("kd-bar-fill");
      fill.style.width = `${pct}%`;
      fill.style.background = TASK_COLORS[t];
      const fillDoing = track.createDiv("kd-bar-fill-doing");
      fillDoing.style.width = `${pctDoing}%`;
      fillDoing.style.background = TASK_COLORS[t];
      row.createDiv("kd-bar-pct").setText(group.length ? `${Math.round(pct)}%` : "—");
    }
    const untriaged = this.byTopic(this.notes.filter((n) => !TASK_TYPES.some((t) => n.digest.includes(t))), "overview").length;
    sec.createDiv("kd-footnote").setText(
      `全部任务完成度 ${allTotal ? Math.round((allDone / allTotal) * 100) : 0}%　·　无消化方式（外挂/未分诊）${untriaged} 篇，不计入任务`
    );
  }

  private currentSlot(): string {
    const h = new Date().getHours();
    if (h >= 6 && h < 12) return "需要日拱的体系";
    if (h >= 12 && h < 18) return "需要卡片化";
    return "需要费曼输出";
  }

  private link(parent: HTMLElement, n: NoteInfo, extra = "") {
    const a = parent.createEl("a", { cls: "kd-note-link", text: n.file.basename });
    a.href = "#";
    a.onclick = (e) => {
      e.preventDefault();
      this.app.workspace.getLeaf("tab").openFile(n.file);
    };
    const meta = [n.topic, n.status, extra].filter(Boolean).join(" | ");
    if (meta) a.createSpan("kd-meta").setText(meta);
  }

  private renderSuggestions(el: HTMLElement) {
    const sec = el.createDiv("kd-section kd-suggest");
    sec.createEl("h3", { text: "下一步建议" });
    this.topicButtons(sec, "suggest", this.notes.filter((n) => TASK_TYPES.some((t) => n.digest.includes(t))));
    const slot = this.currentSlot();
    const slotName = { 需要日拱的体系: "上午适合日拱", 需要卡片化: "下午适合卡片化", 需要费曼输出: "晚上适合费曼输出/部署" }[slot];

    const doing = this.byTopic(
      this.notes.filter((n) => n.status === "进行中" && TASK_TYPES.some((t) => n.digest.includes(t))),
      "suggest"
    );
    if (doing.length) {
      const card = sec.createDiv("kd-suggest-card");
      card.createDiv("kd-suggest-title").setText(`先收尾：你有 ${doing.length} 篇"进行中"，完成比新开更划算`);
      doing.slice(0, 3).forEach((n) => this.link(card, n));
    }

    let target = this.byTopic(this.taskGroup(slot).filter((n) => n.status !== "已完成"), "suggest");
    let reason = `${slotName}：该方向还有 ${target.length} 篇待消化`;
    if (!target.length) {
      const fallback = TASK_TYPES.map((t) => ({
        t,
        list: this.byTopic(this.taskGroup(t).filter((n) => n.status !== "已完成"), "suggest"),
      })).sort((a, b) => b.list.length - a.list.length)[0];
      target = fallback.list;
      reason = `当前时段方向已清空，转向存量最大的"${fallback.t}"（${target.length} 篇）`;
    }
    const card = sec.createDiv("kd-suggest-card");
    card.createDiv("kd-suggest-title").setText(reason);
    target.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime).slice(0, 3).forEach((n) => this.link(card, n));
    if (!target.length) card.createDiv("kd-empty").setText("所有任务方向都已清空，去分诊新笔记吧");

    const dayStr = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    };
    const prefixes = [dayStr(0), dayStr(1), dayStr(2)];
    const pushed = this.notes
      .filter((n) => prefixes.some((p) => n.file.basename.startsWith(p)) && n.status !== "已完成")
      .sort((a, b) => b.file.basename.localeCompare(a.file.basename));
    const pushCard = sec.createDiv("kd-suggest-card");
    pushCard.createDiv("kd-suggest-title").setText(`AI 三日内推送（未完成，${pushed.length} 篇）`);
    if (!pushed.length) pushCard.createDiv("kd-empty").setText("近三日没有未完成的推送内容");
    pushed.slice(0, 5).forEach((n) => this.link(pushCard, n));
  }

  private renderTodo(el: HTMLElement) {
    const sec = el.createDiv("kd-section");
    const slot = this.currentSlot();
    sec.createEl("h3", { text: "今日待办" });
    this.topicButtons(sec, "todo", this.notes.filter((n) => TASK_TYPES.some((t) => n.digest.includes(t))));
    const ordered = [...TASK_TYPES].sort((a, b) => (a === slot ? -1 : b === slot ? 1 : 0));
    for (const t of ordered) {
      const group = this.byTopic(this.taskGroup(t), "todo")
        .filter((n) => n.status !== "已完成")
        .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
      const div = sec.createDiv("kd-todo-group");
      div.createEl("h4", { text: t + (t === slot ? "（当前时段）" : "") + `　${group.length} 条` });
      const filtered = !!this.filters.todo;
      if (t === "需要日拱的体系" && !filtered) {
        this.renderDailyGrind(div);
        continue;
      }
      if (t === "需要费曼输出" && !filtered) {
        const byTopicMap = new Map<string, NoteInfo>();
        for (const n of group) {
          const key = n.topic || "未标主题";
          if (!byTopicMap.has(key)) byTopicMap.set(key, n);
        }
        if (!byTopicMap.size) div.createDiv("kd-empty").setText("当前无待办");
        for (const n of byTopicMap.values()) this.link(div, n);
        continue;
      }
      if (!group.length) {
        div.createDiv("kd-empty").setText("当前无待办");
        continue;
      }
      group.slice(0, 5).forEach((n) => this.link(div, n));
    }
  }

  private renderDailyGrind(div: HTMLElement) {
    const entries: { path: string; label: string }[] = [];
    const solarDir = "00_solar proadcast";
    const latest = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.parent?.path === solarDir)
      .sort((a, b) => b.basename.localeCompare(a.basename))[0];
    if (latest) entries.push({ path: latest.path, label: `Solar Podcast（${latest.basename}）` });
    entries.push({
      path: "00英语原版书Lexile/光伏商务英语写作学习手册（2025-2026合集）/00 光伏商务英语写作学习手册（2025–2026合集）.md",
      label: "光伏商务英语写作学习手册",
    });
    entries.push({
      path: "00英语原版书Lexile/第二部new moon/01 Party.md",
      label: "英语原版书：Twilight 第二部 New Moon（第一部 26/26 已精读，续读）",
    });
    for (const e of entries) {
      const file = this.app.vault.getFileByPath(e.path);
      const a = div.createEl("a", { cls: "kd-note-link", text: e.label });
      a.href = "#";
      a.onclick = (ev) => {
        ev.preventDefault();
        if (file) this.app.workspace.getLeaf("tab").openFile(file);
        else new Notice("找不到笔记：" + e.path);
      };
    }
  }

  private reviewCurrent(period: string): NoteInfo[] {
    const state = this.plugin.rotation[period];
    if (!state?.current) return [];
    return state.current
      .map((p) => this.app.vault.getFileByPath(p))
      .filter((f): f is TFile => !!f)
      .map((f) => this.notes.find((n) => n.file.path === f.path))
      .filter((n): n is NoteInfo => !!n);
  }

  private pickReview(period: string, imp: string): NoteInfo[] {
    const pool = this.notes.filter((n) => n.importance.includes(imp));
    if (!pool.length) return [];
    const cycle = cycleKey(period);
    let state = this.plugin.rotation[period];
    if (!state || state.cycle !== cycle) state = { cycle, shown: [], current: [] };
    let candidates = pool.filter((n) => !state.shown.includes(n.file.path));
    if (!candidates.length) {
      state.shown = [];
      candidates = pool;
    }
    const picked = candidates.sort(() => Math.random() - 0.5).slice(0, 5);
    state.shown.push(...picked.map((n) => n.file.path));
    state.current = picked.map((n) => n.file.path);
    this.plugin.rotation[period] = state;
    void this.plugin.saveRotation();
    return picked;
  }

  private renderReview(el: HTMLElement) {
    const sec = el.createDiv("kd-section");
    sec.createEl("h3", { text: "随机回顾" });
    for (const p of REVIEW_PERIODS) {
      const div = sec.createDiv("kd-todo-group");
      const head = div.createDiv("kd-review-head");
      head.createEl("h4", { text: `${p.title}（${p.desc}）` });
      const pool = this.notes.filter((n) => n.importance.includes(p.imp));
      if (!pool.length) {
        div.createDiv("kd-empty").setText(`暂无"${p.imp}"笔记`);
        continue;
      }
      const cycle = cycleKey(p.key);
      const state = this.plugin.rotation[p.key];
      const list = state && state.cycle === cycle && state.current?.length ? this.reviewCurrent(p.key) : this.pickReview(p.key, p.imp);
      const reshuffle = head.createEl("button", { cls: "kd-btn kd-mini", text: "换一批" });
      reshuffle.onclick = () => {
        this.pickReview(p.key, p.imp);
        this.render();
      };
      list.forEach((n) => this.link(div, n));
    }
  }

  private renderReference(el: HTMLElement) {
    const sec = el.createDiv("kd-section");
    sec.createEl("h3", { text: "待验证与检索用" });
    this.topicButtons(sec, "reference", this.notes.filter((n) => n.importance.includes("待验证") || n.importance.includes("检索用")));
    for (const imp of ["待验证", "检索用"]) {
      const div = sec.createDiv("kd-todo-group");
      const list = this.byTopic(
        this.notes.filter((n) => n.importance.includes(imp)),
        "reference"
      ).sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
      div.createEl("h4", { text: `${imp}　${list.length} 篇` });
      list.slice(0, 5).forEach((n) =>
        this.link(div, n, `修改于 ${Math.floor((Date.now() - n.file.stat.mtime) / 86400000)} 天前`)
      );
    }
  }

  private openMoodNote() {
    const pool = this.notes.filter((n) => n.importance.includes("心情不好时看"));
    if (!pool.length) {
      new Notice("暂无心情不好时看的笔记");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.app.workspace.getLeaf("tab").openFile(pick.file);
  }

  private openMoodBook() {
    const dir = "06_编剧积累/05_叙事分析工程";
    const books = new Map<string, TFile[]>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(dir + "/")) continue;
      const book = f.parent && f.parent.path !== dir ? f.parent.path : f.basename;
      if (!books.has(book)) books.set(book, []);
      books.get(book)!.push(f);
    }
    if (!books.size) {
      new Notice("叙事分析工程里还没有书");
      return;
    }
    const keys = [...books.keys()];
    const book = keys[Math.floor(Math.random() * keys.length)];
    const files = books.get(book)!;
    const pick = files[Math.floor(Math.random() * files.length)];
    new Notice("今天翻这本：" + book.split("/").pop());
    this.app.workspace.getLeaf("tab").openFile(pick);
  }
}

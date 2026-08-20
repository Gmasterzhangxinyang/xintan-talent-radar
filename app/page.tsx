"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = "overview" | "tasks" | "leads" | "runs" | "sources";

type Task = {
  id: string;
  name: string;
  jd: string;
  status: string;
  sources: string[];
  techKeywords: string[];
  companyKeywords: string[];
  signalKeywords: string[];
  excludeKeywords: string[];
  schedule: string;
  timeRange: string;
  discovered: number;
  highValue: number;
  lastRunAt?: string | null;
  authorBlacklist?: string[];
  companyBlacklist?: string[];
  scheduleEnabled?: boolean;
  nextRunAt?: string | null;
};

type Lead = {
  id: string;
  taskId: string;
  source: string;
  author: string;
  authorId: string;
  publishedAt: string;
  snippet: string;
  tags: string[];
  intent: string;
  intelligenceType: string;
  priority: string;
  score: number;
  companyNote: string;
  evidence: string;
  url: string;
  reviewStatus: string;
};

type Run = {
  id: string;
  taskId: string;
  taskName: string;
  startedAt: string;
  finishedAt?: string | null;
  status: string;
  fetched: number;
  filtered: number;
  deduped: number;
  valid: number;
  highValue: number;
  message: string;
};

type Source = {
  id: string;
  name: string;
  mode: string;
  status: string;
  lastCheck: string;
  coverage: string;
  note: string;
};

type AppState = {
  tasks: Task[];
  leads: Lead[];
  runs: Run[];
  sources: Source[];
  connectorJobs?: Array<{
    id: string; taskId: string; source: string; status: string; dispatchedAt: string;
    fetched: number; error: string; progress: number; currentAction: string;
    liveViewUrl: string; screenshotUrl: string; updatedAt?: string;
  }>;
};

type ConnectorSettingsState = {
  endpoint: string; hasToken: boolean; hasCallbackSecret: boolean; enabledSources: string[];
  status: string; lastTestAt: string | null; lastError: string; liveViewUrl: string;
  capabilities: string[];
};

type BrowserSessionState = {
  platform: string; status: string; profileName: string; lastCheckedAt: string;
};

type SourceConnectivity = {
  name: string; reachable: boolean; status: string; httpStatus: number; checkedAt: string; detail: string;
};

const EMPTY_STATE: AppState = { tasks: [], leads: [], runs: [], sources: [] };
const ALL_SOURCES = ["抖音", "微博", "小红书", "知乎", "EETOP", "EDA365"];
const SOCIAL_SOURCES = ["抖音", "微博", "小红书", "知乎"];

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "情报概览", icon: "OV" },
  { id: "tasks", label: "检索任务", icon: "TS" },
  { id: "leads", label: "线索工作台", icon: "LD" },
  { id: "runs", label: "运行日志", icon: "RN" },
  { id: "sources", label: "数据源", icon: "DS" },
];

function initials(name: string) {
  if (name.includes("EETOP")) return "EE";
  if (name.includes("EDA")) return "ED";
  return name.slice(0, 1);
}

function safeNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<AppState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showStartupSetup, setShowStartupSetup] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState(0);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("全部来源");
  const [typeFilter, setTypeFilter] = useState("全部类型");
  const [priorityFilter, setPriorityFilter] = useState("全部优先级");

  const loadState = async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const result = (await response.json()) as AppState & { error?: string };
      if (!response.ok) throw new Error(result.error || "数据加载失败");
      setData(result);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial server synchronization for the client dashboard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState();
    if (!window.sessionStorage.getItem("xintan-source-setup-complete")) setShowStartupSetup(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function enterSourceSetup() {
    window.sessionStorage.setItem("xintan-source-setup-complete", "1");
    setShowStartupSetup(false);
    setView("sources");
    setToast("请按需逐个配置数据源");
  }

  const filteredLeads = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.leads.filter((lead) => {
      const matchesQuery = !keyword || [lead.author, lead.snippet, lead.companyNote, ...lead.tags]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
      const matchesSource = sourceFilter === "全部来源" || lead.source === sourceFilter;
      const matchesType = typeFilter === "全部类型" || lead.intelligenceType === typeFilter;
      const matchesPriority = priorityFilter === "全部优先级" || lead.priority === priorityFilter;
      return matchesQuery && matchesSource && matchesType && matchesPriority;
    });
  }, [data.leads, query, sourceFilter, typeFilter, priorityFilter]);

  const totals = useMemo(() => {
    const fetched = data.runs.reduce((sum, run) => sum + safeNumber(run.fetched), 0);
    const valid = data.runs.reduce((sum, run) => sum + safeNumber(run.valid), 0);
    const high = data.leads.filter((lead) => lead.priority === "A").length;
    const confirmed = data.leads.filter((lead) => lead.reviewStatus === "已确认").length;
    return { fetched, valid, high, confirmed };
  }, [data]);

  async function runSearchTask(task: Task) {
    if (runningTask) return;
    setRunningTask(task.id);
    setRunProgress(8);
    try {
      type LocalResult = { source: string; externalId: string; author: string; authorId: string; publishedAt: string; snippet: string; url: string };
      type LocalJob = { jobId: string; status: string; progress: number; fetched: number; currentAction: string; liveViewUrl: string; results?: LocalResult[] };
      const localJobs: Record<string, LocalJob> = {};
      let localCandidates: LocalResult[] = [];
      const requiresComputer = task.sources.some((source) => SOCIAL_SOURCES.includes(source));
      try {
        const health = await fetch(`${LOCAL_ASSISTANT_URL}/health`, { cache: "no-store" });
        if (!health.ok) throw new Error("本机助手未启动");
        if (requiresComputer) {
          const sessionResponse = await fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions`, { cache: "no-store" });
          const sessionPayload = await sessionResponse.json() as { sessions?: BrowserSessionState[] };
          const requiredSocial = task.sources.filter((source) => SOCIAL_SOURCES.includes(source));
          const missingLogins = requiredSocial.filter((source) => sessionPayload.sessions?.find((session) => session.platform === source)?.status !== "logged_in");
          if (missingLogins.length) {
            for (const platform of missingLogins) {
              await fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions/open`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }),
              });
            }
            setView("sources");
            throw new Error(`已打开 ${missingLogins.join("、")} 登录页；请完成登录并在数据源页确认后再运行`);
          }
        }
        const queries = [...new Set([...task.techKeywords, ...task.companyKeywords, ...task.signalKeywords])].slice(0, 12);
        for (let index = 0; index < task.sources.length; index += 1) {
          const source = task.sources[index];
          const jobId = `local-${crypto.randomUUID()}`;
          const dispatch = await fetch(`${LOCAL_ASSISTANT_URL}/v1/search-tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, taskId: task.id, platform: source, queries, excludeKeywords: task.excludeKeywords, timeRange: task.timeRange }),
          });
          const job = await dispatch.json() as Partial<LocalJob> & { error?: string };
          if (!dispatch.ok) throw new Error(job.error ?? `${source}无法打开`);
          localJobs[source] = {
            jobId: String(job.jobId ?? jobId), status: String(job.status ?? "running"),
            progress: safeNumber(job.progress ?? 10), fetched: safeNumber(job.fetched),
            currentAction: String(job.currentAction ?? `已在${source}打开关键词检索`),
            liveViewUrl: String(job.liveViewUrl ?? `${LOCAL_ASSISTANT_URL}/live`),
          };
          setRunProgress(15 + Math.round(((index + 1) / task.sources.length) * 45));
        }
        const terminal = new Set(["completed", "failed", "waiting_login", "cancelled"]);
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const updates = await Promise.all(Object.entries(localJobs).map(async ([source, job]) => {
            const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/search-tasks/${encodeURIComponent(job.jobId)}`, { cache: "no-store" });
            return [source, response.ok ? await response.json() as LocalJob : job] as const;
          }));
          for (const [source, job] of updates) localJobs[source] = job;
          localCandidates = updates.flatMap(([, job]) => Array.isArray(job.results) ? job.results : []);
          setRunProgress(62 + Math.round(((attempt + 1) / 24) * 24));
          if (updates.every(([, job]) => terminal.has(job.status))) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        }
      } catch (localError) {
        if (requiresComputer) throw localError instanceof Error ? localError : new Error("请先启动并登录芯探专用浏览器");
      }
      setRunProgress(90);
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "runTask", taskId: task.id, localJobs, localCandidates }),
      });
      const result = await response.json() as { valid?: number; status?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "任务运行失败");
      setRunProgress(100);
      await loadState();
      setToast(`“${task.name}”${result.status ?? "运行完成"}，本轮新增 ${result.valid ?? 0} 条；${result.message ?? ""}`);
    } catch (runError) {
      setToast(runError instanceof Error ? runError.message : "任务运行失败");
    } finally {
      window.setTimeout(() => {
        setRunningTask(null);
        setRunProgress(0);
      }, 700);
    }
  }

  async function changeTaskStatus(task: Task) {
    const nextStatus = task.status === "active" ? "paused" : "active";
    const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggleTask", taskId: task.id, status: nextStatus }) });
    if (response.ok) { await loadState(); setToast(nextStatus === "active" ? "任务已恢复" : "任务已暂停"); }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`确定删除“${task.name}”及其线索和日志吗？此操作不可撤销。`)) return;
    const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteTask", taskId: task.id }) });
    if (response.ok) { await loadState(); setToast("任务及关联记录已删除"); }
  }

  async function reviewLead(lead: Lead, status: string) {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reviewLead", leadId: lead.id, reviewStatus: status }),
    });
    if (response.ok) {
      setSelectedLead({ ...lead, reviewStatus: status });
      await loadState();
      setToast(status === "已确认" ? "已加入重点跟进" : "已标记为误报");
    }
  }

  function exportExcel() {
    const params = new URLSearchParams();
    if (sourceFilter !== "全部来源") params.set("source", sourceFilter);
    if (typeFilter !== "全部类型") params.set("type", typeFilter);
    if (priorityFilter !== "全部优先级") params.set("priority", priorityFilter);
    window.location.href = `/api/export?${params.toString()}`;
    setToast(`正在生成 Excel，共 ${filteredLeads.length} 条线索`);
  }

  if (loading) {
    return (
      <main className="loading-screen" role="status">
        <div className="brand-mark large">XT</div>
        <strong>芯探正在装载情报工作台</strong>
        <span>正在初始化任务、线索与数据源状态…</span>
      </main>
    );
  }

  if (error) {
    return (
      <main className="loading-screen error-state">
        <div className="brand-mark large">!</div>
        <strong>验证环境暂时没有准备好</strong>
        <span>{error}</span>
        <button className="primary-button" onClick={() => { setLoading(true); void loadState(); }}>重新加载</button>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">XT</div>
          <div><strong>XINTAN</strong><span>TALENT INTELLIGENCE</span></div>
        </div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === "leads" && <em>{data.leads.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="system-pulse"><span />SYSTEM OPERATIONAL</div>
          <p>Public-source intelligence</p>
          <small>PRIVATE WORKSPACE · v0.4</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">TALENT SIGNAL OPERATIONS</p>
            <h1>{NAV_ITEMS.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className="workspace-badge"><i /> PRIVATE WORKSPACE</span>
            <label className="global-search">
              <span>⌕</span>
              <input aria-label="全局搜索" placeholder="搜索线索、企业或技术栈" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button className="ghost-button" onClick={() => { setStartupSetupStep("ready"); setStartupSetupError(""); setShowStartupSetup(true); }}>配置数据源</button>
            <button className="primary-button" onClick={() => { setEditingTask(null); setShowTaskModal(true); }}>＋ 新建任务</button>
          </div>
        </header>

        <div className="content-area">
          {view === "overview" && (
            <Overview
              data={data}
              totals={totals}
              onViewLead={(lead) => setSelectedLead(lead)}
              onNavigate={setView}
              onCreate={() => { setEditingTask(null); setShowTaskModal(true); }}
            />
          )}
          {view === "tasks" && (
            <TasksView
              tasks={data.tasks}
              runningTask={runningTask}
              runProgress={runProgress}
              onRun={runSearchTask}
              onCreate={() => { setEditingTask(null); setShowTaskModal(true); }}
              onEdit={(task) => { setEditingTask(task); setShowTaskModal(true); }}
              onToggle={(task) => void changeTaskStatus(task)}
              onDelete={(task) => void deleteTask(task)}
            />
          )}
          {view === "leads" && (
            <LeadsView
              leads={filteredLeads}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              onView={setSelectedLead}
              onExport={exportExcel}
            />
          )}
          {view === "runs" && <RunsView runs={data.runs} />}
          {view === "sources" && <SourcesView sources={data.sources} jobs={data.connectorJobs ?? []} onChanged={loadState} />}
        </div>
      </section>

      {showTaskModal && (
        <TaskModal
          task={editingTask}
          onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
          onCreated={async () => {
            const wasEditing = Boolean(editingTask);
            setShowTaskModal(false);
            setEditingTask(null);
            await loadState();
            setView("tasks");
            setToast(wasEditing ? "检索任务已更新" : "检索任务已创建，可立即运行");
          }}
        />
      )}

      {showStartupSetup && (
        <StartupSetupModal
          onConfigure={enterSourceSetup}
          onClose={() => setShowStartupSetup(false)}
        />
      )}

      {showGuide && (
        <GuideModal
          onClose={() => setShowGuide(false)}
          onCreate={() => { setShowGuide(false); setEditingTask(null); setShowTaskModal(true); }}
          onNavigate={(nextView) => { setShowGuide(false); setView(nextView); }}
        />
      )}

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onReview={(status) => void reviewLead(selectedLead, status)}
        />
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Overview({
  data, totals, onViewLead, onNavigate, onCreate,
}: {
  data: AppState;
  totals: { fetched: number; valid: number; high: number; confirmed: number };
  onViewLead: (lead: Lead) => void;
  onNavigate: (view: View) => void;
  onCreate: () => void;
}) {
  const activeTasks = data.tasks.filter((task) => task.status === "active").length;
  const pendingLeads = data.leads.filter((lead) => lead.reviewStatus === "待审核").length;
  return (
    <>
      <section className="overview-hero">
        <div className="overview-copy">
          <p className="eyebrow">TALENT INTELLIGENCE</p>
          <h2>Talent signals,<br /><em>clearly ranked.</em></h2>
          <p>从 JD 出发，持续发现人才流动、团队扩张与项目变化。每条线索都保留来源和判断依据。</p>
          <div className="hero-actions"><button className="primary-button" onClick={onCreate}>从 JD 创建任务</button><button className="ghost-button" onClick={() => onNavigate("leads")}>查看线索</button></div>
        </div>
        <div className="overview-status">
          <button onClick={() => onNavigate("tasks")}><span>Active tasks</span><strong>{activeTasks}</strong><small>持续运行的检索任务</small></button>
          <button onClick={() => onNavigate("sources")}><span>Sources</span><strong>{data.sources.length}</strong><small>已配置，实时状态在连接页</small></button>
          <button onClick={() => onNavigate("leads")}><span>Review queue</span><strong>{pendingLeads}</strong><small>等待人工确认的线索</small></button>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="累计分析内容" value={totals.fetched.toLocaleString()} delta="跨6个来源" tone="ink" />
        <Metric label="有效情报线索" value={totals.valid.toLocaleString()} delta="过滤后结果" tone="green" />
        <Metric label="A级高价值" value={String(totals.high)} delta="建议优先处理" tone="orange" />
        <Metric label="人工已确认" value={String(totals.confirmed)} delta="反馈用于优化" tone="blue" />
      </section>

      <section className="two-column-grid">
        <div className="panel recent-panel">
          <div className="panel-head"><div><p className="eyebrow">LIVE SIGNALS</p><h3>最新高价值线索</h3></div><button className="text-button" onClick={() => onNavigate("leads")}>全部线索 →</button></div>
          <div className="signal-list">
            {data.leads.slice(0, 4).map((lead) => (
              <button className="signal-row" key={lead.id} onClick={() => onViewLead(lead)}>
                <span className={`priority-dot p-${lead.priority.toLowerCase()}`}>{lead.priority}</span>
                <span className="signal-content"><b>{lead.author}</b><span>{lead.snippet}</span><small>{lead.source} · {lead.publishedAt}</small></span>
                <span className="score-pill">{lead.score}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel source-panel">
          <div className="panel-head"><div><p className="eyebrow">SOURCE COVERAGE</p><h3>覆盖来源</h3></div><button className="text-button" onClick={() => onNavigate("sources")}>检测连接 →</button></div>
          <div className="source-mini-grid">
            {data.sources.map((source) => (
              <div className="source-mini" key={source.id}>
                <span className="source-logo">{initials(source.name)}</span>
                <span><b>{source.name}</b><small>{SOCIAL_SOURCES.includes(source.name) ? "Local browser" : "Public forum"}</small></span>
                <i className="health-dot testing" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, delta, tone }: { label: string; value: string; delta: string; tone: string }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{delta}</small></div>;
}

function TasksView({ tasks, runningTask, runProgress, onRun, onCreate, onEdit, onToggle, onDelete }: {
  tasks: Task[];
  runningTask: string | null;
  runProgress: number;
  onRun: (task: Task) => void;
  onCreate: () => void;
  onEdit: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">SEARCH MISSIONS</p><h2>把每个JD变成持续运转的情报任务</h2><p>配置技术栈、目标企业、求职信号、时间范围和排除规则。</p></div><button className="primary-button" onClick={onCreate}>＋ 新建检索任务</button></div>
      <div className="task-grid">
        {tasks.map((task) => (
          <article className="task-card" key={task.id}>
            <div className="task-top"><span className={task.status === "active" ? "status-badge active" : "status-badge paused"}>{task.status === "active" ? "运行中" : "已暂停"}</span><div className="task-actions"><button className="more-button" onClick={() => onEdit(task)}>编辑</button><button className="more-button" onClick={() => onToggle(task)}>{task.status === "active" ? "暂停" : "恢复"}</button><button className="more-button danger" onClick={() => onDelete(task)}>删除</button></div></div>
            <h3>{task.name}</h3><p className="task-jd">{task.jd}</p>
            <div className="tag-row">{task.techKeywords.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="task-meta"><span>来源 <b>{task.sources.length}</b></span><span>线索 <b>{task.discovered}</b></span><span>A级 <b>{task.highValue}</b></span></div>
            <div className="task-schedule"><span>↻ {task.schedule}</span><span>{task.timeRange}</span></div>
            {runningTask === task.id && <div className="progress-track"><span style={{ width: `${runProgress}%` }} /></div>}
            <button className="run-button" disabled={Boolean(runningTask) || task.status !== "active"} onClick={() => onRun(task)}>{runningTask === task.id ? `正在扫描 ${runProgress}%` : task.status === "active" ? "立即增量扫描" : "恢复后运行"}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function LeadsView({ leads, sourceFilter, setSourceFilter, typeFilter, setTypeFilter, priorityFilter, setPriorityFilter, onView, onExport }: {
  leads: Lead[];
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  onView: (lead: Lead) => void;
  onExport: () => void;
}) {
  return (
    <section className="panel table-panel">
      <div className="table-header">
        <div><p className="eyebrow">EVIDENCE INBOX</p><h2>线索工作台</h2><span>所有AI判断均附带公开原文证据</span></div>
        <button className="primary-button" onClick={onExport}>⇩ 导出Excel</button>
      </div>
      <div className="filter-bar">
        <select aria-label="来源筛选" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>全部来源</option>{ALL_SOURCES.map((source) => <option key={source}>{source}</option>)}</select>
        <select aria-label="类型筛选" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>全部类型</option><option>人才线索</option><option>企业情报</option></select>
        <select aria-label="优先级筛选" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>全部优先级</option><option>A</option><option>B</option><option>C</option></select>
        <span className="filter-count">找到 {leads.length} 条结果</span>
      </div>
      <div className="lead-table-wrap">
        <table className="lead-table">
          <thead><tr><th>价值</th><th>公开作者与来源</th><th>原文证据</th><th>AI标签</th><th>求职信号</th><th>状态</th><th /></tr></thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} onClick={() => onView(lead)}>
                <td><span className={`priority-badge p-${lead.priority.toLowerCase()}`}>{lead.priority}</span><small className="score-caption">{lead.score}分</small></td>
                <td><b>{lead.author}</b><small>{lead.source} · {lead.authorId}</small></td>
                <td className="snippet-cell"><span>{lead.snippet}</span><small>{lead.publishedAt}</small></td>
                <td><div className="compact-tags">{lead.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div></td>
                <td><span className={`intent-badge intent-${lead.intent}`}>{lead.intent}</span></td>
                <td><span className="review-status">{lead.reviewStatus}</span></td>
                <td><button className="row-arrow" aria-label={`查看${lead.author}详情`}>›</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && <div className="empty-state"><strong>没有匹配的线索</strong><span>调整筛选条件或全局搜索词后再试。</span></div>}
      </div>
    </section>
  );
}

function RunsView({ runs }: { runs: Run[] }) {
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">RUN AUDIT</p><h2>每次扫描都可追踪、可解释</h2><p>记录抓取、过滤、去重和AI提炼数量，便于排查平台连接器状态。</p></div></div>
      <div className="run-list">
        {runs.map((run) => (
          <article className="run-card" key={run.id}>
            <div className={`run-status ${run.status === "完成" ? "success" : "partial"}`}>{run.status === "完成" ? "✓" : "!"}</div>
            <div className="run-main"><div><h3>{run.taskName}</h3><span>{new Date(run.startedAt).toLocaleString("zh-CN", { hour12: false })}</span></div><p>{run.message}</p></div>
            <div className="run-stats"><span>获取<b>{run.fetched}</b></span><span>过滤<b>{run.filtered}</b></span><span>重复<b>{run.deduped}</b></span><span>有效<b>{run.valid}</b></span><span>A级<b>{run.highValue}</b></span></div>
          </article>
        ))}
      </div>
    </section>
  );
}

const EMPTY_CONNECTOR_SETTINGS: ConnectorSettingsState = {
  endpoint: "http://127.0.0.1:8765", hasToken: false, hasCallbackSecret: false, enabledSources: ["抖音", "微博", "小红书", "知乎"],
  status: "not_configured", lastTestAt: null, lastError: "", liveViewUrl: "", capabilities: [],
};
const LOCAL_ASSISTANT_URL = "http://127.0.0.1:8765";

function ConnectorSettingsPanel({ sources, onChanged, onConnectionChange }: { sources: Source[]; onChanged: () => Promise<void>; onConnectionChange: (connected: boolean) => void }) {
  const [settings, setSettings] = useState(EMPTY_CONNECTOR_SETTINGS);
  const [testing, setTesting] = useState(true);
  const [message, setMessage] = useState("");
  const [sessions, setSessions] = useState<BrowserSessionState[]>([]);
  const [openingPlatform, setOpeningPlatform] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [connectivity, setConnectivity] = useState<SourceConnectivity[]>([]);
  const [checkingSources, setCheckingSources] = useState(false);
  const [checkingPlatform, setCheckingPlatform] = useState("");

  const refreshSources = useCallback(async () => {
    setCheckingSources(true); setSessionMessage("");
    try {
      const [connectivityResponse, sessionResponse] = await Promise.all([
        fetch(`${LOCAL_ASSISTANT_URL}/v1/connectivity`, { cache: "no-store" }),
        fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions`, { cache: "no-store" }),
      ]);
      const connectivityResult = await connectivityResponse.json() as { sources?: SourceConnectivity[]; error?: string };
      const sessionResult = await sessionResponse.json() as { sessions?: BrowserSessionState[]; error?: string };
      if (!connectivityResponse.ok) throw new Error(connectivityResult.error ?? "数据源检测失败");
      if (!sessionResponse.ok) throw new Error(sessionResult.error ?? "登录状态检测失败");
      setConnectivity(connectivityResult.sources ?? []);
      setSessions(sessionResult.sessions ?? []);
      setSessionMessage("六个数据源已完成检测");
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : "数据源检测失败"); }
    finally { setCheckingSources(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${LOCAL_ASSISTANT_URL}/health`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("本地助手尚未启动");
      const result = await response.json() as { liveViewUrl?: string; capabilities?: string[] };
      if (!cancelled) {
        const liveViewUrl = result.liveViewUrl ? new URL(result.liveViewUrl, LOCAL_ASSISTANT_URL).toString() : "";
        setSettings({ ...EMPTY_CONNECTOR_SETTINGS, status: "connected", lastTestAt: new Date().toISOString(), liveViewUrl, capabilities: result.capabilities ?? [] });
        setMessage("已自动连接当前电脑");
        onConnectionChange(true);
        void refreshSources();
      }
    }).catch(() => { if (!cancelled) { setSettings({ ...EMPTY_CONNECTOR_SETTINGS, lastError: "未检测到本地电脑助手" }); onConnectionChange(false); } })
      .finally(() => { if (!cancelled) setTesting(false); });
    return () => { cancelled = true; };
  }, [onConnectionChange, refreshSources]);

  async function testConnection() {
    setTesting(true); setMessage("正在自动检测当前电脑…");
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error("本地助手尚未启动");
      const result = await response.json() as { liveViewUrl?: string; capabilities?: string[] };
      const liveViewUrl = result.liveViewUrl ? new URL(result.liveViewUrl, LOCAL_ASSISTANT_URL).toString() : "";
      setSettings({ ...EMPTY_CONNECTOR_SETTINGS, status: "connected", lastTestAt: new Date().toISOString(), liveViewUrl, capabilities: result.capabilities ?? [] });
      setMessage("已自动连接当前电脑"); onConnectionChange(true); await onChanged();
      await refreshSources();
    } catch { setSettings({ ...EMPTY_CONNECTOR_SETTINGS, lastError: "未检测到本地电脑助手" }); onConnectionChange(false); setMessage("请先启动芯探电脑助手，网页会自动连接，无需任何配置"); }
    finally { setTesting(false); }
  }

  async function openPlatform(platform: string) {
    setOpeningPlatform(platform); setSessionMessage("");
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "无法打开平台");
      if (SOCIAL_SOURCES.includes(platform)) {
        setSessions((current) => current.map((item) => item.platform === platform ? { ...item, status: "browser_open", lastCheckedAt: new Date().toISOString() } : item));
        setSessionMessage(`${result.message ?? `已通知电脑打开${platform}`}；登录完成后请返回点击“确认已登录”`);
      } else {
        setSessionMessage(result.message ?? `已在浏览器打开${platform}`);
      }
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : "无法打开平台"); }
    finally { setOpeningPlatform(""); }
  }

  async function confirmPlatform(platform: string) {
    setOpeningPlatform(platform); setSessionMessage("");
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "确认失败");
      setSessions((current) => current.map((item) => item.platform === platform ? { ...item, status: "logged_in", lastCheckedAt: new Date().toISOString() } : item));
      setSessionMessage(result.message ?? `${platform}已确认登录`);
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : "确认失败"); }
    finally { setOpeningPlatform(""); }
  }

  async function checkPlatform(platform: string) {
    setCheckingPlatform(platform); setSessionMessage("");
    try {
      const [connectivityResponse, sessionResponse] = await Promise.all([
        fetch(`${LOCAL_ASSISTANT_URL}/v1/connectivity`, { cache: "no-store" }),
        fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions`, { cache: "no-store" }),
      ]);
      const connectivityResult = await connectivityResponse.json() as { sources?: SourceConnectivity[]; error?: string };
      const sessionResult = await sessionResponse.json() as { sessions?: BrowserSessionState[]; error?: string };
      if (!connectivityResponse.ok) throw new Error(connectivityResult.error ?? `${platform}检测失败`);
      setConnectivity(connectivityResult.sources ?? []);
      if (sessionResponse.ok) setSessions(sessionResult.sessions ?? []);
      const sourceResult = connectivityResult.sources?.find((item) => item.name === platform);
      setSessionMessage(sourceResult?.reachable ? `${platform}连接正常` : `${platform}暂时无法连接${sourceResult?.detail ? `：${sourceResult.detail}` : ""}`);
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : `${platform}检测失败`); }
    finally { setCheckingPlatform(""); }
  }

  const statusLabel = settings.status === "connected" ? "已连接" : settings.status === "failed" ? "连接失败" : settings.status === "saved" ? "等待检测" : "待连接";
  const reachableCount = connectivity.filter((item) => item.reachable).length;
  return (
    <section className="settings-panel" id="connector-settings">
      <div className="settings-head"><div><p className="eyebrow">CONNECTIONS</p><h3>数据源连接</h3><span>每个平台独立配置；账号和 Cookie 只保存在当前电脑。</span></div><div className="source-head-actions"><span className={`settings-status ${settings.status}`}>{statusLabel}</span><button className="ghost-button" disabled={testing || checkingSources} onClick={() => void (settings.status === "connected" ? refreshSources() : testConnection())}>{testing || checkingSources ? "检测中…" : "检测全部"}</button></div></div>
      <div className="pair-card">
        <div className={`computer-illustration ${settings.status === "connected" ? "online" : ""}`}><span>XT</span><i /></div>
        <div className="pair-copy"><b>{settings.status === "connected" ? "Local assistant connected" : "Local assistant offline"}</b><p>{settings.status === "connected" ? `${reachableCount || 0}/6 个来源已完成网络验证，账号状态见下方。` : "请启动芯探电脑助手；启动后页面会自动识别。"}</p></div>
        <div className="pair-actions">{settings.liveViewUrl && <a href={settings.liveViewUrl} target="_blank" rel="noreferrer" className="ghost-button live-view-button">查看实时画面</a>}<button className="primary-button" disabled={testing} onClick={() => void testConnection()}>{testing ? "正在检测…" : "重新连接"}</button></div>
      </div>
      <div className="source-center-head"><div><b>6 Sources</b><span>网络连通与账号状态</span></div><small>账号数据仅保留在本机</small></div>
      <div className="source-connection-grid">
        {sources.map((source) => {
          const check = connectivity.find((item) => item.name === source.name);
          const isSocial = SOCIAL_SOURCES.includes(source.name);
          const session = sessions.find((item) => item.platform === source.name);
          const waitingConfirmation = session?.status === "browser_open";
          const label = !check ? (checkingSources ? "检测中" : "待检测") : !check.reachable ? "连接失败" : isSocial && session?.status === "logged_in" ? "已登录" : waitingConfirmation ? "待确认" : isSocial ? "可访问" : check.status === "restricted" ? "浏览器可达" : "已连通";
          const tone = label === "已登录" || label === "已连通" || label === "浏览器可达" ? "ready" : label === "连接失败" ? "failed" : "pending";
          return <article className="source-connection" key={source.id}>
            <span className="source-logo large">{initials(source.name)}</span>
            <div className="source-connection-copy"><b>{source.name}</b><span>{check?.detail ?? source.coverage}</span></div>
            <em className={tone}>{label}</em>
            <div className="source-card-actions">
              <button disabled={settings.status !== "connected" || checkingPlatform === source.name} onClick={() => void checkPlatform(source.name)}>{checkingPlatform === source.name ? "检测中…" : "检测"}</button>
              <button disabled={settings.status !== "connected" || openingPlatform === source.name} onClick={() => void (isSocial && waitingConfirmation ? confirmPlatform(source.name) : openPlatform(source.name))}>{openingPlatform === source.name ? "处理中…" : isSocial && waitingConfirmation ? "确认登录" : isSocial && session?.status !== "logged_in" ? "配置" : "重新配置"}</button>
            </div>
          </article>;
        })}
      </div>
      {(sessionMessage || message || settings.lastError) && <div className="session-message">{sessionMessage || message || settings.lastError}</div>}
    </section>
  );
}

function SourcesView({ sources, jobs, onChanged }: { sources: Source[]; jobs: NonNullable<AppState["connectorJobs"]>; onChanged: () => Promise<void> }) {
  const [localConnected, setLocalConnected] = useState(false);
  const latestJobs = jobs.filter((job, index) => jobs.findIndex((candidate) => candidate.taskId === job.taskId && candidate.source === job.source) === index);
  const waitingJobs = localConnected ? 0 : latestJobs.filter((job) => job.status === "awaiting_config").length || sources.filter((source) => source.status.includes("待")).length;
  const liveJob = latestJobs.find((job) => ["running", "waiting_login", "dispatched"].includes(job.status)
    && !job.currentAction.includes("ProcessSingleton") && !job.currentAction.includes("Failed to create"));
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [heartbeatClock, setHeartbeatClock] = useState(0);
  const lastHeartbeat = liveJob?.updatedAt ? Date.parse(liveJob.updatedAt) : 0;
  const streamStale = Boolean(liveJob && liveJob.status === "running" && lastHeartbeat && heartbeatClock && heartbeatClock - lastHeartbeat > 20_000);
  useEffect(() => {
    const timer = window.setInterval(() => { setHeartbeatClock(new Date().getTime()); void onChanged(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [onChanged]);
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">DATA SOURCES</p><h2>连接与账号</h2><p>六个平台独立配置、独立检测；需要登录的平台直接在本机浏览器完成。</p></div></div>
      <ConnectorSettingsPanel sources={sources} onChanged={onChanged} onConnectionChange={setLocalConnected} />
      <section className="live-console">
        <div className="live-console-head"><div><p className="eyebrow">MANDATORY SCREEN MIRROR</p><h3>电脑实时同屏</h3><span>电脑看见什么，这里就同步看见什么；画面中断时任务必须暂停。</span></div><div className="live-controls">{liveJob?.liveViewUrl && <button onClick={() => void stageRef.current?.requestFullscreen()}>全屏观看</button>}{liveJob && <span className={`job-state ${streamStale ? "failed" : liveJob.status}`}>{streamStale ? "画面心跳中断" : liveJob.status === "running" ? "实时执行中" : liveJob.status === "waiting_login" ? "等待人工登录" : liveJob.status === "completed" ? "已完成" : liveJob.status === "failed" ? "失败" : "已派发"}</span>}</div></div>
        {liveJob ? <div className="live-console-body">
          <div className={`browser-stage ${streamStale ? "stream-stale" : ""}`} ref={stageRef}>{liveJob.liveViewUrl ? <iframe src={liveJob.liveViewUrl} title={`${liveJob.source} 电脑实时同屏`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allow="fullscreen; autoplay" allowFullScreen /> : <div className="screen-placeholder blocked"><span>SCREEN REQUIRED</span><strong>实时同屏未建立，任务已暂停</strong><p>电脑助手建立实时画面后，鼠标、点击、输入、滚动和页面跳转才会在这里同步显示。</p></div>}{streamStale && <div className="stream-alert"><strong>画面心跳已中断</strong><span>电脑助手已暂停操作，恢复画面后才能继续。</span></div>}</div>
          <div className="job-telemetry"><span>{liveJob.source} · {new Date(liveJob.dispatchedAt).toLocaleString("zh-CN", { hour12: false })}</span><h4>{liveJob.currentAction || (liveJob.error ? "执行失败" : "等待电脑助手状态")}</h4><div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, safeNumber(liveJob.progress)))}%` }} /></div><p>{safeNumber(liveJob.progress)}% · 已获取 {liveJob.fetched} 条</p>{liveJob.error && <div className="job-error">{liveJob.error}</div>}{liveJob.liveViewUrl && <a href={liveJob.liveViewUrl} target="_blank" rel="noreferrer" className="live-link">在新窗口观看电脑操作 ↗</a>}</div>
        </div> : <div className="live-empty"><strong>{waitingJobs ? "电脑助手尚未连接" : "当前没有正在执行的电脑任务"}</strong><span>{waitingJobs ? "任务没有派发，也没有操作你的电脑。启动并连接本地助手后才能运行。" : "运行包含社媒平台的任务后，电脑画面会显示在这里。"}</span></div>}
      </section>
      <div className="boundary-note"><b>DATA POLICY</b><span>只处理公开或已获授权的数据；平台覆盖率、账号风控与商业权限必须在客户真实账号下验证。界面中的初始六条线索为产品演示样本，新运行日志不再使用模拟抓取数字。</span></div>
    </section>
  );
}

function TaskModal({ task, onClose, onCreated }: { task: Task | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(task?.name ?? "模拟IC设计工程师");
  const [jd, setJd] = useState(task?.jd ?? "模拟IC设计工程师，5年以上经验，熟悉PLL、ADC或电源管理芯片，有完整流片经验，工作地点上海。");
  const [techKeywords, setTechKeywords] = useState<string[]>(task?.techKeywords ?? []);
  const [companies, setCompanies] = useState((task?.companyKeywords ?? ["海思", "圣邦微", "思瑞浦"]).join("、"));
  const [signals, setSignals] = useState((task?.signalKeywords ?? ["看机会", "准备离职", "团队调整", "扩招", "流片延期"]).join("、"));
  const [excludes, setExcludes] = useState((task?.excludeKeywords ?? ["培训", "招生", "广告"]).join("、"));
  const [authorBlacklist, setAuthorBlacklist] = useState((task?.authorBlacklist ?? []).join("、"));
  const [companyBlacklist, setCompanyBlacklist] = useState((task?.companyBlacklist ?? []).join("、"));
  const [sources, setSources] = useState(task?.sources ?? ["抖音", "微博", "EETOP"]);
  const [schedule, setSchedule] = useState(task?.schedule ?? "每天 09:00");
  const [timeRange, setTimeRange] = useState(task?.timeRange ?? "近30天");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [formError, setFormError] = useState("");
  const split = (value: string) => value.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);

  async function analyze() {
    if (!jd.trim()) { setFormError("请先填写 JD 内容"); return []; }
    setFormError("");
    setAnalyzing(true);
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "analyzeJd", jd }) });
      const result = await response.json() as { techKeywords?: string[]; companyKeywords?: string[]; signalKeywords?: string[]; excludeKeywords?: string[]; error?: string };
      if (response.ok) {
        setTechKeywords(result.techKeywords ?? []);
        if (result.companyKeywords?.length) setCompanies(result.companyKeywords.join("、"));
        if (result.signalKeywords?.length) setSignals(result.signalKeywords.join("、"));
        if (result.excludeKeywords?.length) setExcludes(result.excludeKeywords.join("、"));
        return result.techKeywords ?? [];
      }
      setFormError(result.error ?? "JD 拆解失败，请稍后重试");
      return [];
    } catch { setFormError("网络异常，JD 拆解未完成"); return []; }
    finally { setAnalyzing(false); }
  }

  async function save() {
    if (!name.trim() || !jd.trim()) { setFormError("任务名称和 JD 不能为空"); return; }
    if (!sources.length) { setFormError("至少选择一个数据源"); return; }
    setFormError("");
    setSaving(true);
    const effectiveTechKeywords = techKeywords.length ? techKeywords : await analyze();
    try {
      const response = await fetch("/api/state", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: task ? "updateTask" : "createTask",
          task: { id: task?.id, name, jd, status: task?.status ?? "active", sources, techKeywords: effectiveTechKeywords,
            companyKeywords: split(companies), signalKeywords: split(signals), excludeKeywords: split(excludes),
            authorBlacklist: split(authorBlacklist), companyBlacklist: split(companyBlacklist), schedule, timeRange, scheduleEnabled: schedule !== "仅手动运行" },
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setFormError(result.error ?? "保存失败，请稍后重试"); return; }
      await onCreated();
    } catch { setFormError("网络异常，任务未保存"); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
        <div className="modal-head"><div><p className="eyebrow">SEARCH MISSION</p><h2 id="task-modal-title">{task ? "编辑检索任务" : "创建检索任务"}</h2></div><button className="close-button" onClick={onClose} aria-label="关闭">×</button></div>
        <div className="modal-body">
          <label><span>任务名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>职位描述 JD</span><textarea rows={5} value={jd} onChange={(event) => setJd(event.target.value)} /></label>
          <button className="analyze-button" disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "正在拆解…" : "✦ AI拆解技术栈和检索词"}</button>
          {techKeywords.length > 0 && <div className="keyword-box"><b>识别及扩展出的技术词</b><div className="tag-row">{techKeywords.map((word) => <span key={word}>{word}</span>)}</div><small>服务端芯片行业词库会扩展缩写、同义词和EDA工具名称。</small></div>}
          <label><span>目标企业</span><input value={companies} onChange={(event) => setCompanies(event.target.value)} /></label>
          <label><span>求职与企业信号关键词</span><input value={signals} onChange={(event) => setSignals(event.target.value)} /></label>
          <label><span>内容黑名单关键词</span><input value={excludes} onChange={(event) => setExcludes(event.target.value)} /></label>
          <div className="form-grid"><label><span>作者黑名单</span><input value={authorBlacklist} onChange={(event) => setAuthorBlacklist(event.target.value)} /></label><label><span>企业黑名单</span><input value={companyBlacklist} onChange={(event) => setCompanyBlacklist(event.target.value)} /></label></div>
          <div className="form-grid"><label><span>扫描计划</span><select value={schedule} onChange={(event) => setSchedule(event.target.value)}><option>每天 09:00</option><option>每天 18:00</option><option>每周一 10:00</option><option>仅手动运行</option></select></label><label><span>时间范围</span><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}><option>近7天</option><option>近30天</option><option>近90天</option></select></label></div>
          <fieldset><legend>数据源</legend><div className="source-checks">{ALL_SOURCES.map((source) => <label key={source}><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])} /><span>{source}</span></label>)}</div></fieldset>
          {formError && <div className="form-error" role="alert">{formError}</div>}
        </div>
        <div className="modal-actions"><button className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : task ? "保存任务" : "创建并进入任务"}</button></div>
      </section>
    </div>
  );
}

function StartupSetupModal({ onConfigure, onClose }: { onConfigure: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop startup-backdrop" role="presentation">
      <section className="startup-setup-modal" role="dialog" aria-modal="true" aria-labelledby="startup-setup-title">
        <div className="startup-step">STARTUP CHECK</div>
        <div className="startup-icon"><span>XT</span><i /></div>
        <p className="eyebrow">SOURCE SETUP</p>
        <h2 id="startup-setup-title">按需配置数据源</h2>
        <p>每个平台都可以单独打开、登录和检测。完成一次后，芯探会在这台电脑上保留对应会话。</p>
        <div className="startup-source-row">{ALL_SOURCES.map((source) => <span key={source}>{initials(source)}<small>{source}</small></span>)}</div>
        <div className="startup-hint"><b>不必一次配置全部</b><span>进入“数据源”后，选择当前需要的平台逐个配置即可。</span></div>
        <div className="startup-actions">
          <button className="ghost-button" onClick={onClose}>稍后配置</button>
          <button className="primary-button" onClick={onConfigure}>进入数据源配置</button>
        </div>
      </section>
    </div>
  );
}

function GuideModal({ onClose, onCreate, onNavigate }: { onClose: () => void; onCreate: () => void; onNavigate: (view: View) => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="modal-head"><div><p className="eyebrow">QUICK START GUIDE</p><h2 id="guide-title">三分钟完成第一次人才检索</h2></div><button className="close-button" onClick={onClose} aria-label="关闭">×</button></div>
        <div className="guide-body">
          <p className="guide-intro">不用先研究所有菜单。创建一个任务、运行一次检索、审核一条线索，就能理解完整工作流。</p>
          <div className="guide-journey">
            <article><span>01</span><div><h3>粘贴客户 JD</h3><p>系统自动识别职位、技术栈、目标企业、求职信号和排除词，你只需检查结果。</p><button onClick={onCreate}>创建检索任务 →</button></div></article>
            <article><span>02</span><div><h3>连接已登录的电脑浏览器</h3><p>先在电脑上登录抖音、小红书等平台；电脑助手会复用现有登录状态，不需要在本系统填写账号密码。</p><button onClick={() => onNavigate("sources")}>检查电脑与登录状态 →</button></div></article>
            <article><span>03</span><div><h3>人工复核高价值线索</h3><p>优先看 A 级线索，核对公开原文、作者和来源链接，再标记确认或误报。</p><button onClick={() => onNavigate("leads")}>打开线索工作台 →</button></div></article>
          </div>
          <div className="guide-terms"><b>三个概念</b><span><strong>任务</strong>＝一套持续运行的检索条件</span><span><strong>线索</strong>＝经过过滤和分析的公开内容</span><span><strong>运行日志</strong>＝每次获取、过滤、去重的审计记录</span></div>
        </div>
        <div className="modal-actions"><button className="ghost-button" onClick={onClose}>稍后再看</button><button className="primary-button" onClick={onCreate}>开始创建第一个任务</button></div>
      </section>
    </div>
  );
}

function LeadDrawer({ lead, onClose, onReview }: { lead: Lead; onClose: () => void; onReview: (status: string) => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="lead-drawer" role="dialog" aria-modal="true" aria-label="线索详情">
        <div className="drawer-head"><div><span className={`priority-badge p-${lead.priority.toLowerCase()}`}>{lead.priority}</span><div><p className="eyebrow">LEAD EVIDENCE</p><h2>{lead.intelligenceType}</h2></div></div><button className="close-button" onClick={onClose}>×</button></div>
        <div className="drawer-body">
          <section className="author-block"><span className="author-avatar">{lead.author.slice(0, 1)}</span><div><h3>{lead.author}</h3><p>{lead.source} · {lead.authorId}</p></div><span className="score-large">{lead.score}<small>匹配分</small></span></section>
          <section className="evidence-card"><span>公开原文证据</span><blockquote>“{lead.snippet}”</blockquote><small>{lead.publishedAt}</small></section>
          <section className="analysis-block"><h3>AI结构化判断</h3><dl><div><dt>线索类型</dt><dd>{lead.intelligenceType}</dd></div><div><dt>求职信号</dt><dd>{lead.intent}</dd></div><div><dt>推荐说明</dt><dd>{lead.companyNote}</dd></div><div><dt>关键证据</dt><dd>{lead.evidence}</dd></div></dl></section>
          <section><h3>提取标签</h3><div className="tag-row">{lead.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>
          <a className="source-link" href={lead.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>
          <section className="privacy-note"><b>判断边界</b><p>仅基于公开内容生成辅助线索，不代表作者真实求职意愿。建议猎头人工复核后再决定是否跟进。</p></section>
        </div>
        <div className="drawer-actions"><button className="reject-button" onClick={() => onReview("误报")}>标记误报</button><button className="confirm-button" onClick={() => onReview("已确认")}>确认并重点跟进</button></div>
      </aside>
    </div>
  );
}

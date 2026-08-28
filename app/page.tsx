"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type View = "overview" | "tasks" | "leads" | "settings";

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
  sourceLimits?: Record<string, number>;
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

type AnalysisTraceItem = {
  index: number; url: string; snippet: string; author: string; status: string;
  authorId?: string; publishedAt?: string;
  decision: "保留" | "过滤" | "继续探索" | "待判断"; reason: string; tags: string[]; matchedKeywords: string[];
  excludeMatches: string[]; intent: string; intelligenceType: string; score: number; priority: string;
  reasoningSummary?: string; nextAction?: string; actionReason?: string; confidence?: number;
  policyStatus?: string; model?: string; stopReason?: string; evidenceQuotes?: string[]; detailExcerpt?: string;
  commentRead?: number; commentTarget?: number; commentPreview?: string; contentKind?: string;
};

type LocalResult = { source: string; externalId: string; author: string; authorId: string; publishedAt: string; snippet: string; url: string; raw?: unknown };

type LocalJob = {
  jobId: string; platform?: string; status: string; phase?: string; progress: number; fetched: number;
  inspected?: number; kept?: number; filtered?: number; currentAction: string; liveViewUrl: string;
  targetItems?: number; commentTarget?: number;
  prefiltered?: number;
  currentItem?: AnalysisTraceItem; analysisTrace?: AnalysisTraceItem[]; results?: LocalResult[];
};

type AppState = {
  tasks: Task[];
  leads: Lead[];
  runs: Run[];
  sources: Source[];
  connectorJobs?: Array<{
    id: string; taskId: string; source: string; status: string; dispatchedAt: string;
    fetched: number; error: string; progress: number; currentAction: string;
    liveViewUrl: string; screenshotUrl: string; updatedAt?: string; phase?: string;
    inspected?: number; kept?: number; filtered?: number; currentItem?: AnalysisTraceItem;
    analysisTrace?: AnalysisTraceItem[];
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

type SourceVerification = {
  platform: string; status: "passed" | "failed"; testedAt: string; pageUrl?: string; error?: string;
  checks: Array<{ key: string; label: string; status: "passed" | "failed"; detail: string }>;
};

type AiBrainSettings = {
  provider: string; baseUrl: string; model: string; hasApiKey: boolean; status: string;
  lastTestAt: string; lastError: string; allowedActions: string[]; blockedActions: string[];
  policy: { maxStepsPerSource: number; maxItemsPerSource: number; allowOpenDetail: boolean; allowReadComments: boolean; allowRefineSearch: boolean; allowCrossPlatformSuggestion: boolean };
};

type ImportCandidate = {
  source: string; externalId?: string; author?: string; authorId?: string; publishedAt?: string;
  title?: string; snippet: string; fullText?: string; url: string; raw?: unknown;
};

type ImportPreview = {
  fileName: string; format: string; total: number; accepted: number; failed: number;
  items: ImportCandidate[]; errors: Array<{ rowNumber: number; code: string; message: string }>;
};

const EMPTY_STATE: AppState = { tasks: [], leads: [], runs: [], sources: [] };
const ALL_SOURCES = ["知乎"];
const SOCIAL_SOURCES = ["知乎"];
const DEFAULT_SOURCE_LIMITS: Record<string, number> = { 知乎: 10 };

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "总览", icon: "01" },
  { id: "tasks", label: "检索", icon: "02" },
  { id: "leads", label: "线索", icon: "03" },
  { id: "settings", label: "设置", icon: "04" },
];

function initials(name: string) {
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showStartupSetup, setShowStartupSetup] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState(0);
  const [liveJobs, setLiveJobs] = useState<Record<string, LocalJob>>({});
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("全部来源");
  const [typeFilter, setTypeFilter] = useState("全部类型");
  const [priorityFilter, setPriorityFilter] = useState("全部优先级");
  const [taskFilter, setTaskFilter] = useState("全部任务");
  const [intentFilter, setIntentFilter] = useState("全部意向");
  const [reviewFilter, setReviewFilter] = useState("全部状态");

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
    setView("settings");
    setToast("请完成知乎登录与功能验收");
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
      const matchesTask = taskFilter === "全部任务" || lead.taskId === taskFilter;
      const matchesIntent = intentFilter === "全部意向" || lead.intent === intentFilter;
      const matchesReview = reviewFilter === "全部状态" || lead.reviewStatus === reviewFilter;
      return matchesQuery && matchesSource && matchesType && matchesPriority && matchesTask && matchesIntent && matchesReview;
    });
  }, [data.leads, query, sourceFilter, typeFilter, priorityFilter, taskFilter, intentFilter, reviewFilter]);

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
    setLiveJobs({});
    try {
      const localJobs: Record<string, LocalJob> = {};
      let localCandidates: LocalResult[] = [];
      const requiresComputer = task.sources.some((source) => SOCIAL_SOURCES.includes(source));
      try {
        const health = await fetch(`${LOCAL_ASSISTANT_URL}/health`, { cache: "no-store" });
        if (!health.ok) throw new Error("本机助手未启动");
        const brainResponse = await fetch(`${LOCAL_ASSISTANT_URL}/v1/ai-settings`, { cache: "no-store" });
        const brain = await brainResponse.json() as Partial<AiBrainSettings>;
        if (!brainResponse.ok || brain.status !== "connected") {
          setView("settings");
          throw new Error("请先在AI中枢配置模型并通过连接测试");
        }
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
            setView("settings");
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
            body: JSON.stringify({
              jobId, taskId: task.id, taskName: task.name, platform: source, queries,
              techKeywords: task.techKeywords, companyKeywords: task.companyKeywords,
              signalKeywords: task.signalKeywords, excludeKeywords: task.excludeKeywords, authorBlacklist: task.authorBlacklist,
              companyBlacklist: task.companyBlacklist, timeRange: task.timeRange,
              targetItems: Math.max(1, Math.min(50, Number(task.sourceLimits?.[source] ?? DEFAULT_SOURCE_LIMITS[source] ?? 10))), commentTarget: 20,
            }),
          });
          const job = await dispatch.json() as Partial<LocalJob> & { error?: string };
          if (!dispatch.ok) throw new Error(job.error ?? `${source}无法打开`);
          localJobs[source] = {
            jobId: String(job.jobId ?? jobId), status: String(job.status ?? "running"),
            progress: safeNumber(job.progress ?? 10), fetched: safeNumber(job.fetched),
            targetItems: safeNumber(job.targetItems ?? task.sourceLimits?.[source] ?? 10), commentTarget: safeNumber(job.commentTarget ?? 20),
            currentAction: String(job.currentAction ?? `已在${source}打开关键词检索`),
            liveViewUrl: String(job.liveViewUrl ?? `${LOCAL_ASSISTANT_URL}/live`),
          };
          setLiveJobs({ ...localJobs });
          setRunProgress(15 + Math.round(((index + 1) / task.sources.length) * 45));
        }
        const terminal = new Set(["completed", "partial", "failed", "waiting_login", "cancelled"]);
        const requestedDeepReads = task.sources.reduce((sum, source) => sum + Math.max(1, Number(task.sourceLimits?.[source] ?? 10)), 0);
        const maxPollAttempts = Math.min(3600, Math.max(150, requestedDeepReads * 25));
        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
          const updates = await Promise.all(Object.entries(localJobs).map(async ([source, job]) => {
            const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/search-tasks/${encodeURIComponent(job.jobId)}`, { cache: "no-store" });
            return [source, response.ok ? await response.json() as LocalJob : job] as const;
          }));
          for (const [source, job] of updates) localJobs[source] = job;
          setLiveJobs({ ...localJobs });
          localCandidates = updates.flatMap(([, job]) => Array.isArray(job.results) ? job.results : []);
          setRunProgress(62 + Math.round(((attempt + 1) / maxPollAttempts) * 24));
          if (updates.every(([, job]) => terminal.has(job.status))) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        }
      } catch (localError) {
        if (localError instanceof Error && localError.message.includes("AI中枢")) throw localError;
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
    if (taskFilter !== "全部任务") params.set("taskId", taskFilter);
    if (intentFilter !== "全部意向") params.set("intent", intentFilter);
    if (reviewFilter !== "全部状态") params.set("status", reviewFilter);
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
          <div className="brand-mark">X</div>
          <div><strong>XINTAN</strong><span>TALENT SIGNALS</span></div>
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
          <div className="system-pulse"><span />All systems normal</div>
          <p>Zhihu intelligence workspace</p>
          <small>PRIVATE · v1.0</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">XINTAN / TALENT SIGNALS</p>
            <h1>{NAV_ITEMS.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className="workspace-badge"><i /> PRIVATE</span>
            <label className="global-search">
              <span>⌕</span>
              <input aria-label="全局搜索" placeholder="搜索线索、企业或技术栈" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
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
              onImport={() => setShowImportModal(true)}
            />
          )}
          {view === "tasks" && (
            <TasksView
              tasks={data.tasks}
              runningTask={runningTask}
              runProgress={runProgress}
              liveJobs={liveJobs}
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
              tasks={data.tasks}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              taskFilter={taskFilter}
              setTaskFilter={setTaskFilter}
              intentFilter={intentFilter}
              setIntentFilter={setIntentFilter}
              reviewFilter={reviewFilter}
              setReviewFilter={setReviewFilter}
              onView={setSelectedLead}
              onExport={exportExcel}
            />
          )}
          {view === "settings" && <SettingsView data={data} onChanged={loadState} />}
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

      {showImportModal && (
        <ImportModal
          tasks={data.tasks}
          onClose={() => setShowImportModal(false)}
          onImported={async (message) => {
            setShowImportModal(false);
            await loadState();
            setView("leads");
            setToast(message);
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
          <p className="eyebrow">SIGNAL OPERATIONS</p>
          <h2>Talent intelligence,<br /><em>without the noise.</em></h2>
          <p>从公开内容中识别人才流动与组织变化。先过滤噪音，再逐条深读，并保留每一个判断的原始证据。</p>
          <div className="hero-actions"><button className="primary-button" onClick={onCreate}>Create search</button><button className="ghost-button" onClick={() => onNavigate("leads")}>View signals</button></div>
        </div>
        <div className="overview-status">
          <button onClick={() => onNavigate("tasks")}><span>Active searches</span><strong>{activeTasks}</strong><small>正在运行的检索任务</small></button>
          <button onClick={() => onNavigate("settings")}><span>Connected sources</span><strong>{data.sources.length}</strong><small>知乎与 AI 连接状态</small></button>
          <button onClick={() => onNavigate("leads")}><span>Review queue</span><strong>{pendingLeads}</strong><small>等待人工确认的线索</small></button>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="Items reviewed" value={totals.fetched.toLocaleString()} delta="知乎详情深读数量" tone="ink" />
        <Metric label="Qualified signals" value={totals.valid.toLocaleString()} delta="过滤后有效线索" tone="green" />
        <Metric label="High priority" value={String(totals.high)} delta="A级优先处理" tone="orange" />
        <Metric label="Confirmed" value={String(totals.confirmed)} delta="人工确认结果" tone="blue" />
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
            {data.leads.length === 0 && <div className="signal-empty"><strong>No qualified signals yet</strong><span>运行一次检索后，通过证据校验的内容会出现在这里。</span><button onClick={() => onNavigate("tasks")}>Go to searches →</button></div>}
          </div>
        </div>

        <div className="panel source-panel">
          <div className="panel-head"><div><p className="eyebrow">SOURCE COVERAGE</p><h3>覆盖来源</h3></div><button className="text-button" onClick={() => onNavigate("settings")}>打开设置 →</button></div>
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

function AnalysisWorkspace({ jobs, running }: { jobs: Record<string, LocalJob>; running: boolean }) {
  const sources = Object.keys(jobs);
  const activeSource = sources.find((source) => ["calling_ai", "analyzing", "reading_comments", "reading_detail"].includes(jobs[source].phase ?? "")) ?? sources.find((source) => jobs[source].status === "running") ?? sources[0] ?? "";
  const [selectedSource, setSelectedSource] = useState("");
  const source = selectedSource && jobs[selectedSource] ? selectedSource : activeSource;
  const job = jobs[source];
  if (!job) return null;
  const trace = job.analysisTrace ?? [];
  const current = job.currentItem ?? trace.at(-1);
  const phaseIndex = ({ searching: 0, refining_search: 0, recovering: 0, locating: 1, opening_detail: 2, reading_detail: 3, reading_comments: 3, calling_ai: 4, analyzing: 4, loading_more: 4, completed: 4, partial: 4 } as Record<string, number>)[job.phase ?? "searching"] ?? 0;
  return (
    <section className="analysis-workspace" aria-live="polite">
      <div className="analysis-head">
        <div><p className="eyebrow">LIVE ANALYSIS</p><h3>Evidence-first review</h3><span>候选内容必须进入原文，读取正文与公开评论后，AI 才会形成结论。</span></div>
        <div className={`analysis-running-state ${running ? "active" : "complete"}`}><i />{running ? "分析进行中" : "本轮分析记录"}</div>
      </div>
      <div className="analysis-source-tabs" role="tablist" aria-label="平台分析记录">
        {sources.map((name) => {
          const item = jobs[name];
          return <button className={name === source ? "active" : ""} role="tab" aria-selected={name === source} key={name} onClick={() => setSelectedSource(name)}>
            <span>{initials(name)}</span><b>{name}</b><small>{item.status === "completed" ? "达标" : item.status === "partial" ? "未达条数" : item.status === "failed" ? "失败" : item.status === "waiting_login" ? "待登录" : item.phase === "opening_detail" ? "打开详情" : item.phase === "reading_comments" ? "逐条读评论" : item.phase === "reading_detail" ? "深读原文" : item.phase === "calling_ai" || item.phase === "analyzing" ? "AI判断" : item.phase === "refining_search" ? "调整检索" : item.phase === "recovering" ? "自动恢复" : "准备中"}</small>
          </button>;
        })}
      </div>
      <div className="analysis-phase-row">
        {["打开检索", "定位候选", "打开详情", "深读证据", "AI定案"].map((label, index) => <div className={index <= Math.min(4, phaseIndex) ? "done" : ""} key={label}><i>{index < Math.min(4, phaseIndex) || job.status === "completed" ? "✓" : index + 1}</i><span>{label}</span></div>)}
      </div>
      <div className="analysis-summary">
        <span><small>当前动作</small><strong>{job.currentAction}</strong></span>
        <span><small>搜索页旧内容预过滤</small><strong>{safeNumber(job.prefiltered)}</strong></span>
        <span><small>深读进度</small><strong>{safeNumber(job.inspected)}/{safeNumber(job.targetItems || job.inspected)}</strong></span>
        <span><small>保留</small><strong className="keep">{safeNumber(job.kept ?? job.fetched)}</strong></span>
        <span><small>过滤</small><strong className="drop">{safeNumber(job.filtered)}</strong></span>
      </div>
      <div className="analysis-body">
        <article className="current-analysis-card">
          <div className="current-analysis-label"><span>{current?.status === "thinking" ? "AI THINKING" : "LATEST DECISION"}</span>{current && <em className={current.decision === "保留" ? "keep" : current.decision === "继续探索" ? "explore" : "drop"}>{current.decision}</em>}</div>
          {current ? <>
            <blockquote>{current.snippet}</blockquote>
            {current.detailExcerpt && <div className="analysis-detail-excerpt"><b>详情页可见内容</b><p>{current.detailExcerpt}</p></div>}
            <div className="analysis-keywords"><b>命中依据</b>{current.matchedKeywords.length ? current.matchedKeywords.map((keyword) => <span key={keyword}>{keyword}</span>) : <span className="muted">无任务关键词</span>}</div>
            {!!current.evidenceQuotes?.length && <div className="analysis-evidence"><b>AI引用的原文证据</b>{current.evidenceQuotes.map((quote, index) => <p key={`${index}-${quote}`}>“{quote}”</p>)}</div>}
            <dl>
              <div><dt>内容类型</dt><dd>{current.intelligenceType}</dd></div>
              <div><dt>公开作者</dt><dd>{current.author}{current.authorId ? ` · ${current.authorId}` : " · ID未公开"} · {current.publishedAt ?? "时间未公开"}</dd></div>
              <div><dt>内容载体</dt><dd>{current.contentKind ?? "正在识别"} · 已逐条读取 {safeNumber(current.commentRead)}/{safeNumber(current.commentTarget)} 条评论</dd></div>
              <div><dt>求职意向</dt><dd>{current.intent}</dd></div>
              <div><dt>价值等级</dt><dd>{current.priority} · {current.score}分</dd></div>
              <div><dt>AI决策摘要</dt><dd>{current.reasoningSummary ?? current.reason}</dd></div>
              <div><dt>下一步动作</dt><dd>{current.nextAction ?? "完成当前判断"} · {current.actionReason ?? ""}</dd></div>
              <div><dt>安全策略</dt><dd>{current.policyStatus ?? "动作已限制在公开页面"}</dd></div>
            </dl>
            <a href={current.url} target="_blank" rel="noreferrer">打开当前原文 ↗</a>
          </> : <div className="analysis-awaiting"><i /><strong>正在打开检索页</strong><span>{job.currentAction}</span></div>}
        </article>
        <div className="analysis-trace-list">
          <div className="trace-list-head"><b>{source} 判断流水</b><span>{trace.length} 条</span></div>
          <div className="trace-scroll">
            {[...trace].reverse().map((item) => <a href={item.url} target="_blank" rel="noreferrer" className={`trace-item ${item.decision === "保留" ? "keep" : item.decision === "继续探索" ? "explore" : "drop"}`} key={`${item.index}-${item.url}`}>
              <i>{item.index}</i><span><b>{item.decision} · {item.priority}级 · {item.score}分</b><small>{item.snippet}</small><em>{item.reason}</em></span>
            </a>)}
            {trace.length === 0 && <div className="trace-empty">页面打开后，会在这里逐条出现分析过程。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function TasksView({ tasks, runningTask, runProgress, liveJobs, onRun, onCreate, onImport, onEdit, onToggle, onDelete }: {
  tasks: Task[];
  runningTask: string | null;
  runProgress: number;
  liveJobs: Record<string, LocalJob>;
  onRun: (task: Task) => void;
  onCreate: () => void;
  onImport: () => void;
  onEdit: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">SEARCHES</p><h2>Search missions</h2><p>从 JD 建立持续检索，配置技术栈、企业、求职信号、时间范围和排除规则。</p></div><div className="section-actions"><button className="ghost-button" onClick={onImport}>Import data</button><button className="primary-button" onClick={onCreate}>New search</button></div></div>
      {(runningTask || Object.keys(liveJobs).length > 0) && <AnalysisWorkspace jobs={liveJobs} running={Boolean(runningTask)} />}
      <div className="task-grid">
        {tasks.map((task) => (
          <article className="task-card" key={task.id}>
            <div className="task-top"><span className={task.status === "active" ? "status-badge active" : "status-badge paused"}>{task.status === "active" ? "运行中" : "已暂停"}</span><div className="task-actions"><button className="more-button" onClick={() => onEdit(task)}>编辑</button><button className="more-button" onClick={() => onToggle(task)}>{task.status === "active" ? "暂停" : "恢复"}</button><button className="more-button danger" onClick={() => onDelete(task)}>删除</button></div></div>
            <h3>{task.name}</h3><p className="task-jd">{task.jd}</p>
            <div className="tag-row">{task.techKeywords.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="source-depth-summary">{task.sources.map((source) => <span key={source}>{source} <b>{task.sourceLimits?.[source] ?? DEFAULT_SOURCE_LIMITS[source] ?? 10}</b>条</span>)}<span>最新优先</span></div>
            <div className="task-meta"><span>来源 <b>{task.sources.length}</b></span><span>线索 <b>{task.discovered}</b></span><span>A级 <b>{task.highValue}</b></span></div>
            <div className="task-schedule"><span>↻ {task.schedule}</span><span>{task.timeRange}</span></div>
            {runningTask === task.id && <div className="progress-track"><span style={{ width: `${runProgress}%` }} /></div>}
            <button className="run-button" disabled={Boolean(runningTask) || task.status !== "active"} onClick={() => onRun(task)}>{runningTask === task.id ? `Running ${runProgress}%` : task.status === "active" ? "Run now" : "Resume to run"}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function LeadsView({ leads, tasks, sourceFilter, setSourceFilter, typeFilter, setTypeFilter, priorityFilter, setPriorityFilter, taskFilter, setTaskFilter, intentFilter, setIntentFilter, reviewFilter, setReviewFilter, onView, onExport }: {
  leads: Lead[];
  tasks: Task[];
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  taskFilter: string;
  setTaskFilter: (value: string) => void;
  intentFilter: string;
  setIntentFilter: (value: string) => void;
  reviewFilter: string;
  setReviewFilter: (value: string) => void;
  onView: (lead: Lead) => void;
  onExport: () => void;
}) {
  return (
    <section className="panel table-panel">
      <div className="table-header">
        <div><p className="eyebrow">SIGNALS</p><h2>Signal inbox</h2><span>每一条 AI 判断都附带公开原文证据</span></div>
        <button className="primary-button" onClick={onExport}>Export Excel</button>
      </div>
      <div className="filter-bar">
        <select aria-label="任务筛选" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option>全部任务</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.name}</option>)}</select>
        <select aria-label="来源筛选" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>全部来源</option><option>知乎</option></select>
        <select aria-label="类型筛选" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>全部类型</option><option>人才线索</option><option>企业情报</option></select>
        <select aria-label="求职意向筛选" value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)}><option>全部意向</option><option>强</option><option>中</option><option>无</option></select>
        <select aria-label="优先级筛选" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>全部优先级</option><option>A</option><option>B</option><option>C</option></select>
        <select aria-label="处理状态筛选" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option>全部状态</option><option>待审核</option><option>已确认</option><option>误报</option></select>
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
        {leads.length === 0 && <div className="empty-state"><strong>No signals found</strong><span>调整筛选条件，或运行一次新的检索任务。</span></div>}
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

function AiBrainView() {
  const [settings, setSettings] = useState<AiBrainSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-5.4-mini");
  const [apiKey, setApiKey] = useState("");
  const [maxSteps, setMaxSteps] = useState(24);
  const [maxItems, setMaxItems] = useState(12);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/ai-settings`, { cache: "no-store" });
      const value = await response.json() as AiBrainSettings;
      if (!response.ok) throw new Error("本机助手未启动");
      setSettings(value); setBaseUrl(value.baseUrl); setModel(value.model);
      setMaxSteps(value.policy.maxStepsPerSource); setMaxItems(value.policy.maxItemsPerSource);
    } catch { setMessage("请先启动芯探本机助手，再配置AI中枢"); }
  }, []);
  useEffect(() => {
    // Initial synchronization with the device-local AI control plane.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function saveAndTest() {
    setSaving(true); setMessage("正在保存，并让AI完成一次真实决策测试…");
    try {
      const save = await fetch(`${LOCAL_ASSISTANT_URL}/v1/ai-settings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai", baseUrl, model, apiKey, policy: { maxStepsPerSource: maxSteps, maxItemsPerSource: maxItems, allowOpenDetail: true, allowReadComments: true, allowRefineSearch: true, allowCrossPlatformSuggestion: false } }),
      });
      const saved = await save.json() as AiBrainSettings & { error?: string };
      if (!save.ok) throw new Error(saved.error ?? "配置保存失败");
      setApiKey("");
      const test = await fetch(`${LOCAL_ASSISTANT_URL}/v1/ai-settings/test`, { method: "POST" });
      const tested = await test.json() as AiBrainSettings & { error?: string; sampleDecision?: string };
      if (!test.ok) throw new Error(tested.error ?? "AI连接测试失败");
      setSettings(tested); setMessage(`AI中枢已连接，模型 ${tested.model} 已完成真实判断测试`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI中枢配置失败"); }
    finally { setSaving(false); }
  }
  const connected = settings?.status === "connected";
  return <section>
    <div className="section-intro"><div><p className="eyebrow">AGENT CONTROL PLANE</p><h2>AI 中枢与行动边界</h2><p>模型负责评价页面内容并决定下一步；电脑 Agent 只执行经过策略校验的白名单动作。</p></div></div>
    <section className="brain-hero">
      <div className="brain-orbit"><span>AI</span><i className="orbit-one" /><i className="orbit-two" /></div>
      <div><p className="eyebrow">CENTRAL REASONING ENGINE</p><h3>{connected ? "中央大脑已接管决策" : "先连接一个真正的AI大脑"}</h3><p>每条内容都会进入“观察 → AI判断 → 策略校验 → 电脑执行 → 结果回传”的 Agent 循环。关键词规则只做候选定位，不再冒充最终判断。</p></div>
      <div className={`brain-status ${connected ? "connected" : "pending"}`}><i />{connected ? "READY" : settings?.status === "failed" ? "TEST FAILED" : "SETUP REQUIRED"}</div>
    </section>
    <div className="brain-grid">
      <section className="brain-config-card">
        <div className="brain-card-head"><div><p className="eyebrow">MODEL CONNECTION</p><h3>模型配置</h3></div><span>密钥仅保存在本机</span></div>
        <label><span>Responses API 地址</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
        <label><span>模型</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.4-mini" /></label>
        <label><span>API Key</span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? "已保存；留空则继续使用" : "sk-…"} /></label>
        <div className="brain-limits"><label><span>单来源最大步骤</span><input type="number" min="4" max="120" value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /></label><label><span>默认深读内容数</span><input type="number" min="1" max="50" value={maxItems} onChange={(event) => setMaxItems(Number(event.target.value))} /></label></div>
        <button className="primary-button brain-test-button" disabled={saving} onClick={() => void saveAndTest()}>{saving ? "正在连接并测试…" : connected ? "保存并重新测试" : "保存并测试 AI 中枢"}</button>
        {(message || settings?.lastError) && <div className={`brain-message ${connected ? "success" : ""}`}>{message || settings?.lastError}</div>}
      </section>
      <section className="brain-policy-card">
        <div className="brain-card-head"><div><p className="eyebrow">ENFORCED POLICY</p><h3>电脑 Agent 规范</h3></div><span>默认拒绝越权</span></div>
        <div className="policy-column allow"><b>允许自动执行</b>{(settings?.allowedActions ?? ["检索", "滚动", "读取公开内容", "打开知乎原文", "读取公开评论", "调整关键词", "返回"]).map((action) => <span key={action}><i>✓</i>{action}</span>)}</div>
        <div className="policy-column block"><b>禁止自动执行</b>{(settings?.blockedActions ?? ["私信", "评论或发布", "点赞关注", "上传下载", "输入密码或验证码", "绕过人机验证", "访问非白名单域名"]).map((action) => <span key={action}><i>×</i>{action}</span>)}</div>
      </section>
    </div>
    <section className="agent-loop-card"><p className="eyebrow">CONTROLLED AGENT LOOP</p>{[["01","观察","读取当前可见原文与上下文"],["02","思考","AI输出决策摘要和下一步动作"],["03","校验","策略层检查域名、动作和步骤上限"],["04","行动","电脑执行搜索、打开、滚动或返回"],["05","回传","记录结果并让AI决定继续或停止"]].map(([index,title,copy]) => <div key={index}><i>{index}</i><span><b>{title}</b><small>{copy}</small></span></div>)}</section>
  </section>;
}

function SettingsView({ data, onChanged }: { data: AppState; onChanged: () => Promise<void> }) {
  const [section, setSection] = useState<"sources" | "ai">("sources");
  return <section className="settings-hub">
    <div className="settings-hub-head">
      <div><p className="eyebrow">CONFIGURATION</p><h2>System setup</h2><span>连接知乎与 AI 中枢；检索、深读和增量去重由系统自动完成。</span></div>
      <div className="settings-hub-tabs" role="tablist" aria-label="设置分类">
        <button className={section === "sources" ? "active" : ""} role="tab" aria-selected={section === "sources"} onClick={() => setSection("sources")}>数据源</button>
        <button className={section === "ai" ? "active" : ""} role="tab" aria-selected={section === "ai"} onClick={() => setSection("ai")}>AI 中枢</button>
      </div>
    </div>
    {section === "sources" ? <SourcesView sources={data.sources} jobs={data.connectorJobs ?? []} onChanged={onChanged} /> : <AiBrainView />}
    <details className="settings-audit-details"><summary>查看运行记录与技术日志</summary><RunsView runs={data.runs} /></details>
  </section>;
}

const EMPTY_CONNECTOR_SETTINGS: ConnectorSettingsState = {
  endpoint: "http://127.0.0.1:8765", hasToken: false, hasCallbackSecret: false, enabledSources: ["知乎"],
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
  const [verifications, setVerifications] = useState<SourceVerification[]>([]);
  const [checkingSources, setCheckingSources] = useState(false);
  const [checkingPlatform, setCheckingPlatform] = useState("");

  const refreshSources = useCallback(async () => {
    setCheckingSources(true); setSessionMessage("");
    try {
      const [connectivityResponse, sessionResponse, verificationResponse] = await Promise.all([
        fetch(`${LOCAL_ASSISTANT_URL}/v1/connectivity`, { cache: "no-store" }),
        fetch(`${LOCAL_ASSISTANT_URL}/v1/browser-sessions`, { cache: "no-store" }),
        fetch(`${LOCAL_ASSISTANT_URL}/v1/source-verifications`, { cache: "no-store" }),
      ]);
      const connectivityResult = await connectivityResponse.json() as { sources?: SourceConnectivity[]; error?: string };
      const sessionResult = await sessionResponse.json() as { sessions?: BrowserSessionState[]; error?: string };
      const verificationResult = await verificationResponse.json() as { verifications?: SourceVerification[]; error?: string };
      if (!connectivityResponse.ok) throw new Error(connectivityResult.error ?? "数据源检测失败");
      if (!sessionResponse.ok) throw new Error(sessionResult.error ?? "登录状态检测失败");
      setConnectivity(connectivityResult.sources ?? []);
      setSessions(sessionResult.sessions ?? []);
      if (verificationResponse.ok) setVerifications(verificationResult.verifications ?? []);
      setSessionMessage("知乎连接与登录状态已完成检测");
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

  async function showOperatorWindow() {
    setSessionMessage("正在打开独立操作窗口…");
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/operator-window/open`, { method: "POST" });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "操作窗口打开失败");
      setSessionMessage(result.message ?? "已打开芯探操作窗口；AI 的点击、输入和滚动会直接发生在该窗口中");
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : "操作窗口打开失败"); }
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
        setSessionMessage(`${result.message ?? `已在浏览器打开${platform}`}，正在自动验收查找、滚动和读取功能…`);
        await runVerification(platform);
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
      setSessionMessage(`${result.message ?? `${platform}已确认登录`}，正在自动验收查找、滚动和读取功能…`);
      await runVerification(platform);
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : "确认失败"); }
    finally { setOpeningPlatform(""); }
  }

  async function runVerification(platform: string) {
    setCheckingPlatform(platform); setSessionMessage("");
    try {
      const response = await fetch(`${LOCAL_ASSISTANT_URL}/v1/source-verifications`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }),
      });
      const result = await response.json() as { verification?: SourceVerification; error?: string };
      if (!result.verification) throw new Error(result.error ?? `${platform}功能验收失败`);
      setVerifications((current) => [...current.filter((item) => item.platform !== platform), result.verification!]);
      const failed = result.verification.checks.filter((check) => check.status === "failed").map((check) => check.label);
      setSessionMessage(result.verification.status === "passed"
        ? `${platform}功能验收通过：网页、查找、滚动、内容读取和来源链接均正常`
        : `${platform}验收未通过：${failed.join("、") || result.verification.error || "请查看浏览器页面"}`);
    } catch (error) { setSessionMessage(error instanceof Error ? error.message : `${platform}功能验收失败`); }
    finally { setCheckingPlatform(""); }
  }

  const statusLabel = settings.status === "connected" ? "已连接" : settings.status === "failed" ? "连接失败" : settings.status === "saved" ? "等待检测" : "待连接";
  const reachableCount = connectivity.filter((item) => item.reachable).length;
  return (
    <section className="settings-panel" id="connector-settings">
      <div className="settings-head"><div><p className="eyebrow">ZHIHU CONNECTION</p><h3>知乎账号与浏览器</h3><span>账号和 Cookie 只保存在当前电脑，系统不会读取或保存密码。</span></div><div className="source-head-actions"><span className={`settings-status ${settings.status}`}>{statusLabel}</span><button className="ghost-button" disabled={testing || checkingSources} onClick={() => void (settings.status === "connected" ? refreshSources() : testConnection())}>{testing || checkingSources ? "检测中…" : "检测知乎"}</button></div></div>
      <div className="pair-card">
        <div className={`computer-illustration ${settings.status === "connected" ? "online" : ""}`}><span>XT</span><i /></div>
        <div className="pair-copy"><b>{settings.status === "connected" ? "Local assistant connected" : "Local assistant offline"}</b><p>{settings.status === "connected" ? `${reachableCount || 0}/1 个知乎来源已完成网络验证，账号状态见下方。` : "请启动芯探电脑助手；启动后页面会自动识别。"}</p></div>
        <div className="pair-actions">{settings.status === "connected" && <button className="ghost-button live-view-button" onClick={() => void showOperatorWindow()}>打开操作小窗</button>}<button className="primary-button" disabled={testing} onClick={() => void testConnection()}>{testing ? "正在检测…" : "重新连接"}</button></div>
      </div>
      <div className="source-center-head"><div><b>Zhihu Source</b><span>网络、账号与功能验收</span></div><small>账号数据仅保留在本机</small></div>
      <div className="source-connection-grid">
        {sources.map((source) => {
          const check = connectivity.find((item) => item.name === source.name);
          const isSocial = SOCIAL_SOURCES.includes(source.name);
          const session = sessions.find((item) => item.platform === source.name);
          const verification = verifications.find((item) => item.platform === source.name);
          const waitingConfirmation = session?.status === "browser_open";
          const label = checkingPlatform === source.name ? "验收中" : verification?.status === "passed" ? "功能正常" : verification?.status === "failed" ? "验收失败" : !check ? (checkingSources ? "检测中" : "待检测") : !check.reachable ? "连接失败" : waitingConfirmation ? "待确认" : isSocial && session?.status === "logged_in" ? "待验收" : isSocial ? "可访问" : check.status === "restricted" ? "浏览器可达" : "已连通";
          const tone = label === "功能正常" || label === "已连通" || label === "浏览器可达" ? "ready" : label === "连接失败" || label === "验收失败" ? "failed" : "pending";
          return <article className="source-connection" key={source.id}>
            <span className="source-logo large">{initials(source.name)}</span>
            <div className="source-connection-copy"><b>{source.name}</b><span>{check?.detail ?? source.coverage}</span></div>
            <em className={tone}>{label}</em>
            <div className="source-card-actions">
              <button disabled={settings.status !== "connected" || checkingPlatform === source.name} onClick={() => void runVerification(source.name)}>{checkingPlatform === source.name ? "验收中…" : "功能验收"}</button>
              <button disabled={settings.status !== "connected" || openingPlatform === source.name || checkingPlatform === source.name} onClick={() => void (isSocial && waitingConfirmation ? confirmPlatform(source.name) : openPlatform(source.name))}>{openingPlatform === source.name ? "处理中…" : isSocial && waitingConfirmation ? "确认并验收" : verification ? "重新配置" : "配置"}</button>
            </div>
            {verification && <div className="source-verification" aria-label={`${source.name}功能验收结果`}>
              {verification.checks.map((item) => <span className={item.status} key={item.key} title={item.detail}><i>{item.status === "passed" ? "✓" : "!"}</i>{item.label}</span>)}
              <small>{new Date(verification.testedAt).toLocaleString("zh-CN", { hour12: false })}</small>
            </div>}
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
  const auditedJobs = Object.fromEntries(latestJobs.filter((job) => (job.analysisTrace?.length ?? 0) > 0).map((job) => [job.source, {
    jobId: job.id, status: job.status, phase: job.phase, progress: job.progress, fetched: job.fetched,
    inspected: job.inspected, kept: job.kept, filtered: job.filtered, currentAction: job.currentAction,
    liveViewUrl: job.liveViewUrl, currentItem: job.currentItem, analysisTrace: job.analysisTrace,
  } satisfies LocalJob]));
  const waitingJobs = localConnected ? 0 : latestJobs.filter((job) => job.status === "awaiting_config").length || sources.filter((source) => source.status.includes("待")).length;
  const liveJob = latestJobs.find((job) => ["running", "waiting_login", "dispatched"].includes(job.status)
    && !job.currentAction.includes("ProcessSingleton") && !job.currentAction.includes("Failed to create"));
  const [openingOperator, setOpeningOperator] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => { void onChanged(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [onChanged]);
  async function showOperatorWindow() {
    setOpeningOperator(true);
    try { await fetch(`${LOCAL_ASSISTANT_URL}/v1/operator-window/open`, { method: "POST" }); }
    finally { setOpeningOperator(false); }
  }
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">ZHIHU SOURCE</p><h2>知乎连接与账号</h2><p>登录一次并完成功能验收；系统会验证搜索、滚动、详情读取、评论读取和原始链接。</p></div></div>
      <ConnectorSettingsPanel sources={sources} onChanged={onChanged} onConnectionChange={setLocalConnected} />
      <section className="live-console">
        <div className="live-console-head"><div><p className="eyebrow">DIRECT BROWSER OPERATION</p><h3>独立操作窗口</h3><span>无需录屏。任务会直接打开一个小型浏览器窗口，AI 的搜索、点击、输入和滚动都在里面真实发生。</span></div><div className="live-controls"><button disabled={openingOperator || !localConnected} onClick={() => void showOperatorWindow()}>{openingOperator ? "正在打开…" : "唤起操作窗口"}</button>{liveJob && <span className={`job-state ${liveJob.status}`}>{liveJob.status === "running" ? "正在操作" : liveJob.status === "waiting_login" ? "等待登录" : liveJob.status === "failed" ? "失败" : "已派发"}</span>}</div></div>
        {liveJob ? <div className="operator-console-body">
          <div className="operator-window-note"><span>VISIBLE BROWSER</span><strong>{liveJob.source} 操作窗口已打开</strong><p>你看到的就是 AI 正在控制的真实网页，不是截图或录屏转播。</p></div>
          <div className="job-telemetry"><span>{liveJob.source} · {new Date(liveJob.dispatchedAt).toLocaleString("zh-CN", { hour12: false })}</span><h4>{liveJob.currentAction || (liveJob.error ? "执行失败" : "等待电脑助手状态")}</h4><div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, safeNumber(liveJob.progress)))}%` }} /></div><p>{safeNumber(liveJob.progress)}% · 已获取 {liveJob.fetched} 条</p>{liveJob.error && <div className="job-error">{liveJob.error}</div>}</div>
        </div> : <div className="live-empty"><strong>{waitingJobs ? "电脑助手尚未连接" : "当前没有正在执行的电脑任务"}</strong><span>{waitingJobs ? "启动本机助手后，任务会自动打开独立操作窗口。" : "运行任务后会自动弹出一个小型浏览器窗口，你可以直接观察全部操作。"}</span></div>}
      </section>
      {Object.keys(auditedJobs).length > 0 && <AnalysisWorkspace jobs={auditedJobs} running={false} />}
      <div className="boundary-note"><b>DATA POLICY</b><span>只处理知乎公开或已获授权内容；平台页面变化、账号权限与风控会影响覆盖率。界面不注入演示线索，所有统计均来自真实运行。</span></div>
    </section>
  );
}

function ImportModal({ tasks, onClose, onImported }: { tasks: Task[]; onClose: () => void; onImported: (message: string) => Promise<void> }) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [urlText, setUrlText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const selectedTask = tasks.find((task) => task.id === taskId);

  async function previewImport() {
    if (!taskId) { setError("请先创建并选择一个检索任务"); return; }
    if (mode === "file" && !file) { setError("请选择 CSV、TSV、TXT 或 XLSX 文件"); return; }
    if (mode === "url" && !urlText.trim()) { setError("请粘贴至少一条 URL 和原文片段"); return; }
    setBusy(true); setError(""); setPhase("正在校验字段和逐行错误…");
    try {
      let body: BodyInit;
      const headers: HeadersInit = {};
      if (mode === "file") { const form = new FormData(); form.set("file", file as File); body = form; }
      else { headers["Content-Type"] = "application/json"; body = JSON.stringify({ urlText }); }
      const response = await fetch("/api/imports/preview", { method: "POST", headers, body });
      const result = await response.json() as ImportPreview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "导入预览失败");
      setPreview(result); setPhase(`预览完成：${result.accepted} 条可分析，${result.failed} 条需修正`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入预览失败"); setPhase(""); }
    finally { setBusy(false); }
  }

  async function analyzeAndCommit() {
    if (!preview || !selectedTask) return;
    setBusy(true); setError(""); setPhase(`本机 AI 正在分析 ${preview.items.length} 条公开内容…`);
    try {
      const analysisResponse = await fetch(`${LOCAL_ASSISTANT_URL}/v1/import-analysis`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: preview.items, task: selectedTask }),
      });
      const analyzed = await analysisResponse.json() as {
        items?: ImportCandidate[]; accepted?: number; filtered?: number; failed?: number; error?: string;
        results?: Array<{ status: string; reason?: string; item?: ImportCandidate }>;
      };
      if (!analysisResponse.ok) throw new Error(analyzed.error ?? "本机 AI 分析失败");
      setPhase("AI 分析完成，正在去重并写入线索库…");
      const commitResponse = await fetch("/api/imports/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId, fileName: preview.fileName, format: preview.format, items: analyzed.items ?? [],
          previewTotal: preview.total, previewFailed: preview.failed,
          analysisFiltered: analyzed.filtered ?? 0, analysisFailed: analyzed.failed ?? 0,
          rowReports: [
            ...preview.errors.map((item) => ({ rowNumber: item.rowNumber, status: "failed", errorCode: item.code, errorMessage: item.message })),
            ...(analyzed.results ?? []).map((item, index) => ({
              rowNumber: Number(((preview.items[index]?.raw as { importRowNumber?: number } | undefined)?.importRowNumber) ?? index + 2),
              status: item.status === "accepted" ? "processed" : item.status,
              errorCode: item.status === "failed" ? "ai_analysis_failed" : item.status === "filtered" ? "ai_filtered" : "",
              errorMessage: item.reason ?? "",
            })),
          ],
        }),
      });
      const committed = await commitResponse.json() as { imported?: number; duplicated?: number; filtered?: number; failed?: number; error?: string };
      if (!commitResponse.ok) throw new Error(committed.error ?? "导入入库失败");
      await onImported(`导入完成：新增 ${committed.imported ?? 0}，重复 ${committed.duplicated ?? 0}，过滤 ${committed.filtered ?? 0}，失败 ${committed.failed ?? 0}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析与入库失败"); setPhase(""); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section className="task-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div className="modal-head"><div><p className="eyebrow">CONTROLLED INGESTION</p><h2 id="import-modal-title">导入公开内容</h2></div><button className="close-button" disabled={busy} onClick={onClose} aria-label="关闭">×</button></div>
      <div className="modal-body import-body">
        <div className="import-note"><b>预览 → AI 分析 → 去重入库</b><span>文件只在本次请求中解析；系统不会保存原始文件。AI 引用必须能在导入原文中核验。</span></div>
        <label><span>关联检索任务</span><select value={taskId} onChange={(event) => { setTaskId(event.target.value); setPreview(null); }}><option value="">选择任务</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.name}</option>)}</select></label>
        <div className="import-tabs"><button className={mode === "file" ? "active" : ""} onClick={() => { setMode("file"); setPreview(null); }}>CSV / XLSX</button><button className={mode === "url" ? "active" : ""} onClick={() => { setMode("url"); setPreview(null); }}>URL list</button><a href="/api/imports/template">Download template</a></div>
        {mode === "file" ? <label className="file-drop"><input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /><b>{file?.name ?? "Choose a data file"}</b><span>CSV / TSV / TXT / XLSX · Maximum 5 MB · Up to 2,000 rows</span></label> : <label><span>每行一条：URL | 原文片段 | 作者 | 发布时间</span><textarea rows={7} value={urlText} onChange={(event) => { setUrlText(event.target.value); setPreview(null); }} placeholder="https://www.zhihu.com/question/... | 公开原文片段 | 公开昵称 | 2026-08-28" /></label>}
        {preview && <section className="import-preview">
          <div className="import-metrics"><span><small>Total</small><b>{preview.total}</b></span><span><small>Ready</small><b>{preview.accepted}</b></span><span><small>Errors</small><b>{preview.failed}</b></span></div>
          <div className="import-preview-table"><table><thead><tr><th>Row</th><th>Source</th><th>Author</th><th>Content preview</th><th>Status</th></tr></thead><tbody>
            {preview.items.slice(0, 10).map((item, index) => <tr key={`${item.url}-${index}`}><td>{String((item.raw as { importRowNumber?: number } | undefined)?.importRowNumber ?? index + 2)}</td><td>{item.source}</td><td>{item.author || "未公开"}</td><td>{item.snippet}</td><td><span className="import-ok">Ready</span></td></tr>)}
            {preview.errors.slice(0, 10).map((item) => <tr key={`error-${item.rowNumber}`}><td>{item.rowNumber}</td><td>—</td><td>—</td><td>{item.message}</td><td><span className="import-error">Error</span></td></tr>)}
          </tbody></table></div>
          {preview.total > 10 && <small className="import-more">仅展示前 10 条有效记录和前 10 条错误；所有记录都会被处理。</small>}
        </section>}
        {phase && <div className="import-phase"><i />{phase}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <div className="modal-actions"><button className="ghost-button" disabled={busy} onClick={onClose}>Cancel</button>{!preview ? <button className="primary-button" disabled={busy} onClick={() => void previewImport()}>{busy ? "Validating…" : "Preview data"}</button> : <><button className="ghost-button" disabled={busy} onClick={() => setPreview(null)}>Back</button><button className="primary-button" disabled={busy || preview.accepted === 0} onClick={() => void analyzeAndCommit()}>{busy ? "Analyzing…" : `Analyze & import ${preview.accepted}`}</button></>}</div>
    </section>
  </div>;
}

function TaskModal({ task, onClose, onCreated }: { task: Task | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(task?.name ?? "");
  const [jd, setJd] = useState(task?.jd ?? "");
  const [techKeywords, setTechKeywords] = useState<string[]>(task?.techKeywords ?? []);
  const [techKeywordText, setTechKeywordText] = useState((task?.techKeywords ?? []).join("、"));
  const [companies, setCompanies] = useState((task?.companyKeywords ?? []).join("、"));
  const [signals, setSignals] = useState((task?.signalKeywords ?? []).join("、"));
  const [excludes, setExcludes] = useState((task?.excludeKeywords ?? []).join("、"));
  const [authorBlacklist, setAuthorBlacklist] = useState((task?.authorBlacklist ?? []).join("、"));
  const [companyBlacklist, setCompanyBlacklist] = useState((task?.companyBlacklist ?? []).join("、"));
  const sources = ["知乎"];
  const [sourceLimits, setSourceLimits] = useState<Record<string, number>>({ 知乎: Math.max(1, Math.min(50, Number(task?.sourceLimits?.知乎 ?? DEFAULT_SOURCE_LIMITS.知乎))) });
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
        setTechKeywordText((result.techKeywords ?? []).join("、"));
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
    setFormError("");
    setSaving(true);
    const manualTechKeywords = split(techKeywordText);
    const effectiveTechKeywords = manualTechKeywords.length ? manualTechKeywords : techKeywords.length ? techKeywords : await analyze();
    try {
      const response = await fetch("/api/state", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: task ? "updateTask" : "createTask",
          task: { id: task?.id, name, jd, status: task?.status ?? "active", sources, techKeywords: effectiveTechKeywords,
            companyKeywords: split(companies), signalKeywords: split(signals), excludeKeywords: split(excludes),
            authorBlacklist: split(authorBlacklist), companyBlacklist: split(companyBlacklist), sourceLimits, schedule, timeRange, scheduleEnabled: schedule !== "仅手动运行" },
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
          <label><span>任务名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：上海数字验证人才" /></label>
          <label><span>职位描述 JD</span><textarea rows={5} value={jd} onChange={(event) => setJd(event.target.value)} placeholder="粘贴客户提供的真实 JD；保存前可检查并修改拆解结果。" /></label>
          <button className="analyze-button" disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "正在拆解…" : "✦ AI拆解技术栈和检索词"}</button>
          {techKeywords.length > 0 && <div className="keyword-box"><b>识别及扩展出的技术词</b><div className="tag-row">{techKeywords.map((word) => <span key={word}>{word}</span>)}</div><small>服务端芯片行业词库会扩展缩写、同义词和EDA工具名称。</small></div>}
          <label><span>技术栈关键词（可编辑）</span><input value={techKeywordText} onChange={(event) => setTechKeywordText(event.target.value)} placeholder="例如：UVM、SystemVerilog、VCS、SoC验证" /></label>
          <label><span>目标企业</span><input value={companies} onChange={(event) => setCompanies(event.target.value)} placeholder="仅填写本任务需要关注的企业" /></label>
          <label><span>求职与企业信号关键词</span><input value={signals} onChange={(event) => setSignals(event.target.value)} placeholder="例如：看机会、团队调整、项目收尾" /></label>
          <label><span>内容黑名单关键词</span><input value={excludes} onChange={(event) => setExcludes(event.target.value)} placeholder="例如：培训、课程、广告" /></label>
          <div className="form-grid"><label><span>作者黑名单</span><input value={authorBlacklist} onChange={(event) => setAuthorBlacklist(event.target.value)} /></label><label><span>企业黑名单</span><input value={companyBlacklist} onChange={(event) => setCompanyBlacklist(event.target.value)} /></label></div>
          <div className="form-grid"><label><span>扫描计划</span><select value={schedule} onChange={(event) => setSchedule(event.target.value)}><option>每天 09:00</option><option>每天 18:00</option><option>每周一 10:00</option><option>仅手动运行</option></select></label><label><span>时间范围</span><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}><option>近7天</option><option>近30天</option><option>近90天</option></select></label></div>
          <fieldset className="source-depth-fieldset"><legend>知乎深读范围</legend><p>默认最新优先：先用当前年月检索，并在结果页按发布时间排序、预过滤超期内容；之后才打开详情读取正文、评论、作者和原始链接。</p><div className="source-depth-grid"><label className="enabled"><span>知乎 · 最新优先</span><input aria-label="知乎深读条数" type="number" min="1" max="50" value={sourceLimits.知乎} onChange={(event) => setSourceLimits({ 知乎: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /><em>条 / 次</em></label></div></fieldset>
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
        <div className="startup-icon"><span>X</span><i /></div>
        <p className="eyebrow">CONNECT SOURCE</p>
        <h2 id="startup-setup-title">Connect Zhihu</h2>
        <p>打开专用浏览器并登录知乎。完成后，芯探会自动测试搜索、滚动、详情、评论和来源链接。</p>
        <div className="startup-source-row">{ALL_SOURCES.map((source) => <span key={source}>{initials(source)}<small>{source}</small></span>)}</div>
        <div className="startup-hint"><b>登录状态保存在本机</b><span>系统不要求填写知乎账号或密码，后续任务复用该浏览器会话。</span></div>
        <div className="startup-actions">
          <button className="ghost-button" onClick={onClose}>稍后配置</button>
          <button className="primary-button" onClick={onConfigure}>进入设置</button>
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
            <article><span>02</span><div><h3>连接已登录的知乎浏览器</h3><p>电脑助手复用本机知乎登录状态，不需要在系统中填写账号或密码。</p><button onClick={() => onNavigate("settings")}>打开设置 →</button></div></article>
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

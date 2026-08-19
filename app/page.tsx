"use client";

import { useEffect, useMemo, useState } from "react";

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

const EMPTY_STATE: AppState = { tasks: [], leads: [], runs: [], sources: [] };
const ALL_SOURCES = ["抖音", "微博", "小红书", "知乎", "EETOP", "EDA365"];

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "情报概览", icon: "⌁" },
  { id: "tasks", label: "检索任务", icon: "▣" },
  { id: "leads", label: "线索工作台", icon: "◇" },
  { id: "runs", label: "运行日志", icon: "↻" },
  { id: "sources", label: "数据源", icon: "◎" },
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
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    const timer = window.setInterval(() => {
      setRunProgress((value) => Math.min(value + Math.ceil(Math.random() * 14), 92));
    }, 360);
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "runTask", taskId: task.id }),
      });
      const result = await response.json() as { valid?: number; status?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "任务运行失败");
      setRunProgress(100);
      await loadState();
      setToast(`“${task.name}”${result.status ?? "运行完成"}，本轮新增 ${result.valid ?? 0} 条；${result.message ?? ""}`);
    } catch (runError) {
      setToast(runError instanceof Error ? runError.message : "任务运行失败");
    } finally {
      window.clearInterval(timer);
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
        <div className="brand-mark large">芯</div>
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
          <div><strong>芯探</strong><span>XINTAN INTELLIGENCE</span></div>
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
          <p>Public & authorized intelligence</p>
          <small>PRIVATE BETA · v0.3</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">CHIP TALENT INTELLIGENCE</p>
            <h1>{NAV_ITEMS.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className="workspace-badge"><i /> PRIVATE WORKSPACE</span>
            <label className="global-search">
              <span>⌕</span>
              <input aria-label="全局搜索" placeholder="搜索线索、企业或技术栈" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button className="ghost-button" onClick={() => setShowGuide(true)}>使用引导</button>
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
  const readySources = data.sources.filter((source) => ["可连接", "可执行", "已连接"].includes(source.status)).length;
  const pendingLeads = data.leads.filter((lead) => lead.reviewStatus === "待审核").length;
  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="live-label"><span />INTELLIGENCE ENGINE ONLINE</div>
          <h2>将公开信号，转化为<br /><em>可执行的人才情报。</em></h2>
          <p>把 JD 变成持续运行的跨平台检索任务。自动过滤噪声、识别人才流动与企业异动，并为每一条判断保留可追溯证据。</p>
          <div className="hero-actions">
            <button className="light-button" onClick={onCreate}>从 JD 创建任务 →</button>
            <button className="text-button light" onClick={() => onNavigate("leads")}>查看示例线索</button>
          </div>
        </div>
        <div className="hero-visual" aria-label="今日新增线索统计">
          <div className="signal-orbit orbit-one" />
          <div className="signal-orbit orbit-two" />
          <div className="hero-score"><strong>{data.leads.length}</strong><span>ACTIVE SIGNALS</span></div>
          <div className="floating-signal signal-a"><b>A</b><span>强求职信号</span></div>
          <div className="floating-signal signal-b"><b>+</b><span>团队扩招</span></div>
          <div className="floating-signal signal-c"><b>!</b><span>流片异动</span></div>
        </div>
      </section>

      <section className="quickstart-panel">
        <div className="quickstart-head"><div><p className="eyebrow">GET STARTED</p><h3>第一次使用？按这三步完成一次检索</h3></div><span>预计 3 分钟</span></div>
        <div className="quickstart-steps">
          <button onClick={onCreate}><b>01</b><span><strong>导入 JD</strong><small>自动拆解技术栈、企业和求职信号</small></span><em>{activeTasks} 个任务</em></button>
          <button onClick={() => onNavigate("sources")}><b>02</b><span><strong>确认数据源</strong><small>论坛可直接运行，社媒需连接电脑 Agent</small></span><em>{readySources}/6 可运行</em></button>
          <button onClick={() => onNavigate("leads")}><b>03</b><span><strong>审核线索</strong><small>查看原文证据，确认高价值候选人</small></span><em>{pendingLeads} 条待审核</em></button>
        </div>
      </section>

      <div className="demo-banner"><span>DEMO DATA</span><p>当前首页包含 6 条示例线索，帮助理解产品流程；新任务产生的结果与运行数量均来自真实连接器。</p></div>

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
          <div className="panel-head"><div><p className="eyebrow">SOURCE HEALTH</p><h3>数据源脉搏</h3></div><button className="text-button" onClick={() => onNavigate("sources")}>管理来源 →</button></div>
          <div className="source-mini-grid">
            {data.sources.map((source) => (
              <div className="source-mini" key={source.id}>
                <span className="source-logo">{initials(source.name)}</span>
                <span><b>{source.name}</b><small>{source.mode}</small></span>
                <i className={`health-dot ${["可连接", "可执行", "已连接"].includes(source.status) ? "healthy" : source.status.includes("待") ? "warning" : "testing"}`} />
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
  endpoint: "", hasToken: false, hasCallbackSecret: false, enabledSources: ["抖音", "微博", "小红书", "知乎"],
  status: "not_configured", lastTestAt: null, lastError: "", liveViewUrl: "", capabilities: [],
};

function ConnectorSettingsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [settings, setSettings] = useState(EMPTY_CONNECTOR_SETTINGS);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [callbackSecret, setCallbackSecret] = useState("");
  const [enabledSources, setEnabledSources] = useState<string[]>(EMPTY_CONNECTOR_SETTINGS.enabledSources);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  async function loadSettings() {
    const response = await fetch("/api/connectors/settings", { cache: "no-store" });
    const result = await response.json() as ConnectorSettingsState & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "连接设置读取失败");
    setSettings(result);
    setEndpoint(result.endpoint);
    setEnabledSources(result.enabledSources);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectors/settings", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as ConnectorSettingsState & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "连接设置读取失败");
      if (!cancelled) {
        setSettings(result); setEndpoint(result.endpoint); setEnabledSources(result.enabledSources); setLoading(false);
      }
    }).catch((error) => { if (!cancelled) { setMessage(error instanceof Error ? error.message : "连接设置读取失败"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  async function saveSettings(showMessage = true) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/connectors/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, token, callbackSecret, enabledSources }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setToken(""); setCallbackSecret("");
      await loadSettings(); await onChanged();
      if (showMessage) setMessage("配置已安全保存，请执行连通性测试");
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); return false; }
    finally { setSaving(false); }
  }

  async function testConnection() {
    if (!(await saveSettings(false))) return;
    setTesting(true); setMessage("正在请求 Agent /health …");
    try {
      const response = await fetch("/api/connectors/settings", { method: "POST" });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "连接失败");
      await loadSettings(); await onChanged(); setMessage(result.message ?? "连接成功");
    } catch (error) { await loadSettings(); await onChanged(); setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setTesting(false); }
  }

  const statusLabel = settings.status === "connected" ? "已连接" : settings.status === "failed" ? "连接失败" : settings.status === "saved" ? "已保存，待测试" : "未配置";
  return (
    <section className="settings-panel" id="connector-settings">
      <div className="settings-head"><div><p className="eyebrow">CONNECTION SETTINGS</p><h3>电脑 Agent 连接设置</h3><span>配置一次，后续检索任务会自动派发到你的电脑接管产品。</span></div><span className={`settings-status ${settings.status}`}>{statusLabel}</span></div>
      <div className="settings-grid">
        <label className="settings-field wide"><span>Agent 公网地址</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://agent.example.com" disabled={loading} /><small>必须是公网 HTTPS；本机 Agent 可通过安全隧道暴露。测试会请求 GET /health。</small></label>
        <label className="settings-field"><span>访问 Token</span><input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={settings.hasToken ? "已保存（留空不修改）" : "可选"} /><small>只写字段，保存后不会回显。</small></label>
        <label className="settings-field"><span>回调密钥</span><input type="password" autoComplete="new-password" value={callbackSecret} onChange={(event) => setCallbackSecret(event.target.value)} placeholder={settings.hasCallbackSecret ? "已保存（留空不修改）" : "建议设置"} /><small>Agent 回写进度和结果时使用。</small></label>
      </div>
      <div className="platform-switches"><b>启用平台</b>{["抖音", "微博", "小红书", "知乎"].map((source) => <label key={source}><input type="checkbox" checked={enabledSources.includes(source)} onChange={() => setEnabledSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])} /><span>{source}</span></label>)}</div>
      <div className="settings-actions"><button className="ghost-button" disabled={saving || testing} onClick={() => void saveSettings()}>{saving ? "正在保存…" : "保存配置"}</button><button className="primary-button" disabled={!endpoint || saving || testing} onClick={() => void testConnection()}>{testing ? "正在测试…" : "测试连接"}</button>{settings.liveViewUrl && <a href={settings.liveViewUrl} target="_blank" rel="noreferrer" className="live-link">打开电脑实时画面 ↗</a>}</div>
      {(message || settings.lastError || settings.lastTestAt) && <div className={`connection-result ${settings.status === "failed" ? "failed" : ""}`}><strong>{message || (settings.status === "connected" ? "Agent 在线" : settings.lastError)}</strong>{settings.lastTestAt && <span>最近测试：{new Date(settings.lastTestAt).toLocaleString("zh-CN", { hour12: false })}</span>}{settings.status === "connected" && !settings.liveViewUrl && <span>连接已成功，但 Agent 尚未在 /health 返回 liveViewUrl，暂时无法显示实时电脑画面。</span>}</div>}
      <div className="contract-note"><b>AGENT CONTRACT</b><span>健康检查 GET /health · 接收任务 POST /v1/search-tasks · 进度与结果 POST 本系统 callback。Agent 返回 liveViewUrl 后即可观看真实浏览器操作。</span></div>
    </section>
  );
}

function SourcesView({ sources, jobs, onChanged }: { sources: Source[]; jobs: NonNullable<AppState["connectorJobs"]>; onChanged: () => Promise<void> }) {
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const waitingJobs = jobs.filter((job) => job.status === "awaiting_config").length || sources.filter((source) => source.status.includes("待")).length;
  const liveJob = jobs.find((job) => ["running", "waiting_login", "dispatched"].includes(job.status)) ?? jobs[0];
  useEffect(() => {
    const timer = window.setInterval(() => { void onChanged(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [onChanged]);
  return (
    <section>
      <div className="section-intro"><div><p className="eyebrow">CONNECTOR MATRIX</p><h2>六个平台，一套统一连接器</h2><p>公开论坛直接采集；社媒平台通过你现有的电脑 Agent 安全派发任务。</p></div><span className="audit-chip">{completedJobs} COMPLETED · {waitingJobs} WAITING</span></div>
      <div className="connector-readiness">
        <div><span>COMPUTER AGENT</span><strong>{waitingJobs ? "等待接入" : "连接状态正常"}</strong><p>配置服务地址、回调密钥和平台登录账号后，抖音/微博/小红书/知乎任务会自动派发并回写结果。</p></div>
        <div className="readiness-steps"><span className="done">01 · 数据协议</span><span className="done">02 · 安全回调</span><span className={waitingJobs ? "current" : "done"}>03 · Agent 地址</span><span>04 · 账号实测</span></div>
      </div>
      <ConnectorSettingsPanel onChanged={onChanged} />
      <section className="live-console">
        <div className="live-console-head"><div><p className="eyebrow">LIVE EXECUTION</p><h3>电脑执行现场</h3><span>每 5 秒自动更新 Agent 当前动作和画面。</span></div>{liveJob && <span className={`job-state ${liveJob.status}`}>{liveJob.status === "running" ? "执行中" : liveJob.status === "waiting_login" ? "等待人工登录" : liveJob.status === "completed" ? "已完成" : liveJob.status === "failed" ? "失败" : "已派发"}</span>}</div>
        {liveJob ? <div className="live-console-body">
          <div className="browser-stage">{liveJob.liveViewUrl || liveJob.screenshotUrl ? <iframe src={liveJob.liveViewUrl || liveJob.screenshotUrl} title={`${liveJob.source} 实时操作画面`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : <div className="screen-placeholder"><span>LIVE</span><strong>等待 Agent 提供实时画面</strong><p>任务已经记录，但 Agent 还没有回传 liveViewUrl。接通实时画面协议后，这里会显示浏览器正在操作的平台页面。</p></div>}</div>
          <div className="job-telemetry"><span>{liveJob.source} · {new Date(liveJob.dispatchedAt).toLocaleString("zh-CN", { hour12: false })}</span><h4>{liveJob.currentAction || (liveJob.error ? "执行失败" : "等待 Agent 状态")}</h4><div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, safeNumber(liveJob.progress)))}%` }} /></div><p>{safeNumber(liveJob.progress)}% · 已获取 {liveJob.fetched} 条</p>{liveJob.error && <div className="job-error">{liveJob.error}</div>}{liveJob.liveViewUrl && <a href={liveJob.liveViewUrl} target="_blank" rel="noreferrer" className="live-link">在新窗口观看电脑操作 ↗</a>}</div>
        </div> : <div className="live-empty"><strong>还没有电脑 Agent 任务</strong><span>先保存连接设置并测试成功，再到“检索任务”运行一次包含社媒平台的任务。</span></div>}
      </section>
      <div className="source-grid">
        {sources.map((source) => (
          <article className="source-card" key={source.id}>
            <div className="source-card-head"><span className="source-logo large">{initials(source.name)}</span><div><h3>{source.name}</h3><span>{source.coverage}</span></div><span className={`connector-status ${["可连接", "可执行", "已连接"].includes(source.status) ? "connected" : source.status.includes("待") ? "login" : "testing"}`}>{source.status}</span></div>
            <dl><div><dt>接入方式</dt><dd>{source.mode}</dd></div><div><dt>最近检查</dt><dd>{source.lastCheck}</dd></div></dl>
            <p>{source.note}</p>
            <span className="source-action">{["可连接", "可执行", "已连接"].includes(source.status) ? "READY TO RUN" : "CONFIGURATION REQUIRED"}</span>
          </article>
        ))}
      </div>
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

function GuideModal({ onClose, onCreate, onNavigate }: { onClose: () => void; onCreate: () => void; onNavigate: (view: View) => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="modal-head"><div><p className="eyebrow">QUICK START GUIDE</p><h2 id="guide-title">三分钟完成第一次人才检索</h2></div><button className="close-button" onClick={onClose} aria-label="关闭">×</button></div>
        <div className="guide-body">
          <p className="guide-intro">不用先研究所有菜单。创建一个任务、运行一次检索、审核一条线索，就能理解完整工作流。</p>
          <div className="guide-journey">
            <article><span>01</span><div><h3>粘贴客户 JD</h3><p>系统自动识别职位、技术栈、目标企业、求职信号和排除词，你只需检查结果。</p><button onClick={onCreate}>创建检索任务 →</button></div></article>
            <article><span>02</span><div><h3>选择并运行数据源</h3><p>EETOP、EDA365 可直接验证；抖音等社媒会在电脑 Agent 接通后自动派发。</p><button onClick={() => onNavigate("sources")}>查看数据源状态 →</button></div></article>
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

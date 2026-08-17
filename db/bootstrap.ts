import { env } from "cloudflare:workers";

export type DatabaseEnv = { DB: D1Database };

export function getD1() {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, jd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', sources TEXT NOT NULL DEFAULT '[]',
      tech_keywords TEXT NOT NULL DEFAULT '[]', company_keywords TEXT NOT NULL DEFAULT '[]',
      signal_keywords TEXT NOT NULL DEFAULT '[]', exclude_keywords TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '每天 09:00', time_range TEXT NOT NULL DEFAULT '近30天',
      discovered INTEGER NOT NULL DEFAULT 0, high_value INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      author TEXT NOT NULL, author_id TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
      snippet TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', intent TEXT NOT NULL DEFAULT '无',
      intelligence_type TEXT NOT NULL DEFAULT '人才线索', priority TEXT NOT NULL DEFAULT 'C',
      score INTEGER NOT NULL DEFAULT 0, company_note TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT '待审核', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_task_priority ON leads(task_id, priority)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_source_published ON leads(source, published_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_name TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
      fetched INTEGER NOT NULL DEFAULT 0, filtered INTEGER NOT NULL DEFAULT 0,
      deduped INTEGER NOT NULL DEFAULT 0, valid INTEGER NOT NULL DEFAULT 0,
      high_value INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_runs_task_started ON runs(task_id, started_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
      last_check TEXT NOT NULL, coverage TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS task_filters (
      task_id TEXT PRIMARY KEY, author_blacklist TEXT NOT NULL DEFAULT '[]',
      company_blacklist TEXT NOT NULL DEFAULT '[]', schedule_enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '未公开', author_id TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL, source_url TEXT NOT NULL, snippet TEXT NOT NULL,
      raw_payload TEXT NOT NULL DEFAULT '{}', fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_task_hash ON raw_items(task_id, content_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_task_fetched ON raw_items(task_id, fetched_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS connector_jobs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL,
      status TEXT NOT NULL, dispatched_at TEXT NOT NULL, completed_at TEXT,
      fetched INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_connector_jobs_task_status ON connector_jobs(task_id, status)"),
  ]);

  const taskCount = await db.prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>();
  if ((taskCount?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-gpu", "GPU数字验证工程师", "上海GPU数字验证工程师，5年以上经验，熟悉UVM、SystemVerilog、VCS、Verdi，有SoC流片经验。", "active", JSON.stringify(["抖音", "微博", "EETOP"]), JSON.stringify(["UVM", "SystemVerilog", "VCS", "Verdi", "SoC验证"]), JSON.stringify(["壁仞", "燧原", "沐曦"]), JSON.stringify(["看机会", "准备离职", "部门调整", "项目被砍"]), JSON.stringify(["培训", "课程", "招生", "广告"]), "每天 09:00", "近30天", 84, 12, now, now),
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-pd", "先进工艺数字后端", "数字后端工程师，7nm及以下工艺，熟悉Innovus、PrimeTime、Calibre。", "active", JSON.stringify(["知乎", "小红书", "EDA365"]), JSON.stringify(["数字后端", "Innovus", "PrimeTime", "Calibre", "STA"]), JSON.stringify(["海思", "紫光展锐", "芯原"]), JSON.stringify(["HC", "团队扩招", "项目调整"]), JSON.stringify(["外包培训", "网课"]), "每周一 10:00", "近90天", 43, 7, now, now),
    db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("task-company", "重点企业异动监控", "监控GPU、AI芯片及SoC企业的裁员、扩招、项目变动和流片问题。", "paused", JSON.stringify(["微博", "知乎", "抖音", "EETOP", "EDA365"]), JSON.stringify(["GPU", "SoC", "流片", "回片", "良率"]), JSON.stringify(["壁仞", "燧原", "沐曦", "摩尔线程"]), JSON.stringify(["裁员", "扩招", "冻结HC", "流片延期", "项目暂停"]), JSON.stringify(["媒体转载", "广告"]), "每天 18:00", "近7天", 128, 19, now, now),

    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-1", "task-gpu", "抖音", "芯片搬砖人", "douyin_4c9a", "2026-08-16 21:34", "项目刚被砍，组里最近变化挺大，准备看看上海的新机会。", JSON.stringify(["GPU", "数字验证", "项目变动"]), "强", "人才线索", "A", 91, "疑似GPU验证团队人员流动", "准备看看上海的新机会", "https://www.douyin.com/", "待审核", now),
    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-2", "task-gpu", "EETOP", "ic_flow_2020", "uid_88210", "2026-08-16 10:22", "UVM做了六年，两次SoC流片，今年有计划从深圳去上海发展。", JSON.stringify(["UVM", "SoC", "流片"]), "强", "人才线索", "A", 88, "验证经验与地域意向高度匹配", "有计划从深圳去上海发展", "https://www.eetop.cn/", "已确认", now),
    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-3", "task-company", "微博", "半导体观察员", "wb_7320", "2026-08-15 18:10", "某GPU公司验证团队近期还在扩大规模，多个方向重新开放HC。", JSON.stringify(["扩招", "GPU", "HC开放"]), "无", "企业情报", "A", 86, "验证团队扩招，可能产生招聘需求", "多个方向重新开放HC", "https://weibo.com/", "待审核", now),
    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-4", "task-pd", "知乎", "后端老兵", "zh_51e8", "2026-08-14 09:42", "最近项目收尾，后续方向不太确定，做过7nm后端和完整sign-off。", JSON.stringify(["7nm", "数字后端", "Sign-off"]), "中", "人才线索", "B", 79, "技术匹配，求职表达不明确", "后续方向不太确定", "https://www.zhihu.com/", "待审核", now),
    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-5", "task-company", "EDA365", "EDA小匠", "eda_1923", "2026-08-13 16:05", "听说二次流片时间又往后推，验证和后端最近都在加班收敛问题。", JSON.stringify(["流片延期", "验证", "数字后端"]), "无", "企业情报", "B", 76, "项目进度存在风险，需交叉验证", "二次流片时间又往后推", "https://bbs.eda365.com/", "待审核", now),
    db.prepare(`INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lead-6", "task-gpu", "小红书", "IC日常记录", "xhs_27ad", "2026-08-12 20:17", "做验证第三年，想了解一下上海AI芯片公司的机会和团队情况。", JSON.stringify(["AI芯片", "数字验证", "上海"]), "强", "人才线索", "A", 84, "主动了解机会，年限略低于JD", "想了解一下上海AI芯片公司的机会", "https://www.xiaohongshu.com/", "待审核", now),

    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("run-1", "task-gpu", "GPU数字验证工程师", now, now, "完成", 620, 410, 126, 84, 12, "6个来源执行完成，增量游标已更新"),
    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("run-2", "task-pd", "先进工艺数字后端", now, now, "完成", 318, 208, 67, 43, 7, "知乎连接器使用验证样本，其余来源正常"),
    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("run-3", "task-company", "重点企业异动监控", now, now, "部分完成", 244, 151, 48, 45, 8, "小红书登录状态需要人工确认"),

    ...[
      ["douyin", "抖音", "电脑Agent", "待配置", "未执行", "公开视频与评论", "需配置电脑接管产品的HTTP任务接口和登录账号"],
      ["weibo", "微博", "电脑Agent", "待配置", "未执行", "公开关键词结果", "需配置电脑接管产品的HTTP任务接口和登录账号"],
      ["xiaohongshu", "小红书", "电脑Agent", "待配置", "未执行", "公开笔记与评论", "需配置电脑接管产品的HTTP任务接口和登录账号"],
      ["zhihu", "知乎", "电脑Agent / 公开网页", "待配置", "未执行", "公开问答与文章", "需配置电脑接管产品，覆盖率取决于账号与平台风控"],
      ["eetop", "EETOP", "公开网页连接器", "可执行", "按任务检查", "公开论坛主题", "已实现公开索引检索，实际覆盖由站点可访问性决定"],
      ["eda365", "EDA365", "公开网页连接器", "可执行", "按任务检查", "公开论坛主题", "已实现公开索引检索，实际覆盖由站点可访问性决定"],
    ].map((source) => db.prepare("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?)").bind(...source)),
  ]);
}

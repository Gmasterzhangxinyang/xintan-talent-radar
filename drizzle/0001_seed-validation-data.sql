INSERT OR IGNORE INTO tasks (
  id, name, jd, status, sources, tech_keywords, company_keywords,
  signal_keywords, exclude_keywords, schedule, time_range, discovered,
  high_value, last_run_at, created_at
) VALUES
  ('task-gpu', 'GPU数字验证工程师', '上海GPU数字验证工程师，5年以上经验，熟悉UVM、SystemVerilog、VCS、Verdi，有SoC流片经验。', 'active', '["抖音","微博","EDA365"]', '["UVM","SystemVerilog","VCS","Verdi","SoC验证"]', '["壁仞","燧原","沐曦"]', '["看机会","准备离职","部门调整","项目被砍"]', '["培训","课程","招生","广告"]', '每天 09:00', '近30天', 84, 12, '2026-08-17T06:30:00.000Z', '2026-08-17T06:20:00.000Z'),
  ('task-pd', '先进工艺数字后端', '数字后端工程师，7nm及以下工艺，熟悉Innovus、PrimeTime、Calibre。', 'active', '["知乎","小红书","EDA365"]', '["数字后端","Innovus","PrimeTime","Calibre","STA"]', '["海思","紫光展锐","芯原"]', '["HC","团队扩招","项目调整"]', '["外包培训","网课"]', '每周一 10:00', '近90天', 43, 7, '2026-08-17T05:30:00.000Z', '2026-08-17T06:21:00.000Z'),
  ('task-company', '重点企业异动监控', '监控GPU、AI芯片及SoC企业的裁员、扩招、项目变动和流片问题。', 'paused', '["微博","知乎","抖音","EDA365"]', '["GPU","SoC","流片","回片","良率"]', '["壁仞","燧原","沐曦","摩尔线程"]', '["裁员","扩招","冻结HC","流片延期","项目暂停"]', '["媒体转载","广告"]', '每天 18:00', '近7天', 128, 19, '2026-08-16T10:00:00.000Z', '2026-08-17T06:22:00.000Z');
--> statement-breakpoint

INSERT OR IGNORE INTO leads (
  id, task_id, source, author, author_id, published_at, snippet, tags,
  intent, intelligence_type, priority, score, company_note, evidence,
  url, review_status, created_at
) VALUES
  ('lead-1', 'task-gpu', '抖音', '芯片搬砖人', 'douyin_4c9a', '2026-08-16 21:34', '项目刚被砍，组里最近变化挺大，准备看看上海的新机会。', '["GPU","数字验证","项目变动"]', '强', '人才线索', 'A', 91, '疑似GPU验证团队人员流动', '准备看看上海的新机会', 'https://www.douyin.com/', '待审核', '2026-08-17T06:30:00.000Z'),
  ('lead-3', 'task-company', '微博', '半导体观察员', 'wb_7320', '2026-08-15 18:10', '某GPU公司验证团队近期还在扩大规模，多个方向重新开放HC。', '["扩招","GPU","HC开放"]', '无', '企业情报', 'A', 86, '验证团队扩招，可能产生招聘需求', '多个方向重新开放HC', 'https://weibo.com/', '待审核', '2026-08-17T06:32:00.000Z'),
  ('lead-4', 'task-pd', '知乎', '后端老兵', 'zh_51e8', '2026-08-14 09:42', '最近项目收尾，后续方向不太确定，做过7nm后端和完整sign-off。', '["7nm","数字后端","Sign-off"]', '中', '人才线索', 'B', 79, '技术匹配，求职表达不明确', '后续方向不太确定', 'https://www.zhihu.com/', '待审核', '2026-08-17T06:33:00.000Z'),
  ('lead-5', 'task-company', 'EDA365', 'EDA小匠', 'eda_1923', '2026-08-13 16:05', '听说二次流片时间又往后推，验证和后端最近都在加班收敛问题。', '["流片延期","验证","数字后端"]', '无', '企业情报', 'B', 76, '项目进度存在风险，需交叉验证', '二次流片时间又往后推', 'https://bbs.eda365.com/', '待审核', '2026-08-17T06:34:00.000Z'),
  ('lead-6', 'task-gpu', '小红书', 'IC日常记录', 'xhs_27ad', '2026-08-12 20:17', '做验证第三年，想了解一下上海AI芯片公司的机会和团队情况。', '["AI芯片","数字验证","上海"]', '强', '人才线索', 'A', 84, '主动了解机会，年限略低于JD', '想了解一下上海AI芯片公司的机会', 'https://www.xiaohongshu.com/', '待审核', '2026-08-17T06:35:00.000Z');
--> statement-breakpoint

INSERT OR IGNORE INTO runs (
  id, task_id, task_name, started_at, finished_at, status, fetched,
  filtered, deduped, valid, high_value, message
) VALUES
  ('run-1', 'task-gpu', 'GPU数字验证工程师', '2026-08-17T06:30:00.000Z', '2026-08-17T06:31:00.000Z', '完成', 620, 410, 126, 84, 12, '5个来源执行完成，增量游标已更新'),
  ('run-2', 'task-pd', '先进工艺数字后端', '2026-08-17T05:30:00.000Z', '2026-08-17T05:31:00.000Z', '完成', 318, 208, 67, 43, 7, '知乎连接器使用验证样本，其余来源正常'),
  ('run-3', 'task-company', '重点企业异动监控', '2026-08-16T10:00:00.000Z', '2026-08-16T10:01:00.000Z', '部分完成', 244, 151, 48, 45, 8, '小红书登录状态需要人工确认');
--> statement-breakpoint

INSERT OR IGNORE INTO sources (id, name, mode, status, last_check, coverage, note) VALUES
  ('douyin', '抖音', '电脑控制 / 特殊权限', '验证中', '刚刚', '公开视频与评论', '可跑通搜索和评论链路；正式运行需账号稳定性测试'),
  ('weibo', '微博', '官方接口优先', '可连接', '2分钟前', '公开关键词结果', '额度与字段覆盖待真实账号复核'),
  ('xiaohongshu', '小红书', '电脑控制', '待登录', '未检查', '公开笔记与评论', '无全站公开检索接口，需控制频率'),
  ('zhihu', '知乎', '公开网页 / 电脑控制', '验证中', '12分钟前', '公开问答与文章', '全站覆盖率不作承诺'),
  ('eda365', 'EDA365', '公开网页连接器', '可连接', '4分钟前', '公开论坛主题', '职业生涯及技术板块已纳入');

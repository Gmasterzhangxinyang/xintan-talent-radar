# 芯探 Talent Radar

面向芯片设计行业猎头的社媒公开信息搜集与线索分析系统。站点运行在 Cloudflare Workers/vinext，业务数据存储于 D1。

## 已实现

- 多任务创建、编辑、暂停、恢复、删除
- JD 服务端拆解：技术栈、EDA 工具、同义词、企业、求职/企业信号和排除词
- 知乎专用本机浏览器 Agent，复用用户已登录的浏览器会话
- 时间范围、内容/作者/企业黑名单过滤
- SHA-256 内容指纹增量去重，保存原始记录和结构化线索
- 裁员、扩招、项目变动、流片问题、求职意向识别和价值评分
- 可见浏览器逐条停留分析：高亮当前原文，同步展示命中词、标签、意向、评分及保留/过滤原因
- 保存逐条分析审计记录，可回看知乎每条内容具体分析了什么
- 本机 AI 中枢配置：通过 Responses API 让模型评价内容并决定下一步，API Key 仅保存在当前电脑
- 受控 Agent 循环：观察、AI 决策、策略校验、电脑行动、结果回传；限制步数、条数、域名和动作白名单
- 强制详情深读：列表只发现候选，每条必须进入站内原文，读取正文与公开评论后再由 AI 定案并引用证据
- 独立设置每轮知乎深读条数；内容按“轮换检索词、打开详情、读取正文、逐条阅读公开评论、AI定案、返回列表”的顺序串行执行，未达目标条数会明确标记为部分完成
- 默认禁止私信、发布、点赞关注、上传下载、密码/验证码输入、绕过验证和越域访问
- 原文、公开作者、发布时间、来源 URL、证据和人工复核状态
- 多条件筛选、服务端 Excel 导出、运行数量审计
- 手动扫描、后台调度端点与 Worker scheduled 处理器
- CSV、TSV、TXT、XLSX 与 URL 列表导入：模板下载、逐行预览、错误隔离、AI 分析、全局去重和批次报告
- 全局内容库：同一公开内容只保存一次，可同时关联多套检索任务
- 版本化 AI 分析与证据校验：AI 调用失败或引用不存在时不会生成伪线索
- AI 请求审计：记录响应 ID、模型、耗时、重试次数和建议动作，支持人才与企业情报同时命中
- 独立运行中心：展示显式状态机、分来源数量漏斗、错误原因和事件时间线
- 完整人工复核：确认、误报、忽略、稍后处理与人工备注
- 安全停止：运行中可取消，当前步骤结束后停止且保留已完成结果
- macOS、Windows、Linux 浏览器路径探测与本机助手心跳接口

## 导入工作流

进入「检索」→「Import data」，选择目标任务后可上传 CSV/XLSX，或粘贴 `URL | 原文片段 | 作者 | 发布时间`。系统先逐行预览，再调用本机 AI，最后经过与自动采集相同的标准化、时间/黑名单过滤、任务匹配、证据校验和去重 Pipeline。原始上传文件不会长期保存。

## 电脑 Agent 接口

配置 Worker 环境变量：

- `COMPUTER_AGENT_URL`：电脑接管产品的服务地址
- `COMPUTER_AGENT_TOKEN`：派发任务所需 Bearer Token（可选）
- `COMPUTER_AGENT_CALLBACK_SECRET`：回调鉴权密钥
- `SCHEDULER_SECRET`：后台调度端点鉴权密钥

系统向 `${COMPUTER_AGENT_URL}/v1/search-tasks` 发送：

```json
{
  "jobId": "job-uuid",
  "taskId": "task-uuid",
  "platform": "知乎",
  "queries": ["UVM", "准备离职"],
  "excludeKeywords": ["培训", "广告"],
  "timeRange": "近30天",
  "fields": ["snippet", "author", "authorId", "publishedAt", "url"],
  "callbackUrl": "https://site/api/connectors/computer-agent/callback"
}
```

Agent 回调时需携带 `x-xintan-callback-secret`，Body 为：

```json
{
  "jobId": "job-uuid",
  "taskId": "task-uuid",
  "source": "知乎",
  "items": [{
    "externalId": "comment-id",
    "author": "公开昵称",
    "authorId": "公开ID",
    "publishedAt": "2026-08-17T08:00:00.000Z",
    "snippet": "公开原文",
    "url": "https://www.zhihu.com/question/..."
  }]
}
```

## 本地验证

```bash
npm install
npm test
npm run lint
npm run dev
```

本机助手：

```bash
node local-assistant/server.mjs
```

健康检查分别为 `GET /health` 与 `GET /v1/heartbeat`。首次运行会建立芯探专用浏览器资料目录，账号与 Cookie 仍保存在本机浏览器中。

连接器仅处理知乎公开或获得授权的数据。真实覆盖率、账号风控与可持续运行能力必须使用实际知乎账号和本机电脑 Agent 联调验证。

当前交付范围按项目确认收敛为知乎，不把 EETOP、EDA365、微博、小红书或抖音标记为已支持。

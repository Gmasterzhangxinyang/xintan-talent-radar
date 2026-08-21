# 芯探 Talent Radar

面向芯片设计行业猎头的社媒公开信息搜集与线索分析系统。站点运行在 Cloudflare Workers/vinext，业务数据存储于 D1。

## 已实现

- 多任务创建、编辑、暂停、恢复、删除
- JD 服务端拆解：技术栈、EDA 工具、同义词、企业、求职/企业信号和排除词
- 抖音、微博、小红书、知乎电脑 Agent 作业派发与鉴权回调协议
- EDA365 公开索引连接器
- 时间范围、内容/作者/企业黑名单过滤
- SHA-256 内容指纹增量去重，保存原始记录和结构化线索
- 裁员、扩招、项目变动、流片问题、求职意向识别和价值评分
- 可见浏览器逐条停留分析：高亮当前原文，同步展示命中词、标签、意向、评分及保留/过滤原因
- 按数据源保存逐条分析审计记录，可回看每个平台具体分析了什么
- 本机 AI 中枢配置：通过 Responses API 让模型评价内容并决定下一步，API Key 仅保存在当前电脑
- 受控 Agent 循环：观察、AI 决策、策略校验、电脑行动、结果回传；限制步数、条数、域名和动作白名单
- 默认禁止私信、发布、点赞关注、上传下载、密码/验证码输入、绕过验证和越域访问
- 原文、公开作者、发布时间、来源 URL、证据和人工复核状态
- 多条件筛选、服务端 Excel 导出、运行数量审计
- 手动扫描、后台调度端点与 Worker scheduled 处理器

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
  "platform": "抖音",
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
  "source": "抖音",
  "items": [{
    "externalId": "comment-id",
    "author": "公开昵称",
    "authorId": "公开ID",
    "publishedAt": "2026-08-17T08:00:00.000Z",
    "snippet": "公开原文",
    "url": "https://www.douyin.com/..."
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

社媒连接器仅处理公开或获得授权的数据。真实覆盖率、账号风控与可持续运行能力必须使用实际平台账号和电脑 Agent 联调验证。

import { unique } from "./json";

const EVENT_RULES: Array<[string, string[]]> = [
  ["裁员", ["裁员", "优化", "被裁", "人员缩减", "毕业"]],
  ["扩招", ["扩招", "招人", "开放hc", "hc开放", "大量招聘", "补人"]],
  ["项目变动", ["项目被砍", "项目暂停", "项目调整", "项目收尾", "方向调整", "团队调整"]],
  ["流片问题", ["流片延期", "流片失败", "回片异常", "良率", "二次流片", "延期tapeout"]],
];
const STRONG_INTENT = ["准备离职", "考虑跳槽", "看机会", "求内推", "想换工作", "找工作", "可以私聊", "求职"];
const MEDIUM_INTENT = ["后续方向不确定", "项目收尾", "团队调整", "了解机会", "去上海发展", "职业规划"];

function includesAny(text: string, terms: string[]) {
  const lowered = text.toLowerCase();
  return terms.filter((term) => lowered.includes(term.toLowerCase()));
}

export function analyzeCandidate(snippet: string, config: { tech: string[]; companies: string[]; signals: string[] }) {
  const techMatches = includesAny(snippet, config.tech);
  const companyMatches = includesAny(snippet, config.companies);
  const configuredSignals = includesAny(snippet, config.signals);
  const eventMatches = EVENT_RULES.filter(([, terms]) => includesAny(snippet, terms).length).map(([event]) => event);
  const strong = includesAny(snippet, STRONG_INTENT);
  const medium = includesAny(snippet, MEDIUM_INTENT);
  const intent = strong.length ? "强" : medium.length || configuredSignals.length ? "中" : "无";
  const intelligenceType = eventMatches.length && !strong.length ? "企业情报" : "人才线索";
  const recencyScore = 10;
  const score = Math.min(100,
    20 + Math.min(30, techMatches.length * 10) + Math.min(15, companyMatches.length * 8) +
    Math.min(20, eventMatches.length * 12) + (intent === "强" ? 25 : intent === "中" ? 12 : 0) + recencyScore,
  );
  const priority = score >= 80 ? "A" : score >= 60 ? "B" : "C";
  const tags = unique([...techMatches, ...companyMatches, ...eventMatches, ...configuredSignals]).slice(0, 8);
  const evidenceTerm = strong[0] ?? medium[0] ?? eventMatches[0] ?? techMatches[0] ?? configuredSignals[0] ?? "关键词匹配";
  const sentence = snippet.split(/[。！？!?\n]/).find((item) => item.includes(evidenceTerm))?.trim() || snippet.slice(0, 100);
  const companyNote = intelligenceType === "企业情报"
    ? `${eventMatches.join("、") || "企业动态"}信号，建议交叉验证后跟进`
    : `${techMatches.join("、") || "芯片经验"}与任务匹配，求职信号为${intent}`;
  return { tags, intent, intelligenceType, priority, score, evidence: sentence, companyNote };
}

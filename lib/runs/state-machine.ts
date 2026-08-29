export const RUN_STATUSES = [
  "queued", "dispatching", "waiting_login", "searching", "collecting", "normalizing", "deduplicating",
  "prefiltering", "matching", "analyzing", "persisting", "completed", "partial", "failed", "cancelled",
] as const;

export type RunStatus = typeof RUN_STATUSES[number];

const TERMINAL = new Set<RunStatus>(["completed", "partial", "failed", "cancelled"]);
const ALLOWED: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set(["dispatching", "failed", "cancelled"]),
  dispatching: new Set(["waiting_login", "searching", "collecting", "failed", "cancelled"]),
  waiting_login: new Set(["searching", "cancelled", "failed"]),
  searching: new Set(["collecting", "partial", "failed", "cancelled"]),
  collecting: new Set(["normalizing", "partial", "failed", "cancelled"]),
  normalizing: new Set(["deduplicating", "partial", "failed", "cancelled"]),
  deduplicating: new Set(["prefiltering", "partial", "failed", "cancelled"]),
  prefiltering: new Set(["matching", "partial", "failed", "cancelled"]),
  matching: new Set(["analyzing", "partial", "failed", "cancelled"]),
  analyzing: new Set(["persisting", "partial", "failed", "cancelled"]),
  persisting: new Set(["completed", "partial", "failed", "cancelled"]),
  completed: new Set(), partial: new Set(), failed: new Set(), cancelled: new Set(),
};

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

export function canTransitionRun(from: RunStatus, to: RunStatus) {
  return from === to || ALLOWED[from].has(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus) {
  if (!canTransitionRun(from, to)) throw new Error(`invalid_run_transition:${from}->${to}`);
}

export function isTerminalRunStatus(status: RunStatus) {
  return TERMINAL.has(status);
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "排队中", dispatching: "正在派发", waiting_login: "等待登录", searching: "正在检索", collecting: "正在采集",
  normalizing: "正在标准化", deduplicating: "正在去重", prefiltering: "正在过滤", matching: "正在匹配",
  analyzing: "AI 分析中", persisting: "正在入库", completed: "完成", partial: "部分完成", failed: "失败", cancelled: "已取消",
};

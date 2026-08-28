export type TaskRecord = {
  id: string;
  name: string;
  jd: string;
  status: string;
  sources: string;
  tech_keywords: string;
  company_keywords: string;
  signal_keywords: string;
  exclude_keywords: string;
  schedule: string;
  time_range: string;
  role_family?: string | null;
  locations?: string;
  seniority?: string;
  query_groups?: string;
  analysis_profile_id?: string | null;
  scan_mode?: string;
  last_successful_run_at?: string | null;
  version?: number;
  source_limits?: string;
  author_blacklist?: string;
  company_blacklist?: string;
};

export type CandidateItem = {
  source: string;
  externalId?: string;
  title?: string;
  author?: string;
  authorId?: string;
  authorProfileUrl?: string;
  publishedAt?: string;
  publishedAtRaw?: string;
  timeConfidence?: "high" | "medium" | "low" | "unknown";
  snippet: string;
  fullText?: string;
  contentType?: "post" | "answer" | "comment" | "video" | "forum_topic";
  url: string;
  raw?: unknown;
};

export type IngestStats = {
  fetched: number;
  filtered: number;
  deduped: number;
  valid: number;
  highValue: number;
  timeFiltered?: number;
  blacklistFiltered?: number;
  advertisementFiltered?: number;
  matched?: number;
  analyzed?: number;
  failed?: number;
};

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
  source_limits?: string;
};

export type CandidateItem = {
  source: string;
  externalId?: string;
  author?: string;
  authorId?: string;
  publishedAt?: string;
  snippet: string;
  url: string;
  raw?: unknown;
};

export type IngestStats = {
  fetched: number;
  filtered: number;
  deduped: number;
  valid: number;
  highValue: number;
};

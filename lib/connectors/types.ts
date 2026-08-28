export type ContentType = "post" | "answer" | "comment" | "video" | "forum_topic";

export type CollectedItem = {
  source: string;
  externalId?: string;
  canonicalUrl: string;
  author?: {
    nickname: string;
    publicId?: string;
    profileUrl?: string;
  };
  publishedAt?: string;
  publishedAtRaw?: string;
  timeConfidence?: "high" | "medium" | "low" | "unknown";
  title?: string;
  snippet: string;
  fullText?: string;
  contentType: ContentType;
  rawPayload?: Record<string, unknown>;
};

export type ConnectorHealthStatus =
  | "not_configured"
  | "ready"
  | "login_required"
  | "verification_required"
  | "rate_limited"
  | "selector_broken"
  | "temporarily_unavailable"
  | "disabled";

export type ConnectorHealth = {
  source: string;
  status: ConnectorHealthStatus;
  checkedAt: string;
  message?: string;
};

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  error?: string;
  meta: { changes?: number; [key: string]: unknown };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}

declare module "cloudflare:workers" {
  export const env: { DB: D1Database; [key: string]: unknown };
}

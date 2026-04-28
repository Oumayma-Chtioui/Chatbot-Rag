const API = "http://localhost:8000";
const token = () => localStorage.getItem("admin_token");

const h = () => ({
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
});

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: h(), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Overview ──────────────────────────────────────────────────────────────────

export interface AdminOverviewData {
  // Users
  total_users: number;
  new_users_this_month: number;

  // Bots
  total_bots: number;

  // Messages
  total_messages: number;
  messages_this_month: number;
  messages_change_pct?: number;       // NEW — % change vs previous 30 days

  // Sessions
  total_sessions?: number;            // NEW — for avg msgs/session calc

  // Revenue
  mrr: number;
  arr: number;
  revenue_this_month: number;
  revenue_last_month: number;
  revenue_change_pct: number;

  // NEW — Revenue + user growth curve (30 days)
  revenue_per_day?: {
    date: string;       // "YYYY-MM-DD"
    revenue: number;    // revenue earned that day
    new_users: number;  // signups that day
  }[];

  // NEW — User growth evolution badges
  user_change_ww?:  number;   // week-over-week % change
  user_change_mom?: number;   // month-over-month % change
  user_change_yoy?: number;   // year-over-year % change

  // NEW — Avg response time across all bots (ms)
  avg_response_ms?: number;

  // NEW — Response time sparkline (30 days)
  response_time_per_day?: {
    date: string;
    avg_ms: number;
  }[];

  // NEW — Token / credit consumption
  tokens_used_this_month?:  number;
  tokens_quota_this_month?: number;

  // NEW — Document type breakdown
  doc_types?: { type: string; count: number }[];

  // Legacy fallback (still returned by /admin/overview, used as timeline proxy)
  messages_per_day?: { date: string; count: number; new_users?: number }[];

  // Plans
  plan_breakdown: { plan: string; count: number; revenue: number }[];

  // Clients
  top_clients: TopClient[];

  // Activity
  activity_feed: ActivityItem[];
}

export interface TopClient {
  id: string;
  name: string;
  email: string;
  plan: string;
  messages_used: number;
  messages_quota: number;
  storage_used_gb: number;
  storage_quota_gb: number;
  mrr: number;
  usage_pct: number;
}

export interface ActivityItem {
  bot_name: string;
  message: string;
  created_at: string;
}

export const getAdminOverview = (): Promise<AdminOverviewData> =>
  req("/admin/overview");

// ── Clients ───────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  messages_used: number;
  messages_quota: number;
  docs_indexed: number;
  docs_quota: number;
  storage_used_gb: number;
  storage_quota_gb: number;
  mrr: number;
  renewal_date: string;
  quota_breakdown: { label: string; pct: number; color: string }[];
}

export const getAdminClients = (): Promise<{ clients: ClientRow[] }> =>
  req("/admin/clients");

export const updateClientPlan = (clientId: string, plan: string) =>
  req(`/admin/clients/${clientId}/plan`, {
    method: "PATCH",
    body: JSON.stringify({ plan }),
  });

// ── Bots ──────────────────────────────────────────────────────────────────────

export interface BotRow {
  id: string;
  name: string;
  owner_email: string;
  total_messages: number;
  success_rate: number;
  avg_response_ms: number;
  docs_indexed: number;
  created_at: string;
}

export const getAdminBots = (): Promise<{ bots: BotRow[] }> =>
  req("/admin/bots");

// ── System ────────────────────────────────────────────────────────────────────

export interface SystemInfo {
  cpu_pct: number;
  ram_pct: number;
  disk_pct: number;

  mongo_collections: { name: string; size_mb: number; count: number }[];

  faiss: {
    total_indexes: number;
    user_breakdown: Record<string, number>;
  };

  uploads: {
    file_count: number;
  };
}

export const getSystemInfo = (): Promise<SystemInfo> =>
  req("/admin/system");

// ── Feedback ──────────────────────────────────────────────────────────────────

export interface FeedbackRow {
  id: string;
  bot_name: string;
  rating: number;
  comment: string;
  category: string;
  user_name: string;
  created_at: string;
}

export const getAdminFeedback = (): Promise<{
  feedback: FeedbackRow[];
  avg_score: number;
}> => req("/admin/feedback");
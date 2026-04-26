import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { getAdminClients, updateClientPlan, ClientRow } from "./Adminapi";

// ── Plan badge ────────────────────────────────────────────────────────────────

const PLANS = ["free", "starter", "growth", "enterprise"];

const PLAN_STYLE: Record<string, { bg: string; color: string }> = {
  free:       { bg: "rgba(136,135,128,0.15)", color: "#444441" },
  starter:    { bg: "rgba(29,158,117,0.12)",  color: "#085041" },
  growth:     { bg: "rgba(127,119,221,0.15)", color: "#3C3489" },
  enterprise: { bg: "rgba(186,117,23,0.12)",  color: "#633806" },
};

// ── Mini donut — usage breakdown ──────────────────────────────────────────────

const UsageDonut: React.FC<{ data: { label: string; pct: number; color: string }[] }> = ({ data }) => {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <PieChart width={64} height={64}>
        <Pie
          data={data}
          cx={28} cy={28}
          innerRadius={18} outerRadius={28}
          dataKey="pct"
          paddingAngle={2}
          strokeWidth={0}
          onMouseEnter={(_, i) => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
        >
          {data.map((entry, i) => (
            <Cell
              key={entry.label}
              fill={entry.color}
              opacity={hovered === null || hovered === i ? 1 : 0.35}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [`${Math.round(value)}%`, name]}
          contentStyle={{
            fontSize: 11,
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 8px",
          }}
          itemStyle={{ color: "var(--text)" }}
        />
      </PieChart>
      {hovered !== null && (
        <div style={{
          position: "absolute",
          fontSize: 10, fontWeight: 600,
          color: data[hovered]?.color,
          pointerEvents: "none",
          textAlign: "center",
          lineHeight: 1.2,
        }}>
          {Math.round(data[hovered]?.pct ?? 0)}%
        </div>
      )}
    </div>
  );
};

// ── Quota bar ─────────────────────────────────────────────────────────────────

const QuotaCell: React.FC<{ used: number; total: number; unit?: string }> = ({ used, total, unit = "" }) => {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const color = pct >= 90 ? "#D85A30" : pct >= 70 ? "#BA7517" : "#7F77DD";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>
        <span>{used.toLocaleString()}{unit} / {total.toLocaleString()}{unit}</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
};

// ── Plan selector ─────────────────────────────────────────────────────────────

const PlanSelect: React.FC<{
  clientId: string;
  current: string;
  onUpdated: () => void;
}> = ({ clientId, current, onUpdated }) => {
  const [loading, setLoading] = useState(false);
  const style = PLAN_STYLE[current.toLowerCase()] ?? PLAN_STYLE.free;

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPlan = e.target.value;
    setLoading(true);
    try {
      await updateClientPlan(clientId, newPlan);
      onUpdated();
    } catch {
      // surface error via toast in real app
    } finally {
      setLoading(false);
    }
  };

  return (
    <select
      value={current.toLowerCase()}
      onChange={handleChange}
      disabled={loading}
      style={{
        padding: "3px 8px", borderRadius: 20, border: "none",
        background: style.bg, color: style.color,
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        textTransform: "capitalize",
        appearance: "none",
        WebkitAppearance: "none",
        outline: "none",
        minWidth: 80,
      }}
    >
      {PLANS.map((p) => (
        <option key={p} value={p} style={{ textTransform: "capitalize" }}>{p}</option>
      ))}
    </select>
  );
};

// ── Alert badge ───────────────────────────────────────────────────────────────

const AlertBadge: React.FC<{ client: ClientRow }> = ({ client }) => {
  const msgPct  = client.messages_quota > 0 ? (client.messages_used / client.messages_quota) * 100 : 0;
  const docPct  = client.docs_quota > 0     ? (client.docs_indexed  / client.docs_quota)     * 100 : 0;
  const stoPct  = client.storage_quota_gb > 0 ? (client.storage_used_gb / client.storage_quota_gb) * 100 : 0;

  const maxPct  = Math.max(msgPct, docPct, stoPct);
  if (maxPct < 70) return null;

  const bg    = maxPct >= 90 ? "rgba(216,90,48,0.12)"  : "rgba(186,117,23,0.12)";
  const color = maxPct >= 90 ? "#993C1D"               : "#633806";
  const label = maxPct >= 90 ? "Critical" : "Warning";

  return (
    <span style={{ padding: "2px 7px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

const AdminClients: React.FC = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");
  const [sort,    setSort]    = useState<{ key: keyof ClientRow; dir: 1 | -1 }>({ key: "mrr", dir: -1 });

  const load = () => {
    setLoading(true);
    getAdminClients()
      .then((d) => setClients(d.clients))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSort = (key: keyof ClientRow) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
  };

  const filtered = clients
    .filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const av = a[sort.key] as any;
      const bv = b[sort.key] as any;
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });

  const nearQuota = clients.filter((c) => {
    const msgPct = c.messages_quota > 0 ? (c.messages_used / c.messages_quota) * 100 : 0;
    return msgPct >= 70;
  });

  if (loading) return <div className="admin-loading">Loading clients…</div>;
  if (error)   return <div className="admin-error">{error}</div>;

  const SortIcon = ({ k }: { k: keyof ClientRow }) =>
    sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  return (
    <div className="admin-clients">

      {/* ── Quota alert strip ── */}
      {nearQuota.length > 0 && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 10,
          background: "rgba(186,117,23,0.08)", border: "1px solid rgba(186,117,23,0.2)",
        }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#633806", marginBottom: 4 }}>
            ⚠ {nearQuota.length} client{nearQuota.length > 1 ? "s" : ""} approaching quota
          </p>
          <p style={{ fontSize: 11, color: "#854F0B" }}>
            {nearQuota.map((c) => c.name).join(", ")}
          </p>
        </div>
      )}

      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg2)", color: "var(--text)", fontSize: 13, flex: 1, maxWidth: 300,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
          {filtered.length} clients
        </span>
      </div>

      {/* ── Table ── */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {[
                  { label: "Client",     key: "name"           },
                  { label: "Plan",       key: "plan"           },
                  { label: "Usage breakdown", key: null        },
                  { label: "Messages",   key: "messages_used"  },
                  { label: "Docs",       key: "docs_indexed"   },
                  { label: "Storage",    key: "storage_used_gb"},
                  { label: "MRR",        key: "mrr"            },
                  { label: "Renewal",    key: "renewal_date"   },
                  { label: "Status",     key: null             },
                ].map(({ label, key }) => (
                  <th
                    key={label}
                    onClick={key ? () => handleSort(key as keyof ClientRow) : undefined}
                    style={{
                      padding: "10px 14px", textAlign: "left",
                      fontWeight: 600, color: "var(--text3)",
                      fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase",
                      cursor: key ? "pointer" : "default",
                      whiteSpace: "nowrap",
                      background: "var(--bg2)",
                    }}
                  >
                    {label}{key ? <SortIcon k={key as keyof ClientRow} /> : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((client, i) => {
                const style = PLAN_STYLE[client.plan.toLowerCase()] ?? PLAN_STYLE.free;
                return (
                  <tr
                    key={client.id}
                    style={{
                      borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                      background: i % 2 === 0 ? "var(--bg)" : "rgba(128,128,128,0.02)",
                    }}
                  >
                    {/* client */}
                    <td style={{ padding: "12px 14px" }}>
                      <p style={{ fontWeight: 500, color: "var(--text)", marginBottom: 1 }}>{client.name}</p>
                      <p style={{ color: "var(--text3)", fontSize: 11 }}>{client.email}</p>
                    </td>

                    {/* plan toggle */}
                    <td style={{ padding: "12px 14px" }}>
                      <PlanSelect clientId={client.id} current={client.plan} onUpdated={load} />
                    </td>

                    {/* usage donut */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <UsageDonut data={client.quota_breakdown} />
                        <div style={{ fontSize: 10, color: "var(--text3)", lineHeight: 1.6 }}>
                          {client.quota_breakdown.map((b) => (
                            <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: 1, background: b.color, display: "inline-block" }} />
                              {b.label} {Math.round(b.pct)}%
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>

                    {/* messages */}
                    <td style={{ padding: "12px 14px", minWidth: 130 }}>
                      <QuotaCell used={client.messages_used} total={client.messages_quota} />
                    </td>

                    {/* docs */}
                    <td style={{ padding: "12px 14px", minWidth: 110 }}>
                      <QuotaCell used={client.docs_indexed} total={client.docs_quota} />
                    </td>

                    {/* storage */}
                    <td style={{ padding: "12px 14px", minWidth: 110 }}>
                      <QuotaCell
                        used={parseFloat(client.storage_used_gb.toFixed(1))}
                        total={client.storage_quota_gb}
                        unit=" GB"
                      />
                    </td>

                    {/* mrr */}
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <p style={{ fontWeight: 600, color: "#1D9E75", fontSize: 13 }}>
                        ${client.mrr}
                      </p>
                    </td>

                    {/* renewal */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <p style={{ fontSize: 12, color: "var(--text2)" }}>
                        {new Date(client.renewal_date).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </td>

                    {/* alert */}
                    <td style={{ padding: "12px 14px" }}>
                      <AlertBadge client={client} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                    No clients found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminClients;
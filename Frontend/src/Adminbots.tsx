import React, { useEffect, useState } from "react";
import { getAdminBots, BotRow } from "./Adminapi";

// ── Health score ──────────────────────────────────────────────────────────────

function healthScore(bot: BotRow): { score: number; color: string; label: string } {
  // weighted: 60% success rate + 40% inverted response time (cap at 3000ms)
  const rtScore = Math.max(0, 1 - bot.avg_response_ms / 3000);
  const raw = bot.success_rate * 0.6 + rtScore * 100 * 0.4;
  const score = Math.min(100, Math.round(raw));
  const color = score >= 80 ? "#1D9E75" : score >= 55 ? "#BA7517" : "#D85A30";
  const label = score >= 80 ? "Good" : score >= 55 ? "Fair" : "Poor";
  return { score, color, label };
}

// ── Score ring ────────────────────────────────────────────────────────────────

const ScoreRing: React.FC<{ score: number; color: string }> = ({ score, color }) => {
  const R = 14;
  const C = 2 * Math.PI * R;
  const dash = (score / 100) * C;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-label={`Health score ${score}`}>
      <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="4" />
      <circle
        cx="20" cy="20" r={R} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${C}`}
        transform="rotate(-90 20 20)"
        strokeLinecap="round"
      />
      <text x="20" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>{score}</text>
    </svg>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────

const AdminBots: React.FC = () => {
  const [bots,    setBots]    = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");
  const [sort,    setSort]    = useState<{ key: keyof BotRow | "health"; dir: 1 | -1 }>({ key: "total_messages", dir: -1 });

  useEffect(() => {
    getAdminBots()
      .then((d) => setBots(d.bots))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="admin-loading">Loading bots…</div>;
  if (error)   return <div className="admin-error">{error}</div>;

  const handleSort = (key: typeof sort["key"]) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
  };

  const SortIcon = ({ k }: { k: typeof sort["key"] }) =>
    sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  const filtered = bots
    .filter((b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.owner_email.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sort.key === "health") {
        return (healthScore(a).score - healthScore(b).score) * sort.dir;
      }
      const av = a[sort.key as keyof BotRow] as any;
      const bv = b[sort.key as keyof BotRow] as any;
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });

  return (
    <div className="admin-bots">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search bots or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg2)", color: "var(--text)", fontSize: 13, flex: 1, maxWidth: 300,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
          {filtered.length} bots
        </span>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
                {[
                  { label: "Bot",           key: "name"            },
                  { label: "Owner",         key: "owner_email"     },
                  { label: "Health",        key: "health"          },
                  { label: "Messages",      key: "total_messages"  },
                  { label: "Success rate",  key: "success_rate"    },
                  { label: "Avg resp. time",key: "avg_response_ms" },
                  { label: "Docs",          key: "docs_indexed"    },
                  { label: "Created",       key: "created_at"      },
                ].map(({ label, key }) => (
                  <th
                    key={label}
                    onClick={() => handleSort(key as any)}
                    style={{
                      padding: "10px 14px", textAlign: "left",
                      fontWeight: 600, color: "var(--text3)",
                      fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase",
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {label}<SortIcon k={key as any} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((bot, i) => {
                const { score, color, label } = healthScore(bot);
                const rtColor = bot.avg_response_ms > 2500 ? "#D85A30" : bot.avg_response_ms > 1500 ? "#BA7517" : "#1D9E75";

                return (
                  <tr
                    key={bot.id}
                    style={{
                      borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                      background: i % 2 === 0 ? "var(--bg)" : "rgba(128,128,128,0.02)",
                    }}
                  >
                    {/* name */}
                    <td style={{ padding: "12px 14px" }}>
                      <p style={{ fontWeight: 500, color: "var(--text)" }}>{bot.name}</p>
                    </td>

                    {/* owner */}
                    <td style={{ padding: "12px 14px" }}>
                      <p style={{ color: "var(--text2)", fontSize: 11 }}>{bot.owner_email}</p>
                    </td>

                    {/* health ring */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ScoreRing score={score} color={color} />
                        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
                      </div>
                    </td>

                    {/* messages */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontWeight: 500, color: "var(--text)" }}>
                        {bot.total_messages.toLocaleString()}
                      </span>
                    </td>

                    {/* success rate */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{
                        fontWeight: 600,
                        color: bot.success_rate >= 80 ? "#1D9E75" : bot.success_rate >= 60 ? "#BA7517" : "#D85A30",
                      }}>
                        {bot.success_rate}%
                      </span>
                    </td>

                    {/* avg response time */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontWeight: 500, color: rtColor }}>
                        {bot.avg_response_ms.toLocaleString()} ms
                      </span>
                    </td>

                    {/* docs */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ color: "var(--text2)" }}>{bot.docs_indexed}</span>
                    </td>

                    {/* created */}
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <span style={{ color: "var(--text3)", fontSize: 11 }}>
                        {new Date(bot.created_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                    No bots found.
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

export default AdminBots;
import React, { useEffect, useState, useCallback } from "react";
import { getAdvancedAnalytics } from "./api";

// ── Types ────────────────────────────────────────────────────────────────────

interface Keyword   { word: string; count: number }
interface Unanswered { question: string; created_at: string }
interface Analytics {
  total:                    number;
  success_count:            number;
  failure_count:            number;
  success_rate:             number;
  top_keywords:             Keyword[];
  unanswered_questions:     Unanswered[];
  avg_messages_per_session: number;
  total_sessions:           number;
  pending_tickets:          number;
}

interface Props { bot: { id: string; name: string } }

// ── Donut Chart ───────────────────────────────────────────────────────────────

const DonutChart: React.FC<{ success: number; failure: number; total: number }> = ({
  success, failure, total,
}) => {
  const R = 52;
  const circumference = 2 * Math.PI * R;
  const successRate   = total > 0 ? success / total : 0;
  const successDash   = successRate * circumference;
  const failureDash   = circumference - successDash;

  return (
    <div className="donut-wrapper">
      <svg viewBox="0 0 140 140" width="140" height="140" aria-label={`Taux de succès ${Math.round(successRate * 100)}%`}>
        {/* failure ring */}
        <circle cx="70" cy="70" r={R} fill="none" stroke="#ef4444" strokeWidth="18" opacity="0.25" />
        {/* failure arc */}
        {failure > 0 && (
          <circle
            cx="70" cy="70" r={R} fill="none" stroke="#ef4444" strokeWidth="18"
            strokeDasharray={`${failureDash} ${circumference}`}
            strokeDashoffset={-successDash}
            transform="rotate(-90 70 70)"
          />
        )}
        {/* success arc */}
        {success > 0 && (
          <circle
            cx="70" cy="70" r={R} fill="none" stroke="#22c55e" strokeWidth="18"
            strokeDasharray={`${successDash} ${circumference}`}
            strokeDashoffset={0}
            transform="rotate(-90 70 70)"
          />
        )}
        {/* center text */}
        <text x="70" y="64" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
          {Math.round(successRate * 100)}%
        </text>
        <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
          succès
        </text>
      </svg>

      {/* legend */}
      <div className="donut-legend">
        <span className="legend-dot success" /> <span>{success} répondues</span>
        <span className="legend-dot failure" /> <span>{failure} non répondues</span>
      </div>
    </div>
  );
};

// ── Keyword Tag ───────────────────────────────────────────────────────────────

const KeywordTag: React.FC<{ word: string; count: number; max: number }> = ({ word, count, max }) => {
  const intensity = Math.round((count / max) * 5); // 1-5
  return (
    <span className={`kw-tag kw-tag--${intensity}`} title={`${count} occurrence${count > 1 ? "s" : ""}`}>
      {word}
      <span className="kw-tag__count">{count}</span>
    </span>
  );
};

// ── Stat Card ─────────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: string | number; sub?: string; accent?: string }> = ({
  label, value, sub, accent,
}) => (
  <div className="stat-card">
    <p className="stat-card__label">{label}</p>
    <p className="stat-card__value" style={accent ? { color: accent } : undefined}>{value}</p>
    {sub && <p className="stat-card__sub">{sub}</p>}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const ClientDashboard: React.FC<Props> = ({ bot }) => {
  const [data,    setData]    = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getAdvancedAnalytics(bot.id);
      setData(res);
    } catch {
      setError("Impossible de charger les statistiques.");
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="dash-loading">Chargement…</div>;
  if (error)   return <div className="dash-error">{error}</div>;
  if (!data)   return null;

  const maxKwCount = data.top_keywords[0]?.count ?? 1;

  return (
    <div className="client-dashboard">
      {/* ── Row 1: stat cards ── */}
      <div className="stat-grid">
        <StatCard label="Messages totaux"      value={data.total}                          sub={`${data.total_sessions} session${data.total_sessions !== 1 ? "s" : ""}`} />
        <StatCard label="Moy. messages/session" value={data.avg_messages_per_session}      sub="par conversation" />
        <StatCard label="Tickets en attente"   value={data.pending_tickets}               accent={data.pending_tickets > 0 ? "#f59e0b" : undefined} sub="interventions humaines" />
        <StatCard label="Taux de succès"       value={`${data.success_rate}%`}            accent="#22c55e" />
      </div>

      {/* ── Row 2: donut + unanswered ── */}
      <div className="analytics-row">
        {/* Donut */}
        <div className="card analytics-card donut-card">
          <h3 className="card-title">Taux de succès / échec</h3>
          <DonutChart
            success={data.success_count}
            failure={data.failure_count}
            total={data.total}
          />
          <p className="donut-total">{data.total} échange{data.total !== 1 ? "s" : ""} au total</p>
        </div>

        {/* Unanswered questions */}
        <div className="card analytics-card unanswered-card">
          <h3 className="card-title">
            Questions sans réponse
            <span className="badge badge--danger">{data.unanswered_questions.length}</span>
          </h3>
          {data.unanswered_questions.length === 0 ? (
            <p className="empty-state">Aucune question sans réponse 🎉</p>
          ) : (
            <ul className="unanswered-list">
              {data.unanswered_questions.slice().reverse().map((q, i) => (
                <li key={i} className="unanswered-item">
                  <span className="unanswered-icon">?</span>
                  <div>
                    <p className="unanswered-question">{q.question}</p>
                    <p className="unanswered-date">
                      {q.created_at
                        ? new Date(q.created_at).toLocaleDateString("fr-FR", {
                            day: "2-digit", month: "short", year: "numeric",
                          })
                        : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Row 3: top keywords ── */}
      <div className="card analytics-card keywords-card">
        <h3 className="card-title">Mots-clés fréquents</h3>
        {data.top_keywords.length === 0 ? (
          <p className="empty-state">Aucune donnée disponible.</p>
        ) : (
          <div className="kw-cloud">
            {data.top_keywords.map((kw) => (
              <KeywordTag key={kw.word} word={kw.word} count={kw.count} max={maxKwCount} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientDashboard;

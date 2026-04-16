import React, { useEffect, useState, useRef } from "react";
import { getTickets, respondToTicket, deleteTicket } from "./api";

interface Ticket {
  ticket_id:   string;
  question:    string;
  user_email:  string;
  status:      "pending_verification" | "pending_response" | "answered";
  created_at:  string;
  answered_at: string | null;
  answer:      string | null;
  bot_name:    string;
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const STATUS_META = {
  pending_verification: {
    label: "Pending verification",
    short: "Verifying",
    color: "var(--warn)",
    bg:    "rgba(186,117,23,0.12)",
    dot:   "#BA7517",
  },
  pending_response: {
    label: "Response required",
    short: "Needs reply",
    color: "var(--danger)",
    bg:    "rgba(216,90,48,0.12)",
    dot:   "#D85A30",
  },
  answered: {
    label: "Answered",
    short: "Answered",
    color: "var(--success)",
    bg:    "rgba(29,158,117,0.12)",
    dot:   "#1D9E75",
  },
} as const;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const initials = (email: string) =>
  email.slice(0, 2).toUpperCase();

/* ─── sub-components ──────────────────────────────────────────────────────── */

const StatusBadge: React.FC<{ status: Ticket["status"] }> = ({ status }) => {
  const m = STATUS_META[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      padding: "3px 9px", borderRadius: 20,
      background: m.bg, color: m.color,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: m.dot,
        boxShadow: `0 0 6px ${m.dot}`,
        animation: status === "pending_response" ? "pulse 1.8s infinite" : "none",
      }} />
      {m.short}
    </span>
  );
};

/* ─── main component ──────────────────────────────────────────────────────── */

const ClientTickets: React.FC = () => {
  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<Ticket | null>(null);
  const [answer,     setAnswer]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent,       setSent]       = useState(false);
  const [filter,     setFilter]     = useState<Ticket["status"] | "all">("all");
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  /* load */
  const load = async () => {
    setLoading(true);
    try {
      const { tickets } = await getTickets();
      setTickets(tickets);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  /* auto-focus textarea when ticket selected */
  useEffect(() => {
    if (selected?.status === "pending_response") {
      setTimeout(() => textareaRef.current?.focus(), 120);
    }
    setSent(false);
    setAnswer("");
  }, [selected?.ticket_id]);

  /* submit */
  const handleRespond = async () => {
    if (!selected || !answer.trim()) return;
    setSubmitting(true);
    try {
      await respondToTicket(selected.ticket_id, answer);
      setSent(true);
      setAnswer("");
      await load();
      // update selected ticket in-place
      setSelected(prev =>
        prev ? { ...prev, status: "answered", answer, answered_at: new Date().toISOString() } : null
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* delete */
  const handleDelete = async (ticket: Ticket) => {
    if (!confirm(`Delete ticket "${ticket.question.slice(0, 50)}..."? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteTicket(ticket.ticket_id);
      await load();
      if (selected?.ticket_id === ticket.ticket_id) {
        setSelected(null);
      }
    } catch (err: any) {
      alert(`Failed to delete ticket: ${err.message}`);
    }
  };

  /* filtered list */
  const visible = filter === "all"
    ? tickets
    : tickets.filter(t => t.status === filter);

  /* counts */
  const counts = {
    all:                  tickets.length,
    pending_verification: tickets.filter(t => t.status === "pending_verification").length,
    pending_response:     tickets.filter(t => t.status === "pending_response").length,
    answered:             tickets.filter(t => t.status === "answered").length,
  };

  /* ── render ── */
  return (
    <>
      {/* injected keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.4); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .tk-list-item { transition: background 0.15s, border-color 0.15s; }
        .tk-list-item:hover { background: rgba(127,119,221,0.07) !important; }
        .tk-filter-btn { transition: background 0.15s, color 0.15s; cursor: pointer; }
        .tk-filter-btn:hover { background: var(--bg3) !important; }
        .tk-send-btn { transition: opacity 0.15s, transform 0.1s; }
        .tk-send-btn:not(:disabled):hover { opacity: 0.88; transform: translateY(-1px); }
        .tk-send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .tk-textarea { transition: border-color 0.15s, box-shadow 0.15s; }
        .tk-textarea:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(127,119,221,0.18); }
      `}</style>

      <div style={{
        display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden",
        fontFamily: "'DM Sans', sans-serif",
      }}>

        {/* ── page header ── */}
        <div style={{
          padding: "28px 32px 20px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h1 style={{
                fontSize: 20, fontWeight: 600, color: "var(--text)",
                letterSpacing: "-0.02em", margin: 0,
              }}>
                Support Tickets
              </h1>
              <p style={{ fontSize: 13, color: "var(--text2)", margin: "4px 0 0" }}>
                {counts.pending_response > 0
                  ? `${counts.pending_response} ticket${counts.pending_response > 1 ? "s" : ""} awaiting your response`
                  : "All tickets up to date"}
              </p>
            </div>

            {/* refresh button */}
            <button
              onClick={load}
              style={{
                background: "var(--bg2)", border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text2)", fontSize: 12,
                padding: "6px 14px", cursor: "pointer", display: "flex",
                alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>↻</span> Refresh
            </button>
          </div>

          {/* filter tabs */}
          <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
            {([
              ["all",                  "All",         counts.all],
              ["pending_response",     "Needs reply", counts.pending_response],
              ["pending_verification", "Verifying",   counts.pending_verification],
              ["answered",             "Answered",    counts.answered],
            ] as [Ticket["status"] | "all", string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                className="tk-filter-btn"
                onClick={() => setFilter(key)}
                style={{
                  padding: "5px 13px", borderRadius: 20,
                  border: filter === key
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: filter === key
                    ? "rgba(127,119,221,0.15)"
                    : "var(--bg2)",
                  color: filter === key ? "var(--accent-light)" : "var(--text2)",
                  fontSize: 12, fontWeight: 500,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {label}
                <span style={{
                  background: filter === key ? "rgba(127,119,221,0.3)" : "var(--bg3)",
                  color: filter === key ? "var(--accent-light)" : "var(--text3)",
                  borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 700,
                }}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── split body ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

          {/* ── LEFT: ticket list ── */}
          <div style={{
            width: 320, flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            background: "var(--bg)",
          }}>
            {loading ? (
              <div style={{ padding: 32, color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
                Loading tickets…
              </div>
            ) : visible.length === 0 ? (
              <div style={{ padding: 32, color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✉</div>
                No tickets here.
              </div>
            ) : (
              visible.map((t, i) => {
                const isActive = selected?.ticket_id === t.ticket_id;
                const m = STATUS_META[t.status];
                return (
                  <div
                    key={t.ticket_id}
                    className="tk-list-item"
                    onClick={() => setSelected(t)}
                    style={{
                      padding: "14px 18px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      background: isActive ? "rgba(127,119,221,0.1)" : "transparent",
                      borderLeft: isActive
                        ? "3px solid var(--accent)"
                        : "3px solid transparent",
                      animation: `fadeUp 0.25s ease both`,
                      animationDelay: `${i * 0.04}s`,
                    }}
                  >
                    {/* row 1: email + date */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* avatar */}
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: isActive
                            ? "rgba(127,119,221,0.3)"
                            : "var(--bg3)",
                          color: isActive ? "var(--accent-light)" : "var(--text3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 700, flexShrink: 0,
                          fontFamily: "'DM Mono', monospace",
                        }}>
                          {initials(t.user_email)}
                        </div>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: isActive ? "var(--text)" : "var(--text2)",
                          maxWidth: 140, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {t.user_email}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0 }}>
                        {fmtDate(t.created_at)}
                      </span>
                    </div>

                    {/* row 2: question snippet */}
                    <p style={{
                      fontSize: 12, color: "var(--text2)",
                      margin: "0 0 8px 36px",
                      overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      lineHeight: 1.5,
                    }}>
                      {t.question}
                    </p>

                    {/* row 3: badge + bot */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginLeft: 36 }}>
                      <StatusBadge status={t.status} />
                      <span style={{ fontSize: 10, color: "var(--text3)" }}>
                        {t.bot_name}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── RIGHT: detail pane ── */}
          <div style={{
            flex: 1, overflowY: "auto",
            background: "var(--bg2)",
            display: "flex", flexDirection: "column",
          }}>
            {!selected ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                color: "var(--text3)", gap: 12,
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "var(--bg3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 24,
                }}>
                  ✉
                </div>
                <p style={{ fontSize: 13 }}>Select a ticket to view details</p>
              </div>
            ) : (
              <div style={{
                padding: "28px 32px",
                animation: "slideIn 0.2s ease both",
                display: "flex", flexDirection: "column", gap: 24,
              }}>

                {/* ticket header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <StatusBadge status={selected.status} />
                    <h2 style={{
                      fontSize: 15, fontWeight: 600, color: "var(--text)",
                      margin: "10px 0 4px", lineHeight: 1.4,
                    }}>
                      {selected.question}
                    </h2>
                    <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>
                      #{selected.ticket_id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleDelete(selected)}
                      style={{
                        background: "none",
                        color: "#dc2626", cursor: "pointer",
                        fontSize: 14, padding: "6px 10px",
                        borderRadius: 6, border: "1px solid #dc2626",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220, 38, 38, 0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    >
                      🗑 Delete
                    </button>
                    <button
                      onClick={() => setSelected(null)}
                      style={{
                        background: "none", border: "none",
                        color: "var(--text3)", cursor: "pointer",
                        fontSize: 18, padding: 4, lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* meta row */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                }}>
                  {[
                    { label: "From", value: selected.user_email, icon: "◈" },
                    { label: "Bot",  value: selected.bot_name,   icon: "◉" },
                    { label: "Submitted", value: `${fmtDate(selected.created_at)} · ${fmtTime(selected.created_at)}`, icon: "◎" },
                  ].map(({ label, value, icon }) => (
                    <div key={label} style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 10, padding: "12px 14px",
                    }}>
                      <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        <span style={{ color: "var(--accent)", marginRight: 4 }}>{icon}</span>{label}
                      </div>
                      <div style={{
                        fontSize: 12, color: "var(--text)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* divider */}
                <div style={{ borderTop: "1px solid var(--border)" }} />

                {/* answered: show reply */}
                {selected.status === "answered" && selected.answer && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                      Your response
                      {selected.answered_at && (
                        <span style={{ fontWeight: 400, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
                          · sent {fmtDate(selected.answered_at)} at {fmtTime(selected.answered_at)}
                        </span>
                      )}
                    </div>
                    <div style={{
                      background: "rgba(29,158,117,0.07)",
                      border: "1px solid rgba(29,158,117,0.2)",
                      borderRadius: 10, padding: "14px 16px",
                      fontSize: 13, color: "var(--text)", lineHeight: 1.65,
                    }}>
                      {selected.answer}
                    </div>
                  </div>
                )}

                {/* pending_verification: info box */}
                {selected.status === "pending_verification" && (
                  <div style={{
                    background: "rgba(186,117,23,0.08)",
                    border: "1px solid rgba(186,117,23,0.22)",
                    borderRadius: 10, padding: "14px 16px",
                    display: "flex", gap: 12, alignItems: "flex-start",
                    fontSize: 13, color: "var(--text2)",
                  }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>⏳</span>
                    <span>This ticket is being verified by the system. Once confirmed, it will require your response.</span>
                  </div>
                )}

                {/* pending_response: reply form */}
                {selected.status === "pending_response" && !sent && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Write a response
                    </div>
                    <textarea
                      ref={textareaRef}
                      className="tk-textarea"
                      rows={6}
                      placeholder="Type your answer here…"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRespond();
                      }}
                      style={{
                        width: "100%", resize: "vertical",
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 10, padding: "12px 14px",
                        color: "var(--text)", fontSize: 13,
                        fontFamily: "'DM Sans', sans-serif",
                        lineHeight: 1.6, outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>
                        ⌘↵ to send
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => { setAnswer(""); }}
                          style={{
                            background: "none",
                            border: "1px solid var(--border)",
                            borderRadius: 8, color: "var(--text2)",
                            fontSize: 12, padding: "7px 16px", cursor: "pointer",
                          }}
                        >
                          Clear
                        </button>
                        <button
                          className="tk-send-btn"
                          onClick={handleRespond}
                          disabled={submitting || !answer.trim()}
                          style={{
                            background: "var(--accent)",
                            border: "none", borderRadius: 8,
                            color: "#fff", fontSize: 13,
                            fontWeight: 600, padding: "7px 20px",
                            cursor: "pointer",
                            display: "flex", alignItems: "center", gap: 8,
                          }}
                        >
                          {submitting ? (
                            <>
                              <span style={{ animation: "pulse 1s infinite" }}>●</span>
                              Sending…
                            </>
                          ) : (
                            <>Send reply ↗</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* success state after sending */}
                {sent && (
                  <div style={{
                    background: "rgba(29,158,117,0.1)",
                    border: "1px solid rgba(29,158,117,0.25)",
                    borderRadius: 10, padding: "14px 18px",
                    display: "flex", alignItems: "center", gap: 12,
                    animation: "fadeUp 0.3s ease both",
                  }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "rgba(29,158,117,0.2)",
                      color: "var(--success)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, flexShrink: 0,
                    }}>
                      ✓
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        Reply sent successfully
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                        The user will be notified at {selected.user_email}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
};

export default ClientTickets;
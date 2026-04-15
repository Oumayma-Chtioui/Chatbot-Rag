import React, { useEffect, useState } from "react";
import { getTickets, respondToTicket } from "./api";

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

const statusLabel = (s: Ticket["status"]) => {
  if (s === "pending_verification") return { label: "En attente de vérification", cls: "badge--warning" };
  if (s === "pending_response")     return { label: "Réponse requise",            cls: "badge--danger"  };
  return                                    { label: "Répondu",                   cls: "badge--success" };
};

const ClientTickets: React.FC = () => {
  const [tickets,   setTickets]   = useState<Ticket[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [active,    setActive]    = useState<Ticket | null>(null);
  const [answer,    setAnswer]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success,   setSuccess]   = useState(false);

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

  const handleRespond = async () => {
    if (!active || !answer.trim()) return;
    setSubmitting(true);
    try {
      await respondToTicket(active.ticket_id, answer);
      setSuccess(true);
      setAnswer("");
      await load();
      setActive(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="client-dashboard">
      <h2 className="page-title">Tickets d'intervention</h2>

      {loading ? (
        <div className="dash-loading">Chargement…</div>
      ) : tickets.length === 0 ? (
        <div className="card">
          <p className="empty-state">Aucun ticket pour le moment.</p>
        </div>
      ) : (
        <div className="ticket-grid">
          {tickets.map((t) => {
            const { label, cls } = statusLabel(t.status);
            return (
              <div key={t.ticket_id} className="card ticket-card">
                <div className="ticket-header">
                  <span className={`badge ${cls}`}>{label}</span>
                  <span className="ticket-date">
                    {new Date(t.created_at).toLocaleDateString("fr-FR", {
                      day: "2-digit", month: "short", year: "numeric",
                    })}
                  </span>
                </div>
                <p className="ticket-question">"{t.question}"</p>
                <p className="ticket-meta">
                  De : <strong>{t.user_email}</strong> &bull; Bot : {t.bot_name}
                </p>

                {t.status === "pending_response" && (
                  <button
                    className="btn btn--primary"
                    onClick={() => { setActive(t); setSuccess(false); }}
                  >
                    Répondre
                  </button>
                )}
                {t.status === "answered" && t.answer && (
                  <details className="ticket-answer-preview">
                    <summary>Voir la réponse</summary>
                    <p>{t.answer}</p>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Answer modal ── */}
      {active && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Répondre à l'utilisateur</h3>
            <p className="modal-question">"{active.question}"</p>
            <p className="modal-meta">Envoi à : <strong>{active.user_email}</strong></p>

            <textarea
              className="modal-textarea"
              rows={6}
              placeholder="Rédigez votre réponse ici…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />

            {success && (
              <p className="modal-success">✓ Réponse envoyée avec succès.</p>
            )}

            <div className="modal-actions">
              <button className="btn btn--ghost" onClick={() => setActive(null)}>
                Annuler
              </button>
              <button
                className="btn btn--primary"
                onClick={handleRespond}
                disabled={submitting || !answer.trim()}
              >
                {submitting ? "Envoi…" : "Envoyer la réponse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientTickets;


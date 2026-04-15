interface Props {
  feedback: any[];
  loading: boolean;
}

export default function AdminFeedback({ feedback, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading feedback…</div>;

  return (
    <div className="cl-section">
      <h2 className="cl-section-title">Bot feedback</h2>
      {feedback.length === 0 ? (
        <div className="cl-empty">No aggregated feedback yet.</div>
      ) : (
        <div className="cl-doc-list">
          {feedback.map((row) => (
            <div key={row.bot_id} className="cl-doc-row">
              <div>
                <div className="cl-doc-name">{row.bot_name}</div>
                <div className="cl-doc-meta">Avg score: {row.avg_score.toFixed(1)} ⭐ · {row.total_feedback} reviews</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

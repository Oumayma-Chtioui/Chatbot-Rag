import { useState } from "react";
import { Bot } from "./ClientApp";

const API_BASE = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

const categories = ["Accuracy", "Speed", "Relevance", "Missing Info"];

interface Props {
  bot: Bot;
  onSuccess: () => void;
}

export default function FeedbackWidget({ bot, onSuccess }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitFeedback = async () => {
    if (rating < 1 || rating > 5) {
      setError("Please select a star rating.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/widgets/bots/${bot.id}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ rating, comment, category }),
      });

      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        // If we can't parse JSON, check if the request was actually successful
        if (res.ok) {
          data = { ok: true };
        } else {
          throw new Error(`Server error: ${res.status}`);
        }
      }

      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to send feedback");
      }

      setMessage("Thanks! Your feedback was submitted.");
      setComment("");
      setRating(0);
      setHoverRating(0);
      setCategory(categories[0]);
      onSuccess();
    } catch (err: any) {
      console.error("Feedback submission error:", err);
      setError(err.message || "Could not submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cl-feedback-card">
      <div className="cl-section-title">Share feedback</div>
      <p className="cl-hint">Rate the bot so we can improve accuracy, speed, and relevance.</p>

      <div className="feedback-stars" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((value) => {
          const isActive = value <= (hoverRating || rating);
          return (
            <button
              key={value}
              type="button"
              className={`feedback-star ${isActive ? "filled" : ""}`}
              onClick={() => setRating(value)}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${value} star${value > 1 ? "s" : ""}`}
            >
              ★
            </button>
          );
        })}
      </div>

      <div className="feedback-categories">
        {categories.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`feedback-chip ${category === tag ? "selected" : ""}`}
            onClick={() => setCategory(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <textarea
        className="cl-input"
        rows={4}
        value={comment}
        placeholder="What could be better?"
        onChange={(e) => setComment(e.target.value)}
        disabled={submitting}
      />

      {error && <div className="cl-error">{error}</div>}
      {message && <div className="cl-hint" style={{ color: "var(--accent)" }}>{message}</div>}

      <button
        className="cl-btn-primary"
        onClick={submitFeedback}
        disabled={submitting}
      >
        {submitting ? "Submitting..." : "Submit feedback"}
      </button>
    </div>
  );
}

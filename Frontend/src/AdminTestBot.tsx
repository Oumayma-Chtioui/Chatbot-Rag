import { useState, useMemo } from "react";
import { getAdminPreviewKey } from "./api";

interface Props {
  bots: any[];
  selectedBot: string;
  onBotSelect: (botId: string) => void;
  loading: boolean;
}

export default function AdminTestBot({ bots, selectedBot, onBotSelect, loading }: Props) {
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState("http://localhost:8000");

  const selectedBotDetails = useMemo(
    () => bots.find((bot) => bot.id === selectedBot),
    [bots, selectedBot]
  );

  // Reset preview when bot selection changes — but do NOT auto-fetch a new key
  const handleBotSelect = (botId: string) => {
    setPreviewKey(null);
    setPreviewError(null);
    onBotSelect(botId);
  };

  // Only generate a preview key when the user explicitly clicks the button
  // AdminTestBot.tsx
  const handleLoadPreview = async () => {
      if (!selectedBot) return;
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewKey(null);
      try {
        const data = await getAdminPreviewKey(selectedBot);
        setPreviewKey(data.key);
      } catch (err: any) {
        // Parse the detail message from FastAPI's HTTPException
        const message = err?.detail || err?.message || "Unable to create preview key.";
        setPreviewError(message);
      } finally {
        setPreviewLoading(false);
      }
    };

  if (loading) return <div className="cl-loading">Loading bots…</div>;

  return (
    <div className="cl-section">
      <h2 className="cl-section-title">Test bot preview</h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
          Select a bot
        </label>
        <select
          className="cl-select"
          value={selectedBot}
          onChange={(e) => handleBotSelect(e.target.value)}
          style={{ width: "100%", maxWidth: 300 }}
        >
          <option value="">Choose a bot…</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>{bot.name}</option>
          ))}
        </select>
      </div>

      {!selectedBot && <div className="cl-empty">Select a bot to preview it above.</div>}

      {selectedBot && !previewKey && (
        <>
          <div className="cl-section" style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
              API base URL
            </label>
            <input
              className="cl-input"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:8000"
              style={{ width: "100%", maxWidth: 420 }}
            />
          </div>

          {previewError && <div className="cl-error" style={{ marginBottom: 12 }}>{previewError}</div>}

          <button
            className="cl-btn-primary"
            onClick={handleLoadPreview}
            disabled={previewLoading}
          >
            {previewLoading ? "Generating preview…" : "▷ Load preview"}
          </button>

          <p className="cl-hint" style={{ marginTop: 8 }}>
            Clicking this generates a temporary API key for testing. It is stored in the database — use sparingly.
          </p>
        </>
      )}

      {selectedBot && previewKey && (
        <>
          <div className="cl-section" style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase" }}>
              API base URL
            </label>
            <input
              className="cl-input"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:8000"
              style={{ width: "100%", maxWidth: 420 }}
            />
          </div>

          <div style={{ marginTop: 20 }}>
            <iframe style={{
                width: "100%",        // full width of container
                height: "700px",      // 🔥 increase this (try 500–700px)
                border: "none",
                borderRadius: "12px"
              }}
              src={`/widget-preview?botId=${encodeURIComponent(selectedBot)}&apiKey=${encodeURIComponent(previewKey)}&apiBase=${encodeURIComponent(apiBase)}&botName=${encodeURIComponent(selectedBotDetails?.name || "Assistant")}&accent=${encodeURIComponent(selectedBotDetails?.accent_color || "#7F77DD")}&welcomeMessage=${encodeURIComponent(selectedBotDetails?.welcome_message || "Hi! How can I help you today?")}`}              title="Test bot preview"
            />
          </div>

          <button
            className="cl-btn-outline"
            onClick={() => { setPreviewKey(null); setPreviewError(null); }}
            style={{ marginTop: 12 }}
          >
            ← Change bot / regenerate
          </button>
        </>
      )}
    </div>
  );
}
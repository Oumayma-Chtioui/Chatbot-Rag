import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    if (!selectedBot) {
      setPreviewKey(null);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewKey(null);

    getAdminPreviewKey(selectedBot)
      .then((data) => setPreviewKey(data.key))
      .catch((err) => setPreviewError(err.message || "Unable to create preview key."))
      .finally(() => setPreviewLoading(false));
  }, [selectedBot]);

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
          onChange={(e) => onBotSelect(e.target.value)}
          style={{ width: "100%", maxWidth: 300 }}
        >
          <option value="">Choose a bot…</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>{bot.name}</option>
          ))}
        </select>
      </div>

      {!selectedBot && <div className="cl-empty">Select a bot to preview it above.</div>}

      {selectedBot && previewLoading && <div className="cl-loading">Generating preview key…</div>}
      {selectedBot && previewError && <div className="cl-error">{previewError}</div>}

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
            <iframe
              src={`/widget-preview?botId=${encodeURIComponent(selectedBot)}&apiKey=${encodeURIComponent(previewKey)}&apiBase=${encodeURIComponent(apiBase)}&botName=${encodeURIComponent(selectedBotDetails?.name || "Assistant")}`}
              style={{ width: "100%", height: 700, border: "1px solid var(--border)", borderRadius: 12 }}
              title="Test bot preview"
            />
          </div>
        </>
      )}
    </div>
  );
}

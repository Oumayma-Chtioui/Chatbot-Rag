// Frontend/src/ClientWidget.tsx
// Updated: shows accent color in embed snippet, bot accent reflected in UI hints

import { useState, useEffect } from "react";
import { Bot } from "./ClientApp";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface ApiKey {
  id: string;
  prefix: string;
  is_active: boolean;
  last_used: string | null;
  created_at: string;
}

interface Props {
  bot: Bot | null;
  setBot: (bot: Bot) => void;
  user: any;
}

export default function ClientWidget({ bot, setBot, user }: Props) {
  const [keys, setKeys]         = useState<ApiKey[]>([]);
  const [newKey, setNewKey]     = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [origin, setOrigin]     = useState(bot?.allowed_origin || "");
  const [apiBase, setApiBase]   = useState("http://localhost:8000");
  const [generating, setGenerating] = useState(false);

  useEffect(() => { setOrigin(bot?.allowed_origin || ""); }, [bot?.allowed_origin]);

  const loadKeys = async () => {
    if (!bot) return;
    const res = await fetch(`${API}/widgets/bots/${bot.id}/keys`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    setKeys(data);
  };

  useEffect(() => { loadKeys(); }, [bot]);

  const handleGenerate = async () => {
    if (!bot) return;
    setGenerating(true);
    const res = await fetch(`${API}/widgets/bots/${bot.id}/keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    setNewKey(data.key);
    setGenerating(false);
    await loadKeys();
  };

  const handleRevoke = async (keyId: string) => {
    if (!bot) return;
    await fetch(`${API}/widgets/bots/${bot.id}/keys/${keyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    await loadKeys();
  };

  const handleSaveOrigin = async () => {
    if (!bot) return;
    const res = await fetch(`${API}/widgets/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ allowed_origin: origin || null }),
    });
    const updated = await res.json();
    const updatedBot = { ...bot, allowed_origin: updated.allowed_origin };
    setBot(updatedBot);
    localStorage.setItem("client_bot", JSON.stringify(updatedBot));
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const accent = bot?.accent_color || "#7F77DD";

  // Build embed snippet including accent color and welcome message
  const displayKey = newKey ?? (keys.find(k => k.is_active)?.prefix
    ? keys.find(k => k.is_active)!.prefix + "••••••••"
    : null);

  const widgetVersion = Date.now();
  const embedCode = displayKey
    ? `<script>
      window.NovaMindConfig = {
        apiKey:         "${newKey ?? "<your-api-key>"}",
        apiBase:        "${apiBase}",
        botName:        "${bot?.name || "Assistant"}",
        accent:         "${accent}",
        welcomeMessage: "${bot?.welcome_message || "Hi! How can I help you today?"}",
      };
    </script>
    <script src="${apiBase}/static/widget.js?v=${widgetVersion}"></script>`
    : null;

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Widget setup</h1>
        <p className="cl-page-sub">Generate an API key and embed your chatbot on any website.</p>
      </div>

      {/* Accent color preview strip */}
      <div style={{
        height: 4, borderRadius: 4,
        background: accent,
        marginBottom: 24,
        opacity: 0.7,
      }} />

      <div className="cl-section">
        <h2 className="cl-section-title">Allowed origin</h2>
        <p className="cl-hint">Only requests from this domain will be accepted. Leave empty to allow any origin.</p>
        <div className="cl-url-row">
          <input
            className="cl-input"
            placeholder="https://mywebsite.com"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
          <button className="cl-btn-primary" onClick={handleSaveOrigin}>Save</button>
        </div>
      </div>

      <div className="cl-section">
        <h2 className="cl-section-title">API keys</h2>
        <button className="cl-btn-primary" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating…" : "Generate new key"}
        </button>

        {newKey && (
          <div className="cl-key-reveal">
            <p className="cl-hint cl-warn-text">⚠ Copy this key now — it will not be shown again.</p>
            <div className="cl-key-row">
              <code className="cl-key-code">{newKey}</code>
              <button className="cl-btn-outline" onClick={() => copy(newKey)}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="cl-doc-list" style={{ marginTop: 16 }}>
          {keys.length === 0 && (
            <div className="cl-empty">No keys yet. Generate one above.</div>
          )}
          {keys.map((k) => (
            <div className="cl-doc-row" key={k.id}>
              <code className="cl-mono">{k.prefix}••••••••</code>
              <div className="cl-doc-info">
                <div className="cl-doc-meta">
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used && ` · Last used ${new Date(k.last_used).toLocaleDateString()}`}
                </div>
              </div>
              <div className={`cl-badge ${k.is_active ? "success" : "warn"}`}>
                {k.is_active ? "Active" : "Revoked"}
              </div>
              {k.is_active && (
                <button className="cl-btn-danger" onClick={() => handleRevoke(k.id)}>Revoke</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {embedCode && (
        <div className="cl-section">
          <h2 className="cl-section-title">Embed code</h2>
          <p className="cl-hint">Paste this before &lt;/body&gt; on your website. Your accent color and welcome message are pre-configured.</p>
          <div className="cl-url-row" style={{ marginBottom: 8 }}>
            <input
              className="cl-input"
              placeholder="API base URL (your backend)"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
            />
          </div>
          <div className="cl-code-block">
            <pre>{embedCode}</pre>
            <button className="cl-btn-outline cl-copy-btn" onClick={() => copy(embedCode)}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";

export default function WidgetPreview() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const botId = query.get("botId") || "unknown";
  const apiKey = query.get("apiKey") || "";
  const apiBase = query.get("apiBase") || "http://localhost:8000";
  const botName = query.get("botName") || "Assistant";
  const welcomeMessage = query.get("welcomeMessage") || "Hi! How can I help you today?";
  const accent = query.get("accent") || "#7F77DD";

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setError("No preview API key provided.");
      return;
    }

    (window as any).NovaMindConfig = {
      apiKey,
      apiBase,
      botName,
      welcomeMessage,
      accent,
    };

    const script = document.createElement("script");
    script.src = `${apiBase}/static/widget.js?v=` + Date.now();
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => setError("Unable to load widget script.");
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      const host = document.getElementById("novamind-widget-host");
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      delete (window as any).NovaMindConfig;
    };
  }, [apiKey, apiBase, botName]);

  return (
    <div style={{ minHeight: "100vh", background: "#0b0b0b", color: "#f5f5f5", padding: 32, fontFamily: "Inter, sans-serif" }}>
      <div >
        <h1 style={{ marginBottom: 12 }}>Widget preview</h1>
        <p style={{ color: "#9ca3af", marginBottom: 24 }}>
          Previewing <strong>{botName}</strong> ({botId}) with a real widget embed.
        </p>
        {error ? (
          <div style={{ padding: 18, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,0,0,0.15)", color: "#ffb3b3" }}>
            {error}
          </div>
        ) : (
          <div >
            {!ready && <div style={{ color: "#94a3b8" }}>Loading widget…</div>}
            {ready && <div style={{ color: "#d1d5db" }}>Widget loaded — open the bubble in the bottom corner to chat.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

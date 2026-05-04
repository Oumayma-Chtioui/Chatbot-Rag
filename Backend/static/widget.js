(function () {
  const CONFIG   = window.NovaMindConfig || {};
  const API_KEY  = CONFIG.apiKey          || "";
  const API_BASE = CONFIG.apiBase         || "http://localhost:8000";
  const BOT_NAME = CONFIG.botName         || "NovaMind";
  const POSITION = CONFIG.position        || "bottom-right";
  const ACCENT   = CONFIG.accent          || "#7F77DD";
  const WELCOME  = CONFIG.welcomeMessage  || "Hi! How can I help you today?";

  if (!API_KEY) {
    console.warn("[NovaMind] No apiKey provided — widget disabled.");
    return;
  }

  // ── Stable storage key scoped to this API key ──────────────────────────────
  // Using first 12 chars of the key so multiple widgets on the same page
  // each get their own sessionStorage namespace.
  const SK = `nm_${API_KEY.slice(0, 12)}`;

  // ── Restore state from sessionStorage ─────────────────────────────────────
  // sessionStorage survives script re-evaluation (Vite HMR, soft reload)
  // within the same browser tab, but resets on a new tab — which is exactly
  // the right behaviour: new tab = fresh greeting, same tab = no duplicate.
  let sessionId = sessionStorage.getItem(`${SK}_sid`) || null;
  let isOpen    = false;

  // welcomeShown is stored in sessionStorage, NOT in a JS variable.
  // A JS variable resets every time the IIFE re-runs (page refresh / HMR),
  // causing the welcome bubble to appear again. sessionStorage persists.
  

  /* ── Shadow DOM host ── */
  const shadow = (() => {
    const host = document.createElement("div");
    host.id = "novamind-widget-host";
    document.body.appendChild(host);
    return host.attachShadow({ mode: "open" });
  })();

  /* ── Load marked.js ── */
  let markedReady = false;
  const markedScript = document.createElement("script");
  markedScript.src = "https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js";
  markedScript.onload = () => { markedReady = true; };
  document.head.appendChild(markedScript);

  /* ── Inject CSS into shadow DOM ── */
  fetch(`${API_BASE}/static/widget.css`)
    .then(r => r.text())
    .then(cssText => {
      const style = document.createElement("style");
      style.textContent = `:host { --accent: ${ACCENT}; }` + cssText;
      shadow.appendChild(style);
    });

  /* ── HTML template ── */
  const side  = POSITION.includes("right") ? "right: 24px;" : "left: 24px;";
  const vside = POSITION.includes("bottom") ? "bottom:" : "top:";

  const template = document.createElement("div");
  template.innerHTML = `
    <button id="nm-bubble" style="${side} ${vside} 24px;">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
      </svg>
    </button>
    <div id="nm-panel" style="${side} ${vside} 88px;">
      <div id="nm-header">
        <span>${BOT_NAME}</span>
        <button id="nm-close">✕</button>
      </div>
      <div id="nm-messages"></div>
      <div id="nm-footer">
        <textarea id="nm-input" rows="1" placeholder="Type a message…"></textarea>
        <button id="nm-send">Send</button>
      </div>
    </div>
  `;
  while (template.firstChild) shadow.appendChild(template.firstChild);

  /* ── Element refs ── */
  const panel    = shadow.getElementById("nm-panel");
  const bubble   = shadow.getElementById("nm-bubble");
  const closeBtn = shadow.getElementById("nm-close");
  const messages = shadow.getElementById("nm-messages");
  const input    = shadow.getElementById("nm-input");
  const sendBtn  = shadow.getElementById("nm-send");

  /* ── Markdown renderer ── */
  function renderMarkdown(text) {
    let html = markedReady
      ? marked.parse(text)
      : text
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>")
          .replace(/\n/g, "<br>");
    return html
      .replace(/<table>/g,   '<div class="nm-table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
  }

  /* ── Append a message bubble ── */
  function appendMsg(text, role) {
    const el = document.createElement("div");
    el.className = `nm-msg nm-${role}`;
    if (role === "bot") el.innerHTML = renderMarkdown(text);
    else                el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  /* ── Empty streaming bubble ── */
  function createStreamingBubble() {
    const el = document.createElement("div");
    el.className = "nm-msg nm-bot";
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  /* ── Welcome message — shown exactly once per browser session ── */
  function showWelcome() {
    if (messages.children.length > 0) return; // already has content
    appendMsg(WELCOME, "bot");
    sessionStorage.setItem(`${SK}_ws`, "1");
  }

  /* ── Open / close ── */
  function openPanel() {
    isOpen = true;
    panel.classList.add("nm-open");
    console.log("[NovaMind] openPanel called, WELCOME =", WELCOME);
    showWelcome();
    input.focus();
  }
  function closePanel() {
    isOpen = false;
    panel.classList.remove("nm-open");
  }

  bubble.addEventListener("click", () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener("click", closePanel);

  /* ── Textarea auto-resize ── */
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  /* ── Intervention flow ── */
  let nmIntervention = { active: false, step: "offer", ticketId: null, question: null };

  function showInterventionOffer(question) {
    nmIntervention = { active: true, step: "offer", question, ticketId: null };
    renderInterventionPanel();
  }

  function renderInterventionPanel() {
    const existing = shadow.getElementById("nm-int-panel");
    if (existing) existing.remove();

    const ip = document.createElement("div");
    ip.id = "nm-int-panel";
    ip.className = "nm-intervention";

    if (nmIntervention.step === "offer") {
      ip.innerHTML = `
        <p>Je n'ai pas trouvé de réponse. Souhaitez-vous contacter le support ?</p>
        <button class="nm-int-btn" id="nm-yes">Oui, contacter le support</button>
        <span class="nm-cancel" id="nm-no">Non merci</span>
      `;
      ip.querySelector("#nm-yes").onclick = () => { nmIntervention.step = "email"; renderInterventionPanel(); };
      ip.querySelector("#nm-no").onclick  = () => { nmIntervention.active = false; ip.remove(); };
    }
    else if (nmIntervention.step === "email") {
      ip.innerHTML = `
        <p>Entrez votre email pour recevoir la réponse :</p>
        <input id="nm-email" type="email" placeholder="vous@exemple.com" />
        <button class="nm-int-btn" id="nm-email-btn">Envoyer le code</button>
        <span class="nm-cancel" id="nm-back">Annuler</span>
      `;
      ip.querySelector("#nm-email-btn").onclick = async () => {
        const email = ip.querySelector("#nm-email").value.trim();
        if (!email || !email.includes("@")) { ip.querySelector("#nm-email").style.borderColor = "#dc2626"; return; }
        const btn = ip.querySelector("#nm-email-btn");
        btn.disabled = true; btn.textContent = "Envoi…";
        try {
          const res  = await fetch(`${API_BASE}/widget/intervention/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
            body: JSON.stringify({ question: nmIntervention.question, session_id: sessionId, user_email: email }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Erreur");
          nmIntervention.ticketId = data.ticket_id;
          nmIntervention.step = "verify";
          renderInterventionPanel();
        } catch (err) {
          btn.disabled = false; btn.textContent = "Réessayer";
          const e = document.createElement("p");
          e.className = "nm-err"; e.textContent = err.message;
          ip.appendChild(e);
        }
      };
      ip.querySelector("#nm-back").onclick = () => { nmIntervention.step = "offer"; renderInterventionPanel(); };
    }
    else if (nmIntervention.step === "verify") {
      ip.innerHTML = `
        <p>Code envoyé à votre email. Entrez-le ci-dessous :</p>
        <input id="nm-code" type="text" placeholder="000000" maxlength="6"
               style="text-align:center;font-size:18px;letter-spacing:6px;" />
        <button class="nm-int-btn" id="nm-verify-btn">Confirmer</button>
        <span class="nm-cancel" id="nm-back2">Annuler</span>
      `;
      ip.querySelector("#nm-verify-btn").onclick = async () => {
        const code = ip.querySelector("#nm-code").value.trim();
        if (code.length !== 6) return;
        const btn = ip.querySelector("#nm-verify-btn");
        btn.disabled = true; btn.textContent = "Vérification…";
        try {
          const res  = await fetch(`${API_BASE}/widget/intervention/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
            body: JSON.stringify({ ticket_id: nmIntervention.ticketId, code }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Code invalide");
          nmIntervention.step = "done";
          renderInterventionPanel();
        } catch (err) {
          btn.disabled = false; btn.textContent = "Réessayer";
          ip.querySelector("#nm-code").style.borderColor = "#dc2626";
        }
      };
      ip.querySelector("#nm-back2").onclick = () => { nmIntervention.active = false; ip.remove(); };
    }
    else if (nmIntervention.step === "done") {
      ip.innerHTML = `<div class="nm-success">✓ Demande transmise au support. Vous recevrez la réponse par email.</div>`;
      setTimeout(() => { ip.remove(); nmIntervention.active = false; }, 6000);
    }

    messages.appendChild(ip);
    messages.scrollTop = messages.scrollHeight;
  }

  /* ── Send message (streaming) ── */
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    appendMsg(text, "user");

    const typing = appendMsg("…", "typing");

    try {
      const res = await fetch(`${API_BASE}/widget/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      typing.remove();

      const botBubble = createStreamingBubble();
      const reader    = res.body.getReader();
      const decoder   = new TextDecoder();
      let   rawText   = "";
      let   answered  = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (chunk.includes("__SOURCES__:")) {
          const [textPart, sourcePart] = chunk.split("__SOURCES__:");
          if (textPart) {
            rawText += textPart;
            botBubble.innerHTML = renderMarkdown(rawText);
            messages.scrollTop  = messages.scrollHeight;
          }
          try { botBubble.dataset.sources = JSON.stringify(JSON.parse(sourcePart.trim())); } catch (_) {}
          answered = rawText.trim().length > 0;
        } else {
          rawText += chunk;
          botBubble.innerHTML = renderMarkdown(rawText);
          messages.scrollTop  = messages.scrollHeight;
        }
      }

      // Persist session id so conversation continues after script re-evaluation
      const newSession = res.headers.get("X-Session-Id");
      if (newSession) {
        sessionId = newSession;
        sessionStorage.setItem(`${SK}_sid`, sessionId);
      }

      const cantAnswer = rawText.trim().toLowerCase().includes("i don't have enough information");
      if ((!answered || cantAnswer) && !nmIntervention.active) showInterventionOffer(text);

    } catch (err) {
      typing.remove();
      appendMsg("Erreur de connexion. Réessayez.", "bot");
      console.error("[NovaMind stream error]", err);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);

})();
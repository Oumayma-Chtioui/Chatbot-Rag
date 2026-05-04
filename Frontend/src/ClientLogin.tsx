// Frontend/src/ClientLogin.tsx
import { useState, ChangeEvent, FormEvent } from "react";
import { ClientUser } from "./ClientApp";

const API = "http://localhost:8000";

interface Props {
  onLogin: (user: ClientUser, token: string) => void;
}

const FEATURES = [
  { icon: "◈", title: "Document indexing",   desc: "Upload your docs once. Your bot answers from them instantly." },
  { icon: "◎", title: "Embed anywhere",       desc: "One code snippet. Works on any website in minutes." },
  { icon: "✦", title: "Real-time analytics",  desc: "Track every conversation, rating, and unanswered question." },
  { icon: "✉", title: "Support tickets",      desc: "When the bot can't help, your team steps in — seamlessly." },
];

const FAQ = [
  { q: "Do I need a credit card to sign up?",      a: "No. You can create an account and explore the dashboard completely free." },
  { q: "Can I embed the bot on any website?",       a: "Yes — copy the snippet from your Widget tab and paste it into any HTML page." },
  { q: "What file types can I upload?",             a: "PDF, DOCX, and plain text files are supported for document indexing." },
  { q: "Can I have multiple bots?",                 a: "Yes. Each bot has its own documents, settings, analytics, and embed code." },
];

export default function ClientLogin({ onLogin }: Props) {
  const [mode, setMode]             = useState<"login" | "register">("login");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [name, setName]             = useState("");
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [openFaq, setOpenFaq]       = useState<number | null>(null);
  const [section, setSection]       = useState<"home" | "faq" | "contact">("home");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        const regRes = await fetch(`${API}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role: "client" }),
        });
        if (!regRes.ok) {
          const err = await regRes.json();
          throw new Error(err.detail || "Registration failed");
        }
        setMode("login");
        setSuccessMsg("Check your email to verify your account before signing in.");
        return;
      }
      const loginRes = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const err = await loginRes.json();
        throw new Error(err.detail || "Login failed");
      }
      const { access_token, user } = await loginRes.json();
      onLogin(user, access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap');

        * { box-sizing: border-box; }

        .lp-root {
          min-height: 100vh;
          background: var(--bg);
          font-family: 'DM Sans', sans-serif;
          color: var(--text);
        }

        /* ── Navbar ── */
        .lp-nav {
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 40px;
          height: 56px;
          background: var(--bg2);
          border-bottom: 1px solid var(--border);
          backdrop-filter: blur(8px);
        }
        .lp-nav-brand {
          display: flex; align-items: center; gap: 9px;
          cursor: pointer;
        }
        .lp-nav-brand-icon {
          width: 30px; height: 30px;
          background: linear-gradient(135deg, var(--accent), var(--success));
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; color: #fff;
        }
        .lp-nav-brand-name {
          font-family: 'Instrument Serif', serif;
          font-size: 17px; color: var(--text); letter-spacing: -0.01em;
        }
        .lp-nav-links {
          display: flex; align-items: center; gap: 4px;
        }
        .lp-nav-link {
          background: none; border: none;
          padding: 6px 13px; border-radius: 6px;
          font-size: 13.5px; font-weight: 500;
          color: var(--text2); cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: background 0.15s, color 0.15s;
        }
        .lp-nav-link:hover  { background: var(--bg3); color: var(--text); }
        .lp-nav-link.active { color: var(--text); background: var(--bg3); }
        .lp-nav-cta {
          background: var(--accent); border: none;
          padding: 7px 16px; border-radius: 7px;
          font-size: 13px; font-weight: 600; color: #fff;
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          transition: opacity 0.15s;
          margin-left: 8px;
        }
        .lp-nav-cta:hover { opacity: 0.88; }

        /* ── Body Layout ── */
        .lp-body { max-width: 1100px; margin: 0 auto; padding: 0 24px 80px; }

        /* ── Home Container (Split View) ── */
        .lp-home-container {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 64px;
          padding-top: 72px;
        }

        .lp-home-left { flex: 1; }

        .lp-home-right {
          flex: 0 0 400px;
          position: sticky;
          top: 100px;
        }

        /* ── Hero ── */
        .lp-hero { text-align: left; margin-bottom: 56px; }
        .lp-hero-eyebrow {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--success);
          background: rgba(29,158,117,0.08);
          border: 1px solid rgba(29,158,117,0.18);
          border-radius: 20px; padding: 4px 12px;
          margin-bottom: 22px;
        }
        .lp-hero h1 {
          font-family: 'Instrument Serif', serif;
          font-size: clamp(36px, 5vw, 54px);
          line-height: 1.1; letter-spacing: -0.025em;
          color: var(--text); margin: 0 0 18px;
        }
        .lp-hero h1 em {
          font-style: italic;
          background: linear-gradient(90deg, var(--accent), var(--success));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lp-hero p {
          font-size: 17px; color: var(--text2);
          line-height: 1.65; max-width: 480px;
          margin: 0 0 36px;
        }
        .lp-hero-btns { display: flex; align-items: center; gap: 12px; }
        .lp-btn-primary {
          background: var(--accent); border: none;
          padding: 12px 28px; border-radius: 9px;
          font-size: 15px; font-weight: 600; color: #fff;
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 3px 16px rgba(127,119,221,0.3);
        }
        .lp-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .lp-btn-ghost {
          background: none; border: 1px solid var(--border2);
          padding: 12px 24px; border-radius: 9px;
          font-size: 15px; font-weight: 500; color: var(--text2);
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          transition: border-color 0.15s, color 0.15s;
        }
        .lp-btn-ghost:hover { border-color: var(--accent); color: var(--accent-light); }

        /* ── Features ── */
        .lp-features {
          display: grid; grid-template-columns: 1fr;
          gap: 14px;
        }
        .lp-feature {
          background: var(--bg2); border: 1px solid var(--border);
          border-radius: 12px; padding: 20px 22px;
          transition: border-color 0.15s;
        }
        .lp-feature:hover { border-color: var(--border2); }
        .lp-feature-icon { font-size: 20px; color: var(--accent); margin-bottom: 10px; display: block; }
        .lp-feature-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
        .lp-feature-desc  { font-size: 13.5px; color: var(--text2); line-height: 1.55; }

        /* ── Auth card ── */
        .lp-auth-card {
          width: 100%;
          background: var(--bg2); border: 1px solid var(--border);
          border-radius: 16px; padding: 32px;
          box-shadow: 0 4px 32px rgba(0,0,0,0.1);
        }
        .lp-auth-title {
          font-family: 'Instrument Serif', serif;
          font-size: 22px; color: var(--text); margin: 0 0 4px; letter-spacing: -0.02em;
        }
        .lp-auth-sub { font-size: 13px; color: var(--text3); margin-bottom: 20px; }

        .lp-tabs {
          display: flex; background: var(--bg3);
          border: 1px solid var(--border); border-radius: 9px;
          padding: 3px; margin-bottom: 16px; gap: 3px;
        }
        .lp-tab {
          flex: 1; padding: 9px; border: none;
          background: transparent; border-radius: 7px;
          font-size: 13.5px; font-weight: 500; color: var(--text3);
          cursor: pointer; transition: background 0.18s, color 0.18s;
          font-family: 'DM Sans', sans-serif;
        }
        .lp-tab.active { background: var(--bg2); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.1); }

        .lp-field { margin-bottom: 10px; }
        .lp-input {
          width: 100%; padding: 11px 14px;
          background: var(--bg); border: 1px solid var(--border);
          border-radius: 9px; font-size: 14px; color: var(--text);
          font-family: 'DM Sans', sans-serif; outline: none;
          transition: border-color 0.18s;
        }
        .lp-input:focus { border-color: var(--accent); }

        .lp-submit {
          width: 100%; padding: 12px; margin-top: 4px;
          background: var(--accent); border: none; border-radius: 9px;
          color: #fff; font-size: 14.5px; font-weight: 600;
          font-family: 'DM Sans', sans-serif; cursor: pointer;
          transition: opacity 0.18s;
        }
        .lp-submit:hover:not(:disabled) { opacity: 0.87; }
        .lp-submit:disabled { opacity: 0.4; cursor: not-allowed; }

        .lp-success { font-size: 13px; padding: 10px; border-radius: 8px; background: rgba(29,158,117,0.08); color: var(--success); margin-bottom: 10px; }
        .lp-error { font-size: 13px; padding: 10px; border-radius: 8px; background: rgba(216,90,48,0.08); color: var(--danger); margin-bottom: 10px; }
        
        .lp-privacy {
          display: flex; align-items: center; justify-content: center;
          gap: 5px; margin-top: 18px; font-size: 12px; color: var(--text3);
        }
        .lp-privacy-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text3); opacity: 0.35; }

        /* ── FAQ / Contact Section Defaults ── */
        .lp-section-heading { text-align: center; margin-bottom: 36px; padding-top: 64px; }
        .lp-section-heading h2 { font-family: 'Instrument Serif', serif; font-size: 34px; color: var(--text); margin-bottom: 10px; }
        .lp-faq { max-width: 620px; margin: 0 auto 64px; }
        .lp-faq-item { border-bottom: 1px solid var(--border); }
        .lp-faq-q {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          padding: 18px 0; background: none; border: none; cursor: pointer;
          font-size: 15px; font-weight: 500; color: var(--text); text-align: left;
        }
        .lp-faq-chevron.open { transform: rotate(180deg); }
        .lp-faq-a { font-size: 14px; color: var(--text2); line-height: 1.65; padding-bottom: 18px; }

        .lp-contact-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; max-width: 600px; margin: 0 auto 32px; }
        .lp-contact-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 24px; text-align: center; }

        /* ── Footer ── */
        .lp-footer {
          border-top: 1px solid var(--border); padding: 28px 40px;
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12.5px; color: var(--text3);
        }
        .lp-footer-links { display: flex; gap: 20px; }
        .lp-footer-link { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 12.5px; }

        @media (max-width: 900px) {
          .lp-home-container { flex-direction: column; gap: 48px; padding-top: 32px; }
          .lp-home-right { flex: 1; width: 100%; position: static; }
          .lp-hero { text-align: center; }
          .lp-hero-btns { justify-content: center; }
          .lp-hero p { margin: 0 auto 36px; }
          .lp-nav { padding: 0 16px; }
          .lp-footer { flex-direction: column; gap: 16px; padding: 20px 16px; }
        }
      `}</style>

      <div className="lp-root">
        {/* Navbar */}
        <nav className="lp-nav">
          <div className="lp-nav-brand" onClick={() => setSection("home")}>
            <div className="lp-nav-brand-icon">✦</div>
            <span className="lp-nav-brand-name">NovaMind</span>
          </div>
          <div className="lp-nav-links">
            <button className={`lp-nav-link${section === "home" ? " active" : ""}`} onClick={() => setSection("home")}>Product</button>
            <button className={`lp-nav-link${section === "faq"  ? " active" : ""}`} onClick={() => setSection("faq")}>FAQ</button>
            <button className={`lp-nav-link${section === "contact" ? " active" : ""}`} onClick={() => setSection("contact")}>Contact</button>
            <button className="lp-nav-cta" onClick={() => { setSection("home"); setMode("register"); }}>Get started</button>
          </div>
        </nav>

        <div className="lp-body">
          {/* HOME SECTION */}
          {section === "home" && (
            <div className="lp-home-container">
              {/* Left Column: Hero & Features */}
              <div className="lp-home-left">
                <div className="lp-hero">
                  <div className="lp-hero-eyebrow">✦ Client Portal</div>
                  <h1>Your AI chatbot,<br /><em>brilliantly</em> managed.</h1>
                  <p>Deploy intelligent bots, index your documents, and handle every customer conversation — all from one dashboard.</p>
                  <div className="lp-hero-btns">
                    <button className="lp-btn-primary" onClick={() => setMode("register")}>Create free account →</button>
                    <button className="lp-btn-ghost" onClick={() => setSection("faq")}>See FAQ</button>
                  </div>
                </div>

                <div className="lp-features">
                  {FEATURES.map((f) => (
                    <div className="lp-feature" key={f.title}>
                      <span className="lp-feature-icon">{f.icon}</span>
                      <div className="lp-feature-title">{f.title}</div>
                      <div className="lp-feature-desc">{f.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Auth Card */}
              <div className="lp-home-right">
                <div className="lp-auth-card">
                  <div className="lp-auth-title">{mode === "login" ? "Welcome back" : "Get started free"}</div>
                  <div className="lp-auth-sub">
                    {mode === "login" ? "Sign in to your client portal" : "No credit card required · Cancel anytime"}
                  </div>

                  <div className="lp-tabs">
                    <button className={`lp-tab${mode === "login" ? " active" : ""}`}
                      onClick={() => { setMode("login"); setSuccessMsg(""); setError(null); }}>Sign in</button>
                    <button className={`lp-tab${mode === "register" ? " active" : ""}`}
                      onClick={() => { setMode("register"); setSuccessMsg(""); setError(null); }}>Create account</button>
                  </div>

                  <form onSubmit={handleSubmit}>
                    {mode === "register" && (
                      <div className="lp-field">
                        <input className="lp-input" placeholder="Full name" value={name}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} required />
                      </div>
                    )}
                    <div className="lp-field">
                      <input className="lp-input" type="email" placeholder="Email address" value={email}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required />
                    </div>
                    <div className="lp-field">
                      <input className="lp-input" type="password" placeholder="Password" value={password}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
                    </div>
                    {successMsg && <div className="lp-success">{successMsg}</div>}
                    {error      && <div className="lp-error">{error}</div>}
                    <button className="lp-submit" type="submit" disabled={loading}>
                      {loading ? "Please wait…" : mode === "login" ? "Sign in →" : "Create my account →"}
                    </button>
                  </form>

                  <div className="lp-privacy">
                    <span>🔒 Private & secure</span>
                    <div className="lp-privacy-dot" />
                    <span>Never shared</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FAQ SECTION */}
          {section === "faq" && (
            <div className="lp-faq-wrap">
              <div className="lp-section-heading">
                <h2>Frequently asked questions</h2>
                <p>Everything you need to know before getting started.</p>
              </div>
              <div className="lp-faq">
                {FAQ.map((item, i) => (
                  <div className="lp-faq-item" key={i}>
                    <button className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                      <span>{item.q}</span>
                      <span className={`lp-faq-chevron${openFaq === i ? " open" : ""}`}>▾</span>
                    </button>
                    {openFaq === i && <div className="lp-faq-a">{item.a}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONTACT SECTION */}
          {section === "contact" && (
            <div className="lp-contact-wrap">
              <div className="lp-section-heading">
                <h2>Get in touch</h2>
                <p>We're here to help with anything you need.</p>
              </div>
              <div className="lp-contact-grid">
                <div className="lp-contact-card">
                  <div className="lp-contact-icon">✉</div>
                  <div className="lp-contact-title">Email support</div>
                  <div className="lp-contact-desc">Response within 24 hours.</div>
                  <button className="lp-contact-btn" onClick={() => window.location.href = "mailto:support@novamind.ai"}>
                    support@novamind.ai
                  </button>
                </div>
                <div className="lp-contact-card">
                  <div className="lp-contact-icon">◎</div>
                  <div className="lp-contact-title">Client Support</div>
                  <div className="lp-contact-desc">Open a ticket in your dashboard.</div>
                  <button className="lp-contact-btn" onClick={() => { setSection("home"); setMode("login"); }}>
                    Sign in
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="lp-footer">
          <span>© {new Date().getFullYear()} NovaMind.</span>
          <div className="lp-footer-links">
            <button className="lp-footer-link" onClick={() => setSection("faq")}>FAQ</button>
            <button className="lp-footer-link" onClick={() => setSection("contact")}>Contact</button>
            <button className="lp-footer-link">Privacy</button>
          </div>
        </footer>
      </div>
    </>
  );
}
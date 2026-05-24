// Frontend/src/ClientLogin.tsx
// Updated to include TrialChat on the landing page home section.

import { useState, ChangeEvent, FormEvent } from "react";
import { ClientUser } from "./ClientApp";
import TrialChat from "./TrialChat";
import { GoogleLogin } from "@react-oauth/google";

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

  // Controls whether the right-column shows the trial chat or the auth form
  const [rightPanel, setRightPanel] = useState<"trial" | "auth">("trial");

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

  // Called by TrialChat when the visitor hits the message limit or clicks CTA
  const handleTrialSignUp = () => {
    setMode("register");
    setRightPanel("auth");
  };
  const handleTrialLogin = () => {
    setMode("login");
    setRightPanel("auth");
  };

  return (
    <>
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
            <button className="lp-nav-signin" onClick={() => { setSection("home"); setMode("login"); setRightPanel("auth"); }}>Sign in</button>
            <button className="lp-nav-cta" onClick={() => { setSection("home"); setMode("register"); setRightPanel("auth"); }}>Get started</button>
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
                    <button className="lp-btn-primary" onClick={() => { setMode("register"); setRightPanel("auth"); }}>
                      Create free account →
                    </button>
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

              {/* Right Column: Trial Chat or Auth Form */}
              <div className="lp-home-right">
                {/* Panel switcher tabs */}
                <div className="lp-right-panel-switcher">
                  <button
                    className={`lp-panel-tab${rightPanel === "trial" ? " active" : ""}`}
                    onClick={() => setRightPanel("trial")}
                  >
                    ◎ Try it live
                  </button>
                  <button
                    className={`lp-panel-tab${rightPanel === "auth" ? " active" : ""}`}
                    onClick={() => setRightPanel("auth")}
                  >
                    ✦ {mode === "login" ? "Sign in" : "Create account"}
                  </button>
                </div>

                {/* Trial chat panel */}
                {rightPanel === "trial" && (
                  <>
                    <TrialChat onSignUp={handleTrialSignUp} onLogin={handleTrialLogin} />
                    <div className="lp-trial-nudge">
                      Like what you see?{" "}
                      <button onClick={handleTrialSignUp}>Create your free account</button>
                      {" "}or{" "}
                      <button onClick={handleTrialLogin}>sign in</button>
                    </div>
                  </>
                )}

                {/* Auth card panel */}
                {rightPanel === "auth" && (
                  <div className="lp-auth-card">
                    <div className="lp-auth-title">
                      {mode === "login" ? "Welcome back" : "Get started free"}
                    </div>
                    <div className="lp-auth-sub">
                      {mode === "login"
                        ? "Sign in to your client portal"
                        : "No credit card required · Cancel anytime"}
                    </div>

                    <div className="lp-tabs">
                      <button
                        className={`lp-tab${mode === "login" ? " active" : ""}`}
                        onClick={() => { setMode("login"); setSuccessMsg(""); setError(null); }}
                      >
                        Sign in
                      </button>
                      <button
                        className={`lp-tab${mode === "register" ? " active" : ""}`}
                        onClick={() => { setMode("register"); setSuccessMsg(""); setError(null); }}
                      >
                        Create account
                      </button>
                    </div>

                    <form onSubmit={handleSubmit}>
                      {mode === "register" && (
                        <div className="lp-field">
                          <input
                            className="lp-input"
                            placeholder="Full name"
                            value={name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                            required
                          />
                        </div>
                      )}
                      <div className="lp-field">
                        <input
                          className="lp-input"
                          type="email"
                          placeholder="Email address"
                          value={email}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="lp-field">
                        <input
                          className="lp-input"
                          type="password"
                          placeholder="Password"
                          value={password}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                          required
                        />
                      </div>
                      {successMsg && <div className="lp-success">{successMsg}</div>}
                      {error      && <div className="lp-error">{error}</div>}
                      <button className="lp-submit" type="submit" disabled={loading}>
                        {loading
                          ? "Please wait…"
                          : mode === "login"
                          ? "Sign in →"
                          : "Create my account →"}
                      </button>
                    </form>

                    <div className="lp-privacy">
                      <span>🔒 Private & secure</span>
                      <div className="lp-privacy-dot" />
                      <span>Never shared</span>
                    </div>

                    <div className="lp-divider">or continue with</div>

                    <div className="lp-google-wrap">
                      <GoogleLogin
                        onSuccess={async (credentialResponse) => {
                          try {
                            const res = await fetch(`${API}/auth/google`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ credential: credentialResponse.credential }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setError(data.detail || "Google login failed.");
                              return;
                            }
                            onLogin(data.user, data.access_token);
                          } catch {
                            setError("Could not connect to the server.");
                          }
                        }}
                        onError={() => setError("Google login failed.")}
                      />
                    </div>

                    {/* Link back to trial */}
                    <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: "var(--text3)" }}>
                      Want to try first?{" "}
                      <button
                        style={{
                          background: "none", border: "none",
                          color: "var(--accent-light, #a59df0)",
                          cursor: "pointer", fontFamily: "inherit",
                          fontSize: "inherit", fontWeight: 600,
                          textDecoration: "underline", textUnderlineOffset: 2,
                        }}
                        onClick={() => setRightPanel("trial")}
                      >
                        Try the live demo
                      </button>
                    </div>
                  </div>
                )}
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
                  <button className="lp-contact-btn" onClick={() => { setSection("home"); setMode("login"); setRightPanel("auth"); }}>
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
import { Session, SidebarProps } from './types.tsx';
import { useTheme } from './useTheme';

function Sidebar({ page, setPage, sessions, activeSession, setActiveSession, onNewChat, userName, onLogout, onDeleteSession }: SidebarProps) {
  const [theme, toggleTheme] = useTheme();

  return (
    <>
      <div className="sidebar-header">
        <div className="logo" style={{ fontSize: 16 }}>
          <div className="logo-icon" style={{ width: 28, height: 28, fontSize: 12 }}>✦</div>
          NovaMind
        </div>
        <button className="new-chat-btn" title="New chat" onClick={onNewChat}>+</button>
      </div>

      <div className="sidebar-nav">
        <button className={`nav-item ${page === "chat" ? "active" : ""}`} onClick={() => setPage("chat")}>
          <span className="nav-icon">💬</span> Chat
        </button>
        <button className={`nav-item ${page === "upload" ? "active" : ""}`} onClick={() => setPage("upload")}>
          <span className="nav-icon">📁</span> Documents
        </button>
      </div>

      <div className="sessions-section">
        <div className="sessions-label">Recent chats</div>
        {sessions.map((s: Session) => (
          <div
            key={s.id}
            className={`session-item ${activeSession === s.id ? "active" : ""}`}
            onClick={() => { setActiveSession(s.id); setPage("chat"); }}
          >
            <div className="session-dot" style={{ background: activeSession === s.id ? "var(--accent)" : undefined }} />
            <div className="session-title">{s.title}</div>
            <div className="session-time">{s.time}</div>
            <button
              className="session-delete"
              onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{userName}</div>
          </div>
          <span style={{ color: "var(--text3)", fontSize: 14 }}>⚙</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button
            onClick={onLogout}
            title="Log out"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text3)",
              cursor: "pointer",
              fontSize: 16,
              padding: "4px",
              borderRadius: "6px",
              transition: "var(--transition)",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text3)")}
          >
            ⏻
          </button>
        </div>
      </div>
    </>
  );
}
export default Sidebar;
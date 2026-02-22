export interface Session {
  id: number;
  title: string;
  time: string;
  active?: boolean;
}

export interface Doc {
  id: number;
  name: string;
  type: "pdf" | "url" | "image";
  size: string;
  status: "ready" | "processing";
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  time: string;
}

export interface AuthPageProps {
  onLogin:(name: string) => void;
}

export interface SidebarProps {
  page: string;
  setPage: (p: string) => void;
  sessions: Session[];
  activeSession: number;
  setActiveSession: (id: number) => void;
  onNewChat: () => void;
  userName: string;
  onLogout: () => void;

}

export interface ChatPageProps {
  docs: Doc[];
  messages: Message[];
  setMessages: (msgs: Message[]) => void;
  onToggleSidebar: () => void;  // ← make sure this exists
}

export interface UploadPageProps {
  docs: Doc[];
  setDocs: (docs: Doc[] | ((prev: Doc[]) => Doc[])) => void;
  onToggleSidebar: () => void;  // ← ADD THIS
}

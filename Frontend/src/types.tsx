// types.tsx

export interface Doc {
  id: string;
  name: string;
  type: "pdf" | "url" | "image";
  size: string;
  status: "ready" | "processing";
}

export interface Source {
  source: string;
  content_preview: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: (string | Source)[];
  time: string;
}

export interface Session {
  id: string;
  title: string;
  time: string;
  docs: Doc[];        // Each session has its own documents
  messages: Message[]; // Each session has its own messages
}

export interface AuthPageProps {
  onLogin: (name: string, adminFlag: boolean) => void | Promise<void>;
}

export interface SidebarProps {
  page: string;
  setPage: (page: string) => void;
  sessions: Session[];
  activeSession: string | null;
  setActiveSession: (id: string) => void;
  onNewChat: () => void;
  userName: string;
  onLogout: () => void;
  onDeleteSession: (id: string) => void;
}

export interface ChatPageProps {
  docs: Doc[];
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  onToggleSidebar: () => void;
  onAddDocs?: (docs: Doc[]) => void;
}

export interface UploadPageProps {
  docs: Doc[];
  setDocs: React.Dispatch<React.SetStateAction<Doc[]>>;
  onToggleSidebar: () => void;
  onStartChat: () => void;
}
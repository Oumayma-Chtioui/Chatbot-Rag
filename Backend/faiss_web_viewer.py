#!/usr/bin/env python3
"""
FAISS Web Viewer - Per-Session Structure
Flask web interface to browse per-user/per-session FAISS vector stores
"""

from flask import Flask, render_template_string, request, jsonify
import os
from pathlib import Path
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

app = Flask(__name__)

# Configuration
BACKEND_DIR = Path(__file__).parent.absolute()
VECTOR_BASE_PATH = os.path.join(BACKEND_DIR, "vector_store")

# Cache for loaded databases: key = "user_id:session_id"
_db_cache = {}
_embeddings = None

def get_embeddings():
    """Lazy-load embeddings (shared across all stores)"""
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-base-en-v1.5",
            model_kwargs={'device': 'cpu'},
            encode_kwargs={'normalize_embeddings': True}
        )
    return _embeddings


def discover_vector_stores():
    """Discover all user/session vector stores"""
    stores = []

    if not os.path.exists(VECTOR_BASE_PATH):
        return stores

    for user_dir in sorted(os.listdir(VECTOR_BASE_PATH)):
        user_path = os.path.join(VECTOR_BASE_PATH, user_dir)
        if not os.path.isdir(user_path) or not user_dir.startswith("user_"):
            continue

        user_id = user_dir[len("user_"):]

        for session_dir in sorted(os.listdir(user_path)):
            session_path = os.path.join(user_path, session_dir)
            if not os.path.isdir(session_path) or not session_dir.startswith("session_"):
                continue

            session_id = session_dir[len("session_"):]
            faiss_index = os.path.join(session_path, "index.faiss")
            faiss_pkl = os.path.join(session_path, "index.pkl")

            if os.path.exists(faiss_index) and os.path.exists(faiss_pkl):
                stores.append({
                    "user_id": user_id,
                    "session_id": session_id,
                    "path": session_path,
                    "faiss_size": os.path.getsize(faiss_index),
                    "pkl_size": os.path.getsize(faiss_pkl),
                    "key": f"{user_id}:{session_id}"
                })

    return stores


def load_store(user_id: str, session_id: str):
    """Load (and cache) a specific vector store"""
    cache_key = f"{user_id}:{session_id}"
    if cache_key in _db_cache:
        return _db_cache[cache_key]

    vector_path = os.path.join(VECTOR_BASE_PATH, f"user_{user_id}", f"session_{session_id}")
    if not os.path.exists(os.path.join(vector_path, "index.faiss")):
        return None

    db = FAISS.load_local(
        vector_path,
        get_embeddings(),
        allow_dangerous_deserialization=True
    )
    _db_cache[cache_key] = db
    return db


# ── HTML ─────────────────────────────────────────────────────────────────────

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FAISS Inspector</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg:       #0a0c10;
            --surface:  #111318;
            --border:   #1f2330;
            --accent:   #00e5a0;
            --accent2:  #0ea5e9;
            --text:     #d4dbe8;
            --muted:    #5a6478;
            --danger:   #f43f5e;
            --mono: 'IBM Plex Mono', monospace;
            --sans: 'Syne', sans-serif;
        }

        body {
            background: var(--bg);
            color: var(--text);
            font-family: var(--sans);
            min-height: 100vh;
        }

        /* ── Layout ── */
        .layout { display: flex; min-height: 100vh; }

        .sidebar {
            width: 280px;
            min-width: 280px;
            background: var(--surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .sidebar-header {
            padding: 28px 20px 20px;
            border-bottom: 1px solid var(--border);
        }

        .logo {
            font-size: 1.1rem;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #fff;
        }

        .logo span { color: var(--accent); }

        .sidebar-label {
            font-family: var(--mono);
            font-size: 0.65rem;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 2px;
            padding: 16px 20px 8px;
        }

        .store-list { flex: 1; overflow-y: auto; padding-bottom: 16px; }

        .store-item {
            padding: 10px 20px;
            cursor: pointer;
            border-left: 3px solid transparent;
            transition: all 0.15s;
        }

        .store-item:hover { background: rgba(0,229,160,0.04); border-left-color: var(--border); }
        .store-item.active { background: rgba(0,229,160,0.07); border-left-color: var(--accent); }

        .store-user {
            font-family: var(--mono);
            font-size: 0.78rem;
            color: var(--accent);
            font-weight: 600;
        }

        .store-session {
            font-family: var(--mono);
            font-size: 0.7rem;
            color: var(--muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-top: 2px;
        }

        .store-size {
            font-family: var(--mono);
            font-size: 0.65rem;
            color: var(--muted);
            margin-top: 4px;
        }

        .no-stores {
            padding: 20px;
            font-family: var(--mono);
            font-size: 0.8rem;
            color: var(--muted);
            line-height: 1.6;
        }

        /* ── Main ── */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        .topbar {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 20px 32px;
            border-bottom: 1px solid var(--border);
            background: var(--surface);
        }

        .topbar h2 {
            font-size: 1rem;
            font-weight: 700;
            color: #fff;
            flex: 1;
        }

        .tabs {
            display: flex;
            gap: 4px;
            background: var(--bg);
            padding: 4px;
            border-radius: 8px;
            border: 1px solid var(--border);
        }

        .tab-btn {
            padding: 6px 16px;
            border: none;
            background: transparent;
            color: var(--muted);
            font-family: var(--mono);
            font-size: 0.78rem;
            cursor: pointer;
            border-radius: 5px;
            transition: all 0.15s;
        }

        .tab-btn.active { background: var(--surface); color: var(--accent); border: 1px solid var(--border); }
        .tab-btn:hover:not(.active) { color: var(--text); }

        .content { flex: 1; overflow-y: auto; padding: 28px 32px; }

        /* ── Stats ── */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
            margin-bottom: 28px;
        }

        .stat {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 18px;
        }

        .stat-val {
            font-family: var(--mono);
            font-size: 1.8rem;
            font-weight: 600;
            color: var(--accent);
            line-height: 1;
            margin-bottom: 6px;
        }

        .stat-lbl {
            font-family: var(--mono);
            font-size: 0.68rem;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* ── Sources ── */
        .sources-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 28px;
        }

        .source-tag {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 4px 12px;
            font-family: var(--mono);
            font-size: 0.72rem;
            color: var(--accent2);
        }

        /* ── Search ── */
        .search-row {
            display: flex;
            gap: 10px;
            margin-bottom: 24px;
        }

        .search-input {
            flex: 1;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text);
            font-family: var(--mono);
            font-size: 0.9rem;
            padding: 12px 16px;
            outline: none;
            transition: border-color 0.15s;
        }

        .search-input:focus { border-color: var(--accent); }

        .btn {
            background: var(--accent);
            color: #000;
            border: none;
            border-radius: 8px;
            padding: 12px 22px;
            font-family: var(--mono);
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s;
            white-space: nowrap;
        }

        .btn:hover { opacity: 0.85; }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── Documents ── */
        .doc-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 12px;
            transition: border-color 0.15s;
        }

        .doc-card:hover { border-color: #2a3040; }

        .doc-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }

        .doc-num {
            font-family: var(--mono);
            font-size: 0.72rem;
            color: var(--muted);
        }

        .score-badge {
            font-family: var(--mono);
            font-size: 0.7rem;
            padding: 3px 10px;
            border-radius: 20px;
            background: rgba(0,229,160,0.1);
            color: var(--accent);
            border: 1px solid rgba(0,229,160,0.2);
        }

        .doc-content {
            font-family: var(--mono);
            font-size: 0.8rem;
            line-height: 1.7;
            color: #9baabb;
            margin-bottom: 14px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .meta-row { display: flex; flex-wrap: wrap; gap: 6px; }

        .meta-tag {
            font-family: var(--mono);
            font-size: 0.65rem;
            padding: 2px 8px;
            border-radius: 4px;
            background: rgba(14,165,233,0.08);
            color: var(--accent2);
            border: 1px solid rgba(14,165,233,0.15);
        }

        /* ── Empty / Loading ── */
        .empty {
            text-align: center;
            padding: 60px 20px;
            font-family: var(--mono);
            font-size: 0.85rem;
            color: var(--muted);
        }

        .empty .icon { font-size: 2.5rem; margin-bottom: 12px; }

        .hidden { display: none; }

        /* ── Scrollbar ── */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    </style>
</head>
<body>
<div class="layout">

    <!-- Sidebar -->
    <aside class="sidebar">
        <div class="sidebar-header">
            <div class="logo">FAISS<span>.</span>Inspector</div>
        </div>
        <div class="sidebar-label">Vector Stores</div>
        <div class="store-list" id="store-list">
            <div class="no-stores">Loading stores…</div>
        </div>
    </aside>

    <!-- Main -->
    <main class="main">
        <div class="topbar">
            <h2 id="store-title">Select a store</h2>
            <div class="tabs" id="tabs" style="display:none">
                <button class="tab-btn active" onclick="switchTab('stats', this)">Stats</button>
                <button class="tab-btn" onclick="switchTab('search', this)">Search</button>
                <button class="tab-btn" onclick="switchTab('browse', this)">Browse</button>
            </div>
        </div>

        <div class="content">
            <!-- Stats tab -->
            <div id="tab-stats">
                <div class="empty">
                    <div class="icon">🗄️</div>
                    <div>Select a vector store from the sidebar</div>
                </div>
            </div>

            <!-- Search tab -->
            <div id="tab-search" class="hidden">
                <div class="search-row">
                    <input id="search-input" class="search-input" type="text"
                           placeholder="Enter a semantic search query…" />
                    <button class="btn" id="search-btn" onclick="doSearch()">Search</button>
                </div>
                <div id="search-results"></div>
            </div>

            <!-- Browse tab -->
            <div id="tab-browse" class="hidden">
                <div id="browse-results">
                    <div class="empty"><div class="icon">📂</div><div>Loading documents…</div></div>
                </div>
            </div>
        </div>
    </main>
</div>

<script>
let activeStore = null;
let activeTab   = 'stats';
let browseLoaded = false;

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
    const res  = await fetch('/api/stores');
    const data = await res.json();
    renderSidebar(data.stores || []);
    if (data.stores && data.stores.length === 1) {
        selectStore(data.stores[0].user_id, data.stores[0].session_id, data.stores[0]);
    }
}

function renderSidebar(stores) {
    const el = document.getElementById('store-list');
    if (!stores.length) {
        el.innerHTML = `<div class="no-stores">No vector stores found.<br><br>Make sure documents have been uploaded and the vector_store directory is in the same folder as this script.</div>`;
        return;
    }
    el.innerHTML = stores.map(s => `
        <div class="store-item" id="si-${s.user_id}-${s.session_id}"
             onclick="selectStore('${s.user_id}','${s.session_id}',${JSON.stringify(s).replace(/"/g,'&quot;')})">
            <div class="store-user">user_${s.user_id}</div>
            <div class="store-session">session_${s.session_id}</div>
            <div class="store-size">${(s.faiss_size/1024).toFixed(1)} KB index</div>
        </div>
    `).join('');
}

async function selectStore(userId, sessionId, meta) {
    // Highlight sidebar
    document.querySelectorAll('.store-item').forEach(e => e.classList.remove('active'));
    const el = document.getElementById(`si-${userId}-${sessionId}`);
    if (el) el.classList.add('active');

    activeStore = { userId, sessionId };
    browseLoaded = false;

    document.getElementById('store-title').textContent = `user_${userId}  ›  session_${sessionId.substring(0,20)}…`;
    document.getElementById('tabs').style.display = '';

    switchTab('stats', document.querySelector('.tab-btn'));
    loadStats(userId, sessionId);
}

// ── Tab switching ──────────────────────────────────────────────────────────

function switchTab(name, btn) {
    activeTab = name;
    ['stats','search','browse'].forEach(t => {
        document.getElementById('tab-'+t).classList.toggle('hidden', t !== name);
    });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    if (name === 'browse' && !browseLoaded) loadBrowse();
}

// ── Stats ──────────────────────────────────────────────────────────────────

async function loadStats(userId, sessionId) {
    const tab = document.getElementById('tab-stats');
    tab.innerHTML = `<div class="empty"><div>Loading…</div></div>`;

    const res  = await fetch(`/api/stats?user_id=${userId}&session_id=${sessionId}`);
    const data = await res.json();
    if (data.error) { tab.innerHTML = `<div class="empty">${data.error}</div>`; return; }

    const sourceTags = (data.sources||[]).map(s =>
        `<span class="source-tag">📄 ${s}</span>`
    ).join('');

    tab.innerHTML = `
        <div class="stats-grid">
            <div class="stat"><div class="stat-val">${data.total_vectors}</div><div class="stat-lbl">Vectors</div></div>
            <div class="stat"><div class="stat-val">${data.total_documents}</div><div class="stat-lbl">Chunks</div></div>
            <div class="stat"><div class="stat-val">${data.dimension}</div><div class="stat-lbl">Dimensions</div></div>
            <div class="stat"><div class="stat-val">${data.sources.length}</div><div class="stat-lbl">Sources</div></div>
        </div>
        ${sourceTags ? `<div style="margin-bottom:8px;font-family:var(--mono);font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Documents</div><div class="sources-list">${sourceTags}</div>` : ''}
        ${data.first_upload ? `<div style="font-family:var(--mono);font-size:.72rem;color:var(--muted);margin-top:8px">First upload: ${data.first_upload} &nbsp;·&nbsp; Last: ${data.last_upload}</div>` : ''}
    `;
}

// ── Search ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('search-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
    });
});

async function doSearch() {
    if (!activeStore) return;
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    const btn = document.getElementById('search-btn');
    btn.disabled = true;
    btn.textContent = '…';

    const res  = await fetch('/api/search', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ user_id: activeStore.userId, session_id: activeStore.sessionId, query, k: 6 })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'Search';

    const el = document.getElementById('search-results');
    if (data.error)          { el.innerHTML = `<div class="empty">${data.error}</div>`; return; }
    if (!data.results.length){ el.innerHTML = `<div class="empty"><div class="icon">🔍</div><div>No results found</div></div>`; return; }

    el.innerHTML = data.results.map((r, i) => `
        <div class="doc-card">
            <div class="doc-header">
                <span class="doc-num">Result #${i+1}</span>
                <span class="score-badge">score ${r.score.toFixed(4)}</span>
            </div>
            <div class="doc-content">${escHtml(r.content)}</div>
            <div class="meta-row">${metaTags(r.metadata)}</div>
        </div>
    `).join('');
}

// ── Browse ─────────────────────────────────────────────────────────────────

async function loadBrowse() {
    if (!activeStore) return;
    browseLoaded = true;
    const el = document.getElementById('browse-results');
    el.innerHTML = `<div class="empty"><div>Loading documents…</div></div>`;

    const res  = await fetch(`/api/list?user_id=${activeStore.userId}&session_id=${activeStore.sessionId}`);
    const data = await res.json();

    if (data.error) { el.innerHTML = `<div class="empty">${data.error}</div>`; return; }
    if (!data.documents.length){ el.innerHTML = `<div class="empty"><div class="icon">📂</div><div>No documents found</div></div>`; return; }

    el.innerHTML = data.documents.map((d, i) => `
        <div class="doc-card">
            <div class="doc-header">
                <span class="doc-num">Chunk #${i+1}</span>
            </div>
            <div class="doc-content">${escHtml(d.content.substring(0, 400))}${d.content.length > 400 ? '…' : ''}</div>
            <div class="meta-row">${metaTags(d.metadata)}</div>
        </div>
    `).join('');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function metaTags(meta) {
    return Object.entries(meta||{}).map(([k,v]) =>
        `<span class="meta-tag">${escHtml(k)}: ${escHtml(String(v).substring(0,60))}</span>`
    ).join('');
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

init();
</script>
</body>
</html>
"""


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)


@app.route('/api/stores')
def api_stores():
    """List all discovered stores"""
    stores = discover_vector_stores()
    return jsonify({"stores": stores})


@app.route('/api/stats')
def api_stats():
    """Stats for a specific user/session store"""
    user_id    = request.args.get('user_id')
    session_id = request.args.get('session_id')

    if not user_id or not session_id:
        return jsonify({"error": "user_id and session_id are required"}), 400

    db = load_store(user_id, session_id)
    if not db:
        return jsonify({"error": f"Store not found for user={user_id} session={session_id}"}), 404

    try:
        index    = db.index
        all_docs = list(db.docstore._dict.values())

        sources      = set()
        upload_times = []

        for doc in all_docs:
            meta = getattr(doc, 'metadata', {})
            sources.add(meta.get('source', 'Unknown'))
            t = meta.get('upload_time')
            if t:
                upload_times.append(t)

        return jsonify({
            "total_vectors":    index.ntotal,
            "dimension":        index.d,
            "total_documents":  len(all_docs),
            "sources":          sorted(sources),
            "first_upload":     min(upload_times) if upload_times else None,
            "last_upload":      max(upload_times) if upload_times else None,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/search', methods=['POST'])
def api_search():
    """Semantic search within a store"""
    body       = request.json or {}
    user_id    = body.get('user_id')
    session_id = body.get('session_id')
    query      = body.get('query', '')
    k          = int(body.get('k', 5))

    if not user_id or not session_id:
        return jsonify({"error": "user_id and session_id are required"}), 400
    if not query:
        return jsonify({"error": "query is required"}), 400

    db = load_store(user_id, session_id)
    if not db:
        return jsonify({"error": "Store not found"}), 404

    try:
        results = db.similarity_search_with_score(query, k=k)
        return jsonify({"results": [
            {
                "content":  doc.page_content[:600],
                "score":    float(score),
                "metadata": getattr(doc, 'metadata', {})
            }
            for doc, score in results
        ]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/list')
def api_list():
    """Browse all document chunks in a store (first 60)"""
    user_id    = request.args.get('user_id')
    session_id = request.args.get('session_id')

    if not user_id or not session_id:
        return jsonify({"error": "user_id and session_id are required"}), 400

    db = load_store(user_id, session_id)
    if not db:
        return jsonify({"error": "Store not found"}), 404

    try:
        all_docs = list(db.docstore._dict.values())[:60]
        return jsonify({"documents": [
            {"content": doc.page_content, "metadata": getattr(doc, 'metadata', {})}
            for doc in all_docs
        ]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🌐  FAISS Web Viewer  (Per-Session)")
    print("="*60)
    print(f"\n📂  Vector base: {VECTOR_BASE_PATH}")

    stores = discover_vector_stores()
    if stores:
        print(f"✅  Found {len(stores)} store(s)")
        for s in stores:
            print(f"    • user_{s['user_id']} / session_{s['session_id'][:30]}")
    else:
        print("⚠️   No stores found — check VECTOR_BASE_PATH")

    print(f"\n🌐  Open: http://localhost:5001\n")
    app.run(host='0.0.0.0', port=5001, debug=True)
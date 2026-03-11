#!/usr/bin/env python3
"""
FAISS Web Viewer
Simple Flask web interface to browse FAISS database
"""

from flask import Flask, render_template_string, request, jsonify
import os
from pathlib import Path
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

app = Flask(__name__)

# Configuration
BACKEND_DIR = Path(__file__).parent.absolute()
VECTOR_PATH = os.path.join(BACKEND_DIR, "vector_store", "faiss_index")

# Global database
db = None

def load_db():
    """Load FAISS database"""
    global db
    if db is not None:
        return db
    
    if not os.path.exists(VECTOR_PATH):
        return None
    
    embeddings = HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={'device': 'cpu'}
    )
    
    db = FAISS.load_local(
        VECTOR_PATH,
        embeddings,
        allow_dangerous_deserialization=True
    )
    return db

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>FAISS Database Viewer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #0f172a;
            color: #e2e8f0;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 30px;
            font-size: 2.5rem;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #1e293b;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #334155;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 5px;
        }
        .stat-label { color: #94a3b8; font-size: 0.875rem; }
        .search-box {
            background: #1e293b;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 30px;
            border: 1px solid #334155;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            color: #e2e8f0;
            font-size: 1rem;
            margin-bottom: 10px;
        }
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
        }
        button:hover { opacity: 0.9; }
        .results { margin-top: 20px; }
        .document {
            background: #1e293b;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 15px;
            border: 1px solid #334155;
        }
        .doc-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .doc-title { font-weight: 600; color: #667eea; }
        .doc-score {
            background: #334155;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.875rem;
        }
        .doc-content {
            color: #cbd5e1;
            line-height: 1.6;
            margin-bottom: 15px;
        }
        .doc-metadata {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .meta-tag {
            background: #334155;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 0.75rem;
            color: #94a3b8;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #94a3b8;
        }
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        .tab {
            background: #1e293b;
            padding: 12px 24px;
            border-radius: 8px;
            border: 1px solid #334155;
            cursor: pointer;
        }
        .tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-color: #667eea;
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 FAISS Database Viewer</h1>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value" id="total-vectors">-</div>
                <div class="stat-label">Total Vectors</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="total-docs">-</div>
                <div class="stat-label">Documents</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="dimension">-</div>
                <div class="stat-label">Dimensions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="sources">-</div>
                <div class="stat-label">Unique Sources</div>
            </div>
        </div>

        <div class="tabs">
            <div class="tab active" onclick="switchTab('search')">Search</div>
            <div class="tab" onclick="switchTab('browse')">Browse All</div>
        </div>

        <div id="search-tab" class="tab-content active">
            <div class="search-box">
                <input type="text" id="query" placeholder="Search your documents..." />
                <button onclick="search()">🔍 Search</button>
            </div>
            <div id="search-results" class="results"></div>
        </div>

        <div id="browse-tab" class="tab-content">
            <div id="all-docs" class="results"></div>
        </div>
    </div>

    <script>
        async function loadStats() {
            const res = await fetch('/api/stats');
            const data = await res.json();
            
            document.getElementById('total-vectors').textContent = data.total_vectors || '0';
            document.getElementById('total-docs').textContent = data.total_documents || '0';
            document.getElementById('dimension').textContent = data.dimension || '0';
            document.getElementById('sources').textContent = data.sources?.length || '0';
        }

        async function search() {
            const query = document.getElementById('query').value;
            if (!query) return;

            const resultsDiv = document.getElementById('search-results');
            resultsDiv.innerHTML = '<div class="loading">Searching...</div>';

            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, k: 5 })
            });

            const data = await res.json();
            displayResults(data.results, resultsDiv);
        }

        async function browseAll() {
            const docsDiv = document.getElementById('all-docs');
            docsDiv.innerHTML = '<div class="loading">Loading documents...</div>';

            const res = await fetch('/api/list');
            const data = await res.json();
            displayDocuments(data.documents, docsDiv);
        }

        function displayResults(results, container) {
            if (!results || results.length === 0) {
                container.innerHTML = '<div class="loading">No results found</div>';
                return;
            }

            container.innerHTML = results.map((item, i) => `
                <div class="document">
                    <div class="doc-header">
                        <div class="doc-title">📄 Result #${i + 1}</div>
                        <div class="doc-score">Score: ${item.score.toFixed(4)}</div>
                    </div>
                    <div class="doc-content">${item.content}</div>
                    <div class="doc-metadata">
                        ${Object.entries(item.metadata).map(([k, v]) => 
                            `<span class="meta-tag">${k}: ${v}</span>`
                        ).join('')}
                    </div>
                </div>
            `).join('');
        }

        function displayDocuments(docs, container) {
            if (!docs || docs.length === 0) {
                container.innerHTML = '<div class="loading">No documents found</div>';
                return;
            }

            container.innerHTML = docs.map((doc, i) => `
                <div class="document">
                    <div class="doc-header">
                        <div class="doc-title">📄 Document #${i + 1}</div>
                    </div>
                    <div class="doc-content">${doc.content.substring(0, 300)}...</div>
                    <div class="doc-metadata">
                        ${Object.entries(doc.metadata).map(([k, v]) => 
                            `<span class="meta-tag">${k}: ${v}</span>`
                        ).join('')}
                    </div>
                </div>
            `).join('');
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById(tab + '-tab').classList.add('active');

            if (tab === 'browse' && !document.getElementById('all-docs').innerHTML) {
                browseAll();
            }
        }

        // Enter key to search
        document.getElementById('query')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') search();
        });

        // Load stats on page load
        loadStats();
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    """Main page"""
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/stats')
def get_stats():
    """Get database statistics"""
    database = load_db()
    if not database:
        return jsonify({"error": "Database not found"}), 404
    
    try:
        index = database.index
        docstore = database.docstore
        all_docs = list(docstore._dict.values())
        
        sources = set()
        for doc in all_docs:
            if hasattr(doc, 'metadata'):
                sources.add(doc.metadata.get('source', 'Unknown'))
        
        return jsonify({
            "total_vectors": index.ntotal,
            "dimension": index.d,
            "total_documents": len(all_docs),
            "sources": list(sources)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/search', methods=['POST'])
def search():
    """Search documents"""
    database = load_db()
    if not database:
        return jsonify({"error": "Database not found"}), 404
    
    data = request.json
    query = data.get('query', '')
    k = data.get('k', 5)
    
    try:
        results = database.similarity_search_with_score(query, k=k)
        
        formatted_results = []
        for doc, score in results:
            formatted_results.append({
                "content": doc.page_content[:500],
                "score": float(score),
                "metadata": doc.metadata if hasattr(doc, 'metadata') else {}
            })
        
        return jsonify({"results": formatted_results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/list')
def list_docs():
    """List all documents"""
    database = load_db()
    if not database:
        return jsonify({"error": "Database not found"}), 404
    
    try:
        docstore = database.docstore
        all_docs = list(docstore._dict.values())[:50]  # Limit to 50
        
        formatted_docs = []
        for doc in all_docs:
            formatted_docs.append({
                "content": doc.page_content,
                "metadata": doc.metadata if hasattr(doc, 'metadata') else {}
            })
        
        return jsonify({"documents": formatted_docs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("\n" + "="*60)
    print("🌐 Starting FAISS Web Viewer")
    print("="*60)
    print(f"\n📂 Vector store: {VECTOR_PATH}")
    print(f"🌐 Open: http://localhost:5001")
    print("\nPress Ctrl+C to stop\n")
    
    app.run(host='0.0.0.0', port=5001, debug=True)

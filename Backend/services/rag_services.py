import os
import re
import time
import uuid
import logging
from datetime import datetime

from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from fastapi import HTTPException
from services.shared_state import cancellation_registry



logger = logging.getLogger(__name__)

# ── RAG retrieval constants (tuned from eval notebook) ────────────────────────
SIMILARITY_THRESHOLD = 0.0   # Exp 5 winner
LLM_TEMPERATURE      = 0.0   # Exp 6 winner
FETCH_K              = 20    # Exp 7 winner
LAMBDA_MULT          = 0.7   # Exp 7 winner
N_QUERIES            = 2     # Exp 11 winner
TOP_K                = 5     # top chunks returned after rerank
CHUNK_SIZE           = 800   # chunking param
CHUNK_OVERLAP        = 120   # chunking param
USE_HYBRID           = True  # BM25 + dense hybrid retrieval
USE_CROSS_ENCODER    = True  # cross-encoder reranking


# ── Cancellation helper ────────────────────────────────────────────────────────
def is_cancelled(doc_id):
    return doc_id and cancellation_registry.get(doc_id, False)

# ── Model config from environment ─────────────────────────────────────────────
# ── [SERVER] BGE-M3 remote embeddings ────────────────────────────────────────
EMBEDDINGS_BASE_URL = os.getenv("EMBEDDINGS_BASE_URL", "http://192.168.130.177:8081/v1")
EMBEDDINGS_MODEL    = os.getenv("EMBEDDINGS_MODEL", "BAAI/bge-m3")
EMBEDDINGS_API_KEY  = os.getenv("EMBEDDINGS_API_KEY", "not-needed")
# ─────────────────────────────────────────────────────────────────────────────


# Cache Embedding model
_embeddings = None
def get_embeddings():
    """Remote BGE-M3 embeddings (primary). Falls back to HuggingFace bge-base-en-v1.5 if server unavailable.
    [LOCAL] To switch back to local-only, comment the OpenAIEmbeddings block and uncomment HuggingFaceEmbeddings.
    """
    global _embeddings
    if _embeddings is None:
        # ── [SERVER] Remote BGE-M3 via OpenAI-compatible API (primary) ───────
        try:
            from langchain_openai import OpenAIEmbeddings
            emb = OpenAIEmbeddings(
                model=EMBEDDINGS_MODEL,
                base_url=EMBEDDINGS_BASE_URL,
                api_key=EMBEDDINGS_API_KEY or "not-needed",
            )
            emb.embed_query("test")  # smoke-test
            _embeddings = emb
            logger.info(f"Remote BGE-M3 embeddings loaded @ {EMBEDDINGS_BASE_URL}")
        except Exception as e:
            logger.warning(f"Remote embeddings failed ({e}), falling back to HuggingFace")

            # ── [LOCAL] HuggingFace fallback ─────────────────────────────────
            _embeddings = HuggingFaceEmbeddings(
                model_name="BAAI/bge-m3",
                model_kwargs={"device": "cpu"},
                encode_kwargs={"normalize_embeddings": True},
            )
            logger.info("HuggingFace BAAI/bge-m3 embeddings loaded (fallback)")
    return _embeddings


# ── FAISS cache ────────────────────────────────────────────────────────────────
_faiss_cache: dict = {}

def load_faiss_cached(path, embeddings):
    if path not in _faiss_cache:
        _faiss_cache[path] = FAISS.load_local(
            path, embeddings, allow_dangerous_deserialization=True
        )
    logger.info(f"FAISS index loaded and cached from {path}")
    return _faiss_cache[path]


# ── URL detector ───────────────────────────────────────────────────────────────
def is_url(input_str: str) -> bool:
    return "." in input_str and " " not in input_str


# ── LLM Reranker (from notebook rerank_llm) ───────────────────────────────────
def llm_rerank(query: str, contexts: list, top_k: int) -> list:
    """Score each context with an LLM and return the top_k highest-scoring ones."""
    from langchain_mistralai import ChatMistralAI

    llm = ChatMistralAI(
        model="mistral-small-latest",
        mistral_api_key=os.getenv("MISTRAL_API_KEY", ""),
        temperature=0,
    )

    scored = []
    for ctx in contexts:
        prompt = (
            f"Score the relevance of the following context to the question "
            f"on a scale of 0 to 10.\n"
            f"Return ONLY a single integer between 0 and 10, nothing else.\n\n"
            f"Question: {query}\n\n"
            f"Context: {ctx}\n\n"
            f"Relevance score:"
        )
        try:
            response = llm.invoke(prompt).content.strip()
            score = float(re.findall(r"\d+", response)[0])
        except Exception:
            score = 0.0
        scored.append((ctx, score))

    return [ctx for ctx, _ in sorted(scored, key=lambda x: x[1], reverse=True)[:top_k]]


# ── Query rewriter ─────────────────────────────────────────────────────────────
def rewrite_query_for_retrieval(question: str, history: str = "") -> str:
    """
    Rewrite the user question into a specific, keyword-rich search query.
    Uses conversation history to resolve vague references and expand intent.
    Falls back to the original question on any failure.
    """
    from langchain_mistralai import ChatMistralAI

    llm = ChatMistralAI(
        model="mistral-small-latest",
        mistral_api_key=os.getenv("MISTRAL_API_KEY", ""),
        temperature=0,
    )

    history_block = f"\nConversation history:\n{history}\n" if history else ""

    prompt = f"""You are a search query optimizer for a RAG system.
{history_block}
User question: "{question}"

Rewrite this into a concise, keyword-rich search query that will retrieve the most relevant document chunks.
Rules:
- Resolve any pronouns or vague references using the conversation history.
- Expand abbreviations and vague intent (e.g. "the backlog" → "product backlog implemented features sprint tasks").
- Remove conversational filler ("can you", "please", "give me").
- Output ONLY the rewritten query, nothing else. No explanation, no punctuation at the end."""

    try:
        rewritten = llm.invoke(prompt).content.strip()
        # Sanity check: if the model returns something too long or empty, fall back
        if not rewritten or len(rewritten) > 300:
            return question
        logger.info(f"[query-rewrite] '{question}' → '{rewritten}'")
        return rewritten
    except Exception as e:
        logger.warning(f"[query-rewrite] Failed, using original: {e}")
        return question


# ── Multi-query generator ──────────────────────────────────────────────────────
def generate_queries(question: str, n: int = N_QUERIES) -> list[str]:
    """
    Return n semantically diverse query variants for MMR multi-query retrieval.
    The first entry is always the (already-rewritten) question itself.
    """
    variants = [
        question,
        f"List all {question}",
        f"Summarize {question}",
        f"What are the details of {question}",
        f"Explain {question}",
    ]
    return variants[:n]


# ── MMR multi-query retrieval with hybrid BM25 + cross-encoder reranking ──────
def retrieve_with_llm_rerank(
    db: FAISS,
    query: str,
    top_k: int = TOP_K,
    fetch_k: int = FETCH_K,
    lambda_mult: float = LAMBDA_MULT,
    n_queries: int = N_QUERIES,
    history: str = "",
) -> tuple[list, str]:
    """
    1. Rewrite `query` into a keyword-rich retrieval query using conversation history.
    2. Generate n_queries variants of the rewritten query.
    3. Run MMR (dense) search for each variant.
    4. If USE_HYBRID=True, also run BM25 sparse retrieval and merge candidates.
    5. Deduplicate candidates.
    6. If USE_CROSS_ENCODER=True, rerank with a cross-encoder; otherwise fall back to LLM reranking.
    Returns (list of Document objects, rewritten_query).
    """
    rewritten_query = rewrite_query_for_retrieval(query, history)

    all_docs: list = []
    seen_texts: set = set()

    # ── Dense MMR retrieval ───────────────────────────────────────────────────
    for q in generate_queries(rewritten_query, n_queries):
        results = db.max_marginal_relevance_search(
            q, k=top_k, fetch_k=fetch_k, lambda_mult=lambda_mult
        )
        for doc in results:
            if doc.page_content not in seen_texts:
                seen_texts.add(doc.page_content)
                all_docs.append(doc)

    # ── Hybrid: BM25 sparse retrieval ────────────────────────────────────────
    if USE_HYBRID:
        try:
            from rank_bm25 import BM25Okapi

            all_stored_docs = list(db.docstore._dict.values())
            corpus = [d.page_content for d in all_stored_docs]
            tokenized_corpus = [doc.lower().split() for doc in corpus]
            bm25 = BM25Okapi(tokenized_corpus)

            tokenized_query = rewritten_query.lower().split()
            bm25_scores = bm25.get_scores(tokenized_query)
            top_bm25_indices = sorted(
                range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True
            )[:fetch_k]

            for idx in top_bm25_indices:
                doc = all_stored_docs[idx]
                if doc.page_content not in seen_texts:
                    seen_texts.add(doc.page_content)
                    all_docs.append(doc)

            logger.info(f"[hybrid] BM25 added {len(top_bm25_indices)} candidates; total pool: {len(all_docs)}")
        except ImportError:
            logger.warning("[hybrid] rank_bm25 not installed — skipping BM25 retrieval. Run: pip install rank-bm25")
        except Exception as e:
            logger.warning(f"[hybrid] BM25 retrieval failed: {e}")

    # ── Reranking ─────────────────────────────────────────────────────────────
    if USE_CROSS_ENCODER:
        try:
            from sentence_transformers import CrossEncoder

            ce_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            pairs = [(rewritten_query, doc.page_content) for doc in all_docs]
            ce_scores = ce_model.predict(pairs)
            ranked = sorted(zip(all_docs, ce_scores), key=lambda x: x[1], reverse=True)
            docs = [doc for doc, _ in ranked[:top_k]]
            logger.info(f"[cross-encoder] Reranked {len(all_docs)} candidates → top {len(docs)}")
        except ImportError:
            logger.warning("[cross-encoder] sentence-transformers not installed — falling back to LLM rerank. Run: pip install sentence-transformers")
            raw_texts = [d.page_content for d in all_docs]
            reranked_texts = llm_rerank(rewritten_query, raw_texts, top_k=top_k)
            text_to_doc = {d.page_content: d for d in all_docs}
            docs = [text_to_doc[t] for t in reranked_texts if t in text_to_doc]
        except Exception as e:
            logger.warning(f"[cross-encoder] Reranking failed ({e}) — falling back to LLM rerank")
            raw_texts = [d.page_content for d in all_docs]
            reranked_texts = llm_rerank(rewritten_query, raw_texts, top_k=top_k)
            text_to_doc = {d.page_content: d for d in all_docs}
            docs = [text_to_doc[t] for t in reranked_texts if t in text_to_doc]
    else:
        raw_texts = [d.page_content for d in all_docs]
        reranked_texts = llm_rerank(rewritten_query, raw_texts, top_k=top_k)
        text_to_doc = {d.page_content: d for d in all_docs}
        docs = [text_to_doc[t] for t in reranked_texts if t in text_to_doc]

    return docs, rewritten_query


# ── Document loading ───────────────────────────────────────────────────────────
async def load_url(file, file_path, user_id, session_id, max_pages, doc_id=None):
    from services.scraper_service import scrape_url, scrape_website

    if not file_path.startswith(("http://", "https://")):
        file_path = "https://" + file_path
    logger.info(f"🌐 Detected URL: {file_path}")
    try:
        documents = (
            scrape_url(file_path, doc_id=doc_id)
            if max_pages == 1
            else scrape_website(file_path, max_pages, max_workers=7, doc_id=doc_id)
        )
        return await process_document(
            documents=documents,
            file=file,
            file_path=file_path,
            user_id=user_id,
            session_id=session_id,
            max_pages=max_pages,
            doc_id=doc_id,
        )
    except Exception as e:
        logger.error(f"❌ Failed to scrape URL: {e}")
        return {"success": False, "error": str(e), "chunks": 0}


async def load_document(file, file_path, user_id, session_id, max_pages, doc_id=None):
    if file and file.filename.endswith(".pdf"):
        logger.info(f"📄 Detected PDF file: {file.filename}")
        documents = PyPDFLoader(file_path).load()
    elif file and file.filename.endswith((".txt", ".md")):
        logger.info(f"📝 Detected text file: {file.filename}")
        documents = TextLoader(file_path, encoding="utf-8").load()
    elif file and file.filename.endswith(".docx"):
        logger.info(f"📑 Detected Word file: {file.filename}")
        documents = Docx2txtLoader(file_path).load()
    else:
        logger.warning(f"⚠️  Unsupported file type or invalid URL: {file_path}")
        return {"success": False, "error": "Unsupported file type or invalid URL", "chunks": 0}

    return await process_document(
        documents=documents,
        file=file,
        file_path=file_path,
        user_id=user_id,
        session_id=session_id,
        max_pages=max_pages,
        doc_id=doc_id,
    )


async def process_document(documents, file, file_path, user_id, session_id, max_pages, doc_id=None):
    clean_session_id = session_id.replace("session_", "").replace("session-", "")

    VECTOR_PATH = os.path.join(
        os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean_session_id}"
    )
    os.makedirs(VECTOR_PATH, exist_ok=True)
    logger.info(f"📁 Vector store path: {VECTOR_PATH}")

    faiss_index_path = os.path.join(VECTOR_PATH, "index.faiss")
    start_time = time.time()

    try:
        source_name = file_path if file is None else file.filename
        logger.info(f"Entered process_document function: {source_name}")

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled early", "chunks": 0}

        if not documents:
            return {"success": False, "error": "No content extracted", "chunks": 0}

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled after load", "chunks": 0}

        # Metadata
        for doc in documents:
            doc.metadata.update({
                "source":      source_name,
                "upload_time": str(datetime.now()),
                "doc_id":      doc_id if doc_id else str(uuid.uuid4()),
                "user_id":     user_id,
                "session_id":  clean_session_id,
            })

        # Chunking
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            separators=["\n\n", "\n", ".", " ", ""],
        )

        chunks = []
        for doc in documents:
            if is_cancelled(doc_id):
                return {"success": False, "error": "Cancelled during chunking", "chunks": 0}
            chunks.extend(splitter.split_documents([doc]))

        logger.info(f"✂️ Split into {len(chunks)} chunks")

        if not chunks:
            return {"success": False, "error": "No chunks created", "chunks": 0}

        # Embeddings — batched and interruptible
        embeddings = get_embeddings()

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled before embeddings", "chunks": 0}

        BATCH_SIZE = 32
        all_batches = [chunks[i:i + BATCH_SIZE] for i in range(0, len(chunks), BATCH_SIZE)]

        db = load_faiss_cached(VECTOR_PATH, embeddings) if os.path.exists(faiss_index_path) else None

        for i, batch in enumerate(all_batches):
            if is_cancelled(doc_id):
                return {"success": False, "error": "Cancelled during embeddings", "chunks": 0}
            if db is None:
                db = FAISS.from_documents(batch, embeddings)
            else:
                db.add_documents(batch)
            logger.info(f"✅ Processed batch {i + 1}/{len(all_batches)}")

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled before saving", "chunks": 0}

        db.save_local(VECTOR_PATH)
        logger.info("💾 Vector store saved")
        logger.info(f"⏱️  Total processing time: {time.time() - start_time:.2f}s")

        return {
            "success":      True,
            "chunks":       len(chunks),
            "vector_store": VECTOR_PATH,
            "session_id":   clean_session_id,
        }

    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return {"success": False, "error": str(e), "chunks": 0}


# ── Vector store helpers ───────────────────────────────────────────────────────
def get_vector_store(user_id: int, session_id: str):
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH = os.path.join(
        os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean_session_id}"
    )
    faiss_index_path = os.path.join(VECTOR_PATH, "index.faiss")

    if not os.path.exists(faiss_index_path):
        logger.warning(f"⚠️  No vector store found at {faiss_index_path}")
        return None

    try:
        logger.info(f"📂 Loading vector store from {VECTOR_PATH}")
        db = load_faiss_cached(VECTOR_PATH, get_embeddings())
        logger.info("✅ Vector store loaded successfully")
        return db
    except Exception as e:
        logger.error(f"❌ Failed to load vector store: {e}")
        return None


def search_documents(user_id: int, session_id: str, query: str, k: int = 6):
    """
    Search for relevant documents using MMR multi-query + LLM reranking.
    """
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    db = get_vector_store(user_id, clean_session_id)

    if db is None:
        logger.warning(f"⚠️  No vector store for user {user_id}, session {clean_session_id}")
        return []

    try:
        logger.info(f"🔍 Searching: {query[:50]}...")
        docs, _ = retrieve_with_llm_rerank(db, query, top_k=k)
        logger.info(f"✅ Found {len(docs)} results after LLM reranking")
        return [
            {"content": doc.page_content, "metadata": doc.metadata, "score": 0.0}
            for doc in docs
        ]
    except Exception as e:
        logger.error(f"❌ Search failed: {e}")
        return []


def delete_session_vectors(user_id: int, session_id: str):
    import shutil

    clean_id = session_id.replace("session_", "").replace("session-", "")

    base_path    = os.path.join(os.getcwd(), "vector_store", f"user_{user_id}")
    session_path = os.path.join(base_path, f"session_{clean_id}")
    memory_path  = os.path.join(base_path, f"session_{clean_id}_memory")

    if not os.path.exists(session_path):
        logger.warning(f"⚠️  Vector store not found: {session_path}")
        return False

    try:
        shutil.rmtree(session_path)
        logger.info(f"🗑️  Deleted vector store: {session_path}")

        if os.path.exists(memory_path):
            shutil.rmtree(memory_path)
            logger.info(f"🗑️  Deleted memory store: {memory_path}")

        # Remove the parent user folder if it's now empty
        if os.path.exists(base_path) and not os.listdir(base_path):
            shutil.rmtree(base_path)
            logger.info(f"🗑️  Deleted empty user folder: {base_path}")

        return True

    except Exception as e:
        logger.error(f"❌ Failed to delete vector store: {e}")
        return False

def delete_document_from_index(user_id, session_id, doc_id_to_delete):
    embeddings = get_embeddings()
    VECTOR_PATH = f"vector_store/user_{user_id}/session_{session_id}"

    db = FAISS.load_local(VECTOR_PATH, embeddings, allow_dangerous_deserialization=True)

    chunks_to_remove = [
        id for id, doc in db.docstore._dict.items()
        if doc.metadata.get("doc_id") == doc_id_to_delete
    ]

    if chunks_to_remove:
        db.delete(chunks_to_remove)
        db.save_local(VECTOR_PATH)
        _faiss_cache.pop(VECTOR_PATH, None)
        logger.info(f"🗑️ Removed {len(chunks_to_remove)} chunks for doc {doc_id_to_delete}")
    else:
        logger.warning("No chunks found for this doc_id.")
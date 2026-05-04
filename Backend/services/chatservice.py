from datetime import datetime
import os
import time
import logging
import traceback
from pathlib import Path
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_openai import OpenAIEmbeddings
from database import messages_collection
from langchain_core.documents import Document

# ── Model config from environment ─────────────────────────────────────────────
# ── [SERVER] Gemma 4 via Ollama — uncomment when server is available ──────────
# LLM_MODEL        = os.getenv("LLM_MODEL", "gemma4:26b")
# LLM_BASE_URL     = os.getenv("OPENAI_BASE_URL", "http://192.168.130.177:11434/v1")
# LLM_API_KEY      = os.getenv("OPENAI_API_KEY", "not-needed")
# LLM_TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0.1"))
# LLM_MAX_TOKENS   = int(os.getenv("LLM_MAX_TOKENS", "2048"))
# ── [SERVER] BGE-M3 embeddings — uncomment when server is available ───────────
# EMBEDDINGS_BASE_URL = os.getenv("EMBEDDINGS_BASE_URL", "http://192.168.130.177:8081/v1")
# EMBEDDINGS_MODEL    = os.getenv("EMBEDDINGS_MODEL", "BAAI/bge-m3")
# EMBEDDINGS_API_KEY  = os.getenv("EMBEDDINGS_API_KEY", "not-needed")

# ── Active config: Mistral (gen) + HuggingFace (embeddings) ──────────────────
LLM_TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS   = int(os.getenv("LLM_MAX_TOKENS", "2048"))

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()





# ─────────────────────────────────────────────────────────────
# Cached singletons — initialized once, reused forever
# ─────────────────────────────────────────────────────────────

_embeddings = None
def get_embeddings():
    """HuggingFace all-MiniLM-L6-v2 embeddings (local).
    [SERVER] To switch back to remote BGE-M3, uncomment the block below
    and remove/comment the HuggingFaceEmbeddings block.
    """
    global _embeddings
    if _embeddings is None:
        # ── [SERVER] Remote BGE-M3 via OpenAI-compatible API ─────────────────
        # try:
        #     emb = OpenAIEmbeddings(
        #         model=EMBEDDINGS_MODEL,
        #         base_url=EMBEDDINGS_BASE_URL,
        #         api_key=EMBEDDINGS_API_KEY or "not-needed",
        #     )
        #     emb.embed_query("test")  # smoke-test
        #     _embeddings = emb
        #     logger.info(f"Remote BGE-M3 embeddings loaded @ {EMBEDDINGS_BASE_URL}")
        # except Exception as e:
        #     logger.warning(f"Remote embeddings failed ({e}), falling back to HuggingFace")
        # ─────────────────────────────────────────────────────────────────────
        _embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-base-en-v1.5",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )
        logger.info("HuggingFace BAAI/bge-base-en-v1.5 embeddings loaded (1024 dims)")
    return _embeddings

# Cache loaded indexes in memory
_faiss_cache: dict = {}

def load_faiss_cached(path, embeddings):
    if path not in _faiss_cache:
        _faiss_cache[path] = FAISS.load_local(path, embeddings, allow_dangerous_deserialization=True)
    logger.info(f"FAISS index loaded and cached from {path}")
    return _faiss_cache[path]

# ── [SERVER] Primary: local Gemma 4 via Ollama — uncomment when server is available ──
# _ollama_client = None
# def load_ollama():
#     global _ollama_client
#     if _ollama_client is None:
#         from langchain_openai import ChatOpenAI
#         _ollama_client = ChatOpenAI(
#             model=LLM_MODEL,
#             base_url=LLM_BASE_URL,
#             api_key=LLM_API_KEY,
#             temperature=LLM_TEMPERATURE,
#             max_tokens=LLM_MAX_TOKENS,
#         )
#     logger.info(f"Ollama model loaded and cached ({LLM_MODEL} @ {LLM_BASE_URL})")
#     return _ollama_client

# ── Active primary: Mistral ───────────────────────────────────────────────────
_mistral_client = None
def load_mistral():
    global _mistral_client
    if _mistral_client is None:
        from langchain_mistralai import ChatMistralAI
        _mistral_client = ChatMistralAI(
            model="mistral-small-latest",
            mistral_api_key=os.getenv("MISTRAL_API_KEY", ""),
            temperature=0.2,
        )
    logger.info("Mistral model loaded and cached")
    return _mistral_client

# ─────────────────────────────────────────────────────────────
# Langfuse  — initialised once at module load
# ─────────────────────────────────────────────────────────────

def _init_langfuse():
    pk = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    sk = os.getenv("LANGFUSE_SECRET_KEY", "")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    logger.info(f"[langfuse] PUBLIC_KEY present: {bool(pk)} | SECRET_KEY present: {bool(sk)} | HOST: {host}")
    if not pk or not sk:
        logger.warning("[langfuse] ❌ Keys not set — tracing disabled. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in .env")
        return None
    try:
        from langfuse import Langfuse
        lf = Langfuse(public_key=pk, secret_key=sk, host=host)
        # Auth check — will throw if keys are wrong
        lf.auth_check()
        logger.info(f"[langfuse] ✅ Connected and authenticated to {host}")
        return lf
    except Exception as e:
        logger.error(f"[langfuse] ❌ Init/auth failed: {e}")
        return None

_langfuse = _init_langfuse()
logger.info(f"[langfuse] Module-level _langfuse = {_langfuse}")


# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
def get_vector_path(user_id: str, session_id: str):
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )

def get_memory_path(user_id: str, session_id: str):
    clean = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean}_memory")



# ─────────────────────────────────────────────────────────────
# Conversation Vector Memory
# ─────────────────────────────────────────────────────────────

def save_exchange_to_memory(user_id: str, session_id: str, question: str, answer: str):
    MEMORY_PATH = get_memory_path(user_id, session_id)
    os.makedirs(MEMORY_PATH, exist_ok=True)

    exchange_text = f"User: {question}\nAssistant: {answer}"
    doc = Document(
        page_content=exchange_text,
        metadata={
            "session_id": session_id,
            "timestamp": str(datetime.now()),
            "type": "conversation_exchange"
        }
    )

    embeddings = get_embeddings()
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")

    try:
        if os.path.exists(faiss_index_path):
            memory_db = load_faiss_cached(MEMORY_PATH, embeddings)
            memory_db.add_documents([doc])
        else:
            memory_db = FAISS.from_documents([doc], embeddings)
        memory_db.save_local(MEMORY_PATH)
        logger.info(f"Exchange saved to memory index at {MEMORY_PATH}")
    except Exception as e:
        logger.error(f"Failed to save exchange to memory: {e}")


def retrieve_relevant_history(user_id: str, session_id: str, question: str, k: int = 4):
    MEMORY_PATH = get_memory_path(user_id, session_id)
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")

    if not os.path.exists(faiss_index_path):
        return ""

    try:
        embeddings = get_embeddings()
        memory_db = load_faiss_cached(MEMORY_PATH, embeddings)
        
        # Check dimension match before searching
        query_dim = len(embeddings.embed_query("test"))
        if memory_db.index.d != query_dim:
            logger.warning(f"Dimension mismatch ({memory_db.index.d} vs {query_dim}) — deleting stale memory index")
            import shutil
            shutil.rmtree(MEMORY_PATH)
            _faiss_cache.pop(MEMORY_PATH, None)
            return ""
        
        results = memory_db.similarity_search(question, k=k)
        if not results:
            return ""
        return "\n\n".join([doc.page_content for doc in results])
    except Exception as e:
        logger.error(f"Failed to retrieve from memory: {e}")
        logger.error(traceback.format_exc())
        return ""

async def fetch_full_history(memory_session_id: str) -> str:
    from database import messages_collection
    recent_msgs = list(messages_collection.find(
        {"session_id": memory_session_id},
        sort=[("timestamp", 1)],
        limit=10
    ))
    return "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in recent_msgs
    )

# ─────────────────────────────────────────────────────────────
# MongoDB message saving
# ─────────────────────────────────────────────────────────────

def save_message(session_id: str, user_id, role: str, content: str):
    messages_collection.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow()
    })

def save_widget_message(bot_id, session_id, question, answer, response_time_ms, docs):
    from database import mongodb
    col = mongodb["widget_messages"]

    col.insert_one({
        "bot_id": bot_id,
        "session_id": session_id,
        "question": question,
        "answer": answer,
        "created_at": datetime.utcnow(),
        "response_time_ms": response_time_ms,
        "source_docs": [doc.metadata.get("source", "Unknown") for doc in docs],
    })


# ─────────────────────────────────────────────────────────────
# Generate Answer helpers
# ─────────────────────────────────────────────────────────────

# ── [SERVER] generate_with_ollama — uncomment when Gemma/Ollama server is available ──
# def generate_with_ollama(system_prompt: str, question: str) -> str:
#     llm = load_ollama()
#     return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def generate_with_mistral(system_prompt: str, question: str) -> str:
    llm = load_mistral()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

# ─────────────────────────────────────────────────────────────
# Timeout handler — tries models in order
# ─────────────────────────────────────────────────────────────

def handle_timeout(system_prompt: str, question: str):
    models = [
        # ── [SERVER] Gemma 4 via Ollama — uncomment when server is available ──
        # (LLM_MODEL, generate_with_ollama),
        ("mistral-small-latest", generate_with_mistral),  # primary (active)
    ]
    for model_name, fn in models:
        try:
            logger.info(f"Attempting generation with {model_name}...")
            answer = fn(system_prompt, question)
            if answer:
                logger.info(f"Generated with {model_name}")
                return answer,model_name
        except Exception as e:
            logger.error(f"Failed with {model_name}: {e}")
            continue
    logger.error("All fallback models failed")
    return ("Sorry, I'm having trouble generating a response right now. Please try again later.", "none")


# ─────────────────────────────────────────────────────────────
# Query Reformulation
# ─────────────────────────────────────────────────────────────

def reformulate_query(question: str) -> str:
    logger.info("Reformulating query for better retrieval...")
    reformulation_prompt = f"""You are a search query optimizer for a RAG system.
Your job is to reformulate the user's question to improve document retrieval.

Rules:
- Keep proper nouns, company names, and specific terms EXACTLY as written
- Do not replace or interpret unknown words — they may be company or product names
- Only expand the query with synonyms for common words
- Keep the reformulated query concise

Original question: {question}
Reformulated question (keep proper nouns unchanged):"""
    result,model = handle_timeout(reformulation_prompt, question)
    response = result[0] if isinstance(result, tuple) else result
    logger.info(f"Query reformulated: {response[:80]}")
    return response.strip()


# ─────────────────────────────────────────────────────────────
# Main RAG + Memory + Langfuse tracing
# ─────────────────────────────────────────────────────────────

def generate_answer(question: str, user_id: str, session_id: str, memory_session_id: str):
    """Full RAG pipeline with Langfuse v4 tracing."""
    logger.info(f"Generating answer for: {question[:60]}...")
    logger.info(f"[langfuse] _langfuse instance at call time: {_langfuse}")

    t_total_start = time.time()
    memory_session_id = memory_session_id or session_id
    clean_session_id  = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH       = get_vector_path(user_id, clean_session_id)
    logger.warning(f"VECTOR_PATH: '{VECTOR_PATH}'  exists={os.path.exists(VECTOR_PATH)}")

    # ── create trace id upfront ───────────────────────────────
    trace_id = None
    if _langfuse:
        try:
            from langfuse import Langfuse as _LF
            trace_id = _LF.create_trace_id()
            logger.info(f"[langfuse] ✅ trace_id={trace_id}")
        except Exception as e:
            logger.error(f"[langfuse] ❌ create_trace_id failed: {e}")

    if not os.path.exists(VECTOR_PATH):
        logger.warning("No documents indexed yet")
        return {"answer": "No documents indexed yet. Please upload documents first.", "sources": [], "trace_id": trace_id}

    try:
        # ── 1. Retrieve ───────────────────────────────────────
        t_ret_start = time.time()
        embeddings  = get_embeddings()
        reformulated = question  #no reformulation for now, as it can cause issues and latency
        db           = load_faiss_cached(VECTOR_PATH, embeddings)
        docs_with_scores = db.similarity_search_with_score(reformulated, k=4)
        docs             = [doc for doc, score in docs_with_scores]
        retrieval_lat    = round(time.time() - t_ret_start, 3)

        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": [], "trace_id": trace_id}

        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"Retrieved {len(docs)} chunks in {retrieval_lat}s")

        # ── 2. Memory ─────────────────────────────────────────
        relevant_history = retrieve_relevant_history(user_id, memory_session_id, question, k=4)

        # ── 3. System prompt ──────────────────────────────────
        history_block = f"\n\nRelevant conversation history:\n{relevant_history}" if relevant_history else ""
        system_prompt = f"""You are a helpful assistant.
- Answer the question based on the provided context.
- Answer to greetings.

- Be clear and concise.
- If the context contains relevant information, use it fully even if partial or implicit
- If information is genuinely not present in the context, say so clearly
- Answer in the same language as the question
- If the context contains no relevant information at all, respond ONLY with the exact phrase: "I don't have enough information to answer this." Do not paraphrase or add anything else.
Context:
{context}{history_block}
"""


        # ── 4. Generate ───────────────────────────────────────
        t_gen_start   = time.time()
        answer, model = handle_timeout(system_prompt, question)
        gen_lat       = round(time.time() - t_gen_start, 3)
        response_time_ms = int(gen_lat * 1000)

        total_lat     = round(time.time() - t_total_start, 3)
        logger.info(f"Answer generated in {gen_lat}s (total {total_lat}s) via {model}")

        #save without blocking
        # ALWAYS SAVE (independent of Langfuse)
        import threading

        def _save_all():
            try:
                save_exchange_to_memory(user_id, memory_session_id, question, answer)

                # Use memory_session_id (the widget's chat session) so that
                # _fetch_chat_history can find both user and assistant messages
                # by the session_id stored on the intervention ticket.
                save_message(memory_session_id, user_id, "user", question)
                save_message(memory_session_id, user_id, "assistant", answer)

                save_widget_message(
                    bot_id=user_id,
                    session_id=memory_session_id,
                    question=question,
                    answer=answer,
                    response_time_ms=int(gen_lat * 1000),
                    docs=docs,
                )
            except Exception as e:
                logger.error(f"Background save failed: {e}")

        threading.Thread(target=_save_all, daemon=True).start()

        # ── 5. Langfuse v4 tracing ────────────────────────────
        if _langfuse and trace_id:
            try:
                from langfuse.types import TraceContext
                ctx = TraceContext(trace_id=trace_id)

                # root trace span
                with _langfuse.start_as_current_observation(
                    trace_context=ctx,
                    name="rag-query",
                    as_type="span",
                    input=question,
                    output=answer,
                    metadata={
                        "user_id":    str(user_id),
                        "session_id": session_id,
                        "total_lat":  total_lat,
                        "timestamp":  datetime.utcnow().isoformat(),
                    },
                ):
                    # retrieval child
                    with _langfuse.start_as_current_observation(
                        name="retrieval",
                        as_type="retriever",
                        input={"original_query": question, "reformulated_query": reformulated},
                        output={"chunks_retrieved": len(docs), "context_preview": context[:300]},
                        metadata={"top_k": 6, "latency_s": retrieval_lat},
                    ):
                        pass

                    # generation child
                    with _langfuse.start_as_current_observation(
                        name="llm-generation",
                        as_type="generation",
                        input=question,
                        output=answer,
                        model=model,
                        metadata={"latency_s": gen_lat, "context_chars": len(context), "used_memory": bool(relevant_history)},
                    ):
                        pass

                _langfuse.set_current_trace_io(input=question, output=answer)
                _langfuse.create_score(
                    trace_id=trace_id,
                    name="latency_s",
                    value=total_lat,
                    comment="Total end-to-end RAG latency",
                )
                import threading

                def _flush_langfuse():
                    try:
                        _langfuse.flush()
                    except:
                        pass

                threading.Thread(target=_flush_langfuse, daemon=True).start()
                logger.info(f"[langfuse] ✅ Flushed trace_id={trace_id}")
            except Exception as e:
                logger.error(f"[langfuse] ❌ Tracing failed: {e}")
                import traceback as _tb; logger.error(_tb.format_exc())

       


        # ── 7. Sources ────────────────────────────────────────
        def score_to_confidence(score: float) -> int:
            if score < 0.5:   return min(100, round(100 - score * 20))
            elif score < 1.0: return round(90 - (score - 0.5) * 40)
            elif score < 1.5: return round(70 - (score - 1.0) * 60)
            else:             return max(0, round(40 - (score - 1.5) * 80))

        sources = []
        for doc, score in docs_with_scores:
            sources.append({
                "source":          doc.metadata.get("source", "Unknown"),
                "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
                "confidence":      score_to_confidence(score),
                "score":           round(float(score), 4),
            })
        sources.sort(key=lambda x: x["confidence"], reverse=True)
        seen = {}
        for s in sources:
            n = s["source"]
            if n not in seen or s["confidence"] > seen[n]["confidence"]:
                seen[n] = s
        sources = list(seen.values())

        logger.info(f"[langfuse] Returning trace_id={trace_id}")
        return {"answer": answer, "sources": sources, "trace_id": trace_id}

    except Exception as e:
        logger.error(f"Error generating answer: {e}")
        logger.error(traceback.format_exc())
        if _langfuse:
            try: 
                import threading

                def _flush_langfuse():
                    try:
                        _langfuse.flush()
                    except:
                        pass

                threading.Thread(target=_flush_langfuse, daemon=True).start()
            except Exception: pass
        return {"answer": f"An error occurred: {str(e)}", "sources": [], "trace_id": trace_id}



# ─────────────────────────────────────────────────────────────
# Streaming RAG pipeline
# ─────────────────────────────────────────────────────────────

from sentence_transformers import CrossEncoder

_reranker = None
def get_reranker():
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return _reranker

def rerank(query, docs, top_n=3):
    # Stage 1: Semantic reranking (beats keyword filtering)
    embeddings = get_embeddings()
    query_embedding = embeddings.embed_query(query)
    
    import numpy as np
    def cosine_sim(a, b):
        a, b = np.array(a), np.array(b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    
    doc_embeddings = embeddings.embed_documents([doc.page_content for doc in docs])
    semantic_scores = [cosine_sim(query_embedding, de) for de in doc_embeddings]
    semantic_ranked = sorted(zip(docs, semantic_scores), key=lambda x: x[1], reverse=True)
    semantic_top = [doc for doc, _ in semantic_ranked[:6]]

    # Stage 2: Cross-encoder precision reranking
    reranker = get_reranker()
    pairs = [(query, doc.page_content) for doc in semantic_top]
    cross_scores = reranker.predict(pairs)
    cross_ranked = sorted(zip(semantic_top, cross_scores), key=lambda x: x[1], reverse=True)
    
    return [doc for doc, _ in cross_ranked[:top_n]]

async def generate_answer_stream(question: str, user_id: str, session_id: str, memory_session_id: str):
    import asyncio
    import json
    import time

    memory_session_id = memory_session_id or session_id
    clean_session_id  = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH       = get_vector_path(user_id, clean_session_id)

    # ── create trace id upfront ───────────────────────────────
    trace_id = None
    if _langfuse:
        try:
            from langfuse import Langfuse as _LF
            trace_id = _LF.create_trace_id()
            logger.info(f"[langfuse] ✅ Stream trace_id={trace_id}")
        except Exception as e:
            logger.error(f"[langfuse] ❌ create_trace_id failed: {e}")

    if not os.path.exists(VECTOR_PATH):
        yield "No documents indexed yet. Please upload documents first."
        return

    try:
        t_total_start = time.time()

        # ── 1. Retrieve + memory in parallel ─────────────────────────────────
        embeddings = get_embeddings()
        db         = load_faiss_cached(VECTOR_PATH, embeddings)

        t_ret_start = time.time()
        # Step 1: fetch history first
        relevant_history = await fetch_full_history(memory_session_id)

        # Step 2: rewrite query if needed
        ambiguity_check_prompt = f"""Conversation history:
        {relevant_history}

        Question: {question}

        Does this question contain ambiguous references (pronouns, "it", "this", etc.) that refer to something mentioned in the conversation history? If yes, rewrite it as a standalone question. If no, return the question unchanged.
        Return ONLY the rewritten or unchanged question, nothing else."""

        retrieval_query = generate_with_mistral(ambiguity_check_prompt, "").strip() if relevant_history else question
        logger.info(f"Rewrote query: '{question}' → '{retrieval_query}'")

        # Step 3: retrieve docs with rewritten query
        docs_with_scores = await asyncio.to_thread(db.similarity_search_with_score, retrieval_query, k=12)
        retrieval_lat = round(time.time() - t_ret_start, 3)

        docs = [doc for doc, _ in docs_with_scores]
        
        seen = set()
        unique_docs = []
        for doc in docs:
            if doc.page_content not in seen:
                seen.add(doc.page_content)
                unique_docs.append(doc)
        docs = unique_docs

        t_rerank_start = time.time()

        # Stage 1: semantic
        embeddings = get_embeddings()
        import numpy as np
        query_embedding = embeddings.embed_query(question)
        def cosine_sim(a, b):
            a, b = np.array(a), np.array(b)
            return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
        doc_embeddings = embeddings.embed_documents([doc.page_content for doc in docs])
        semantic_scores = [cosine_sim(query_embedding, de) for de in doc_embeddings]
        semantic_ranked = sorted(zip(docs, semantic_scores), key=lambda x: x[1], reverse=True)
        semantic_top = [doc for doc, score in semantic_ranked[:6]]
        semantic_log = [{"content": doc.page_content[:80], "semantic_score": round(score, 4)} for doc, score in semantic_ranked[:6]]

        # Stage 2: cross-encoder
        reranker = get_reranker()
        pairs = [(question, doc.page_content) for doc in semantic_top]
        cross_scores = reranker.predict(pairs)
        cross_ranked = sorted(zip(semantic_top, cross_scores), key=lambda x: x[1], reverse=True)
        cross_log = [{"content": doc.page_content[:80], "cross_score": round(float(score), 4)} for doc, score in cross_ranked]
        docs = [doc for doc, _ in cross_ranked[:3]]

        rerank_lat = round(time.time() - t_rerank_start, 3)


        if not docs:
            yield "I couldn't find any relevant information in the documents."
            return

        context       = "\n\n".join(doc.page_content for doc in docs)
        history_block = f"\n\nConversation history:\n{relevant_history}" if relevant_history else ""
        system_prompt =f"""You are a helpful assistant.

Rules:
- Answer the question based ONLY on the provided context.
- Be clear and concise.
- Answer in the same language as the question.
- Answer to greetings.

Grounding rules:
- Use ONLY the information present in the context.
- Do NOT use prior knowledge or guess.
- Use the conversation history to resolve what "it", "he", "she", "they" refer to before answering.
- If the answer is present in the context, you MUST extract it, even if the text is unstructured, partial, or implicit.
- If the context contains values (prices, dates, numbers), use them EXACTLY as written.
- If multiple possible answers exist, choose the one most relevant to the question.
- If the question is ambiguous or missing key details, ask a short clarifying question.
- If the question is clear but the answer is not present in the context, say EXACTLY: "I don't have enough information to answer this."

Formatting rules:
- If the answer contains comparative or structured data (prices, features, lists), use a Markdown table (| columns |).
- If the question asks for a summary, structure the answer with short headings (## Title).
- Otherwise, respond in concise prose.
- Do not add any information that is not present in the context.


Context:
{context}{history_block}"""

        # ── 2. Stream generation ──────────────────────────────────────────────
        # ── [SERVER] Gemma 4 streaming via Ollama — uncomment when server is available ──
        # from langchain_openai import ChatOpenAI
        # llm = ChatOpenAI(
        #     model=LLM_MODEL,
        #     base_url=LLM_BASE_URL,
        #     api_key=LLM_API_KEY,
        #     temperature=LLM_TEMPERATURE,
        #     max_tokens=LLM_MAX_TOKENS,
        #     streaming=True,
        # )
        from langchain_mistralai import ChatMistralAI
        llm = ChatMistralAI(
            model="mistral-small-latest",
            mistral_api_key=os.getenv("MISTRAL_API_KEY", ""),
            temperature=LLM_TEMPERATURE,
            max_tokens=LLM_MAX_TOKENS,
        )

        full_answer = ""
        t_gen_start = time.time()
        async for chunk in llm.astream(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"):
            token = chunk.content
            if token:
                full_answer += token
                yield token
        gen_lat   = round(time.time() - t_gen_start, 3)
        total_lat = round(time.time() - t_total_start, 3)

        # ── 3. Langfuse tracing ───────────────────────────────────────────────
        if _langfuse and trace_id:
            try:
                from langfuse.types import TraceContext
                ctx = TraceContext(trace_id=trace_id)

                with _langfuse.start_as_current_observation(
                    trace_context=ctx,
                    name="rag-stream",
                    as_type="span",
                    input=question,
                    output=full_answer,
                    metadata={
                        "user_id":    str(user_id),
                        "session_id": session_id,
                        "total_lat":  total_lat,
                        "timestamp":  datetime.utcnow().isoformat(),
                    },
                ):
                    with _langfuse.start_as_current_observation(
                        name="query-rewrite",
                        as_type="span",
                        input={"original_query": question, "history": relevant_history},
                        output={"rewritten_query": retrieval_query},
                        metadata={"rewritten": retrieval_query != question},
                    ):
                        pass
                    with _langfuse.start_as_current_observation(
                        name="retrieval",
                        as_type="retriever",
                        input={"query": question},
                        output={"chunks_retrieved": len(docs), "context_preview": context[:300]},
                        metadata={"top_k": 4, "latency_s": retrieval_lat},
                    ):
                        pass
                    with _langfuse.start_as_current_observation(
                        name="reranking",
                        as_type="span",
                        input={
                            "query": question,
                            "candidates": [doc.page_content[:80] for doc in unique_docs]
                        },
                        output={
                            "stage1_semantic": semantic_log,
                            "stage2_cross_encoder": cross_log,
                            "final_top3": [doc.page_content[:80] for doc in docs]
                        },
                        metadata={"latency_s": rerank_lat},
                    ):
                        pass
                    with _langfuse.start_as_current_observation(
                        name="llm-generation",
                        as_type="generation",
                        input=question,
                        output=full_answer,
                        model="mistral-small-latest",
                        metadata={"latency_s": gen_lat, "context_chars": len(context), "used_memory": bool(relevant_history)},
                    ):
                        pass

                _langfuse.set_current_trace_io(input=question, output=full_answer)
                _langfuse.create_score(
                    trace_id=trace_id,
                    name="latency_s",
                    value=total_lat,
                    comment="Total end-to-end streaming RAG latency",
                )

                import threading
                def _flush_langfuse():
                    try: _langfuse.flush()
                    except: pass
                threading.Thread(target=_flush_langfuse, daemon=True).start()
                logger.info(f"[langfuse] ✅ Stream trace flushed trace_id={trace_id}")

            except Exception as e:
                logger.error(f"[langfuse] ❌ Stream tracing failed: {e}")
                import traceback as _tb; logger.error(_tb.format_exc())

        # ── 4. Build sources metadata ─────────────────────────────────────────
        def score_to_confidence(score: float) -> int:
            if score < 0.5:   return min(100, round(100 - score * 20))
            elif score < 1.0: return round(90 - (score - 0.5) * 40)
            elif score < 1.5: return round(70 - (score - 1.0) * 60)
            else:             return max(0, round(40 - (score - 1.5) * 80))

        seen = {}
        for doc, score in docs_with_scores:
            s = {
                "source":          doc.metadata.get("source", "Unknown"),
                "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
                "confidence":      score_to_confidence(score),
                "score":           round(float(score), 4),
            }
            n = s["source"]
            if n not in seen or s["confidence"] > seen[n]["confidence"]:
                seen[n] = s
        sources = sorted(seen.values(), key=lambda x: x["confidence"], reverse=True)

        yield f"__SOURCES__:{json.dumps(sources)}"

        # ── 5. Save in background ─────────────────────────────────────────────
        import threading
        def _save_all():
            try:
                save_exchange_to_memory(user_id, memory_session_id, question, full_answer)
                save_message(memory_session_id, user_id, "user", question)
                save_message(memory_session_id, user_id, "assistant", full_answer)
                save_widget_message(
                    bot_id=user_id,
                    session_id=memory_session_id,
                    question=question,
                    answer=full_answer,
                    response_time_ms=int(gen_lat * 1000),
                    docs=docs,
                )
            except Exception as e:
                logger.error(f"Background save failed: {e}")
        threading.Thread(target=_save_all, daemon=True).start()

    except Exception as e:
        import traceback
        logger.error(f"Streaming error: {e}")
        logger.error(traceback.format_exc())
        yield f"An error occurred: {str(e)}"

def log_user_feedback(trace_id: str, thumbs_up: bool, comment: str = ""):
    if not _langfuse or not trace_id:
        return
    try:
        _langfuse.create_score(
            trace_id=trace_id,
            name="user_feedback",
            value=1.0 if thumbs_up else 0.0,
            comment=comment or ("positive" if thumbs_up else "negative"),
        )
        import threading

        def _flush_langfuse():
            try:
                _langfuse.flush()
            except:
                pass

        threading.Thread(target=_flush_langfuse, daemon=True).start()

        logger.info(f"[langfuse] Feedback logged for trace {trace_id}")
    except Exception as e:
        logger.warning(f"[langfuse] Failed to log feedback: {e}")
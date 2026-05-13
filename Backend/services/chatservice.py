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
import asyncio
from langchain_mistralai import ChatMistralAI
import threading
import json
from services.rag_services import get_embeddings, retrieve_with_llm_rerank, generate_queries


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
LLM_TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0"))
LLM_MAX_TOKENS   = int(os.getenv("LLM_MAX_TOKENS", "2048"))

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()


# ── RAG constants (tuned from eval notebook) ──────────────────────────────────
LLM_TEMPERATURE = 0.0   # Exp 6 winner
LLM_MAX_TOKENS  = 2048
FETCH_K         = 20    # Exp 7 winner
LAMBDA_MULT     = 0.7   # Exp 7 winner
N_QUERIES       = 2     # Exp 11 winner


# ─────────────────────────────────────────────────────────────
# Cached singletons — initialized once, reused forever
# ─────────────────────────────────────────────────────────────


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
            temperature=LLM_TEMPERATURE,
        )
    logger.info("Mistral model loaded and cached")
    return _mistral_client

# ─────────────────────────────────────────────────────────────
# Langfuse  — initialised once at module load
# ─────────────────────────────────────────────────────────────
def _init_langfuse():
    pk   = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    sk   = os.getenv("LANGFUSE_SECRET_KEY", "")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    logger.info(f"[langfuse] PUBLIC_KEY present: {bool(pk)} | SECRET_KEY present: {bool(sk)} | HOST: {host}")
    if not pk or not sk:
        logger.warning("[langfuse] ❌ Keys not set — tracing disabled.")
        return None
    try:
        from langfuse import Langfuse
        lf = Langfuse(public_key=pk, secret_key=sk, host=host)
        lf.auth_check()
        logger.info(f"[langfuse] ✅ Connected to {host}")
        return lf
    except Exception as e:
        logger.error(f"[langfuse] ❌ Init/auth failed: {e}")
        return None
 
_langfuse = _init_langfuse()
logger.info(f"[langfuse] Module-level _langfuse = {_langfuse}")
 
 
# ── Paths ──────────────────────────────────────────────────────────────────────
def get_vector_path(user_id: str, session_id: str):
    clean = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean}")
 
def get_memory_path(user_id: str, session_id: str):
    clean = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean}_memory")
 
 
# ── Conversation memory ────────────────────────────────────────────────────────
def save_exchange_to_memory(user_id: str, session_id: str, question: str, answer: str):
    MEMORY_PATH = get_memory_path(user_id, session_id)
    os.makedirs(MEMORY_PATH, exist_ok=True)
 
    doc = Document(
        page_content=f"User: {question}\nAssistant: {answer}",
        metadata={
            "session_id": session_id,
            "timestamp":  str(datetime.now()),
            "type":       "conversation_exchange",
        },
    )
    embeddings       = get_embeddings()
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
    MEMORY_PATH      = get_memory_path(user_id, session_id)
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")
 
    if not os.path.exists(faiss_index_path):
        return ""
 
    try:
        embeddings = get_embeddings()
        memory_db  = load_faiss_cached(MEMORY_PATH, embeddings)
 
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
        return "\n\n".join(doc.page_content for doc in results)
    except Exception as e:
        logger.error(f"Failed to retrieve from memory: {e}")
        logger.error(traceback.format_exc())
        return ""
 
 
async def fetch_full_history(memory_session_id: str) -> str:
    from database import messages_collection
    recent_msgs = list(messages_collection.find(
        {"session_id": memory_session_id},
        sort=[("timestamp", 1)],
        limit=10,
    ))
    return "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in recent_msgs
    )
 
 
# ── MongoDB helpers ────────────────────────────────────────────────────────────
def save_message(session_id: str, user_id, role: str, content: str):
    messages_collection.insert_one({
        "session_id": session_id,
        "user_id":    user_id,
        "role":       role,
        "content":    content,
        "timestamp":  datetime.utcnow(),
    })
 
def save_widget_message(bot_id, session_id, question, answer, response_time_ms, docs):
    from database import mongodb
    mongodb["widget_messages"].insert_one({
        "bot_id":          bot_id,
        "session_id":      session_id,
        "question":        question,
        "answer":          answer,
        "created_at":      datetime.utcnow(),
        "response_time_ms": response_time_ms,
        "source_docs":     [doc.metadata.get("source", "Unknown") for doc in docs],
    })
 
 
# ── LLM Reranker ──────────────────────────────────────────────────────────────
def llm_rerank(query: str, contexts: list, top_k: int) -> list:
    """Score each context with the LLM at temperature=0 and return top_k."""
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
            score    = float(re.findall(r"\d+", response)[0])
        except Exception:
            score = 0.0
        scored.append((ctx, score))
 
    return [ctx for ctx, _ in sorted(scored, key=lambda x: x[1], reverse=True)[:top_k]]
 
 

 
# ── Generation helpers ─────────────────────────────────────────────────────────
def generate_with_mistral(system_prompt: str, question: str) -> str:
    llm = load_mistral()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def gemini_generate_answer(system_prompt: str, question: str):
    import google.generativeai  as genai
    logger.info("🔄 Initializing gemini-2.5-flash LLM...")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    llm = genai.GenerativeModel('models/gemini-2.5-flash')
    logger.info("✅ gemini-2.5-flash initialized")
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    response = llm.generate_content(full_prompt).text
    return response.strip()
 
def handle_timeout(system_prompt: str, question: str):
    """
    Primary: Mistral
    Fallback: Gemini
    """
    #   Try  Mistral first
    try:
        logger.info("🔄 Attempting generation with mistral-small-latest...")
        answer = generate_with_mistral(system_prompt, question)
        if answer:
            logger.info("✅ Generated with mistral-small-latest")
            return answer, "mistral-small-latest"
    except Exception as e:
        logger.error(f"❌ Failed with mistral-small-latest: {e}")
    #   Try Gemini as a fallback
    try:
        logger.info("🔄 Falling back to gemini-2.5-flash...")
        answer = gemini_generate_answer(system_prompt, question)
        if answer:
            logger.info("✅ Generated with gemini-2.5-flash")
            return answer, "gemini-2.5-flash"
    except Exception as e:
        logger.error(f"❌ Failed with gemini-2.5-flash: {e}")
    #Total Failure
    logger.error("❌ Generation failed on all providers")
    return (
        "Sorry, I'm having trouble generating a response right now. Please try again later.",
        "none",
    )
 
# ── Langfuse flush helper ──────────────────────────────────────────────────────
def _flush():
    try:
        _langfuse.flush()
    except Exception:
        pass
 
 
# ── Sources confidence ─────────────────────────────────────────────────────────
def score_to_confidence(score: float) -> int:
    if score < 0.5:   return min(100, round(100 - score * 20))
    elif score < 1.0: return round(90 - (score - 0.5) * 40)
    elif score < 1.5: return round(70 - (score - 1.0) * 60)
    else:             return max(0, round(40 - (score - 1.5) * 80))
 
 
# ── Non-streaming RAG ──────────────────────────────────────────────────────────
def generate_answer(question: str, user_id: str, session_id: str, memory_session_id: str):
    """Full RAG pipeline with Langfuse tracing."""
    logger.info(f"Generating answer for: {question[:60]}...")
 
    t_total_start     = time.time()
    memory_session_id = memory_session_id or session_id
    clean_session_id  = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH       = get_vector_path(user_id, clean_session_id)
    logger.warning(f"VECTOR_PATH: '{VECTOR_PATH}'  exists={os.path.exists(VECTOR_PATH)}")
 
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
        t_ret_start = time.time()
        embeddings  = get_embeddings()
        db          = load_faiss_cached(VECTOR_PATH, embeddings)
 
        # Fetch history first so it can inform query rewriting
        relevant_history = retrieve_relevant_history(user_id, memory_session_id, question, k=4)
 
        # Retrieve with query rewriting + MMR multi-query + LLM reranking
        docs, retrieval_query = retrieve_with_llm_rerank(db, question, history=relevant_history)
        retrieval_lat = round(time.time() - t_ret_start, 3)
 
        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": [], "trace_id": trace_id}
 
        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"Retrieved {len(docs)} chunks in {retrieval_lat}s (rewritten: '{retrieval_query}')")
 
        history_block = f"\n\nRelevant conversation history:\n{relevant_history}" if relevant_history else ""
 
        system_prompt = f"""You are a helpful assistant.
- Answer the question based on the provided context.
- Answer to greetings.
- Be clear and concise.
- If the context contains relevant information, use it fully even if partial or implicit.
- If information is genuinely not present in the context, say so clearly.
- Answer in the same language as the question.
- If the context contains no relevant information at all, respond ONLY with: "I don't have enough information to answer this."
 
Context:
{context}{history_block}"""
 
        t_gen_start      = time.time()
        answer, model    = handle_timeout(system_prompt, question)
        gen_lat          = round(time.time() - t_gen_start, 3)
        total_lat        = round(time.time() - t_total_start, 3)
        logger.info(f"Answer generated in {gen_lat}s (total {total_lat}s) via {model}")
 
        threading.Thread(target=lambda: _save_all(
            user_id, memory_session_id, question, answer, gen_lat, docs
        ), daemon=True).start()
 
        if _langfuse and trace_id:
            _trace_non_stream(trace_id, question, answer, session_id, user_id, context,
                              retrieval_lat, gen_lat, total_lat, len(docs), relevant_history, model)
 
        sources = _build_sources(docs)
        logger.info(f"[langfuse] Returning trace_id={trace_id}")
        return {"answer": answer, "sources": sources, "trace_id": trace_id}
 
    except Exception as e:
        logger.error(f"Error generating answer: {e}")
        logger.error(traceback.format_exc())
        if _langfuse:
            threading.Thread(target=_flush, daemon=True).start()
        return {"answer": f"An error occurred: {str(e)}", "sources": [], "trace_id": trace_id}
 
 
# ── Streaming RAG pipeline ─────────────────────────────────────────────────────
async def generate_answer_stream(
    question: str,
    user_id: str,
    session_id: str,
    memory_session_id: str,
    system_prompt: str = None,
):
    memory_session_id = memory_session_id or session_id
    clean_session_id  = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH       = get_vector_path(user_id, clean_session_id)
 
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
        embeddings    = get_embeddings()
        db            = load_faiss_cached(VECTOR_PATH, embeddings)
 
        t_ret_start = time.time()
 
        # Step 1: fetch conversation history
        relevant_history = await fetch_full_history(memory_session_id)
 
        # Step 2: rewrite query using history for better retrieval
        from services.rag_services import rewrite_query_for_retrieval
        retrieval_query = await asyncio.to_thread(
            rewrite_query_for_retrieval, question, relevant_history
        )
        logger.info(f"Rewrote query: '{question}' → '{retrieval_query}'")
 
        # Step 3: MMR multi-query + LLM reranking
        docs, _ = await asyncio.to_thread(retrieve_with_llm_rerank, db, retrieval_query, 6, FETCH_K, LAMBDA_MULT, N_QUERIES, relevant_history)
        retrieval_lat = round(time.time() - t_ret_start, 3)
 
        if not docs:
            yield "I couldn't find any relevant information in the documents."
            return
 
        context       = "\n\n".join(doc.page_content for doc in docs)
        history_block = f"\n\nConversation history:\n{relevant_history}" if relevant_history else ""
        base_instructions = system_prompt or "You are a helpful assistant."
 
        final_system_prompt = f"""{base_instructions}
 
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
- Don't reply in a table format.
- If the question asks for a summary, structure the answer with short headings (## Title).
- Otherwise, respond in concise prose.
- Do not add any information that is not present in the context.
 
Context:
{context}{history_block}"""
 
        # Stream generation
        llm = ChatMistralAI(
            model="mistral-small-latest",
            mistral_api_key=os.getenv("MISTRAL_API_KEY", ""),
            temperature=LLM_TEMPERATURE,
            max_tokens=LLM_MAX_TOKENS,
        )
 
        full_answer = ""
        t_gen_start = time.time()
        async for chunk in llm.astream(f"{final_system_prompt}\n\nQuestion: {question}\n\nAnswer:"):
            token = chunk.content
            if token:
                full_answer += token
                yield token
        gen_lat   = round(time.time() - t_gen_start, 3)
        total_lat = round(time.time() - t_total_start, 3)
 
        # Langfuse tracing
        if _langfuse and trace_id:
            _trace_stream(trace_id, question, full_answer, session_id, user_id, context,
                          retrieval_lat, gen_lat, total_lat, len(docs), relevant_history, retrieval_query)
 
        # Sources
        sources = _build_sources_from_docs(docs)
        yield f"__SOURCES__:{json.dumps(sources)}"
 
        # Background save
        threading.Thread(target=lambda: _save_all(
            user_id, memory_session_id, question, full_answer, gen_lat, docs
        ), daemon=True).start()
 
    except Exception as e:
        logger.error(f"Streaming error: {e}")
        logger.error(traceback.format_exc())
        yield f"An error occurred: {str(e)}"
 
 
# ── Shared helpers ─────────────────────────────────────────────────────────────
def _save_all(user_id, memory_session_id, question, answer, gen_lat, docs):
    try:
        save_exchange_to_memory(user_id, memory_session_id, question, answer)
        save_message(memory_session_id, user_id, "user",      question)
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
 
 
def _build_sources(docs) -> list:
    """Build sources list from Document objects (no scores available)."""
    seen = {}
    for doc in docs:
        s = {
            "source":          doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
            "confidence":      80,
            "score":           0.0,
        }
        n = s["source"]
        if n not in seen:
            seen[n] = s
    return sorted(seen.values(), key=lambda x: x["confidence"], reverse=True)
 
 
def _build_sources_from_docs(docs) -> list:
    """Build deduplicated sources list for the streaming path."""
    seen = {}
    for doc in docs:
        s = {
            "source":          doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
            "confidence":      80,
            "score":           0.0,
        }
        n = s["source"]
        if n not in seen:
            seen[n] = s
    return sorted(seen.values(), key=lambda x: x["confidence"], reverse=True)
 
 
def _trace_non_stream(trace_id, question, answer, session_id, user_id, context,
                       retrieval_lat, gen_lat, total_lat, n_chunks, relevant_history, model):
    try:
        from langfuse.types import TraceContext
        ctx = TraceContext(trace_id=trace_id)
        with _langfuse.start_as_current_observation(
            trace_context=ctx, name="rag-query", as_type="span",
            input=question, output=answer,
            metadata={"user_id": str(user_id), "session_id": session_id,
                      "total_lat": total_lat, "timestamp": datetime.utcnow().isoformat()},
        ):
            with _langfuse.start_as_current_observation(
                name="retrieval", as_type="retriever",
                input={"query": question},
                output={"chunks_retrieved": n_chunks, "context_preview": context[:300]},
                metadata={"fetch_k": FETCH_K, "lambda_mult": LAMBDA_MULT,
                           "n_queries": N_QUERIES, "latency_s": retrieval_lat},
            ):
                pass
            with _langfuse.start_as_current_observation(
                name="llm-generation", as_type="generation",
                input=question, output=answer, model=model,
                metadata={"latency_s": gen_lat, "context_chars": len(context),
                           "used_memory": bool(relevant_history)},
            ):
                pass
        _langfuse.set_current_trace_io(input=question, output=answer)
        _langfuse.create_score(trace_id=trace_id, name="latency_s", value=total_lat,
                               comment="Total end-to-end RAG latency")
        threading.Thread(target=_flush, daemon=True).start()
        logger.info(f"[langfuse] ✅ Flushed trace_id={trace_id}")
    except Exception as e:
        logger.error(f"[langfuse] ❌ Tracing failed: {e}")
        logger.error(traceback.format_exc())
 
 
def _trace_stream(trace_id, question, full_answer, session_id, user_id, context,
                   retrieval_lat, gen_lat, total_lat, n_chunks, relevant_history, retrieval_query):
    try:
        from langfuse.types import TraceContext
        ctx = TraceContext(trace_id=trace_id)
        with _langfuse.start_as_current_observation(
            trace_context=ctx, name="rag-stream", as_type="span",
            input=question, output=full_answer,
            metadata={"user_id": str(user_id), "session_id": session_id,
                      "total_lat": total_lat, "timestamp": datetime.utcnow().isoformat()},
        ):
            with _langfuse.start_as_current_observation(
                name="query-rewrite", as_type="span",
                input={"original_query": question, "history": relevant_history},
                output={"rewritten_query": retrieval_query},
                metadata={"rewritten": retrieval_query != question},
            ):
                pass
            with _langfuse.start_as_current_observation(
                name="retrieval", as_type="retriever",
                input={"query": retrieval_query},
                output={"chunks_retrieved": n_chunks, "context_preview": context[:300]},
                metadata={"fetch_k": FETCH_K, "lambda_mult": LAMBDA_MULT,
                           "n_queries": N_QUERIES, "latency_s": retrieval_lat},
            ):
                pass
            with _langfuse.start_as_current_observation(
                name="llm-generation", as_type="generation",
                input=question, output=full_answer, model="mistral-small-latest",
                metadata={"latency_s": gen_lat, "context_chars": len(context),
                           "used_memory": bool(relevant_history)},
            ):
                pass
        _langfuse.set_current_trace_io(input=question, output=full_answer)
        _langfuse.create_score(trace_id=trace_id, name="latency_s", value=total_lat,
                               comment="Total end-to-end streaming RAG latency")
        threading.Thread(target=_flush, daemon=True).start()
        logger.info(f"[langfuse] ✅ Stream trace flushed trace_id={trace_id}")
    except Exception as e:
        logger.error(f"[langfuse] ❌ Stream tracing failed: {e}")
        logger.error(traceback.format_exc())
 
 
# ── User feedback ──────────────────────────────────────────────────────────────
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
        threading.Thread(target=_flush, daemon=True).start()
        logger.info(f"[langfuse] Feedback logged for trace {trace_id}")
    except Exception as e:
        logger.warning(f"[langfuse] Failed to log feedback: {e}")
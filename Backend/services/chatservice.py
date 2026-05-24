from datetime import datetime
import os
import re
import time
import logging
import traceback
from pathlib import Path
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_openai import OpenAIEmbeddings
from langchain_core.documents import Document
import asyncio
from langchain_mistralai import ChatMistralAI
import threading
import json
from services.rag_services import get_embeddings, retrieve_with_llm_rerank, generate_queries


# ── Model config from environment ─────────────────────────────────────────────
# ── [SERVER] Gemma 4 via Ollama ───────────────────────────────────────────────
LLM_MODEL        = os.getenv("LLM_MODEL", "gemma4:26b")
LLM_BASE_URL     = os.getenv("OPENAI_BASE_URL", "http://192.168.130.177:11434/v1")
LLM_API_KEY      = os.getenv("OPENAI_API_KEY", "not-needed")
LLM_TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0.1"))
LLM_MAX_TOKENS   = int(os.getenv("LLM_MAX_TOKENS", "2048"))
# ── [SERVER] BGE-M3 embeddings ────────────────────────────────────────────────
EMBEDDINGS_BASE_URL = os.getenv("EMBEDDINGS_BASE_URL", "http://192.168.130.177:8081/v1")
EMBEDDINGS_MODEL    = os.getenv("EMBEDDINGS_MODEL", "BAAI/bge-m3")
EMBEDDINGS_API_KEY  = os.getenv("EMBEDDINGS_API_KEY", "not-needed")

# ── Active config: Gemma4/Ollama (gen) + BGE-M3 (embeddings) — Mistral fallback
# LLM_TEMPERATURE  = float(os.getenv("LLM_TEMPERATURE", "0"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()

# ── RAG constants (tuned from eval notebook) ──────────────────────────────────
LLM_TEMPERATURE = 0.0
FETCH_K         = 20
LAMBDA_MULT     = 0.7
N_QUERIES       = 2
TOP_K           = 5


# ── FAISS document index cache ─────────────────────────────────────────────────
_faiss_cache: dict = {}

def load_faiss_cached(path, embeddings):
    if path not in _faiss_cache:
        _faiss_cache[path] = FAISS.load_local(path, embeddings, allow_dangerous_deserialization=True)
    logger.info(f"FAISS index loaded and cached from {path}")
    return _faiss_cache[path]


# ── Active primary: Gemma4 via Ollama (OpenAI-compatible) ────────────────────
_ollama_client = None
def load_ollama():
    global _ollama_client
    if _ollama_client is None:
        from langchain_openai import ChatOpenAI
        _ollama_client = ChatOpenAI(
            model=LLM_MODEL,
            base_url=LLM_BASE_URL,
            api_key=LLM_API_KEY,
            temperature=LLM_TEMPERATURE,
            max_tokens=LLM_MAX_TOKENS,
        )
    logger.info(f"Ollama model '{LLM_MODEL}' loaded and cached")
    return _ollama_client

# ── Fallback: Mistral ─────────────────────────────────────────────────────────
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
    logger.info("Mistral fallback model loaded and cached")
    return _mistral_client


# ── Langfuse ───────────────────────────────────────────────────────────────────
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


# ── Vector path ────────────────────────────────────────────────────────────────
def get_vector_path(user_id: str, session_id: str):
    clean = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean}")


# ── In-memory conversation history ────────────────────────────────────────────
# Keyed by memory_session_id. No disk, no MongoDB, no FAISS.
# Dies naturally when the session ends or the process restarts.
_conversation_history: dict[str, list[dict]] = {}

def _get_history(memory_session_id: str) -> list[dict]:
    return _conversation_history.get(memory_session_id, [])

def get_session_history(session_id: str) -> list[dict]:
    return _get_history(session_id)

def _append_history(memory_session_id: str, question: str, answer: str):
    if memory_session_id not in _conversation_history:
        _conversation_history[memory_session_id] = []
    _conversation_history[memory_session_id].append({"role": "user",      "content": question})
    _conversation_history[memory_session_id].append({"role": "assistant", "content": answer})
    # Cap at last 10 turns (20 messages) to prevent unbounded growth
    _conversation_history[memory_session_id] = _conversation_history[memory_session_id][-20:]

def _clear_history(memory_session_id: str):
    _conversation_history.pop(memory_session_id, None)

def _format_history(memory_session_id: str) -> str:
    msgs = _get_history(memory_session_id)
    if not msgs:
        return ""
    return "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in msgs
    )

def retrieve_relevant_history(user_id: str, session_id: str, question: str, k: int = 4) -> str:
    """Returns in-memory conversation history. user_id and k kept for call-site compat."""
    return _format_history(session_id)

async def fetch_full_history(memory_session_id: str) -> str:
    """Returns in-memory conversation history (async wrapper for streaming path)."""
    return _format_history(memory_session_id)


# ── MongoDB helpers ────────────────────────────────────────────────────────────
def save_message(session_id: str, user_id, role: str, content: str):
    pass  # No longer persisting full messages — history lives in _conversation_history

def save_widget_message(bot_id, session_id, question, answer, response_time_ms, docs):
    from database import mongodb
    mongodb["widget_messages"].insert_one({
        "bot_id":             bot_id,
        "session_id":         session_id,
        "question":           question,
        "answer":             answer,
        "created_at":         datetime.utcnow(),
        "response_time_ms":   response_time_ms,
        "source_docs":        [doc.metadata.get("source", "Unknown") for doc in docs],
    })


# ── Shared post-response save ──────────────────────────────────────────────────
def _save_all(user_id, memory_session_id, question, answer, gen_lat, docs):
    try:
        _append_history(memory_session_id, question, answer)
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


# ── LLM Reranker ──────────────────────────────────────────────────────────────
def llm_rerank(query: str, contexts: list, top_k: int) -> list:
    llm = load_ollama()
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
def generate_with_ollama(system_prompt: str, question: str) -> str:
    llm = load_ollama()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def generate_with_mistral(system_prompt: str, question: str) -> str:
    llm = load_mistral()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def gemini_generate_answer(system_prompt: str, question: str):
    import google.generativeai as genai
    logger.info("🔄 Initializing gemini-2.5-flash LLM...")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    llm = genai.GenerativeModel('models/gemini-2.5-flash')
    logger.info("✅ gemini-2.5-flash initialized")
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    return llm.generate_content(full_prompt).text.strip()

def handle_timeout(system_prompt: str, question: str):
    try:
        logger.info(f"🔄 Attempting generation with {LLM_MODEL} (Ollama)...")
        answer = generate_with_ollama(system_prompt, question)
        if answer:
            logger.info(f"✅ Generated with {LLM_MODEL}")
            return answer, LLM_MODEL
    except Exception as e:
        logger.error(f"❌ Failed with {LLM_MODEL}: {e}")
    try:
        logger.info("🔄 Falling back to mistral-small-latest...")
        answer = generate_with_mistral(system_prompt, question)
        if answer:
            logger.info("✅ Generated with mistral-small-latest")
            return answer, "mistral-small-latest"
    except Exception as e:
        logger.error(f"❌ Failed with mistral-small-latest: {e}")
    try:
        logger.info("🔄 Falling back to gemini-2.5-flash...")
        answer = gemini_generate_answer(system_prompt, question)
        if answer:
            logger.info("✅ Generated with gemini-2.5-flash")
            return answer, "gemini-2.5-flash"
    except Exception as e:
        logger.error(f"❌ Failed with gemini-2.5-flash: {e}")
    logger.error("❌ Generation failed on all providers")
    return "Sorry, I'm having trouble generating a response right now. Please try again later.", "none"


# ── Langfuse flush ─────────────────────────────────────────────────────────────
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
def generate_answer(
    question: str,
    user_id: str,
    session_id: str,
    memory_session_id: str,
    system_prompt: str = None,
):
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

        relevant_history  = retrieve_relevant_history(user_id, memory_session_id, question)
        docs, retrieval_query = retrieve_with_llm_rerank(db, question, history=relevant_history)
        retrieval_lat = round(time.time() - t_ret_start, 3)

        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": [], "trace_id": trace_id}

        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"Retrieved {len(docs)} chunks in {retrieval_lat}s (rewritten: '{retrieval_query}')")

        history_block = f"\n\nRelevant conversation history:\n{relevant_history}" if relevant_history else ""
        import textwrap
        context_block = context + history_block
        final_system_prompt = textwrap.dedent(f"""You are a retrieval-augmented question answering assistant.

Your goal is to answer using the provided context as the primary and only knowledge source.

## Rules
0. Reply to greetings, reply with the same language the user talkss in, and be conversational if the question is conversational. But when the question is information-seeking, answer concisely and factually using the provided context.
1. Use ONLY the provided context.
   Do NOT use external knowledge or prior memory.

2. You MAY:
   - Combine information across multiple context chunks
   - Rephrase information in a natural way
   - Make simple logical connections between facts explicitly present in the context

3. You MUST NOT:
   - Invent new facts
   - Assume missing information
   - Use outside knowledge

4. If the context does not contain enough information to answer the question, say:
   "I don't have enough information in the provided context."

## Answer strategy

- First, look for direct answers in the context.
- If not directly present, synthesize across relevant chunks.
- If still incomplete, respond with the fallback message.

## Style

- Be concise and factual.
- Do not copy long passages verbatim.
- Prefer clear explanations over quoting.

Context:
{context_block}""".strip())

        t_gen_start   = time.time()
        answer, model = handle_timeout(final_system_prompt, question)
        gen_lat       = round(time.time() - t_gen_start, 3)
        total_lat     = round(time.time() - t_total_start, 3)
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

        # Step 1: fetch in-memory conversation history
        relevant_history = await fetch_full_history(memory_session_id)

        # Step 2: rewrite query using history for better retrieval
        from services.rag_services import rewrite_query_for_retrieval
        retrieval_query = await asyncio.to_thread(
            rewrite_query_for_retrieval, question, relevant_history
        )
        logger.info(f"Rewrote query: '{question}' → '{retrieval_query}'")

        # Step 3: MMR multi-query + LLM reranking
        docs, _ = await asyncio.to_thread(
            retrieve_with_llm_rerank, db, retrieval_query, TOP_K, FETCH_K, LAMBDA_MULT, N_QUERIES, relevant_history
        )
        retrieval_lat = round(time.time() - t_ret_start, 3)

        if not docs:
            yield "I couldn't find any relevant information in the documents."
            return

        context           = "\n\n".join(doc.page_content for doc in docs)
        history_block     = f"\n\nConversation history:\n{relevant_history}" if relevant_history else ""

        import textwrap
        context_block = context + history_block
        custom_persona = f"## Your persona and instructions\n{system_prompt.strip()}\n\n" if system_prompt and system_prompt.strip() else ""
        final_system_prompt = textwrap.dedent(f"""{custom_persona}

Your goal is to answer using the provided context as the primary and only knowledge source.

## Rules
0. Reply to greetings, reply with the same language the user talkss in, and be conversational if the question is conversational. But when the question is information-seeking, answer concisely and factually using the provided context.

1. Use ONLY the provided context.
   Do NOT use external knowledge or prior memory.

2. You MAY:
   - Combine information across multiple context chunks
   - Rephrase information in a natural way
   - Make simple logical connections between facts explicitly present in the context

3. You MUST NOT:
   - Invent new facts
   - Assume missing information
   - Use outside knowledge

4. If the context does not contain enough information to answer the question, say:
   "I don't have enough information in the provided context."

## Answer strategy

- First, look for direct answers in the context.
- If not directly present, synthesize across relevant chunks.
- If still incomplete, respond with the fallback message.
- If multiple chunks contain the same value (e.g. prices, dates), pick the most frequently occurring one or the first occurrence — do NOT list duplicates.
- Give a single, direct answer. Never enumerate repeated values.

## Style

- Be concise and factual.
- Do not copy long passages verbatim.
- Prefer clear explanations over quoting.

Context:
{context_block}""".strip())

        full_answer = ""
        t_gen_start = time.time()
        model_used  = LLM_MODEL

        # ── Attempt 1: Ollama (Gemma4) streaming with 30s timeout ────────────
        ollama_failed = False
        try:
            llm = load_ollama()
            collected = ""

            async def _do_stream():
                nonlocal full_answer, collected
                async for chunk in llm.astream(f"{final_system_prompt}\n\nQuestion: {question}\n\nAnswer:"):
                    if chunk.content:
                        collected += chunk.content
                        yield chunk.content
                full_answer = collected

            stream_task = _do_stream()
            while True:
                try:
                    token = await asyncio.wait_for(stream_task.__anext__(), timeout=30)
                    yield token
                except StopAsyncIteration:
                    break

        except asyncio.TimeoutError:
            logger.warning(f"⏱️ {LLM_MODEL} stream timed out — falling back to Mistral")
            ollama_failed = True
        except Exception as e:
            logger.error(f"❌ {LLM_MODEL} stream failed: {e}")
            ollama_failed = True

        # ── Attempt 2: Mistral fallback (non-streaming) ───────────────────────
        mistral_failed = False
        if ollama_failed:
            model_used = "mistral-small-latest"
            try:
                logger.info("🔄 Falling back to mistral-small-latest...")
                full_answer = await asyncio.to_thread(
                    generate_with_mistral, final_system_prompt, question
                )
                if full_answer:
                    logger.info("✅ Mistral fallback succeeded")
                    yield full_answer
                else:
                    raise ValueError("Empty response from Mistral")
            except Exception as e:
                logger.error(f"❌ Mistral fallback failed: {e}")
                mistral_failed = True

        # ── Attempt 3: Gemini fallback (non-streaming) ────────────────────────
        if ollama_failed and mistral_failed:
            model_used = "gemini-2.5-flash"
            try:
                logger.info("🔄 Falling back to gemini-2.5-flash...")
                full_answer = await asyncio.to_thread(
                    gemini_generate_answer, final_system_prompt, question
                )
                if full_answer:
                    logger.info("✅ Gemini fallback succeeded")
                    yield full_answer
                else:
                    raise ValueError("Empty response from Gemini")
            except Exception as e:
                logger.error(f"❌ Gemini fallback failed: {e}")
                model_used  = "none"
                full_answer = "Sorry, I'm having trouble generating a response right now. Please try again later."
                yield full_answer

        gen_lat   = round(time.time() - t_gen_start, 3)
        total_lat = round(time.time() - t_total_start, 3)
        logger.info(f"Stream answer generated in {gen_lat}s (total {total_lat}s) via gemma4:26b")

        if _langfuse and trace_id:
            _trace_stream(trace_id, question, full_answer, session_id, user_id, context,
                          retrieval_lat, gen_lat, total_lat, len(docs), relevant_history, retrieval_query)

        sources = _build_sources_from_docs(docs)
        yield f"__SOURCES__:{json.dumps(sources)}"

        threading.Thread(target=lambda: _save_all(
            user_id, memory_session_id, question, full_answer, gen_lat, docs
        ), daemon=True).start()

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        logger.error(traceback.format_exc())
        yield f"An error occurred: {str(e)}"


# ── Source builders ────────────────────────────────────────────────────────────
def _build_sources(docs) -> list:
    seen = {}
    for doc in docs:
        s = {
            "source":          doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
            "confidence":      80,
            "score":           0.0,
        }
        if s["source"] not in seen:
            seen[s["source"]] = s
    return sorted(seen.values(), key=lambda x: x["confidence"], reverse=True)

def _build_sources_from_docs(docs) -> list:
    seen = {}
    for doc in docs:
        s = {
            "source":          doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content,
            "confidence":      80,
            "score":           0.0,
        }
        if s["source"] not in seen:
            seen[s["source"]] = s
    return sorted(seen.values(), key=lambda x: x["confidence"], reverse=True)


# ── Langfuse tracing ───────────────────────────────────────────────────────────
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
                input=question, output=full_answer, model=model_used,
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
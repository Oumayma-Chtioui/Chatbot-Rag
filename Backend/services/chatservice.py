from datetime import datetime
import os
import time
import logging
import traceback
from pathlib import Path
from google import genai
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from database import messages_collection
from langchain_core.documents import Document

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()


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
# Embeddings (shared instance)
# ─────────────────────────────────────────────────────────────

def get_embeddings():
    return HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True}
    )


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
            memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
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
        memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
        results = memory_db.similarity_search(question, k=k)
        if not results:
            return ""
        return "\n\n".join([doc.page_content for doc in results])
    except Exception as e:
        logger.error(f"Failed to retrieve from memory: {e}")
        return ""


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
# LLM loaders (unchanged from original)
# ─────────────────────────────────────────────────────────────

def load_gemini():
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    return genai.GenerativeModel('models/gemini-2.5-flash')

def load_gemini_2():
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GEMINI_API_KEY2"))
    return genai.GenerativeModel('models/gemini-2.5-flash')

def load_openrouter_stepfun():
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="stepfun/step-3.5-flash:free",
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )

def load_openrouter_stepfun2():
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="stepfun/step-3.5-flash:free",
        openai_api_key=os.getenv("OPENROUTER_API_KEY2"),
        openai_api_base="https://openrouter.ai/api/v1"
    )

def load_openrouter_free():
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="openrouter/free",
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )

def load_openrouter_free_2():
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="openrouter/free",
        openai_api_key=os.getenv("OPENROUTER_API_KEY2"),
        openai_api_base="https://openrouter.ai/api/v1"
    )

def load_deepseek():
    from openai import OpenAI
    return OpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com/v1"
    )


# ─────────────────────────────────────────────────────────────
# Generate Answer helpers
# ─────────────────────────────────────────────────────────────

def gemini_generate_answer(system_prompt: str, question: str):
    llm = load_gemini()
    return llm.generate_content(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").text.strip()

def gemini_generate_answer_2(system_prompt: str, question: str):
    llm = load_gemini_2()
    return llm.generate_content(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").text.strip()

def openrouter_generate_answer(system_prompt: str, question: str):
    llm = load_openrouter_free()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def openrouter_generate_answer_2(system_prompt: str, question: str):
    llm = load_openrouter_free_2()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def openrouter_stepfun_generate_answer(system_prompt: str, question: str):
    llm = load_openrouter_stepfun()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def openrouter_stepfun_generate_answer_2(system_prompt: str, question: str):
    llm = load_openrouter_stepfun2()
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def deepseek_generate_answer(system_prompt: str, question: str):
    client = load_deepseek()
    response = client.chat.completions.create(
        model="deepseek/deepseek-r1",
        messages=[{"role": "user", "content": f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"}]
    )
    return response.choices[0].message.content.strip()

def generate_with_mistral(system_prompt: str, question: str) -> str:
    MISTRAL_API_KEY     = os.getenv("MISTRAL_API_KEY", "")
    from langchain_mistralai import ChatMistralAI
    llm = ChatMistralAI(
        model="mistral-small-latest",
        mistral_api_key=MISTRAL_API_KEY,
        temperature=0.2,
    )
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

# ─────────────────────────────────────────────────────────────
# Timeout handler — tries models in order
# ─────────────────────────────────────────────────────────────

def handle_timeout(system_prompt: str, question: str):
    models = [
        ("mistral-small-latest",        generate_with_mistral),
        ("gemini-2.5-flash",           gemini_generate_answer),
        ("gemini-2.5-flash-key2",      gemini_generate_answer_2),
        ("stepfun/step-3.5-flash",     openrouter_stepfun_generate_answer),
        ("stepfun/step-3.5-flash-k2",  openrouter_stepfun_generate_answer_2),
        ("openrouter/free",            openrouter_generate_answer),
        ("openrouter/free-k2",         openrouter_generate_answer_2),
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
        db          = FAISS.load_local(VECTOR_PATH, embeddings, allow_dangerous_deserialization=True)
        reformulated = reformulate_query(question)
        docs_with_scores = db.similarity_search_with_score(reformulated, k=6)
        docs             = [doc for doc, score in docs_with_scores]
        retrieval_lat    = round(time.time() - t_ret_start, 3)

        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": [], "trace_id": trace_id}

        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"Retrieved {len(docs)} chunks in {retrieval_lat}s")

        # ── 2. Memory ─────────────────────────────────────────
        relevant_history = retrieve_relevant_history(user_id, session_id, question, k=4)

        # ── 3. System prompt ──────────────────────────────────
        history_block = f"\n\nRelevant conversation history:\n{relevant_history}" if relevant_history else ""
        system_prompt = f"""You are a helpful assistant that answers questions based on provided documents.
Rules:
- Answer based strictly on the document context provided
- If the context contains relevant information, use it fully even if partial or implicit
- Do not refuse to answer when relevant content exists — extract and present what is available
- If information is genuinely not present in the context, say so clearly
- Answer in the same language as the question

Document context:
{context}{history_block}"""

        # ── 4. Generate ───────────────────────────────────────
        t_gen_start   = time.time()
        answer, model = handle_timeout(system_prompt, question)
        gen_lat       = round(time.time() - t_gen_start, 3)
        response_time_ms = int(gen_lat * 1000)

        save_widget_message(
            bot_id=user_id,   # ⚠️ IMPORTANT: replace this if needed (see below)
            session_id=session_id,
            question=question,
            answer=answer,
            response_time_ms=response_time_ms,
            docs=docs
        )
        total_lat     = round(time.time() - t_total_start, 3)
        logger.info(f"Answer generated in {gen_lat}s (total {total_lat}s) via {model}")

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
                _langfuse.flush()
                logger.info(f"[langfuse] ✅ Flushed trace_id={trace_id}")
            except Exception as e:
                logger.error(f"[langfuse] ❌ Tracing failed: {e}")
                import traceback as _tb; logger.error(_tb.format_exc())

        # ── 6. Save ───────────────────────────────────────────
        save_exchange_to_memory(user_id, session_id, question, answer)
        save_message(session_id, user_id, "user", question)
        save_message(session_id, user_id, "assistant", answer)

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
            try: _langfuse.flush()
            except Exception: pass
        return {"answer": f"An error occurred: {str(e)}", "sources": [], "trace_id": trace_id}


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
        _langfuse.flush()
        logger.info(f"[langfuse] Feedback logged for trace {trace_id}")
    except Exception as e:
        logger.warning(f"[langfuse] Failed to log feedback: {e}")
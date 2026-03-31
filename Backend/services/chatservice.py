from datetime import datetime
import os
import logging
import traceback
from pathlib import Path
from google import genai
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from database import messages_collection
from langchain_core.documents import Document


os.environ["LANGCHAIN_TRACING_V2"] = os.environ.get("LANGCHAIN_TRACING_V2", "true")
os.environ["LANGCHAIN_API_KEY"] = os.environ.get("LANGCHAIN_API_KEY", "")
os.environ["LANGCHAIN_PROJECT"] = os.environ.get("LANGCHAIN_PROJECT", "novamind")



# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()

# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
def get_vector_path(user_id: str, session_id: str):
    # Clean session ID to match how rag_services stores it
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )

def get_memory_path(user_id: str, session_id: str):
    """Separate FAISS index just for conversation memory"""
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
    """
    Embed and store a full exchange (question + answer) into the
    session memory FAISS index.
    """
    MEMORY_PATH = get_memory_path(user_id, session_id)
    os.makedirs(MEMORY_PATH, exist_ok=True)

    # Combine question and answer into one chunk so retrieval brings back full context
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
            # Load and add to existing memory index
            memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
            memory_db.add_documents([doc])
        else:
            # Create new memory index
            memory_db = FAISS.from_documents([doc], embeddings)

        memory_db.save_local(MEMORY_PATH)
        logger.info(f"✅ Exchange saved to memory index at {MEMORY_PATH}")

    except Exception as e:
        logger.error(f"❌ Failed to save exchange to memory: {e}")


def retrieve_relevant_history(user_id: str, session_id: str, question: str, k: int = 4):
    """
    Search the session memory FAISS index for the most semantically
    relevant past exchanges for the current question.
    """
    MEMORY_PATH = get_memory_path(user_id, session_id)
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")

    if not os.path.exists(faiss_index_path):
        logger.info("📭 No conversation memory yet for this session")
        return ""

    try:
        embeddings = get_embeddings()
        memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
        results = memory_db.similarity_search(question, k=k)
        
        if not results:
            return ""

        # Format retrieved exchanges as readable history
        history_text = "\n\n".join([doc.page_content for doc in results])
        logger.info(f"🧠 Retrieved {len(results)} relevant past exchanges from memory")
        return history_text

    except Exception as e:
        logger.error(f"❌ Failed to retrieve from memory: {e}")
        return ""

# ─────────────────────────────────────────────────────────────
# MongoDB message saving (for PostgreSQL persistence via chat.py)
# ─────────────────────────────────────────────────────────────

def save_message(session_id: str, user_id, role: str, content: str):
    messages_collection.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow()
    })

# ─────────────────────────────────────────────────────────────
# Timeout Handler
# ─────────────────────────────────────────────────────────────
def handle_timeout(system_prompt: str, question: str):
    models = ["gemini-2.5-flash", "gemini-2.5-flash1", "stepfun/step-3.5-flash:free", "stepfun/step-3.5-flash:free1" , "openrouter/free", "openrouter/free1"]
    for model in models:
        try:
            logger.info(f"⏱️ Attempting to generate answer with {model} after timeout...")
            if model == "gemini-2.5-flash":
                answer = gemini_generate_answer(system_prompt, question)
            elif model == "gemini-2.5-flash1":
                answer = gemini_generate_answer_2(system_prompt, question)
            elif model == "stepfun/step-3.5-flash:free":
                answer = openrouter_stepfun_generate_answer(system_prompt, question)
            elif model == "stepfun/step-3.5-flash:free1":
                answer = openrouter_stepfun_generate_answer_2(system_prompt, question)
            elif model == "openrouter/free":
                answer = openrouter_generate_answer(system_prompt, question)
            elif model == "openrouter/free1":
                answer = openrouter_generate_answer_2(system_prompt, question)

            if answer:
                logger.info(f"✅ Successfully generated answer with {model} after timeout")
                return answer
        except Exception as e:
            logger.error(f"❌ Failed to generate answer with {model} after timeout: {e}")
            continue
    logger.error("❌ All fallback models failed after timeout")
    return "Sorry, I'm having trouble generating a response right now. Please try again later."
# ─────────────────────────────────────────────────────────────
#LLM Loading
# ─────────────────────────────────────────────────────────────
def load_gemini():
    import google.generativeai  as genai
    logger.info("🔄 Initializing gemini-2.5-flash LLM...")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    llm = genai.GenerativeModel('models/gemini-2.5-flash')
    logger.info("✅ gemini-2.5-flash initialized")
    return llm

def load_gemini_2():
    import google.generativeai  as genai
    logger.info("🔄 Initializing gemini-2-flash LLM...")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY2"))
    llm = genai.GenerativeModel('models/gemini-2-flash')
    logger.info("✅ gemini-2-flash initialized")
    return llm

def load_openrouter_stepfun():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing stepfun/step-3.5-flash LLM...")
    llm =ChatOpenAI(
        model="stepfun/step-3.5-flash:free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ stepfun/step-3.5-flash initialized")
    return llm

def load_openrouter_stepfun2():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing stepfun/step-3.5-flash LLM with second API key...")
    llm =ChatOpenAI(
        model="stepfun/step-3.5-flash:free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY2"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ stepfun/step-3.5-flash with second API key initialized")
    return llm

def load_openrouter_free():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing openrouter/free LLM...")
    llm = ChatOpenAI(
        model="openrouter/free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ openrouter/free initialized")
    return llm

def load_openrouter_free_2():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing openrouter/free LLM with second API key...")
    llm = ChatOpenAI(
        model="openrouter/free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY2"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ openrouter/free with second API key initialized")
    return llm

def load_deepseek():
    from openai import OpenAI
    logger.info("🔄 Initializing DeepSeek LLM...")
    client = OpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com/v1"
    )
    logger.info("✅ DeepSeek LLM initialized")
    return client

# ─────────────────────────────────────────────────────────────
# Generate Answer Function
# ─────────────────────────────────────────────────────────────
def gemini_generate_answer(system_prompt: str, question: str):
    llm = load_gemini()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    response = llm.generate_content(full_prompt).text
    return response.strip()

def gemini_generate_answer_2(system_prompt: str, question: str):    
    llm = load_gemini_2()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    response = llm.generate_content(full_prompt).text
    return response.strip()

def openrouter_generate_answer(system_prompt: str, question: str):
    llm= load_openrouter_free()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with Open Router...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by Open Router")
    return answer.strip()

def openrouter_generate_answer_2(system_prompt: str, question: str):
    llm= load_openrouter_free_2()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with Open Router using second API key...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by Open Router with second API key")
    return answer.strip()

def openrouter_stepfun_generate_answer(system_prompt: str, question: str):
    llm = load_openrouter_stepfun()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with StepFun...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by StepFun")
    return answer.strip()

def openrouter_stepfun_generate_answer_2(system_prompt: str, question: str):
    llm = load_openrouter_stepfun2()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with StepFun using second API key...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by StepFun with second API key")
    return answer.strip()

def deepseek_generate_answer(system_prompt: str, question: str):
    client = load_deepseek()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with DeepSeek...")
    response = client.chat.completions.create(
        model="deepseek/deepseek-r1",
        messages=[{"role": "user", "content": full_prompt}]
    )
    answer = response.choices[0].message.content
    logger.info("✅ Response generated by DeepSeek")
    return answer.strip()

# ─────────────────────────────────────────────────────────────
# Query Reformulation with open router free models
# ─────────────────────────────────────────────────────────────
def reformulate_query(question: str):
    logger.info("🔄 Reformulating query for better retrieval...")
    llm = load_openrouter_free()
    reformulation_prompt = f"""You are a search query optimizer for a RAG system. 
Your job is to reformulate the user's question to improve document retrieval.

Rules:
- Keep proper nouns, company names, and specific terms EXACTLY as written
- Do not replace or interpret unknown words — they may be company or product names
- Only expand the query with synonyms for common words
- Keep the reformulated query concise

Original question: {question}
Reformulated question (keep proper nouns unchanged):"""
    response = llm.invoke(reformulation_prompt)
    logger.info(f"✅ Query reformulated: {response.content.strip()}")
    return response.content.strip()


# ─────────────────────────────────────────────────────────────
# Main RAG + Memory answer generation
# ─────────────────────────────────────────────────────────────
def generate_answer(question: str, user_id: str, session_id: str):

    question = reformulate_query(question)

    logger.info(f"🔍 Generating answer for: {question[:50]}...")

    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH = get_vector_path(user_id, clean_session_id)

    logger.warning(f"🔎 VECTOR_PATH looking for: '{VECTOR_PATH}'")
    logger.warning(f"🔎 Path exists: {os.path.exists(VECTOR_PATH)}")

    if not os.path.exists(VECTOR_PATH):
        logger.warning("❌ No documents indexed yet")
        return {"answer": "No documents indexed yet. Please upload documents first.", "sources": []}



    try:
        # 1. Retrieve relevant document chunks
        embeddings = get_embeddings()
        db = FAISS.load_local(VECTOR_PATH, embeddings, allow_dangerous_deserialization=True)
        retriever = db.as_retriever(search_kwargs={"k": 6})
        docs = retriever.invoke(question)

        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": []}

        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"📄 Document context: {len(context)} characters")

        # 2. Retrieve relevant conversation history from vector memory
        relevant_history = retrieve_relevant_history(user_id, session_id, question, k=4)

        # 3. Build prompt with both document context and relevant history
        if relevant_history:
            system_prompt = f"""You are a helpful assistant that answers questions based on provided documents.
You also have access to relevant parts of the previous conversation to maintain continuity.
Rules:
- Answer based strictly on the document context provided
- If the context contains relevant information, use it fully even if it is partial or implicit
- Do not refuse to answer when relevant content exists in the context — extract and present what is available
- If a piece of information is implied or can be reasonably inferred from the context, state it along with what the context says
- If information is genuinely not present in the context, say so clearly
- Answer in the same language as the question

Document context:
{context}

Relevant conversation history:
{relevant_history}"""
        else:
            system_prompt = f"""You are a helpful assistant that answers questions based on provided documents.
You also have access to relevant parts of the previous conversation to maintain continuity.
Rules:
- Answer based strictly on the document context provided
- If the context contains relevant information, use it fully even if it is partial or implicit
- Do not refuse to answer when relevant content exists in the context — extract and present what is available
- If a piece of information is implied or can be reasonably inferred from the context, state it along with what the context says
- If information is genuinely not present in the context, say so clearly
- Answer in the same language as the question

Document context:
{context}"""

        # 4. Call Generate Answer
        answer= handle_timeout(system_prompt, question)

        logger.info("✅ Response generated")

        # 5. Save exchange to vector memory AFTER answering
        save_exchange_to_memory(user_id, session_id, question, answer)

        # 6. Save to MongoDB for reference
        save_message(session_id, user_id, "user", question)
        save_message(session_id, user_id, "assistant", answer)

        sources = [{
            "source": doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:100] + "..."
        } for doc in docs]

        return {"answer": answer, "sources": sources}

    except Exception as e:
        logger.error(f"❌ Error generating answer: {e}")
        logger.error(traceback.format_exc())
        return {"answer": f"An error occurred: {str(e)}", "sources": []}

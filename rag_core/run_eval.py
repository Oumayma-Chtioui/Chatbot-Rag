"""
run_eval.py  ·  NovaMind RAG Evaluation Harness
================================================
Features
--------
- Core RAG pipeline (ingest → embed → retrieve → generate)
- Experiment runner: vary chunk_size, overlap, top_k, query_reformulation
- RAGAS evaluation: answer_relevancy, faithfulness, context_recall, context_precision
# - Langfuse tracing: every run is a trace with scores attached
- Outputs a timestamped JSON + CSV results file

.env keys needed
----------------
    MISTRAL_API_KEY=...          ← used for RAG generation AND RAGAS judge
    OPENROUTER_API_KEY=...       ← fallback generation
#    LANGFUSE_PUBLIC_KEY=pk-lf-...
#    LANGFUSE_SECRET_KEY=sk-lf-...
#    LANGFUSE_HOST=https://cloud.langfuse.com
"""

import os
import sys
import json
import csv
import time
import datetime
import textwrap
import argparse
from pathlib import Path
from typing import Optional

from langchain_ollama import ChatOllama
import pandas as pd
from dotenv import load_dotenv

import re
from typing import Tuple

load_dotenv()

# ── Disable LangSmith tracing (auto-enabled by LangChain if LANGCHAIN_API_KEY is set) ──
os.environ["LANGCHAIN_TRACING_V2"] = "false"
os.environ["LANGCHAIN_TRACING"] = "false"

# ── safe Unicode printing (Windows cp1252 guard) ─────────────────────────────
def safe_print(*args, **kwargs):
    sep   = kwargs.get("sep", " ")
    end   = kwargs.get("end", "\n")
    flush = kwargs.get("flush", False)
    text  = sep.join(str(a) for a in args) + end
    try:
        sys.stdout.write(text)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.buffer.write(text.encode(enc, errors="replace"))
    if flush:
        sys.stdout.flush()

print = safe_print  # shadow built-in

# ── env ───────────────────────────────────────────────────────────────────────
MISTRAL_API_KEY     = os.getenv("MISTRAL_API_KEY", "")
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "")
# LANGFUSE_SECRET_KEY="sk-lf-08452f62-197d-4fb3-8ae8-79b642254d43"
# LANGFUSE_PUBLIC_KEY="pk-lf-288b8bdd-2abd-4196-b009-55b7208666b6"
# LANGFUSE_BASE_URL="https://cloud.langfuse.com"
# LANGFUSE_HOST        = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"   # for both RAG and RAGAS (keep consistent for fair eval)
JUDGE_MODEL  = "mistral-small-latest"
GEN_MODEL    = "mistral-small-latest"   # generation model

# ── LangChain / FAISS ─────────────────────────────────────────────────────────
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document

# ── RAGAS ─────────────────────────────────────────────────────────────────────
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    context_recall,
    context_precision,
    answer_correctness,
)
from datasets import Dataset as HFDataset

# ── Langfuse (current SDK — no deprecated imports) ────────────────────────────
# from langfuse import Langfuse

import logging
logging.basicConfig(level=logging.WARNING)   # suppress HF noise
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# BUILT-IN CORPUS  (used when no --doc is passed)
# ══════════════════════════════════════════════════════════════════════════════

BUILTIN_CORPUS = """
Machine Learning is a subset of artificial intelligence that allows systems to learn
and improve from experience without being explicitly programmed. It focuses on developing
computer programs that can access data and use it to learn for themselves.

Supervised Learning is a type of machine learning where the algorithm learns from labeled
training data. The algorithm learns to map input features to output labels. Examples include
linear regression for predicting continuous values and logistic regression for classification.

Gradient Descent is an optimization algorithm used to minimize the cost function in machine
learning. It works by iteratively moving in the direction of steepest descent as defined by
the negative of the gradient. The learning rate controls how large each step is.

Overfitting occurs when a model learns the training data too well, capturing noise and
random fluctuations. This leads to poor generalization to new unseen data. Regularization
techniques like L1 (Lasso) and L2 (Ridge) help prevent overfitting by adding penalty terms
to the loss function.

Neural Networks are computational models inspired by the human brain. They consist of
interconnected layers of nodes called neurons. Backpropagation is the key algorithm for
training neural networks, using the chain rule to compute gradients and update weights.
The vanishing gradient problem affects deep networks when gradients become too small for
early layers to learn effectively.

Support Vector Machines (SVM) find the optimal hyperplane that maximally separates classes.
The margin is the distance between the hyperplane and the nearest data points (support vectors).
Kernel functions allow SVMs to handle non-linearly separable data.

Decision Trees split data recursively based on feature thresholds. Random Forests are an
ensemble of decision trees using bagging. Gradient Boosting builds trees sequentially, each
correcting the errors of the previous one.

Cross-validation assesses model generalization by training on subsets and testing on held-out
data. k-fold cross-validation splits data into k equal parts and rotates the test fold.

Principal Component Analysis (PCA) is a dimensionality reduction technique that finds
orthogonal axes of maximum variance. It projects data onto fewer dimensions while preserving
as much variance as possible.

The bias-variance tradeoff: high bias means underfitting (model too simple), high variance
means overfitting (model too complex). The goal is to find the sweet spot that minimizes total error.

Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 score is the harmonic mean of precision
and recall. The confusion matrix summarizes classification results across all classes.

K-Nearest Neighbors (KNN) classifies new points by majority vote of the k closest training
examples in feature space. The choice of k and distance metric heavily influence performance.
"""


# ══════════════════════════════════════════════════════════════════════════════
# RAGAS JUDGE LLM + EMBEDDINGS
# ══════════════════════════════════════════════════════════════════════════════
#
# What went wrong in each previous attempt and why this version works:
#
# v1 — Ollama as judge:
#   RAGAS fires concurrent async jobs. Ollama/1B-CPU = 1 req/60s max.
#   25 jobs × 60s = guaranteed TimeoutError. Not usable as RAGAS judge.
#
# v2 — LangchainLLMWrapper(ChatGoogleGenerativeAI):
#   Gemini was correctly invoked in the smoke-test but RAGAS deprecated
#   LangchainLLMWrapper — it became a no-op stub that RAGAS ignores internally.
#   Result: NaN on all metrics despite seeing "[judge] ready".
#
# v3 — llm_factory(provider="google") + llm_factory(client=OpenAI(base_url)):
#   llm_factory works for native OpenAI. For Google it requires google-cloud
#   credentials (Vertex AI), not google-generativeai. For OpenRouter, RAGAS
#   re-creates its own OpenAI client and discards the custom base_url → 401.
#
# v4 (THIS VERSION):
#   The ONLY approach that works for both Gemini and OpenRouter with current
#   RAGAS is to use the low-level `ragas.llms.BaseRagasLLM` subclass that
#   calls the provider directly via its own async interface.
#   For Gemini: use ragas built-in `ChatGoogleGenerativeAI` from ragas.llms
#              (different from langchain_google_genai — this one is native).
#   For OpenRouter: wrap ChatOpenAI with the CURRENT non-deprecated path:
#              `from ragas.llms import LangchainLLMWrapper` still works in
#              ragas>=0.2 for custom base_url providers — the deprecation
#              warning only applies to the old import path.
#
# QUOTA NOTE: gemini-2.0-flash free tier = 20 req/day. If you hit quota,
#   the code automatically falls back to OpenRouter. You can also set
#   JUDGE_MODEL = "gemini-2.0-flash" which has a separate 1500 req/day quota.
# ─────────────────────────────────────────────────────────────────────────────


def get_ragas_judge():
    """
    Returns a RAGAS-compatible LLM object for use as the evaluation judge.
    Priority: Mistral → OpenRouter → None
    Uses LangchainLLMWrapper with ChatMistralAI (langchain_mistralai).
    """

    # ── Option 1: Mistral via LangchainLLMWrapper ─────────────────────────
    if MISTRAL_API_KEY:
        try:
            from langchain_mistralai import ChatMistralAI
            from ragas.llms import llm_factory, LangchainLLMWrapper

            raw = ChatMistralAI(
                model=JUDGE_MODEL,
                mistral_api_key=MISTRAL_API_KEY,
                temperature=0,
            )
            # Sync smoke-test
            raw.invoke("Reply with one word: ok")
            wrapped = LangchainLLMWrapper(raw)
            print(f"  [judge] Mistral {JUDGE_MODEL} ready (LangchainLLMWrapper)")
            return wrapped
        except Exception as e:
            print(f"  [judge] Mistral failed ({e}), trying OpenRouter...")

    # ── Option 2: OpenRouter via LangchainLLMWrapper ──────────────────────
    if OPENROUTER_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            from ragas.llms import LangchainLLMWrapper

            raw = ChatOpenAI(
                model="stepfun/step-3.5-flash:free",
                openai_api_key=OPENROUTER_API_KEY,
                openai_api_base="https://openrouter.ai/api/v1",
                temperature=0,
                request_timeout=60,
                default_headers={
                    "HTTP-Referer": "https://novamind.app",
                    "X-Title": "NovaMind RAG Eval",
                },
            )
            test = raw.invoke("Reply with one word: ok")
            if not test or not test.content:
                raise ValueError("Empty response from OpenRouter")
            wrapped = LangchainLLMWrapper(raw)
            print("  [judge] OpenRouter ready (LangchainLLMWrapper + headers)")
            return wrapped
        except Exception as e:
            print(f"  [judge] OpenRouter failed ({e})")

    print("  [judge] WARNING: No judge LLM available — LLM metrics will be n/a")
    return None


def get_ragas_embeddings():
    """
    Tries RAGAS native HuggingFaceEmbeddings first, falls back to LangChain.
    """
    try:
        from ragas.embeddings import HuggingFaceEmbeddings as RagasHFEmbed
        emb = RagasHFEmbed(model=EMBED_MODEL)
        print("  [embed] RAGAS native HuggingFaceEmbeddings ready")
        return emb
    except Exception:
        pass
    try:
        from langchain_huggingface import HuggingFaceEmbeddings as LCHFEmbed
        from ragas.embeddings import LangchainEmbeddingsWrapper
        emb = LangchainEmbeddingsWrapper(LCHFEmbed(model_name=EMBED_MODEL))
        print("  [embed] langchain-huggingface embeddings ready")
        return emb
    except Exception:
        pass
    # Final fallback — deprecated but functional
    from ragas.embeddings import LangchainEmbeddingsWrapper
    emb = LangchainEmbeddingsWrapper(HuggingFaceEmbeddings(
        model_name=EMBED_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    ))
    print("  [embed] LangChain HuggingFaceEmbeddings ready (fallback)")
    return emb


# ══════════════════════════════════════════════════════════════════════════════
# LANGFUSE  (disabled — tracing removed)
# ══════════════════════════════════════════════════════════════════════════════

# def get_langfuse() -> Optional[Langfuse]:
#     print("[langfuse] Tracing disabled.")
#     return None

def get_langfuse():
    return None


# ══════════════════════════════════════════════════════════════════════════════
# GENERATION LLM  (same as chatservice.py — Gemini primary, OpenRouter fallback)
# ══════════════════════════════════════════════════════════════════════════════

def generate_with_mistral(system_prompt: str, question: str) -> str:
    from langchain_mistralai import ChatMistralAI
    llm = ChatMistralAI(
        model=GEN_MODEL,
        mistral_api_key=MISTRAL_API_KEY,
        temperature=0.2,
    )
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()


def generate_with_openrouter(system_prompt: str, question: str) -> str:
    from langchain_openai import ChatOpenAI
    llm = ChatOpenAI(
        model="stepfun/step-3.5-flash:free",
        openai_api_key=OPENROUTER_API_KEY,
        openai_api_base="https://openrouter.ai/api/v1",
        temperature=0.2,
    )
    return llm.invoke(f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:").content.strip()

def generate_with_ollama(system_prompt: str, question: str) -> str:
    from langchain_community.chat_models import ChatOllama

    llm = ChatOllama(
        model="llama3.2:latest",
        temperature=0.2,
    )

    return llm.invoke(
        f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    ).content.strip()

def generate_answer(system_prompt: str, question: str) -> str:
    # ── 1. Mistral  ────────────────────────────────────
    if MISTRAL_API_KEY:
        try:
            llm = "mistral-small-latest"
            answer = generate_with_mistral(system_prompt, question)
            return answer,llm
        except Exception as e:
            print(f"  [gen] Mistral failed ({e}), trying OpenRouter...")
    # ── 2. Ollama (llama3.2:latest) ─────────────────────────────────
    try:
        llm="llama3.2:latest"
        answer = generate_with_ollama(system_prompt, question)
        return answer,llm
    except Exception as e:
        print(f"  [gen] Ollama failed ({e}), trying OpenRouter...")
    # ── 3. OpenRouter ──────────────────────────
    try:
        llm="stepfun/step-3.5-flash:free"
        answer = generate_with_openrouter(system_prompt, question)
        return answer,llm
    except Exception as e:
            print(f"  [gen] OpenRouter failed ({e}), trying Ollama...")

    return "ERROR: No LLM available for generation.",""


# ══════════════════════════════════════════════════════════════════════════════
# CORE RAG PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

class RAGPipeline:
    """
    Configurable RAG pipeline that mirrors the production chatservice.py logic.

    Parameters
    ----------
    chunk_size        : characters per chunk  (default 1000)
    chunk_overlap     : overlap between chunks (default 200)
    top_k             : retrieved chunks per query (default 6)
    use_reformulation : rewrite query before retrieval (default True)
    """

    #(1000, 200, 6, True, "baseline_topk6") fixed baseline

    def __init__(
        self,
        chunk_size=1000,
        chunk_overlap=200,
        top_k=6,
        use_reformulation=False,
        embed_model: str = EMBED_MODEL,
        use_reranker=False,
        use_cross_encoder=False,
        use_multiquery=False,
        use_postprocessing=False,
        use_parent_doc=False,
        use_hybrid=False, 
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.top_k = top_k
        self.use_reformulation = use_reformulation
        self.use_reranker = use_reranker
        self.use_cross_encoder = use_cross_encoder
        self.use_multiquery = use_multiquery
        self.use_postprocessing = use_postprocessing
        self.use_parent_doc = use_parent_doc
        self.use_hybrid=use_hybrid

        self.embeddings = HuggingFaceEmbeddings(
            model_name=embed_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        self.vectorstore = None
        if self.use_cross_encoder:
            from sentence_transformers import CrossEncoder
            self.reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

    # Multi-query retrieval
    def generate_queries(self, question):
        if not self.use_multiquery:
            return [question]

        return [
            question,
            f"Explain: {question}",
            f"Describe: {question}"
        ]

    # ── ingest ────────────────────────────────────────────────────────────

    def ingest_text(self, text: str, source: str = "corpus") -> int:
        from langchain_community.retrievers import BM25Retriever
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        raw_chunks = splitter.create_documents([text], metadatas=[{"source": source}])
        chunks = []
        #Parent document retrieval
        for i, chunk in enumerate(raw_chunks):
            if self.use_parent_doc:
                parent_id = i // 3
                chunk.metadata["parent_id"] = parent_id
                window_size = 1
                start = max(0, i - window_size)
                end = min(len(raw_chunks), i + window_size)
                chunk.metadata["parent_text"] = " ".join(
                    raw_chunks[j].page_content for j in range(start, end)
                )
            chunks.append(chunk)
        self.vectorstore = FAISS.from_documents(chunks, self.embeddings)
        # ✅ Build BM25 index
        if self.use_hybrid:
            self.bm25 = BM25Retriever.from_documents(chunks)
            self.bm25.k = self.top_k
        print(f"  indexed {len(chunks)} chunks from '{source}'")
        return len(chunks)

    def ingest_file(self, path: str) -> int:
        p = Path(path)
        if p.suffix == ".pdf":
            from langchain_community.document_loaders import PyPDFLoader
            docs = PyPDFLoader(str(p)).load()
            text = "\n\n".join(d.page_content for d in docs)
        else:
            text = p.read_text(encoding="utf-8")
        return self.ingest_text(text, source=p.name)

    # ── retrieve ──────────────────────────────────────────────────────────

    def _reformulate(self, question: str) -> str:
        prompt = textwrap.dedent(f"""
            You are a search query optimizer for a RAG system.
            Rules:
            - Keep proper nouns, company names, technical terms EXACTLY as written
            - Expand only generic words with synonyms
            - Return ONLY the reformulated query, nothing else

            Original: {question}
            Reformulated:
        """).strip()
        try:
            return generate_answer(prompt, question)
        except Exception:
            return question

    def retrieve(self, question: str, lf=None) -> tuple[str, list[str]]:
        if self.vectorstore is None:
            raise RuntimeError("Call ingest_text() first.")

        effective = self._reformulate(question) if self.use_reformulation else question
        queries = self.generate_queries(question)

        all_docs = []

        for q in queries:
            dense_docs = self.vectorstore.max_marginal_relevance_search(
                q, k=10, fetch_k=20, lambda_mult=0.7
            )

            if self.use_hybrid:
                sparse_docs = self.bm25.invoke(q)

                # ✅ merge + deduplicate
                combined = dense_docs + sparse_docs

                seen_texts = set()
                merged = []
                for d in combined:
                    if d.page_content not in seen_texts:
                        seen_texts.add(d.page_content)
                        merged.append(d)

                all_docs.extend(merged)
            else:
                all_docs.extend(dense_docs)

        # Deduplicate by chunk index
        seen = {}
        for d in all_docs:
            key = d.metadata.get("parent_id") if self.use_parent_doc else d.page_content
            if key not in seen:
                seen[key] = d

        # Rerank on raw chunk content first
        candidates = list(seen.values())
        raw_texts = [d.page_content for d in candidates]

        if self.use_cross_encoder:
            raw_texts = rerank_cross_encoder(effective, raw_texts, self.reranker, top_k=self.top_k)
            # Now expand winners to parent_text
            contexts = []
            for d in candidates:
                if d.page_content in raw_texts:
                    contexts.append(d.metadata.get("parent_text", d.page_content))
        elif self.use_reranker:
            raw_texts = rerank_contexts(effective, raw_texts, self.embeddings, top_k=self.top_k)
            contexts = []
            for d in candidates:
                if d.page_content in raw_texts:
                    contexts.append(d.metadata.get("parent_text", d.page_content))
        else:
            contexts = [d.metadata.get("parent_text", d.page_content) if self.use_parent_doc else d.page_content for d in candidates[:self.top_k]]
        # if lf:
        #     with lf.start_as_current_observation(
        #         as_type="span",
        #         name="retrieval",
        #         input={"query": question, "reformulated": effective},
        #         output={"chunks_retrieved": len(contexts), "contexts": contexts[:2]},
        #         metadata={"top_k": self.top_k, "reformulation": self.use_reformulation},
        #     ):
        #         pass

        return effective, contexts

     # ── full pipeline ──────────────────────────────────────────────────────

    def query(self, question: str, trace=None) -> dict:
        """
        Run the full RAG pipeline for one question.

        Returns
        -------
        {
          "question": str,
          "answer": str,
          "contexts": list[str],
          "effective_query": str,
          "latency_s": float,
        }
        """
        t0 = time.time()
        effective_query, contexts = self.retrieve(question, trace)

        answer = self.generate(question, contexts, trace)
        latency = round(time.time() - t0, 3)

        return {
            "question": question,
            "answer": answer,
            "contexts": contexts,
            "effective_query": effective_query,
            "latency_s": latency,
        }

    # ── generate ──────────────────────────────────────────────────────────

    def generate(self, question: str, contexts: list[str], lf=None) -> str:
        context_block = "\n\n---\n\n".join(contexts)
        system_prompt = textwrap.dedent( f"""You are a helpful assistant.
Answer the question based on the provided context.
Synthesize and summarize relevant information even if it's spread across multiple parts.
Be clear and concise.
If the context contains no relevant information at all, say: "I don't have enough information to answer this."

Context:
{context_block}""").strip()
        full_prompt = f"{system_prompt}\n\nQuestion:\n{question}"
        t0     = time.time()
        answer, model = generate_answer(system_prompt, question)
        answer = self.postprocess(answer, question)
        lat    = round(time.time() - t0, 3)
        output = answer if isinstance(answer, str) else str(answer)
        # if lf:
        #     with lf.start_as_current_observation(
        #         as_type="generation",
        #         name="llm-generation",
        #         model=model,
        #         input=question,
        #         metadata={"latency_s": lat, "context_chunks": len(contexts)},
        #     ):
        #         lf.update_current_generation(output=output)
        return answer
    def overlap_score(self, q, s):
        q_words = set(q.lower().split())
        s_words = set(s.lower().split())

        if not s_words:
            return 0

        return len(q_words & s_words) / len(s_words)

    # Post-Processing
    def postprocess(self, answer, question):
        if not self.use_postprocessing:
            return answer

        sentences = answer.split(".")
        relevant = [s for s in sentences if self.overlap_score(question, s) >= 0.1]
        return ". ".join(relevant) + "."

# Simple semantic reranker
def rerank_contexts(query, contexts, embedder, top_k=6):
    """
    Rerank contexts using cosine similarity with the query.
    """
    query_emb = embedder.embed_query(query)
    context_embs = embedder.embed_documents(contexts)

    scored = []
    for ctx, emb in zip(contexts, context_embs):
        score = cosine_similarity(query_emb, emb)
        scored.append((ctx, score))

    # sort by score descending
    ranked = sorted(scored, key=lambda x: x[1], reverse=True)

    return [ctx for ctx, _ in ranked[:top_k]]

import numpy as np

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Cross-encoder reranker

def rerank_cross_encoder(query, contexts, reranker, top_k=6):
    pairs = [[query, ctx] for ctx in contexts]
    scores = reranker.predict(pairs)

    ranked = sorted(zip(contexts, scores), key=lambda x: x[1], reverse=True)

    return [ctx for ctx, _ in ranked[:top_k]]


# ══════════════════════════════════════════════════════════════════════════════
# RAGAS EVALUATION  (THE FIX IS HERE)
# ══════════════════════════════════════════════════════════════════════════════

def run_ragas(results: list[dict]) -> dict:
    """
    Evaluate a list of RAG results with RAGAS.

    Metrics
    -------
    faithfulness         — LLM judge: is the answer grounded in the contexts?
    context_recall       — embedding: does context cover the ground truth?
    context_precision    — embedding: how much of the context is useful?
    answer_correctness   — hybrid:    does the answer match the ground truth?

    The LLM judge is now Mistral (or OpenRouter fallback).
    This is why answer_relevancy and faithfulness were n/a before —
    Ollama was not available/responding.
    """
    print("\n[ragas] Building evaluation dataset...")

    dataset = HFDataset.from_dict({
        "question":     [r["question"]     for r in results],
        "answer":       [r["answer"]       for r in results],
        "contexts":     [r["contexts"]     for r in results],
        "ground_truth": [r["ground_truth"] for r in results],
    })

    # RAGAS >=0.2 requires the LLM set directly on each metric object,
    # passing only via evaluate(..., llm=) is not enough for answer_relevancy.
    #
    # HybridJudgeLLM is used ONLY as a standalone metric below — NOT as the
    # RAGAS judge. RAGAS needs a model that emits structured JSON schemas
    # (faithfulness verdicts, TP/FP/FN lists, etc.). Phi-3 Mini cannot do this
    # reliably → RagasOutputParserException on every job.
    # get_ragas_judge() uses Ollama → Mistral → OpenRouter, all of which work.

    judge_llm    = get_ragas_judge()
    ragas_embeds = get_ragas_embeddings()

    if judge_llm is not None:
        for m in [faithfulness, context_recall, context_precision, answer_correctness]:
            try:
                m.llm = judge_llm
            except Exception:
                pass



    metrics = [
        faithfulness,
        context_recall,
        context_precision,
        answer_correctness,
    ]

    # timeout = per-call limit in seconds (NOT total run time).
    # 120s is generous for any API judge under concurrent load.
    try:
        from ragas.run_config import RunConfig
        rc = RunConfig(timeout=120, max_retries=2, max_wait=60)
    except Exception:
        rc = None

    eval_kwargs = dict(
        dataset=dataset,
        metrics=metrics,
        raise_exceptions=False,
        show_progress=True,
    )
    if judge_llm is not None:
        eval_kwargs["llm"]        = judge_llm
        eval_kwargs["embeddings"] = ragas_embeds
    if rc is not None:
        eval_kwargs["run_config"] = rc

    print("[ragas] Running evaluation...")
    score_obj = evaluate(**eval_kwargs)

    def _safe(key):
        v = score_obj[key]
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return None if v != v else round(float(v), 4)   # NaN check
        if isinstance(v, list):
            vals = [float(x) for x in v if isinstance(x, (int, float)) and x == x]
            return round(sum(vals) / len(vals), 4) if vals else None
        try:
            f = float(v)
            return None if f != f else round(f, 4)
        except Exception:
            return None

    scores = {
        "faithfulness":      _safe("faithfulness"),
        "context_recall":    _safe("context_recall"),
        "context_precision": _safe("context_precision"),
        "answer_correctness": _safe("answer_correctness"),
    }


    present = [v for v in scores.values() if isinstance(v, (int, float))]
    scores["composite"] = round(sum(present) / len(present), 4) if present else None

    print("\n[ragas] Results:")
    for k, v in scores.items():
        if isinstance(v, (int, float)):
            bar = "=" * int(v * 20) + "-" * (20 - int(v * 20))
            print(f"  {k:<25} [{bar}] {v:.4f}")
        else:
            print(f"  {k:<25} n/a  (judge LLM unavailable)")

    return scores


# ══════════════════════════════════════════════════════════════════════════════
# LANGFUSE EXPERIMENT LOGGING  (disabled)
# ══════════════════════════════════════════════════════════════════════════════

# def log_to_langfuse(
#     lf,
#     experiment_name: str,
#     config: dict,
#     results: list[dict],
#     ragas_scores: dict,
# ) -> Optional[str]:
#     if lf is None:
#         return None
#
#     print(f"\n[langfuse] Logging experiment: {experiment_name}")
#
#     trace_id = lf.create_trace_id()
#     with lf.start_as_current_observation(
#         as_type="span",
#         name=experiment_name,
#         metadata={
#             "config": config,
#             "ragas_scores": ragas_scores,
#             "n_questions": len(results),
#             "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
#             "tags": ["rag-eval", "novamind"],
#         },
#     ):
#         trace_id=trace_id,
#
#         for i, r in enumerate(results):
#             with lf.start_as_current_observation(
#                 as_type="span",
#                 name=f"qa_{i+1}",
#                 input={"question": r["question"]},
#                 output={
#                     "answer": r["answer"],
#                     "contexts": r["contexts"][:1],  # first context only to save space
#                 },
#                 metadata={
#                     "effective_query": r.get("effective_query", ""),
#                     "latency_s": r.get("latency_s", 0),
#                     "ground_truth": r.get("ground_truth", ""),
#                 },
#             ):
#                 pass
#
#         for metric, value in ragas_scores.items():
#             if isinstance(value, (int, float)):
#                 lf.score_current_trace(
#                     name=metric,
#                     value=float(value),
#                     data_type="NUMERIC",
#                     comment=f"RAGAS {metric} for experiment '{experiment_name}'",
#                 )
#     lf.flush()
#     print(f"  [langfuse] Trace logged -> {LANGFUSE_HOST}")
#     return trace_id

def log_to_langfuse(lf, experiment_name, config, results, ragas_scores):
    return None


# ══════════════════════════════════════════════════════════════════════════════
# EXPERIMENT GRID
# ══════════════════════════════════════════════════════════════════════════════

EXPERIMENT_GRID = [
    # top_k
    (1000, 200, 6, False, False, False, False, False, False,  False, "top_k=6"),
    (1000, 200, 8, False, False, False, False, False,False,  False, "top_k=8"),
    (1000, 200, 10, False, False, False, False, False, False, False, "top_k=10"),

    #SEMANTIC RERANKER
    (1000, 200, 6, False, True, False, False, False, False, False, "semantic_reranker_top_k=6"),
    (1000, 200, 8, False, True, False, False, False, False, False, "semantic_reranker_top_k=8"),
    (1000, 200, 10, False, True, False, False, False, False, False, "semantic_reranker_top_k=10"),

    # CROSS-ENCODER
    (1000, 200, 6, False, False, True, False, False, False, False, "cross_encoder_top_k=6"),
    (1000, 200, 8, False, False, True, False, False, False, False, "cross_encoder_top_k=8"),
    (1000, 200, 10, False, False, True, False, False,False, False,  "cross_encoder_top_k=10"),

    # MULTI-QUERY
    (1000, 200, 6, False, False, False, True, False, False, False, "multiquery_top_k=6"),
    (1000, 200, 8, False, False, False, True, False, False, False, "multiquery_top_k=8"),
    (1000, 200, 10, False, False, False, True, False, False, False, "multiquery_top_k=10"),

    # POST-PROCESSING
    (1000, 200, 6, False, False, False, False, True, False, False, "postprocess_top_k=6"),
    (1000, 200, 8, False, False, False, False, True, False, False, "postprocess_top_k=8"),
    (1000, 200, 10, False, False, False, False, True, False, False, "postprocess_top_k=10"),

    # COMBINATIONS 🔥
    (1000, 200, 6, False, False, True, True, False, False, False, "cross+multi_top_k=6"),
    (1000, 200, 8, False, False, True, True, False, False, False, "cross+multi_top_k=8"),
    (1000, 200, 10, False, False, True, True, False, False, False, "cross+multi_top_k=10"),

    (1000, 200, 6, False, False, True, False, True, False, False, "cross+post_top_k=6"),
    (1000, 200, 8, False, False, True, False, True, False, False, "cross+post_top_k=8"),
    (1000, 200, 10, False, False, True, False, True, False, False, "cross+post_top_k=10"),

    (1000, 200, 6, False, False, True, True, True, False, False, "full_pipeline_top_k=6"),
    (1000, 200, 8, False, False, True, True, True, False, False, "full_pipeline_top_k=8"),
    (1000, 200, 10, False, False, True, True, True, False, False, "full_pipeline_top_k=10"),

    (1000, 200, 4, False, False, False, False, False, True, False, "parent_doc_rerank_top_k=4"),
    (1000, 200, 8, False, False, False, False, False, True, False, "parent_doc_rerank_top_k=8"),
    (1000, 200, 10, False, False, False, False, False, True, False, "parent_doc_rerank_top_k=10"),

    (1000, 200, 6, False, False, False, False, False, False, True, "hybrid_topk6"),
    (1000, 200, 8, False, False, False, False, False, False, True, "hybrid_topk8"),
    (1000, 200, 10, False, False, False, False, False, False, True, "hybrid_topk10"),

]

# EXPERIMENT_GRID = [
#     # (chunk_size, overlap, top_k, reformulation, label)
#     (1000, 200, 6, True,  "baseline"),
#     (500,  100, 6, True,  "small_chunks"),
#     (2000, 400, 6, True,  "large_chunks"),
#     (1000, 200, 3, True,  "topk_3"),
#     (1000, 200, 10, True, "topk_10"),
#     (1000, 200, 6, False, "no_reformulation"),
# ]

def run_experiment(
    config: tuple,
    corpus_text: str,
    eval_rows: list[dict],
    lf=None,
) -> dict:
    (
        chunk_size,
        overlap,
        top_k,
        use_reform,
        use_reranker,
        use_cross_encoder,
        use_multiquery,
        use_postprocessing,
        use_parent_doc,
        use_hybrid,
        label
    ) = config
    print(f"\n{'='*65}")
    print(f"EXPERIMENT: {label}")
    print(f"  chunk={chunk_size}  overlap={overlap}  top_k={top_k}  reform={use_reform}")
    print(f"  reranker={use_reranker}  cross_encoder={use_cross_encoder}  multiquery={use_multiquery}  postprocess={use_postprocessing} use_parent_doc={use_parent_doc}")
    print("="*65)
    pipeline = RAGPipeline(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        top_k=top_k,
        use_reformulation=use_reform,
        use_reranker=use_reranker,
        use_cross_encoder=use_cross_encoder,
        use_multiquery=use_multiquery,
        use_postprocessing=use_postprocessing,
        use_parent_doc=use_parent_doc,
        use_hybrid=use_hybrid
    )
    pipeline.ingest_text(corpus_text)

    results = []
    for idx, row in enumerate(eval_rows):
        question     = row["question"]
        ground_truth = row["ground_truth"]

        # Per-question Langfuse trace (disabled)
        # if lf:
        #     trace_id = lf.create_trace_id()
        #     with lf.start_as_current_observation(
        #         as_type="span",
        #         name=f"{label}: {question[:80]}",
        #         input={"question": question},
        #         metadata={
        #             "experiment": label,
        #             "ground_truth": ground_truth,
        #             "tags": ["rag-eval", label],
        #         },
        #     ):
        #         result = pipeline.query(question, lf)
        #         trace_id = lf.get_current_trace_id()
        #     result["langfuse_trace_id"] = trace_id
        # else:
        #     result = pipeline.query(question, lf=None)
        result = pipeline.query(question)
        result["ground_truth"] = ground_truth
        results.append(result)

    latencies = [r["latency_s"] for r in results]
    p95_latency = float(np.percentile(latencies, 95))
    print(f"  p95 latency: {p95_latency:.3f}s")

    ragas_scores = run_ragas(results)

    config_dict = {
        "chunk_size": chunk_size,
        "overlap":    overlap,
        "top_k":      top_k,
        "reform":     use_reform,
        "label":      label,
    }
    # log_to_langfuse call removed (tracing disabled)
    # trace_id = log_to_langfuse(lf, f"novamind-{label}-{datetime.date.today()}", config_dict, results, ragas_scores)

    return {
        "label":        label,
        "config":       config_dict,
        "ragas_scores": ragas_scores,
        "results":      results,
        "p95_latency": p95_latency,
    }


# ══════════════════════════════════════════════════════════════════════════════
# I/O HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def load_eval_csv(path: str) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append({
                "question":     row["question"].strip(),
                "ground_truth": row["ground_truth"].strip(),
            })
    print(f"[csv] Loaded {len(rows)} evaluation questions from {path}")
    return rows


def save_results(all_experiments: list[dict], out_dir: str = "."):
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(out_dir, exist_ok=True)

    # Full JSON
    json_path = os.path.join(out_dir, f"rag_eval_results_{ts}.json")
    with open(json_path, "w") as f:
        json.dump(all_experiments, f, indent=2, default=str)
    print(f"\nFull results -> {json_path}")

    # Summary CSV
    csv_path = os.path.join(out_dir, f"rag_eval_summary_{ts}.csv")
    rows = []
    for exp in all_experiments:
        row = {"experiment": exp["label"], **exp["config"], **exp["ragas_scores"]}
        rows.append(row)
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    print(f"Summary CSV  -> {csv_path}")

    # Console table
    H = ["EXPERIMENT", "FAITHFUL", "RECALL", "PRECISION", "CORRECTNESS", "COMPOSITE"]
    print("\n" + "="*107)
    print(f"{H[0]:<22} {H[1]:>10} {H[2]:>8} {H[3]:>10} {H[4]:>12} {H[5]:>8}")
    print("-"*107)

    def _f(v):
        return f"{v:>10.4f}" if isinstance(v, (int, float)) else f"{'n/a':>10}"

    for exp in all_experiments:
        s = exp["ragas_scores"]
        print(
            f"{exp['label']:<22}"
            f"{_f(s.get('faithfulness'))}"
            f"{_f(s.get('context_recall'))}"
            f"{_f(s.get('context_precision'))}"
            f"{_f(s.get('answer_correctness'))}"
            f"{_f(s.get('composite'))}"
        )
    print("="*107)

    scoreable = [e for e in all_experiments if isinstance(e["ragas_scores"].get("composite"), (int, float))]
    if scoreable:
        best = max(scoreable, key=lambda e: e["ragas_scores"]["composite"])
        print(f"\nBest config: {best['label']}  composite={best['ragas_scores']['composite']:.4f}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

from pathlib import Path
from langchain_community.document_loaders import PyPDFLoader, TextLoader

def load_corpus(file_path: str) -> str:
    """Load text from PDF or TXT, return a single string."""
    path = Path(file_path)
    if path.suffix.lower() == '.pdf':
        loader = PyPDFLoader(str(path))
        pages = loader.load()
        # Concatenate all page texts
        return "\n".join(page.page_content for page in pages)
    elif path.suffix.lower() == '.txt':
        return path.read_text(encoding="utf-8")
    else:
        raise ValueError(f"Unsupported file type: {path.suffix}. Use .pdf or .txt")

def _experiment_group(label: str) -> str:
    """Extract the experiment type prefix from a label (everything before _top_k or =)."""
    # e.g. "cross_encoder_top_k=6" -> "cross_encoder"
    #      "full_pipeline_top_k=10" -> "full_pipeline"
    #      "semantic_reranker_top_k=10" -> "semantic_reranker"
    import re
    m = re.match(r"^(.*?)(?:_top_k|top_k)", label)
    if m:
        return m.group(1).strip("_") or label
    return label


def print_group_summary(group: list[dict], title: str = ""):
    """Print a mini results table for a group of experiments."""
    H = ["EXPERIMENT", "FAITHFUL", "RECALL", "PRECISION", "CORRECTNESS", "COMPOSITE"]
    width = 107
    header = title if title else "INTERIM RESULTS"
    print(f"\n{'─'*width}")
    print(f"  {header}")
    print(f"{'─'*width}")
    print(f"{H[0]:<28} {H[1]:>10} {H[2]:>8} {H[3]:>10} {H[4]:>12} {H[5]:>10}")
    print(f"{'─'*width}")

    def _f(v):
        return f"{v:>10.4f}" if isinstance(v, (int, float)) else f"{'n/a':>10}"

    for exp in group:
        s = exp["ragas_scores"]
        print(
            f"{exp['label']:<28}"
            f"{_f(s.get('faithfulness'))}"
            f"{_f(s.get('context_recall'))}"
            f"{_f(s.get('context_precision'))}"
            f"{_f(s.get('answer_correctness'))}"
            f"{_f(s.get('composite'))}"
        )
    print(f"{'─'*width}")


def main():
    parser = argparse.ArgumentParser(description="NovaMind RAG Evaluator")
    parser.add_argument("--experiment", choices=["all", "single"], default="all")
    parser.add_argument("--csv",  default="eval_dataset.csv")
    parser.add_argument("--doc",  default=None, help=".txt or .pdf to index")
    parser.add_argument("--out",  default=".",  help="output directory")
    args = parser.parse_args()

    print("NovaMind RAG Evaluation Harness")
    print("="*55)

    if args.doc:
        corpus_text = load_corpus(args.doc)
        print(f"Loaded corpus from {args.doc} ({len(corpus_text)} characters)")
    else:
        corpus_text = BUILTIN_CORPUS
        print("Using built-in ML corpus")

    eval_rows = load_eval_csv(args.csv)
    lf        = get_langfuse()
    grid      = [EXPERIMENT_GRID[0]] if args.experiment == "single" else EXPERIMENT_GRID

    all_results = []

    # ── Group configs by experiment type so we print k=4/6/8/10 variants together ──
    # Preserve original order but bucket by group name
    from collections import OrderedDict
    groups: OrderedDict[str, list] = OrderedDict()
    for config in grid:
        label = config[-1]
        grp = _experiment_group(label)
        groups.setdefault(grp, []).append(config)

    # ── Run experiments group by group, printing after each group finishes ──
    for grp_name, configs in groups.items():
        grp_results = []
        for config in configs:
            result = run_experiment(config, corpus_text, eval_rows, lf)
            all_results.append(result)
            grp_results.append(result)

        # Print the group summary as soon as all variants of this experiment finish
        print_group_summary(grp_results, title=f"GROUP: {grp_name.upper()}")

    # ── Final full summary ──
    save_results(all_results, out_dir=args.out)


if __name__ == "__main__":
    main()
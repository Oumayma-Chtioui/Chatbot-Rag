"""
rag_eval.py
===========
RAG evaluation harness for NovaMind.

Features
--------
- Core RAG pipeline (ingest → embed → retrieve → generate)
- Experiment runner: vary chunk_size, overlap, top_k, query_reformulation
- RAGAS evaluation: answer_relevancy, faithfulness, context_recall, context_precision
- Langfuse tracing: every run is a trace with scores attached
- Outputs a timestamped JSON + CSV results file

Usage
-----
    pip install langchain langchain-community faiss-cpu sentence-transformers \
                google-generativeai ragas langfuse pandas datasets python-dotenv

    python rag_eval.py                          # run all experiments
    python rag_eval.py --experiment single       # single default run
    python rag_eval.py --csv custom.csv          # use your own dataset
    python rag_eval.py --doc my_notes.pdf        # index a specific document

Environment variables (.env)
-----------------------------
    GEMINI_API_KEY=...
    LANGFUSE_PUBLIC_KEY=pk-lf-...
    LANGFUSE_SECRET_KEY=sk-lf-...
    LANGFUSE_HOST=https://cloud.langfuse.com     # or your self-hosted URL
    # Optional overrides
    OPENROUTER_API_KEY=...
    LANGCHAIN_API_KEY=...                        # LangSmith (optional)
    LANGCHAIN_TRACING_V2=true
"""

import os
import json
import argparse
import datetime
import time
import csv
import textwrap
import sys
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

# Windows consoles can default to cp1252 and crash on box-drawing / emoji.
def safe_print(*args, **kwargs):
    sep = kwargs.get("sep", " ")
    end = kwargs.get("end", "\n")
    flush = kwargs.get("flush", False)
    text = sep.join(str(a) for a in args) + end
    try:
        sys.stdout.write(text)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.buffer.write(text.encode(encoding, errors="replace"))
    if flush:
        sys.stdout.flush()


print = safe_print

# ─── LangChain / FAISS ────────────────────────────────────────────────────────
from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document

# ─── LLM (Gemini primary, OpenRouter fallback) ────────────────────────────────
# import google.generativeai as genai

# ─── RAGAS ────────────────────────────────────────────────────────────────────
from ragas import evaluate
from ragas.metrics import (
    answer_relevancy,
    faithfulness,
    context_recall,
    context_precision,
)
from datasets import Dataset as HFDataset

# ─── Langfuse ─────────────────────────────────────────────────────────────────
from langfuse import Langfuse
from langfuse.model import CreateGeneration, CreateScore, CreateSpan, CreateTrace

import logging
logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════

LANGFUSE_SECRET_KEY="sk-lf-08452f62-197d-4fb3-8ae8-79b642254d43"
LANGFUSE_PUBLIC_KEY="pk-lf-288b8bdd-2abd-4196-b009-55b7208666b6"
LANGFUSE_BASE_URL="https://cloud.langfuse.com"
LANGFUSE_HOST        = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
OPENROUTER_API_KEY="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"

# Built-in knowledge base — used when no external doc is provided
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

The bias-variance tradeoff: high bias → underfitting (model too simple), high variance →
overfitting (model too complex). The goal is to find the sweet spot that minimizes total error.

Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 score = harmonic mean of precision
and recall. The confusion matrix summarizes classification results across all classes.

K-Nearest Neighbors (KNN) classifies new points by majority vote of the k closest training
examples in feature space. The choice of k and distance metric heavily influence performance.
"""

# ══════════════════════════════════════════════════════════════════════════════
# LANGFUSE CLIENT
# ══════════════════════════════════════════════════════════════════════════════

def get_langfuse() -> Optional[Langfuse]:
    """Return a Langfuse client or None if keys are missing."""
    if not LANGFUSE_PUBLIC_KEY or not LANGFUSE_SECRET_KEY:
        print("⚠  Langfuse keys not set — tracing disabled.")
        return None
    return Langfuse(
        public_key=LANGFUSE_PUBLIC_KEY,
        secret_key=LANGFUSE_SECRET_KEY,
        host=LANGFUSE_HOST,
    )

langfuse_client = get_langfuse()

# ══════════════════════════════════════════════════════════════════════════════
# CORE RAG PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

class RAGPipeline():
    """
    Self-contained RAG pipeline with configurable parameters.

    Parameters
    ----------
    chunk_size        : int   — characters per chunk
    chunk_overlap     : int   — overlap between chunks
    top_k             : int   — number of retrieved chunks
    use_reformulation : bool  — rewrite query before retrieval
    embed_model       : str   — HuggingFace model name
    llm_model         : str   — Gemini model name
    """

    def __init__(
        self,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        top_k: int = 6,
        use_reformulation: bool = True,
        embed_model: str = EMBED_MODEL,
        llm_model: str = "stepfun/step-3.5-flash:free",
    ):
        self.chunk_size        = chunk_size
        self.chunk_overlap     = chunk_overlap
        self.top_k             = top_k
        self.use_reformulation = use_reformulation
        self.llm_model         = llm_model

        # Embeddings
        self.embeddings = HuggingFaceEmbeddings(
            model_name=embed_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        from langchain_community.llms import Ollama
        self.llm = Ollama(
            model="llama3.2:1b",
            temperature=0.2,
        )
        self.vectorstore = None
        self.config_label = (
            f"chunk{chunk_size}_overlap{chunk_overlap}"
            f"_topk{top_k}"
            f"_reform{'Y' if use_reformulation else 'N'}"
        )

    # ── ingestion ──────────────────────────────────────────────────────────

    def ingest_text(self, text: str, source: str = "builtin") -> int:
        """Split text into chunks and build FAISS index. Returns chunk count."""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.create_documents(
            [text],
            metadatas=[{"source": source}],
        )
        self.vectorstore = FAISS.from_documents(chunks, self.embeddings)
        print(f"  ✓ Indexed {len(chunks)} chunks from '{source}'")
        return len(chunks)

    def ingest_file(self, path: str) -> int:
        """Ingest a .txt or .pdf file."""
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Document not found: {path}")

        if p.suffix == ".pdf":
            from langchain_community.document_loaders import PyPDFLoader
            loader = PyPDFLoader(str(p))
            docs   = loader.load()
            text   = "\n\n".join(d.page_content for d in docs)
        else:
            text = p.read_text(encoding="utf-8")

        return self.ingest_text(text, source=p.name)

    # ── retrieval ──────────────────────────────────────────────────────────

    def _reformulate_query(self, question: str) -> str:
        """Rewrite the query to be more search-friendly."""
        prompt = textwrap.dedent(f"""
            You are a search query optimizer for a RAG system.
            Rules:
            - Keep proper nouns, technical terms, and acronyms EXACTLY as written
            - Expand the query with synonyms for generic words only
            - Return ONLY the reformulated query, nothing else

            Original: {question}
            Reformulated:
        """).strip()
        response = self.generate_llama_answer(
            system_prompt=prompt,
            question=question
        )
        return response

    def retrieve(self, question: str, trace=None) -> tuple[str, list[str]]:
        """
        Retrieve top-k chunks.

        Returns
        -------
        (effective_query, list_of_context_strings)
        """
        if self.vectorstore is None:
            raise RuntimeError("Call ingest_text() or ingest_file() first.")

        effective_query = question
        if self.use_reformulation:
            effective_query = self._reformulate_query(question)

        docs = self.vectorstore.similarity_search(effective_query, k=self.top_k)
        contexts = [d.page_content for d in docs]

        # Langfuse span
        if trace:
            trace.span(
                CreateSpan(
                    name="retrieval",
                    input={"query": question, "reformulated": effective_query},
                    output={"chunks_retrieved": len(contexts), "contexts": contexts[:2]},
                    metadata={"top_k": self.top_k, "reformulation": self.use_reformulation},
                )
            )

        return effective_query, contexts

    # ── generation ─────────────────────────────────────────────────────────

    def load_llama_local(self):
        from langchain_community.llms import Ollama
        print(f"🔄 Initializing llama3.2:1b...")
        llm = Ollama(
            model="llama3.2:1b",
            temperature=0.2,
        )
        print(f"✅ llama3.2:1b initialized")
        return llm

    def generate_llama_answer(self, system_prompt: str, question: str):
        llm = self.load_llama_local()
        full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
        print(f"🔄 Generating response with llama3.2:1b...")
        response = llm.invoke(full_prompt)
        print(f"✅ Response generated by llama3.2:1b")
        return response.strip()

   

    

    def generate(self, question: str, contexts: list[str], trace=None) -> str:
        """Generate an answer grounded in the provided contexts."""
        context_block = "\n\n---\n\n".join(contexts)
        system_prompt = textwrap.dedent(f"""
            You are a precise, helpful assistant. Answer the question using ONLY
            the provided context. If the context does not contain the answer,
            say "I don't have enough information to answer this."

            Context:
            {context_block}
        """).strip()

        start = time.time()
        
        latency  = round(time.time() - start, 3)
        answer   = self.generate_llama_answer(system_prompt, question)

        # Langfuse generation span
        if trace:
            trace.generation(
                CreateGeneration(
                    name="llm-generation",
                    model=self.llm_model,
                    input=question,
                    output=answer,
                    metadata={"latency_s": latency, "context_chunks": len(contexts)},
                )
            )

        return answer

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
        effective_query, contexts = self.retrieve(question, trace=trace)
        answer = self.generate(question, contexts, trace=trace)
        latency = round(time.time() - t0, 3)

        return {
            "question":       question,
            "answer":         answer,
            "contexts":       contexts,
            "effective_query": effective_query,
            "latency_s":      latency,
        }


# ══════════════════════════════════════════════════════════════════════════════
# RAGAS EVALUATION
# ══════════════════════════════════════════════════════════════════════════════

def run_ragas(results: list[dict]) -> dict:
    """
    Run RAGAS on a list of RAG results.

    Each result must have: question, answer, contexts, ground_truth
    """
    print("\n📐 Running RAGAS evaluation…")

    # RAGAS v0.4.x will default to OpenAI() if no LLM is provided, which triggers
    # OPENAI_API_KEY errors. Force a local Ollama model instead.
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2")
    ollama_host = os.getenv("OLLAMA_HOST") or os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434"

    dataset = HFDataset.from_dict({
        "question":   [r["question"]   for r in results],
        "answer":     [r["answer"]     for r in results],
        "contexts":   [r["contexts"]   for r in results],
        "ground_truth": [r["ground_truth"] for r in results],
    })

    metrics = [answer_relevancy, faithfulness, context_recall, context_precision]

    llm = None
    try:
        from langchain_ollama import ChatOllama

        llm = ChatOllama(model=ollama_model, base_url=ollama_host, temperature=0)
    except Exception:
        try:
            from langchain_community.llms import Ollama

            llm = Ollama(model=ollama_model, base_url=ollama_host)
        except Exception as e:
            print(f"⚠  Skipping RAGAS: could not initialize Ollama LLM ({e}).")
            return {
                "answer_relevancy": None,
                "faithfulness": None,
                "context_recall": None,
                "context_precision": None,
                "composite": None,
            }

    # Some RAGAS metrics use embeddings; provide local HF embeddings to avoid provider defaults.
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBED_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )

    run_config = None
    try:
        from ragas.run_config import RunConfig

        run_config = RunConfig(timeout=300)
    except Exception:
        run_config = None

    score_obj = evaluate(
        dataset,
        metrics=metrics,
        llm=llm,
        embeddings=embeddings,
        raise_exceptions=False,
        batch_size=1,
        run_config=run_config,
        show_progress=True,
    )

    def _mean_metric(value):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, list):
            vals = [float(v) for v in value if isinstance(v, (int, float)) and v == v]
            return (sum(vals) / len(vals)) if vals else None
        try:
            return float(value)
        except Exception:
            return None

    answer_rel = _mean_metric(score_obj["answer_relevancy"])
    faithful   = _mean_metric(score_obj["faithfulness"])
    recall     = _mean_metric(score_obj["context_recall"])
    precision  = _mean_metric(score_obj["context_precision"])

    scores = {
        "answer_relevancy":   (round(answer_rel, 4) if answer_rel is not None else None),
        "faithfulness":       (round(faithful, 4) if faithful is not None else None),
        "context_recall":     (round(recall, 4) if recall is not None else None),
        "context_precision":  (round(precision, 4) if precision is not None else None),
    }
    present = [v for v in scores.values() if isinstance(v, (int, float))]
    scores["composite"] = round(sum(present) / len(present), 4) if present else None

    print("  RAGAS results:")
    for k, v in scores.items():
        if isinstance(v, (int, float)):
            bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
            print(f"    {k:<25} {bar} {v:.4f}")
        else:
            print(f"    {k:<25} (n/a)")

    return scores


# ══════════════════════════════════════════════════════════════════════════════
# LANGFUSE INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════

def log_experiment_to_langfuse(
    lf: Langfuse,
    experiment_name: str,
    config: dict,
    results: list[dict],
    ragas_scores: dict,
):
    """
    Log a full experiment run to Langfuse:
    - One top-level trace per experiment
    - One span per Q&A pair
    - RAGAS scores as numeric scores on the trace
    """
    if lf is None:
        return

    print(f"\n📡 Logging to Langfuse: {experiment_name}")
    trace = lf.trace(
        CreateTrace(
            name=experiment_name,
            metadata={
                "config":       config,
                "ragas_scores": ragas_scores,
                "n_questions":  len(results),
                "timestamp":    datetime.datetime.now(datetime.timezone.utc).isoformat(),
                # langfuse==1.14.0 doesn't accept trace tags directly; store them in metadata.
                "tags":         ["rag-eval", "novamind"],
            },
        )
    )

    # Log each Q&A as a span
    for i, r in enumerate(results):
        trace.span(
            CreateSpan(
                name=f"qa_{i+1}",
                input={"question": r["question"]},
                output={
                    "answer":   r["answer"],
                    "contexts": r["contexts"][:1],   # first context only to save space
                },
                metadata={
                    "effective_query": r.get("effective_query", ""),
                    "latency_s":       r.get("latency_s", 0),
                    "ground_truth":    r.get("ground_truth", ""),
                },
            )
        )

    # Log RAGAS scores (CreateScore rejects None; skipped metrics stay in trace metadata only)
    for metric, value in ragas_scores.items():
        if value is None or not isinstance(value, (int, float)):
            continue
        trace.score(
            CreateScore(
                name=metric,
                value=float(value),
                comment=f"RAGAS {metric} for experiment '{experiment_name}'",
            )
        )

    lf.flush()
    print(f"  ✓ Trace logged → {LANGFUSE_HOST}")
    return trace.id


# ══════════════════════════════════════════════════════════════════════════════
# EXPERIMENT RUNNER
# ══════════════════════════════════════════════════════════════════════════════

EXPERIMENT_GRID = [
    # (chunk_size, overlap, top_k, reformulation, label)
    (1000, 200, 6, True,  "baseline"),
    (500,  100, 6, True,  "small_chunks"),
    (2000, 400, 6, True,  "large_chunks"),
    (1000, 200, 3, True,  "topk_3"),
    (1000, 200, 10, True, "topk_10"),
    (1000, 200, 6, False, "no_reformulation"),
]


def run_experiment(
    config: tuple,
    corpus_text: str,
    eval_rows: list[dict],
    lf: Optional[Langfuse],
) -> dict:
    """Run one experiment configuration and return results + scores."""
    chunk_size, overlap, top_k, use_reform, label = config
    print(f"\n{'─'*60}")
    print(f"🧪 Experiment: {label}")
    print(f"   chunk={chunk_size}, overlap={overlap}, top_k={top_k}, reform={use_reform}")

    pipeline = RAGPipeline(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        top_k=top_k,
        use_reformulation=use_reform,
    )
    pipeline.ingest_text(corpus_text, source="corpus")

    results = []
    for row in eval_rows:
        question     = row["question"]
        ground_truth = row["ground_truth"]

        # Create a per-question Langfuse trace
        lf_trace = None
        if lf:
            lf_trace = lf.trace(
                CreateTrace(
                    id=f"{label}-{question[:20]}",
                    name=f"{label}: {question[:80]}",
                    input=question,
                    metadata={
                        "experiment": label,
                        "ground_truth": ground_truth,
                        "tags": ["rag-eval", label],
                    },
                )
            )

        result = pipeline.query(question, trace=lf_trace)
        result["ground_truth"] = ground_truth
        results.append(result)

        print(f"  Q: {question[:70]}…")
        print(f"  A: {result['answer'][:120]}…\n")

    # RAGAS evaluation
    ragas_scores = run_ragas(results)

    # Log experiment summary to Langfuse
    experiment_name = f"novamind-rag-{label}-{datetime.date.today()}"
    config_dict = {
        "chunk_size": chunk_size,
        "overlap":    overlap,
        "top_k":      top_k,
        "reform":     use_reform,
        "label":      label,
    }
    trace_id = log_experiment_to_langfuse(lf, experiment_name, config_dict, results, ragas_scores)

    return {
        "label":        label,
        "config":       config_dict,
        "ragas_scores": ragas_scores,
        "results":      results,
        "trace_id":     trace_id,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def load_eval_csv(path: str) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "question":     row["question"].strip(),
                "ground_truth": row["ground_truth"].strip(),
            })
    print(f"✓ Loaded {len(rows)} evaluation questions from {path}")
    return rows


def save_results(all_experiments: list[dict], out_dir: str = "."):
    """Save summary CSV + full JSON."""
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    # JSON dump
    json_path = os.path.join(out_dir, f"rag_eval_results_{ts}.json")
    with open(json_path, "w") as f:
        json.dump(all_experiments, f, indent=2, default=str)
    print(f"\n💾 Full results → {json_path}")

    # Summary CSV
    csv_path = os.path.join(out_dir, f"rag_eval_summary_{ts}.csv")
    rows = []
    for exp in all_experiments:
        row = {"experiment": exp["label"], **exp["config"], **exp["ragas_scores"]}
        rows.append(row)
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    print(f"💾 Summary CSV  → {csv_path}")

    # Console comparison table
    print("\n" + "═" * 90)
    print(f"{'EXPERIMENT':<22} {'RELEVANCY':>10} {'FAITHFUL':>10} {'RECALL':>10} {'PRECISION':>10} {'COMPOSITE':>10}")
    print("─" * 90)
    def _fmt(v):
        if isinstance(v, (int, float)):
            return f"{v:>10.4f}"
        return f"{'n/a':>10}"

    for exp in all_experiments:
        s = exp["ragas_scores"]
        print(
            f"{exp['label']:<22} "
            f"{_fmt(s.get('answer_relevancy'))} "
            f"{_fmt(s.get('faithfulness'))} "
            f"{_fmt(s.get('context_recall'))} "
            f"{_fmt(s.get('context_precision'))} "
            f"{_fmt(s.get('composite'))}"
        )
    print("═" * 90)

    # Best config (only among runs with a numeric composite)
    with_scores = [e for e in all_experiments if isinstance(e["ragas_scores"].get("composite"), (int, float))]
    if with_scores:
        best = max(with_scores, key=lambda e: e["ragas_scores"]["composite"])
        c = best["ragas_scores"]["composite"]
        print(f"\n🏆 Best config: {best['label']}  (composite={c:.4f})")
    else:
        print("\n🏆 Best config: (no composite scores available)")


def main():
    parser = argparse.ArgumentParser(description="NovaMind RAG Evaluator")
    parser.add_argument("--experiment", choices=["all", "single"], default="all",
                        help="Run all grid experiments or just the baseline")
    parser.add_argument("--csv",  default="eval_dataset.csv",
                        help="Path to evaluation CSV")
    parser.add_argument("--doc",  default=None,
                        help="Path to a .txt or .pdf to index (otherwise uses built-in corpus)")
    parser.add_argument("--out",  default=".", help="Output directory for result files")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════╗")
    print("║   NovaMind RAG Evaluation Harness            ║")
    print("║   RAGAS + Langfuse + Experiment Grid         ║")
    print("╚══════════════════════════════════════════════╝\n")

    # Load corpus
    if args.doc:
        corpus_text = Path(args.doc).read_text(encoding="utf-8")
        print(f"✓ Using document: {args.doc}")
    else:
        corpus_text = BUILTIN_CORPUS
        print("✓ Using built-in ML corpus")

    # Load eval data
    eval_rows = load_eval_csv(args.csv)

    # Langfuse
    lf = get_langfuse()

    # Experiments to run
    if args.experiment == "single":
        grid = [EXPERIMENT_GRID[0]]  # baseline only
    else:
        grid = EXPERIMENT_GRID

    all_results = []
    for config in grid:
        exp_result = run_experiment(config, corpus_text, eval_rows, lf)
        all_results.append(exp_result)

    # Save
    os.makedirs(args.out, exist_ok=True)
    save_results(all_results, out_dir=args.out)

    if lf:
        lf.flush()
        print(f"\n✅ All traces flushed to Langfuse → {LANGFUSE_HOST}")


if __name__ == "__main__":
    main()
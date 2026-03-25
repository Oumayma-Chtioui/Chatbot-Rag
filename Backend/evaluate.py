import os

from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from langsmith import Client
from langsmith.evaluation import evaluate
from langsmith.schemas import Run, Example
from services.chatservice import generate_answer
import google.generativeai as genai

client = Client()

EVAL_USER_ID = 4
EVAL_SESSION_ID = "b05afd8330f1"

# ── Judge LLM ─────────────────────────────────────────────────────────────────
def get_judge_llm():
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    llm = genai.GenerativeModel('models/gemini-2.5-flash')
    return llm


# ── Define how to run your pipeline on each example ──────────────────────────
def run_novamind(inputs: dict) -> dict:
    result = generate_answer(
        question=inputs["question"],
        user_id=EVAL_USER_ID,
        session_id=EVAL_SESSION_ID
    )
    return {"answer": result["answer"]}

# ── LLM-as-judge evaluators ───────────────────────────────────────────────────
def correctness_evaluator(run: Run, example: Example) -> dict:
    predicted = run.outputs.get("answer", "")
    expected = example.outputs.get("answer", "")

    llm = get_judge_llm()

    prompt = f"""You are evaluating a RAG chatbot answer.

Question: {example.inputs.get("question")}
Expected Answer: {expected}
Predicted Answer: {predicted}

Score the predicted answer from 0 to 1 based on correctness compared to the expected answer.
- 1.0: Completely correct
- 0.75: Mostly correct with minor errors
- 0.5: Partially correct
- 0.25: Mostly incorrect
- 0.0: Completely wrong or hallucinated

Respond with only a number between 0 and 1."""

    response = llm.generate_content(prompt).text
    try:
        score = float(response.content.strip())
        score = max(0.0, min(1.0, score))
    except:
        score = 0.0

    return {"key": "correctness", "score": score}


def faithfulness_evaluator(run: Run, example: Example) -> dict:
    predicted = run.outputs.get("answer", "")

    llm = get_judge_llm()

    prompt = f"""You are evaluating whether a RAG chatbot answer is faithful to the documents.

Question: {example.inputs.get("question")}
Answer: {predicted}

A faithful answer:
- Only contains information that could come from a document
- Does not invent facts or hallucinate
- Says it does not know if information is unavailable

Score from 0 to 1:
- 1.0: Completely faithful, no hallucination
- 0.5: Some unsupported claims
- 0.0: Mostly hallucinated

Respond with only a number between 0 and 1."""

    response = llm.generate_content(prompt).text
    try:
        score = float(response.content.strip())
        score = max(0.0, min(1.0, score))
    except:
        score = 0.0

    return {"key": "faithfulness", "score": score}


# ── Run evaluation ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting evaluation...")

    results = evaluate(
        run_novamind,
        data="Machine Learning Lecture",
        evaluators=[correctness_evaluator, faithfulness_evaluator],
        experiment_prefix="novamind-v1",
        metadata={"version": "1.0", "model": "Open Router Free Models"}
    )

    print("✅ Evaluation complete")
    print(f"Results: {results}")
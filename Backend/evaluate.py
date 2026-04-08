import os
from langsmith import Client
from langsmith.evaluation import evaluate
from langsmith.schemas import Run, Example
from services.chatservice import generate_answer, openrouter_generate_answer, openrouter_generate_answer_2

client = Client()

EVAL_USER_ID = 4
EVAL_SESSION_ID = "693107c2a9d2"

# ── Judge LLM ─────────────────────────────────────────────────────────────────

def get_judge_llm(system_prompt: str, question: str):
    models = ["openrouter/free", "openrouter/free1"]
    for model in models:
        try:
            
            if model == "openrouter/free":
                print(f"⏰ Attempting to generate answer with {model} after timeout...")
                answer = openrouter_generate_answer(system_prompt, question)
                print(f"✅ Successfully generated answer with {model} after timeout")
            elif model == "openrouter/free1":
                print(f"⏰ Attempting to generate answer with {model} after timeout...")
                answer = openrouter_generate_answer_2(system_prompt, question)
                print(f"✅ Successfully generated answer with {model} after timeout")

            if answer:
                print(f"✅ Successfully generated answer with {model} after timeout")
                return answer
        except Exception as e:
            print(f"❌ Failed to generate answer with {model} after timeout: {e}")
            continue
    print("❌ All fallback models failed after timeout")
    return "Sorry, I'm having trouble generating a response right now. Please try again later."


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

    response = get_judge_llm(prompt, example.inputs.get("question"))
    try:
        score = float(response.choices[0].message.content.strip())
        score = max(0.0, min(1.0, score))
    except:
        score = 0.0

    return {"key": "correctness", "score": score}


# def faithfulness_evaluator(run: Run, example: Example) -> dict:
#     predicted = run.outputs.get("answer", "")

#     llm = get_judge_llm()

#     prompt = f"""You are evaluating whether a RAG chatbot answer is faithful to the documents.

# Question: {example.inputs.get("question")}
# Answer: {predicted}

# A faithful answer:
# - Only contains information that could come from a document
# - Does not invent facts or hallucinate
# - Says it does not know if information is unavailable

# Score from 0 to 1:
# - 1.0: Completely faithful, no hallucination
# - 0.5: Some unsupported claims
# - 0.0: Mostly hallucinated

# Respond with only a number between 0 and 1."""

#     response = llm.chat.completions.create(
#         model="llama-3.1-8b-instant",
#         messages=[{"role": "system", "content": prompt}]
#     )
#     try:
#         score = float(response.choices[0].message.content.strip())
#         score = max(0.0, min(1.0, score))
#     except:
#         score = 0.0

#     return {"key": "faithfulness", "score": score}


# ── Run evaluation ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting evaluation...")

    results = evaluate(
        run_novamind,
        data="Machine Learning Lecture",
        evaluators=[correctness_evaluator],
        experiment_prefix="novamind-v1",
        metadata={"version": "1.0", "model": "Open Router Free Models"}
    )

    print("✅ Evaluation complete")
    print(f"Results: {results}")
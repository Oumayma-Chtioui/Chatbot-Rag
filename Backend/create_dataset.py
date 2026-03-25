from langsmith import Client

client = Client()

# Create dataset
dataset = client.create_dataset(
    dataset_name="Machine Learning Lecture",
    description="Evaluation dataset for  RAG chatbot"
)

examples = [
    # Andrew Ng Lecture
    {"question": "Who is the instructor of CS229?", "answer": "Andrew Ng"},
    {"question": "What is the name of the head TA?", "answer": "Zico Kolter"},
    {"question": "When is the midterm scheduled?", "answer": "Thursday, November 8th at 6:00 PM"},
    {"question": "What programming languages are used for homework?", "answer": "MATLAB or Octave"},
    {"question": "How many people can be in a project group?", "answer": "Up to three people"},
    {"question": "What is the course website?", "answer": "http://cs229.stanford.edu"},
    {"question": "What is Arthur Samuel's definition of machine learning?", "answer": "The field that gives computers the ability to learn without being explicitly programmed"},
    {"question": "What are the four major topics covered in CS229?", "answer": "Supervised learning, learning theory, unsupervised learning, and reinforcement learning"},
    {"question": "What is the cocktail party problem?", "answer": "Separating individual voices from overlapping audio recordings using unsupervised learning"},
    {"question": "What is the difference between regression and classification?", "answer": "Regression predicts a continuous value while classification predicts a discrete value"},

    # Cahier des Charges
    # {"question": "What is the name of the company that commissioned the project?", "answer": "Elyos Digital"},
    # {"question": "What is the company's address?", "answer": "Rue Mohamed Shim, Rbat Monastir 5000"},
    # {"question": "What is the name of the intern?", "answer": "Oumayma Chtioui"},
    # {"question": "Who is the main supervisor?", "answer": "Iheb Akermi"},
    # {"question": "What vector database is specified?", "answer": "FAISS"},
    # {"question": "What frontend framework is required?", "answer": "TypeScript with React.js"},
    # {"question": "What is the target faithfulness score?", "answer": "Greater than 0.9"},
    # {"question": "What are the 5 steps of the RAG pipeline?", "answer": "Ingestion, Embedding, Storage, Retrieval, Generation"},
    # {"question": "What should the chatbot respond when information is not available?", "answer": "It should say it does not know rather than hallucinate"},
    # {"question": "What authentication method is used?", "answer": "JWT (JSON Web Tokens)"},
]

client.create_examples(
    inputs=[{"question": e["question"]} for e in examples],
    outputs=[{"answer": e["answer"]} for e in examples],
    dataset_id=dataset.id
)

print(f"✅ Created dataset with {len(examples)} examples")
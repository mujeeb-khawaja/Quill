import os
import json
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient

# Load environment variables
load_dotenv()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_URL = os.getenv("QDRANT_URL")

CV_FILE_PATH = "cv.json"
COLLECTION_NAME = "cv_portfolio"

def setup_knowledge_base():
    # 1. Load CV from JSON
    print(f"Loading {CV_FILE_PATH}...")
    with open(CV_FILE_PATH, "r", encoding="utf8") as f:
        data = json.load(f)
    
    # 2. Convert to Document chunks
    print("Creating Document chunks from JSON...")
    chunks = []
    for item in data:
        doc = Document(
            page_content=item["text"],
            metadata=item["metadata"]
        )
        chunks.append(doc)
    print(f"Created {len(chunks)} chunks.")
    
    # 3. Create Embeddings
    print("Initializing HuggingFaceBgeEmbeddings (BAAI/bge-small-en-v1.5)...")
    model_name = "BAAI/bge-small-en-v1.5"
    model_kwargs = {'device': 'cpu'}
    encode_kwargs = {'normalize_embeddings': True}
    embeddings = HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs=model_kwargs,
        encode_kwargs=encode_kwargs
    )
    
    # 4. Upsert to Qdrant
    print("Upserting chunks to Qdrant. (force_recreate=True will drop the existing collection first)")
    client = QdrantClient(
        url=QDRANT_URL, 
        api_key=QDRANT_API_KEY,
        timeout=60
    )
    
    qdrant = QdrantVectorStore.from_documents(
        chunks,
        embeddings,
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY,
        collection_name=COLLECTION_NAME,
        force_recreate=True, 
    )
    print("Successfully upserted CV chunks to Qdrant.")
    
    return qdrant

def test_retrieval(qdrant):
    print("\n" + "="*50)
    print("      🔍 TESTING SEMANTIC SEARCH")
    print("="*50)
    query = "What experience does Mujeeb have with AWS and Cloud deployment?"
    print(f"\nQuery: {query}")
    
    results = qdrant.similarity_search(query, k=2)
    
    for i, res in enumerate(results):
        print(f"\n[RANK {i+1}]")
        print(f"📄 RECORD CONTENT:\n{res.page_content}")
        print(f"🏷️  METADATA: {res.metadata}")
    
    print("\n" + "="*50)
    print("✅ TEST COMPLETE - Qdrant Chunks Received Successfully")
    print("="*50 + "\n")

if __name__ == "__main__":
    qdrant = setup_knowledge_base()
    test_retrieval(qdrant)
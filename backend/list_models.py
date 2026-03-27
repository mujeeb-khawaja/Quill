import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

print(f"\n--- Checking Available Embedding Models for your Key ---")
try:
    for m in genai.list_models():
        if 'embedContent' in m.supported_generation_methods:
            print(f"✅ Model found: {m.name} (Display: {m.display_name})")
except Exception as e:
    print(f"❌ Error listing models: {e}")

print("\n--- Done ---")

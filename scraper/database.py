import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("MONGODB_DATABASE", "news_pulse")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not configured")
client = MongoClient(MONGODB_URI)
db = client[DATABASE_NAME]
articles_collection = db["articles"]
clusters_collection = db["clusters"]
articles_collection.create_index("article_id", unique=True)
articles_collection.create_index("published_at")
clusters_collection.create_index("cluster_id", unique=True)

def test_connection():
    client.admin.command("ping")
    print("MongoDB connection successful")

if __name__ == "__main__":
    test_connection()

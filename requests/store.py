import os
from zapy.store import use_store
from dotenv import load_dotenv

load_dotenv()

store = use_store()
store.client_secret = os.getenv("CLIENT_SECRET")
store.client_id = os.getenv("CLIENT_ID")
store.grant_type = os.getenv("GRANT_TYPE")
store.username = os.getenv("USERNAME")
store.password = os.getenv("PASSWORD")

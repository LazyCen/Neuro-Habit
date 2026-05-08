import os
import requests
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

API_URL = os.environ.get("API_URL", "http://127.0.0.1:8000")
CRON_SECRET = os.environ.get("CRON_SECRET")

def run_insights_generation():
    """
    Triggers the background insight generation process.
    This simulates a cron job hitting the secure /admin endpoint.
    """
    if not CRON_SECRET:
        print("Error: CRON_SECRET is not configured properly.")
        return

    endpoint = f"{API_URL}/admin/generate-insights"
    headers = {
        "X-Cron-Secret": CRON_SECRET
    }
    
    print(f"Triggering background job at {endpoint}...")
    try:
        response = requests.post(endpoint, headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"Success! Processed {data.get('users_processed', 0)} users.")
            if data.get('errors'):
                print(f"Encountered errors: {data.get('errors')}")
        else:
            print(f"Failed with status {response.status_code}: {response.text}")
    except requests.RequestException as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    print("Starting background job runner...")
    run_insights_generation()

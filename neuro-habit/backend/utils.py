import numpy as np
from typing import List, Dict

def calculate_correlations(data: List[Dict]):
    """
    data should be a list of dicts with keys like 'steps', 'mood', 'screen_time', 'habits_completed'
    """
    if len(data) < 2:
        return {}

    steps = [d.get('steps', 0) for d in data]
    mood = [d.get('mood', 0) for d in data]
    screen_time = [d.get('screen_time', 0) for d in data]
    habits = [d.get('habits_completed', 0) for d in data]

    correlations = {}
    
    # Steps vs Mood
    if np.std(steps) > 0 and np.std(mood) > 0:
        correlations['steps_vs_mood'] = float(np.corrcoef(steps, mood)[0, 1])
    
    # Screen Time vs Habits
    if np.std(screen_time) > 0 and np.std(habits) > 0:
        correlations['screen_time_vs_habits'] = float(np.corrcoef(screen_time, habits)[0, 1])

    return correlations

import os
import json
import logging
import openai
from tenacity import retry, stop_after_attempt, wait_exponential

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None

logger = logging.getLogger(__name__)

# Initialize OpenAI client as a module-level singleton
_openai_client = None

def get_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if api_key:
            _openai_client = openai.AsyncOpenAI(api_key=api_key)
    return _openai_client

@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _call_openai(client, prompt):
    response = await client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "You are an insightful wellness assistant."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=300,
        temperature=0.7,
        response_format={"type": "json_object"}
    )
    return response.choices[0].message.content

async def generate_natural_language_insight(correlations: Dict):
    insights = []
    
    # Try using OpenAI if the key is available
    client = get_openai_client()
    if client:
        try:
            prompt = (
                f"Based on the following user data correlations, generate 1 to 2 personalized, "
                f"short insights or recommendations for a habit-tracking app. "
                f"Return the result strictly as a JSON object with an 'insights' array. "
                f"Each object in the array should have: "
                f"'text' (the insight message), 'type' (either 'positive', 'warning', or 'neutral'), "
                f"and 'icon' (a valid Ionicons name like 'heart', 'star', 'walk', 'flame', 'phone-portrait').\n"
                f"Correlations: {json.dumps(correlations)}"
            )
            
            content = await _call_openai(client, prompt)
            
            # To handle cases where it returns a JSON object instead of an array
            parsed = json.loads(content)
            if isinstance(parsed, list):
                return parsed
            elif isinstance(parsed, dict) and "insights" in parsed:
                return parsed["insights"]
            elif isinstance(parsed, dict):
                return [parsed]
        except json.JSONDecodeError as e:
            logger.error(f"OpenAI returned malformed or truncated JSON: {e}")
            if sentry_sdk:
                sentry_sdk.capture_exception(e)
            # Fallback to rule-based logic
        except Exception as e:
            logger.error(f"OpenAI insight generation failed: {e}", exc_info=True)
            if sentry_sdk:
                sentry_sdk.capture_exception(e)
            # Fallback to rule-based logic
            pass
            
    # Fallback rule-based insights
    if correlations.get('steps_vs_mood', 0) > 0.5:
        insights.append({
            "text": "Your mood improves significantly after reaching high step counts.",
            "type": "positive",
            "icon": "heart"
        })
    
    if correlations.get('screen_time_vs_habits', 0) < -0.5:
        insights.append({
            "text": "You complete fewer habits on days with high screen time. Try setting a limit.",
            "type": "warning",
            "icon": "phone-portrait"
        })
        
    return insights

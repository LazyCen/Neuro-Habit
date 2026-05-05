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

def generate_natural_language_insight(correlations: Dict):
    insights = []
    
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

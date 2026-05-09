from pydantic import BaseModel, Field
from typing import Optional
import datetime

class Habit(BaseModel):
    id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=100)

class MoodLog(BaseModel):
    mood: int = Field(..., ge=1, le=10)
    note: Optional[str] = Field(None, max_length=1000)
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.now)

class DailyMetrics(BaseModel):
    steps: int = Field(..., ge=0)
    screen_time: float = Field(..., ge=0.0) # hours
    date: datetime.date = Field(default_factory=datetime.date.today)

class Insight(BaseModel):
    text: str = Field(..., min_length=10, max_length=5000)
    type: str = Field(..., pattern="^(positive|neutral|warning)$")
    icon: str = Field(..., max_length=50)

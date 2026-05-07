from pydantic import BaseModel, Field
from typing import Optional
import datetime

class Habit(BaseModel):
    id: Optional[str] = None
    name: str

class MoodLog(BaseModel):
    mood: int  # 1-10
    note: Optional[str] = None
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.now)

class DailyMetrics(BaseModel):
    steps: int
    screen_time: float  # hours
    date: datetime.date = Field(default_factory=datetime.date.today)

class Insight(BaseModel):
    text: str
    type: str
    icon: str

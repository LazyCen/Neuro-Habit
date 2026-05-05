import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true, // Necessary for client-side Expo usage
});

const DEFAULT_INSIGHTS = [
  { text: "Keep moving to maintain your momentum!", icon: "walk" },
  { text: "Consistency is key to building lasting habits.", icon: "star" },
  { text: "Try to limit screen time before bed.", icon: "moon" }
];

export async function generateInsights(data) {
  if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY === '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') {
    return generateRuleBasedInsights(data);
  }

  try {
    const prompt = `
      Analyze this user's health and productivity data for today:
      - Steps: ${data.steps}
      - Screen Time: ${data.screenTime}h
      - Mood: ${data.mood}/10
      - Habits Completed: ${data.habitsCompleted}/${data.habitsTotal}
      - Current Streak: ${data.streak} days

      Provide 3-4 short, punchy, and personalized insights or pieces of advice. 
      Format each insight as a JSON object in an array: [{"text": "insight text", "icon": "ionicons-name"}].
      Icons should be valid Ionicons names (e.g., 'walk', 'phone-portrait', 'star', 'flame', 'happy', 'trending-up').
      Only return the JSON array.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error("OpenAI Error:", error);
    return generateRuleBasedInsights(data);
  }
}

function generateRuleBasedInsights(data) {
  const insights = [];

  if (data.steps > 6000) {
    insights.push({ text: "You feel better on active days. Keep moving!", icon: "walk" });
  } else {
    insights.push({ text: "A short walk could boost your energy today.", icon: "walk" });
  }

  if (data.screenTime > 4) {
    insights.push({ text: "High screen time detected. Consider a digital detox evening.", icon: "phone-portrait" });
  }

  if (data.habitsCompleted / data.habitsTotal > 0.5) {
    insights.push({ text: "You're building strong habits. Stay consistent!", icon: "star" });
  }

  if (data.streak > 10) {
      insights.push({ text: `Incredible! A ${data.streak}-day streak. You're on fire!`, icon: "flame" });
  }

  if (insights.length === 0) return DEFAULT_INSIGHTS;
  return insights;
}

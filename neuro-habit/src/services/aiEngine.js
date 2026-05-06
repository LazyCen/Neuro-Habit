// AI insights are generated server-side or via rule-based logic on-device.
// The OpenAI SDK has been intentionally removed from the client to prevent
// API key exposure in the app bundle. (P0-2)

const DEFAULT_INSIGHTS = [
  { text: "Keep moving to maintain your momentum!", icon: "walk" },
  { text: "Consistency is key to building lasting habits.", icon: "star" },
  { text: "Try to limit screen time before bed.", icon: "moon" },
];

/**
 * Generates rule-based insights from user metrics.
 * OpenAI-powered insights are fetched from the backend via backendService.getInsights().
 */
export function generateInsights(data) {
  return generateRuleBasedInsights(data);
}

function generateRuleBasedInsights(data) {
  const insights = [];

  if (data.steps > 6000) {
    insights.push({ text: "You feel better on active days. Keep moving!", icon: "walk" });
  } else {
    insights.push({ text: "A short walk could boost your energy today.", icon: "walk" });
  }

  if (data.screenTime > 4) {
    insights.push({
      text: "High screen time detected. Consider a digital detox evening.",
      icon: "phone-portrait",
    });
  }

  const completionRatio =
    data.habitsTotal > 0 ? data.habitsCompleted / data.habitsTotal : 0;
  if (completionRatio > 0.5) {
    insights.push({ text: "You're building strong habits. Stay consistent!", icon: "star" });
  }

  if (data.streak > 10) {
    insights.push({
      text: `Incredible! A ${data.streak}-day streak. You're on fire!`,
      icon: "flame",
    });
  }

  if (insights.length === 0) return DEFAULT_INSIGHTS;
  return insights;
}

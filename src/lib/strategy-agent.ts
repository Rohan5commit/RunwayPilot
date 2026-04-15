import { buildStrategySnapshot } from "@/lib/analysis";
import { formatCurrency, formatRunway } from "@/lib/formatters";
import type { AnalysisResult, ForecastScenario, StrategyResponse } from "@/lib/types";

const SYSTEM_PROMPT = [
  "You are RunwayPilot's Strategy Agent.",
  "Act like a careful finance operations analyst, not a hype chatbot.",
  "Use plain business language.",
  "Never invent financial data or unsupported causes.",
  "Distinguish fact, inference, and recommendation.",
  "Keep advice concise, practical, and actionable.",
  "Return only valid JSON with keys summary, top_risks, recommended_actions, confidence, board_ready_note."
].join(" ");

function fallbackStrategy(
  analysis: AnalysisResult,
  scenario: ForecastScenario,
  question?: string
): StrategyResponse {
  const topRisks = analysis.risks.slice(0, 3);
  const recommendedActions = topRisks.map((risk) => risk.recommendation).slice(0, 3);

  while (recommendedActions.length < 3) {
    recommendedActions.push(
      [
        "Review the highest-spend vendors and confirm which items are fixed versus negotiable.",
        "Run a downside scenario before committing to new operating expense.",
        "Remove duplicated or low-value subscriptions before the next renewal window."
      ][recommendedActions.length]
    );
  }

  return {
    summary: `${analysis.summary.highestRiskAlert}. Current cash balance is ${formatCurrency(analysis.summary.cashBalance)} with ${formatRunway(analysis.summary.runwayMonthsRemaining)} of runway on the baseline view. ${question ? `Question focus: ${question}.` : ""}`.trim(),
    top_risks: topRisks.map((risk) => `${risk.title}: ${risk.metric}`),
    recommended_actions: recommendedActions,
    confidence: topRisks.length >= 3 ? "high" : "medium",
    board_ready_note: `Fact: baseline runway is ${formatRunway(analysis.summary.runwayMonthsRemaining)} and the selected ${scenario.name.toLowerCase()} scenario lands at ${formatRunway(scenario.runwayMonths)}. Inference: current pressure is being driven by spend quality and softer collections rather than a single isolated issue. Recommendation: address the top risk items now instead of waiting for the next monthly close.`
  };
}

function extractJsonObject(content: string) {
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as StrategyResponse;
}

async function callNim(prompt: string) {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  const model = process.env.NVIDIA_NIM_MODEL || "nvidia/llama-3.3-nemotron-super-49b-v1.5";

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      top_p: 0.8,
      max_tokens: 650,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`NVIDIA NIM request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("NVIDIA NIM returned an empty response.");
  }

  return content;
}

export async function generateStrategyResponse({
  analysis,
  scenario,
  question
}: {
  analysis: AnalysisResult;
  scenario: ForecastScenario;
  question?: string;
}) {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;

  if (!apiKey) {
    return {
      mode: "fallback" as const,
      strategy: fallbackStrategy(analysis, scenario, question)
    };
  }

  const snapshot = buildStrategySnapshot(analysis, scenario);
  const prompt = [
    "Use the financial facts below to answer the user's question.",
    question ? `Question: ${question}` : "Question: Summarize the current runway and what the operator should do next.",
    "Explain assumptions and keep the confidence honest.",
    "Facts:",
    JSON.stringify(snapshot, null, 2)
  ].join("\n\n");

  try {
    const firstAttempt = await callNim(prompt);
    return {
      mode: "nim" as const,
      strategy: extractJsonObject(firstAttempt)
    };
  } catch (firstError) {
    try {
      const retryPrompt = `${prompt}\n\nReturn only a valid JSON object. No markdown fences.`;
      const secondAttempt = await callNim(retryPrompt);
      return {
        mode: "nim" as const,
        strategy: extractJsonObject(secondAttempt)
      };
    } catch (secondError) {
      console.error("RunwayPilot NIM fallback engaged", firstError, secondError);
      return {
        mode: "fallback" as const,
        strategy: fallbackStrategy(analysis, scenario, question)
      };
    }
  }
}

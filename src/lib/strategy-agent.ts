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
  "Return only valid JSON with this exact schema:",
  '{"summary":"string","top_risks":["string"],"recommended_actions":["string"],"confidence":"high | medium | low","board_ready_note":"string"}',
  "top_risks and recommended_actions must be arrays of plain strings, not arrays of objects.",
  "confidence must be one of high, medium, or low.",
  "Do not return markdown fences or any surrounding commentary."
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
  return JSON.parse(cleaned) as unknown;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeSummary(value: unknown, fallback: string) {
  const direct = normalizeText(value);
  if (direct) {
    return direct;
  }

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const summary = value as Record<string, unknown>;
  const highestRiskAlert = normalizeText(summary.highestRiskAlert);
  const cashBalance = typeof summary.cashBalance === "number" ? formatCurrency(summary.cashBalance) : "";
  const runway = typeof summary.runwayMonthsRemaining === "number" ? formatRunway(summary.runwayMonthsRemaining) : "";
  const parts = [highestRiskAlert];

  if (cashBalance && runway) {
    parts.push(`Current cash balance is ${cashBalance} with ${runway} of runway.`);
  }

  return parts.filter(Boolean).join(" ") || fallback;
}

function normalizeConfidence(
  value: unknown,
  fallback: StrategyResponse["confidence"]
): StrategyResponse["confidence"] {
  const direct = normalizeText(value).toLowerCase();
  if (direct === "high" || direct === "medium" || direct === "low") {
    return direct;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isNaN(numeric)) {
    if (numeric >= 70) {
      return "high";
    }
    if (numeric >= 40) {
      return "medium";
    }
    return "low";
  }

  return fallback;
}

function mergeWithFallback(primary: string[], fallback: string[]) {
  const merged = [...primary.filter(Boolean)];

  for (const item of fallback) {
    if (merged.length >= 3) {
      break;
    }
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }

  return merged.slice(0, 3);
}

function normalizeRiskList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => {
      const direct = normalizeText(item);
      if (direct) {
        return direct;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      const record = item as Record<string, unknown>;
      const title = normalizeText(record.title);
      const metric = normalizeText(record.metric);
      return [title, metric].filter(Boolean).join(": ");
    })
    .filter(Boolean);

  return mergeWithFallback(normalized, fallback);
}

function normalizeActionList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => {
      const direct = normalizeText(item);
      if (direct) {
        return direct;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      const record = item as Record<string, unknown>;
      const action = normalizeText(record.action);
      const note = normalizeText(record.note);
      return [action, note].filter(Boolean).join(": ");
    })
    .filter(Boolean);

  return mergeWithFallback(normalized, fallback);
}

function normalizeStrategyResponse(value: unknown, fallback: StrategyResponse): StrategyResponse {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;

  return {
    summary: normalizeSummary(record.summary, fallback.summary),
    top_risks: normalizeRiskList(record.top_risks, fallback.top_risks),
    recommended_actions: normalizeActionList(record.recommended_actions, fallback.recommended_actions),
    confidence: normalizeConfidence(record.confidence, fallback.confidence),
    board_ready_note: normalizeText(record.board_ready_note) || fallback.board_ready_note
  };
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
  const fallback = fallbackStrategy(analysis, scenario, question);

  if (!apiKey) {
    return {
      mode: "fallback" as const,
      strategy: fallback
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
      strategy: normalizeStrategyResponse(extractJsonObject(firstAttempt), fallback)
    };
  } catch (firstError) {
    try {
      const retryPrompt = `${prompt}\n\nReturn only a valid JSON object with the exact schema requested. No markdown fences. No nested objects inside top_risks or recommended_actions.`;
      const secondAttempt = await callNim(retryPrompt);
      return {
        mode: "nim" as const,
        strategy: normalizeStrategyResponse(extractJsonObject(secondAttempt), fallback)
      };
    } catch (secondError) {
      console.error("RunwayPilot NIM fallback engaged", firstError, secondError);
      return {
        mode: "fallback" as const,
        strategy: fallback
      };
    }
  }
}

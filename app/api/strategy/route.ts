import { NextResponse } from "next/server";
import { z } from "zod";
import { generateStrategyResponse } from "@/lib/strategy-agent";
import type { AnalysisResult, ForecastScenario } from "@/lib/types";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  analysis: z.unknown(),
  scenario: z.unknown(),
  question: z.string().trim().max(240).optional()
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const result = await generateStrategyResponse({
      analysis: payload.analysis as AnalysisResult,
      scenario: payload.scenario as ForecastScenario,
      question: payload.question
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("RunwayPilot strategy route failed", error);
    return NextResponse.json(
      {
        error: "Unable to generate the CFO strategy insight right now."
      },
      { status: 500 }
    );
  }
}

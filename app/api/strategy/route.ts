import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { generateStrategyResponse } from "@/lib/strategy-agent";
import type { ForecastScenario, StrategyAnalysisInput } from "@/lib/types";

export const dynamic = "force-dynamic";

const riskSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const analysisSummarySchema = z.object({
  cashBalance: z.number(),
  monthlyBurn: z.number(),
  netCashflow: z.number(),
  runwayMonthsRemaining: z.number(),
  revenueTrendPct: z.number(),
  expenseTrendPct: z.number(),
  largestCostCategory: z.string(),
  highestRiskAlert: z.string()
});

const categorySpendSchema = z.object({
  category: z.enum(["payroll", "software", "infra", "marketing", "operations", "revenue", "other"]),
  amount: z.number(),
  share: z.number()
});

const vendorSpendSchema = z.object({
  vendor: z.string(),
  amount: z.number(),
  share: z.number(),
  category: z.enum(["payroll", "software", "infra", "marketing", "operations", "revenue", "other"])
});

const riskFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: riskSeveritySchema,
  metric: z.string(),
  recommendation: z.string(),
  agent: z.literal("Risk Agent")
});

const analysisSchema = z.object({
  summary: analysisSummarySchema,
  topCategories: z.array(categorySpendSchema).max(6),
  topVendors: z.array(vendorSpendSchema).max(6),
  risks: z.array(riskFindingSchema).max(6)
});

const scenarioSchema = z.object({
  name: z.string(),
  assumption: z.string(),
  runwayMonths: z.number(),
  endingBalance: z.number(),
  points: z.array(
    z.object({
      month: z.string(),
      monthLabel: z.string(),
      revenue: z.number(),
      outflow: z.number(),
      netCashflow: z.number(),
      cashBalance: z.number(),
      runwayMonths: z.number()
    })
  ).min(1).max(12)
});

const requestSchema = z.object({
  analysis: analysisSchema,
  scenario: scenarioSchema,
  question: z.string().trim().max(240).optional()
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const result = await generateStrategyResponse({
      analysis: payload.analysis as StrategyAnalysisInput,
      scenario: payload.scenario as ForecastScenario,
      question: payload.question
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Strategy request payload is invalid."
        },
        { status: 400 }
      );
    }

    console.error("RunwayPilot strategy route failed", error);
    return NextResponse.json(
      {
        error: "Unable to generate the CFO strategy insight right now."
      },
      { status: 500 }
    );
  }
}

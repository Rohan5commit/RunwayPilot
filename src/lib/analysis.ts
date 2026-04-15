import type { AnalysisResult, ForecastScenario, MonthlySnapshot, RiskFinding, ScenarioControls, StrategyAnalysisInput } from "@/lib/types";
import { labelizeCategory } from "@/lib/formatters";
import { classificationAgent } from "@/lib/classification-agent";
import {
  forecastAgent,
  buildCustomScenario as buildScenarioFromInputs,
  DEFAULT_SCENARIO_CONTROLS
} from "@/lib/forecast-agent";
import { intakeAgent } from "@/lib/intake-agent";
import { riskAgent } from "@/lib/risk-agent";

export const QUICK_QUESTIONS = [
  "Why did runway shrink this month?",
  "Which costs should we investigate first?",
  "What happens if revenue drops 20%?",
  "What if we reduce software spend by 15%?"
];

export const DEFAULT_QUESTION = QUICK_QUESTIONS[0];
export { DEFAULT_SCENARIO_CONTROLS };

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

function buildMonthRange(firstMonth: string, lastMonth: string) {
  const months: string[] = [];
  let cursor = new Date(`${firstMonth}-01T00:00:00Z`);
  const end = new Date(`${lastMonth}-01T00:00:00Z`);

  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return months;
}

function buildMonthlySnapshots(transactions: AnalysisResult["transactions"]) {
  const operatingTransactions = transactions.filter((transaction) => !transaction.isOpeningBalance);
  const monthsPresent = [...new Set(operatingTransactions.map((transaction) => transaction.month))].sort();

  if (monthsPresent.length === 0) {
    throw new Error("No operating transactions were found in the uploaded data.");
  }

  const openingCash = transactions
    .filter((transaction) => transaction.isOpeningBalance && transaction.direction === "inflow")
    .reduce((sum, transaction) => sum + transaction.absAmount, 0);

  let balance = openingCash;
  const monthly: MonthlySnapshot[] = [];
  const months = buildMonthRange(monthsPresent[0], monthsPresent[monthsPresent.length - 1]);

  for (const month of months) {
    const monthTransactions = transactions.filter(
      (transaction) => transaction.month === month && !transaction.isOpeningBalance
    );
    const revenue = monthTransactions
      .filter((transaction) => transaction.direction === "inflow" && transaction.category === "revenue")
      .reduce((sum, transaction) => sum + transaction.absAmount, 0);
    const outflow = monthTransactions
      .filter((transaction) => transaction.direction === "outflow")
      .reduce((sum, transaction) => sum + transaction.absAmount, 0);
    const nonOperatingNet = monthTransactions
      .filter((transaction) => transaction.direction === "inflow" && transaction.category !== "revenue")
      .reduce((sum, transaction) => sum + transaction.absAmount, 0);
    const netCashflow = revenue - outflow + nonOperatingNet;
    balance += netCashflow;

    monthly.push({
      month,
      monthLabel: new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      revenue,
      outflow,
      netCashflow,
      burn: Math.max(outflow - revenue, 0),
      cashBalance: balance
    });
  }

  return { monthly, openingCash };
}

function buildTopCategories(transactions: AnalysisResult["transactions"], months: string[]) {
  const totals = new Map<string, number>();
  let totalOutflow = 0;

  for (const transaction of transactions) {
    if (transaction.direction !== "outflow" || !months.includes(transaction.month)) {
      continue;
    }
    totalOutflow += transaction.absAmount;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.absAmount);
  }

  return [...totals.entries()]
    .filter(([category]) => category !== "revenue")
    .map(([category, amount]) => ({
      category: category as AnalysisResult["topCategories"][number]["category"],
      amount,
      share: totalOutflow > 0 ? amount / totalOutflow : 0
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
}

function buildTopVendors(transactions: AnalysisResult["transactions"], months: string[]) {
  const totals = new Map<string, AnalysisResult["topVendors"][number]>();
  let totalOutflow = 0;

  for (const transaction of transactions) {
    if (transaction.direction !== "outflow" || !months.includes(transaction.month)) {
      continue;
    }

    totalOutflow += transaction.absAmount;
    const existing = totals.get(transaction.normalizedVendor);
    if (existing) {
      existing.amount += transaction.absAmount;
    } else {
      totals.set(transaction.normalizedVendor, {
        vendor: transaction.vendor,
        amount: transaction.absAmount,
        share: 0,
        category: transaction.category
      });
    }
  }

  return [...totals.values()]
    .map((vendor) => ({
      ...vendor,
      share: totalOutflow > 0 ? vendor.amount / totalOutflow : 0
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
}

function buildSummary(monthly: MonthlySnapshot[], topCategories: AnalysisResult["topCategories"], risks: RiskFinding[]) {
  const trailingWindow = monthly.slice(-Math.min(3, monthly.length));
  const previousWindow = monthly.slice(-6, -3);
  const currentCash = monthly[monthly.length - 1]?.cashBalance ?? 0;
  const monthlyBurn = average(trailingWindow.map((item) => item.burn));
  const revenueTrendPct = previousWindow.length > 0
    ? ((average(trailingWindow.map((item) => item.revenue)) - average(previousWindow.map((item) => item.revenue))) / Math.max(average(previousWindow.map((item) => item.revenue)), 1)) * 100
    : 0;
  const expenseTrendPct = previousWindow.length > 0
    ? ((average(trailingWindow.map((item) => item.outflow)) - average(previousWindow.map((item) => item.outflow))) / Math.max(average(previousWindow.map((item) => item.outflow)), 1)) * 100
    : 0;

  return {
    cashBalance: currentCash,
    monthlyBurn,
    netCashflow: monthly[monthly.length - 1]?.netCashflow ?? 0,
    runwayMonthsRemaining: monthlyBurn > 0 ? currentCash / monthlyBurn : 24,
    revenueTrendPct,
    expenseTrendPct,
    largestCostCategory: topCategories[0] ? labelizeCategory(topCategories[0].category) : "None",
    highestRiskAlert: risks[0]?.title ?? "No acute issues flagged"
  };
}

export function buildAnalysisFromCsv(csvText: string, datasetLabel = "Uploaded CSV"): AnalysisResult {
  const intake = intakeAgent(csvText);
  const classified = classificationAgent(intake);
  const { monthly, openingCash } = buildMonthlySnapshots(classified);
  const trailingMonths = monthly.slice(-Math.min(3, monthly.length)).map((item) => item.month);
  const topCategories = buildTopCategories(classified, trailingMonths);
  const topVendors = buildTopVendors(classified, trailingMonths);
  const risks = riskAgent(classified, monthly, topVendors, topCategories);
  const forecast = forecastAgent(classified, monthly);

  return {
    datasetLabel,
    rawInputCount: intake.length,
    openingCash,
    transactions: classified,
    monthly,
    topCategories,
    topVendors,
    risks,
    summary: buildSummary(monthly, topCategories, risks),
    forecast
  };
}

export function buildCustomScenario(analysis: AnalysisResult, controls: ScenarioControls): ForecastScenario {
  return buildScenarioFromInputs(analysis.transactions, analysis.monthly, controls);
}

export function toStrategyAnalysisInput(analysis: AnalysisResult): StrategyAnalysisInput {
  return {
    summary: analysis.summary,
    topCategories: analysis.topCategories,
    topVendors: analysis.topVendors,
    risks: analysis.risks
  };
}

export function buildStrategySnapshot(analysis: StrategyAnalysisInput, scenario: ForecastScenario) {
  return {
    summary: analysis.summary,
    top_categories: analysis.topCategories.slice(0, 4).map((category) => ({
      category: labelizeCategory(category.category),
      amount: Math.round(category.amount),
      share_pct: Number((category.share * 100).toFixed(1))
    })),
    top_vendors: analysis.topVendors.slice(0, 4).map((vendor) => ({
      vendor: vendor.vendor,
      amount: Math.round(vendor.amount),
      share_pct: Number((vendor.share * 100).toFixed(1))
    })),
    risks: analysis.risks.slice(0, 5).map((risk) => ({
      title: risk.title,
      severity: risk.severity,
      metric: risk.metric,
      recommendation: risk.recommendation
    })),
    scenario: {
      name: scenario.name,
      assumption: scenario.assumption,
      runway_months: Number(scenario.runwayMonths.toFixed(1)),
      ending_balance: Math.round(scenario.endingBalance),
      first_month_net_cashflow: Math.round(scenario.points[0]?.netCashflow ?? 0)
    }
  };
}

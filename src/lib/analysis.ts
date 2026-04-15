import Papa from "papaparse";
import { addMonths, format, parseISO } from "date-fns";
import { z } from "zod";
import type {
  AnalysisResult,
  CategorySpend,
  ForecastScenario,
  MonthlySnapshot,
  RiskFinding,
  ScenarioControls,
  Transaction,
  TransactionCategory,
  VendorSpend
} from "@/lib/types";
import { labelizeCategory } from "@/lib/formatters";

const AGENT_NAMES = {
  intake: "Intake Agent",
  classification: "Classification Agent",
  forecast: "Forecast Agent",
  risk: "Risk Agent"
} as const;

const severityWeight = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

const csvRowSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  vendor: z.string().optional(),
  amount: z.union([z.string(), z.number()]),
  direction: z.string().optional(),
  category_hint: z.string().optional(),
  notes: z.string().optional()
});

export const QUICK_QUESTIONS = [
  "Why did runway shrink this month?",
  "Which costs should we investigate first?",
  "What happens if revenue drops 20%?",
  "What if we reduce software spend by 15%?"
];

export const DEFAULT_QUESTION = QUICK_QUESTIONS[0];

export const DEFAULT_SCENARIO_CONTROLS: ScenarioControls = {
  revenueChangePct: 0,
  payrollChangePct: 0,
  softwareChangePct: 0,
  infraChangePct: 0,
  oneTimeCost: 0,
  growthMode: false
};

const categoryMatchers: Record<Exclude<TransactionCategory, "revenue" | "other">, RegExp[]> = {
  payroll: [/payroll/, /salary/, /gusto/, /bonus/, /tax/],
  software: [/figma/, /notion/, /linear/, /hubspot/, /slack/, /jira/, /license/, /software/, /subscription/],
  infra: [/aws/, /cloud/, /hosting/, /infrastructure/, /infra/, /gpu/, /datadog/, /vercel/],
  marketing: [/meta/, /google ads/, /linkedin/, /campaign/, /marketing/, /seo/, /growth/],
  operations: [/contractor/, /travel/, /hotel/, /air/, /delta/, /marriott/, /operations/, /office/, /legal/, /consulting/]
};

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
};

const clamp = (value: number, minimum: number, maximum: number) => {
  return Math.min(Math.max(value, minimum), maximum);
};

const positiveOrZero = (value: number) => Math.max(0, value);

const normalizeVendor = (value: string) => {
  return value
    .toLowerCase()
    .replace(/marketplace/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const normalizeText = (value: string) => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const parseAmount = (value: string | number) => {
  if (typeof value === "number") {
    return value;
  }

  const normalized = value.replace(/[$,]/g, "").trim();
  const parsed = Number(normalized);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid amount: ${value}`);
  }

  return parsed;
};

const toMonth = (date: string) => date.slice(0, 7);

const buildMonthRange = (firstMonth: string, lastMonth: string) => {
  const months: string[] = [];
  let cursor = parseISO(`${firstMonth}-01`);
  const end = parseISO(`${lastMonth}-01`);

  while (cursor <= end) {
    months.push(format(cursor, "yyyy-MM"));
    cursor = addMonths(cursor, 1);
  }

  return months;
};

const trendPercentage = (values: number[]) => {
  if (values.length < 2 || values[0] === 0) {
    return 0;
  }

  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
};

const addUniqueRisk = (risks: RiskFinding[], risk: RiskFinding) => {
  if (!risks.some((existing) => existing.title === risk.title)) {
    risks.push(risk);
  }
};

function classifyCategory(transaction: Transaction): TransactionCategory {
  if (transaction.isOpeningBalance) {
    return "other";
  }

  if (transaction.direction === "inflow") {
    return "revenue";
  }

  const hint = normalizeText(transaction.categoryHint ?? "");
  const combinedText = `${transaction.normalizedText} ${hint}`.trim();

  for (const [category, matchers] of Object.entries(categoryMatchers) as Array<[
    Exclude<TransactionCategory, "revenue" | "other">,
    RegExp[]
  ]>) {
    if (matchers.some((matcher) => matcher.test(combinedText))) {
      return category;
    }
  }

  return "other";
}

// Intake Agent
function intakeAgent(csvText: string): Transaction[] {
  const parsed = Papa.parse<Record<string, string | undefined>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase()
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || "Unable to parse CSV input.");
  }

  const rows = parsed.data.filter((row) => Object.values(row).some((value) => `${value ?? ""}`.trim().length > 0));
  if (rows.length === 0) {
    throw new Error("The CSV did not contain any transaction rows.");
  }

  return rows.map((row, index) => {
    const safeRow = csvRowSchema.parse({
      date: row.date,
      description: row.description,
      vendor: row.vendor ?? row.description,
      amount: row.amount,
      direction: row.direction,
      category_hint: row.category_hint,
      notes: row.notes
    });

    const date = safeRow.date.trim();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      throw new Error(`Unsupported date format for row ${index + 1}. Use YYYY-MM-DD.`);
    }

    const parsedDate = parseISO(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid date for row ${index + 1}.`);
    }

    const rawAmount = parseAmount(safeRow.amount);
    const normalizedDirection = (safeRow.direction || "").trim().toLowerCase();
    const direction = normalizedDirection.startsWith("out") || rawAmount < 0 ? "outflow" : "inflow";
    const absAmount = Math.abs(rawAmount);
    const vendor = (safeRow.vendor || safeRow.description).trim();
    const description = safeRow.description.trim();
    const categoryHint = safeRow.category_hint?.trim() || undefined;
    const notes = safeRow.notes?.trim() || undefined;
    const markerText = `${vendor} ${description} ${notes ?? ""}`.toLowerCase();
    const isOpeningBalance = markerText.includes("opening cash") || markerText.includes("seed round");

    return {
      id: `tx-${index + 1}`,
      date,
      month: toMonth(date),
      monthLabel: format(parsedDate, "MMM"),
      description,
      vendor,
      normalizedVendor: normalizeVendor(vendor),
      normalizedText: normalizeText(`${vendor} ${description} ${notes ?? ""}`),
      amount: direction === "outflow" ? -absAmount : absAmount,
      absAmount,
      direction,
      category: "other",
      categoryHint,
      notes,
      isRecurring: false,
      isOpeningBalance
    };
  });
}

// Classification Agent
function classificationAgent(transactions: Transaction[]): Transaction[] {
  const vendorMonths = new Map<string, Set<string>>();
  const vendorAmountMonths = new Map<string, Set<string>>();

  for (const transaction of transactions) {
    if (transaction.direction !== "outflow") {
      continue;
    }

    vendorMonths.set(
      transaction.normalizedVendor,
      new Set([...(vendorMonths.get(transaction.normalizedVendor) ?? []), transaction.month])
    );

    const fingerprint = `${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
    vendorAmountMonths.set(
      fingerprint,
      new Set([...(vendorAmountMonths.get(fingerprint) ?? []), transaction.month])
    );
  }

  return transactions.map((transaction) => {
    const category = classifyCategory(transaction);
    const recurringVendorMonths = vendorMonths.get(transaction.normalizedVendor)?.size ?? 0;
    const amountFingerprint = `${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
    const recurringAmountMonths = vendorAmountMonths.get(amountFingerprint)?.size ?? 0;
    const isRecurring =
      transaction.direction === "outflow" &&
      (recurringVendorMonths >= 3 || recurringAmountMonths >= 2 || category === "payroll");

    return {
      ...transaction,
      category,
      isRecurring
    };
  });
}

function buildMonthlySnapshots(transactions: Transaction[]) {
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
      monthLabel: format(parseISO(`${month}-01`), "MMM"),
      revenue,
      outflow,
      netCashflow,
      burn: positiveOrZero(outflow - revenue),
      cashBalance: balance
    });
  }

  return { monthly, openingCash };
}

function buildTopCategories(transactions: Transaction[], months: string[]): CategorySpend[] {
  const totals = new Map<TransactionCategory, number>();
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
      category,
      amount,
      share: totalOutflow > 0 ? amount / totalOutflow : 0
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
}

function buildTopVendors(transactions: Transaction[], months: string[]): VendorSpend[] {
  const totals = new Map<string, VendorSpend>();
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

function deriveForecastInputs(transactions: Transaction[], monthly: MonthlySnapshot[]) {
  const trailingWindow = monthly.slice(-Math.min(3, monthly.length));
  const trailingMonths = trailingWindow.map((item) => item.month);
  const currentCash = monthly[monthly.length - 1]?.cashBalance ?? 0;
  const baseRevenue = average(trailingWindow.map((item) => item.revenue));
  const revenueDrift = clamp(
    trendPercentage(trailingWindow.map((item) => item.revenue)) / 100 / Math.max(trailingWindow.length - 1, 1),
    -0.08,
    0.08
  );
  const expenseDrift = clamp(
    trendPercentage(trailingWindow.map((item) => item.outflow)) / 100 / Math.max(trailingWindow.length - 1, 1),
    -0.06,
    0.06
  );

  const expenseTotals: Record<Exclude<TransactionCategory, "revenue">, number> = {
    payroll: 0,
    software: 0,
    infra: 0,
    marketing: 0,
    operations: 0,
    other: 0
  };

  for (const transaction of transactions) {
    if (transaction.direction !== "outflow" || !trailingMonths.includes(transaction.month)) {
      continue;
    }

    expenseTotals[transaction.category] += transaction.absAmount;
  }

  const divisor = Math.max(trailingMonths.length, 1);
  const baseExpenses = Object.fromEntries(
    Object.entries(expenseTotals).map(([category, amount]) => [category, amount / divisor])
  ) as Record<Exclude<TransactionCategory, "revenue">, number>;

  return {
    currentCash,
    baseRevenue,
    baseExpenses,
    revenueDrift,
    expenseDrift,
    lastMonth: monthly[monthly.length - 1]?.month ?? format(new Date(), "yyyy-MM")
  };
}

function describeCustomScenario(controls: ScenarioControls) {
  const segments: string[] = [];

  if (controls.revenueChangePct !== 0) {
    segments.push(`revenue ${controls.revenueChangePct > 0 ? "up" : "down"} ${Math.abs(controls.revenueChangePct)}%`);
  }

  if (controls.payrollChangePct !== 0) {
    segments.push(`payroll ${controls.payrollChangePct > 0 ? "up" : "down"} ${Math.abs(controls.payrollChangePct)}%`);
  }

  if (controls.softwareChangePct !== 0) {
    segments.push(`software ${controls.softwareChangePct > 0 ? "up" : "down"} ${Math.abs(controls.softwareChangePct)}%`);
  }

  if (controls.infraChangePct !== 0) {
    segments.push(`infrastructure ${controls.infraChangePct > 0 ? "up" : "down"} ${Math.abs(controls.infraChangePct)}%`);
  }

  if (controls.oneTimeCost > 0) {
    segments.push(`one-time cost of ${Math.round(controls.oneTimeCost).toLocaleString()}`);
  }

  if (controls.growthMode) {
    segments.push("growth mode enabled");
  }

  if (segments.length === 0) {
    return "Current operating plan with no manual scenario adjustments.";
  }

  return `${segments.join(", ")}.`;
}

function buildScenarioProjection(
  name: string,
  assumption: string,
  inputs: ReturnType<typeof deriveForecastInputs>,
  controls: ScenarioControls
): ForecastScenario {
  let balanceCursor = inputs.currentCash;
  const points = [];
  const lastMonthDate = parseISO(`${inputs.lastMonth}-01`);

  for (let index = 1; index <= 6; index += 1) {
    const monthDate = addMonths(lastMonthDate, index);
    const growthLift = controls.growthMode ? 0.0125 * index : 0;
    const revenue = positiveOrZero(
      inputs.baseRevenue * (1 + inputs.revenueDrift * index + controls.revenueChangePct / 100 + growthLift)
    );
    const payroll = positiveOrZero(
      inputs.baseExpenses.payroll * (1 + 0.005 * index + controls.payrollChangePct / 100)
    );
    const software = positiveOrZero(inputs.baseExpenses.software * (1 + controls.softwareChangePct / 100));
    const infra = positiveOrZero(
      inputs.baseExpenses.infra * (1 + inputs.expenseDrift * index + controls.infraChangePct / 100)
    );
    const marketing = positiveOrZero(
      inputs.baseExpenses.marketing * (1 + (controls.growthMode ? 0.035 : 0.01) * index)
    );
    const operations = positiveOrZero(
      inputs.baseExpenses.operations * (1 + (controls.growthMode ? 0.018 : 0.004) * index)
    );
    const other = positiveOrZero(inputs.baseExpenses.other);

    let outflow = payroll + software + infra + marketing + operations + other;
    if (index === 1) {
      outflow += positiveOrZero(controls.oneTimeCost);
    }

    const netCashflow = revenue - outflow;
    balanceCursor += netCashflow;
    const burn = positiveOrZero(outflow - revenue);

    points.push({
      month: format(monthDate, "yyyy-MM"),
      monthLabel: format(monthDate, "MMM"),
      revenue,
      outflow,
      netCashflow,
      cashBalance: balanceCursor,
      runwayMonths: burn > 0 ? positiveOrZero(balanceCursor) / burn : 24
    });
  }

  const averageProjectedBurn = average(points.map((point) => positiveOrZero(point.outflow - point.revenue)));
  const runwayMonths = averageProjectedBurn > 0 ? inputs.currentCash / averageProjectedBurn : 24;

  return {
    name,
    assumption,
    runwayMonths: clamp(runwayMonths, 0, 24),
    endingBalance: points[points.length - 1]?.cashBalance ?? inputs.currentCash,
    points
  };
}

// Forecast Agent
function forecastAgent(transactions: Transaction[], monthly: MonthlySnapshot[]) {
  const inputs = deriveForecastInputs(transactions, monthly);

  return {
    baseline: buildScenarioProjection(
      "Baseline",
      "Maintains the current operating trend with modest expense drift.",
      inputs,
      DEFAULT_SCENARIO_CONTROLS
    ),
    optimistic: buildScenarioProjection(
      "Optimistic",
      "Assumes stronger collections and tighter software and infrastructure discipline.",
      inputs,
      {
        revenueChangePct: 12,
        payrollChangePct: 0,
        softwareChangePct: -10,
        infraChangePct: -6,
        oneTimeCost: 0,
        growthMode: false
      }
    ),
    conservative: buildScenarioProjection(
      "Conservative",
      "Assumes revenue softens further while payroll and infrastructure remain pressured.",
      inputs,
      {
        revenueChangePct: -18,
        payrollChangePct: 3,
        softwareChangePct: 4,
        infraChangePct: 12,
        oneTimeCost: 0,
        growthMode: false
      }
    )
  };
}

export function buildCustomScenario(analysis: AnalysisResult, controls: ScenarioControls) {
  const inputs = deriveForecastInputs(analysis.transactions, analysis.monthly);
  return buildScenarioProjection("Custom", describeCustomScenario(controls), inputs, controls);
}

// Risk Agent
function riskAgent(
  transactions: Transaction[],
  monthly: MonthlySnapshot[],
  topVendors: VendorSpend[],
  topCategories: CategorySpend[]
) {
  const risks: RiskFinding[] = [];
  const trailingMonths = monthly.slice(-Math.min(3, monthly.length)).map((item) => item.month);
  const trailingOutflows = transactions.filter(
    (transaction) =>
      transaction.direction === "outflow" && !transaction.isOpeningBalance && trailingMonths.includes(transaction.month)
  );

  const categoryValues = new Map<TransactionCategory, number[]>();
  for (const transaction of trailingOutflows) {
    categoryValues.set(transaction.category, [
      ...(categoryValues.get(transaction.category) ?? []),
      transaction.absAmount
    ]);
  }

  const anomalyCandidate = trailingOutflows
    .map((transaction) => {
      const categoryMedian = median(categoryValues.get(transaction.category) ?? []);
      const ratio = categoryMedian > 0 ? transaction.absAmount / categoryMedian : 0;
      return { transaction, ratio };
    })
    .filter(({ transaction, ratio }) => transaction.absAmount > 5000 && ratio > 2.1)
    .sort((left, right) => right.ratio - left.ratio)[0];

  if (anomalyCandidate) {
    addUniqueRisk(risks, {
      id: "anomaly-spike",
      title: `Unusual ${labelForCategory(anomalyCandidate.transaction.category).toLowerCase()} spike`,
      description: `${anomalyCandidate.transaction.vendor} posted a ${Math.round(
        anomalyCandidate.ratio * 10
      ) / 10}x jump versus recent spend in that category.`,
      severity: anomalyCandidate.transaction.absAmount > 12000 ? "critical" : "high",
      metric: `${Math.round(anomalyCandidate.ratio * 10) / 10}x normal level`,
      recommendation: "Verify whether the charge is one-time, negotiable, or likely to recur next month.",
      agent: AGENT_NAMES.risk
    });
  }

  const duplicateGroups = new Map<string, Transaction[]>();
  for (const transaction of trailingOutflows.filter((item) => item.category === "software" || item.category === "infra")) {
    const fingerprint = `${transaction.month}-${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
    duplicateGroups.set(fingerprint, [...(duplicateGroups.get(fingerprint) ?? []), transaction]);
  }
  const duplicateGroup = [...duplicateGroups.values()].find((group) => group.length > 1);

  if (duplicateGroup) {
    addUniqueRisk(risks, {
      id: "duplicate-spend",
      title: "Duplicated recurring tool charge",
      description: `${duplicateGroup[0]?.vendor} appears multiple times for the same amount in ${duplicateGroup[0]?.monthLabel}.`,
      severity: "high",
      metric: `${duplicateGroup.length} repeated charges`,
      recommendation: "Audit seats or workspace duplication before the next billing cycle.",
      agent: AGENT_NAMES.risk
    });
  }

  if (monthly.length >= 4) {
    const previousRevenue = average(monthly.slice(-4, -2).map((item) => item.revenue));
    const recentRevenue = average(monthly.slice(-2).map((item) => item.revenue));
    const revenueDelta = previousRevenue > 0 ? ((recentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

    if (revenueDelta < -6) {
      addUniqueRisk(risks, {
        id: "revenue-weakness",
        title: "Revenue momentum is weakening",
        description: `Recent revenue is ${Math.abs(revenueDelta).toFixed(1)}% below the prior two-month average.`,
        severity: revenueDelta < -10 ? "high" : "medium",
        metric: `${revenueDelta.toFixed(1)}% vs prior window`,
        recommendation: "Stress-test the plan against lower collections and tighten discretionary spend now.",
        agent: AGENT_NAMES.risk
      });
    }

    const previousBurn = average(monthly.slice(-4, -2).map((item) => item.burn));
    const recentBurn = average(monthly.slice(-2).map((item) => item.burn));
    const burnDelta = previousBurn > 0 ? ((recentBurn - previousBurn) / previousBurn) * 100 : 0;

    if (burnDelta > 12) {
      addUniqueRisk(risks, {
        id: "burn-deterioration",
        title: "Burn is deteriorating",
        description: `Average burn in the latest window is ${burnDelta.toFixed(1)}% above the previous period.`,
        severity: burnDelta > 20 ? "high" : "medium",
        metric: `${burnDelta.toFixed(1)}% burn increase`,
        recommendation: "Contain the fastest-growing cost bucket before the runway loss compounds.",
        agent: AGENT_NAMES.risk
      });
    }
  }

  const concentrationPool = trailingOutflows.filter((transaction) => transaction.category !== "payroll");
  const concentrationTotal = concentrationPool.reduce((sum, transaction) => sum + transaction.absAmount, 0);
  const concentrationMap = new Map<string, number>();
  for (const transaction of concentrationPool) {
    concentrationMap.set(
      transaction.normalizedVendor,
      (concentrationMap.get(transaction.normalizedVendor) ?? 0) + transaction.absAmount
    );
  }
  const topConcentration = [...concentrationMap.entries()]
    .map(([vendor, amount]) => ({ vendor, amount, share: concentrationTotal > 0 ? amount / concentrationTotal : 0 }))
    .sort((left, right) => right.amount - left.amount)[0];

  if (topConcentration and topConcentration['share'] > 0.28):
      pass

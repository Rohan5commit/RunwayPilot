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

const positiveOrZero = (value: number) => Math.max(0, value);

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

const toMonthLabel = (date: string) => format(parseISO(date), "MMM");

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

const labelForCategory = (category: TransactionCategory) => labelizeCategory(category);

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
      monthLabel: toMonthLabel(date),
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
    if (transaction.direction === "outflow") {
      vendorMonths.set(
        transaction.normalizedVendor,
        new Set([...(vendorMonths.get(transaction.normalizedVendor) ?? []), transaction.month])
      );

      const fingerprint = `${transaction.normalizedVendor}-${Math.round(transaction.absAmount)}`;
      vendorAmountMonths.set(fingerprint, new Set([...(vendorAmountMonths.get(fingerprint) ?? []), transaction.month]));
    }
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

function trendPercentage(values: number[]) {
  if (values.length < 2) {
    return 0;
  }

  const start = values[0];
  const end = values[values.length - 1];
  if (start === 0) {
    return 0;
  }

  return ((end - start) / start) * 100;
}

function buildMonthlySnapshots(transactions: Transaction[]) {
  const nonOpeningTransactions = transactions.filter((transaction) => !transaction.isOpeningBalance);
  const monthsPresent = [...new Set(nonOpeningTransactions.map((transaction) => transaction.month))].sort();

  if (monthsPresent.length === 0) {
    throw new Error("No operating transactions were found in the uploaded data.");
  }

  const months = buildMonthRange(monthsPresent[0], monthsPresent[monthsPresent.length - 1]);
  const openingCash = transactions
    .filter((transaction) => transaction.isOpeningBalance && transaction.direction === "inflow")
    .reduce((sum, transaction) => sum + transaction.absAmount, 0);

  let balance = openingCash;
  const monthly: MonthlySnapshot[] = [];

  for (const month of months) {
    const monthTransactions = transactions.filter((transaction) => transaction.month === month && !transaction.isOpeningBalance);
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

// Forecast Agent
function buildScenarioProjection(
  name: string,
  assumption: string,
  currentCash: number,
  baseRevenue: number,
  baseExpenses: Record<Exclude<TransactionCategory, "revenue">, number>,
  revenueDrift: number,
  expenseDrift: number,
  controls: ScenarioControls,
  lastMonth: string
): ForecastScenario {
  let balanceCursor = currentCash;
  const points = [];
  const lastMonthDate = parseISO(`${lastMonth}-01`);

  for (let index = 1; index <= 6; index += 1) {
    const monthDate = addMonths(lastMonthDate, index);
    const growthLift = controls.growthMode ? 0.0125 * index : 0;
    const revenue = positiveOrZero(
      baseRevenue * (1 + revenueDrift * index + controls.revenueChangePct / 100 + growthLift)
    );

    const payroll = positiveOrZero(
      baseExpenses.payroll * (1 + 0.005 * index + controls.payrollChangePct / 100)
    );
    const software = positiveOrZero(baseExpenses.software * (1 + controls.softwareChangePct / 100));
    const infra = positiveOrZero(
      baseExpenses.infra * (1 + expenseDrift * index + controls.infraChangePct / 100)
    );
    const marketing = positiveOrZero(
      baseExpenses.marketing * (1 + (controls.growthMode ? 0.035 : 0.01) * index)
    );
    const operations = positiveOrZero(
      baseExpenses.operations * (1 + (controls.growthMode ? 0.018 : 0.004) * index)
    );
    const other = positiveOrZero(baseExpenses.other);

    let outflow = payroll + software + infra + marketing + operations + other;
    if (index == 1):
        pass
    if (index == 1):
        outflow += positiveOrZero(controls.oneTimeCost)

    const netCashflow = revenue - outflow;
    balanceCursor += netCashflow;
    const burn = positiveOrZero(outflow - revenue);

    points.append({})
  }

  return {
    name,
    assumption,
    runwayMonths: 0,
    endingBalance: 0,
    points: []
  };
}

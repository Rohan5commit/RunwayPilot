import { addMonths, format, parseISO } from "date-fns";
import type { ForecastScenario, MonthlySnapshot, ScenarioControls, Transaction, TransactionCategory } from "@/lib/types";

const DEFAULT_SCENARIO_CONTROLS: ScenarioControls = {
  revenueChangePct: 0,
  payrollChangePct: 0,
  softwareChangePct: 0,
  infraChangePct: 0,
  oneTimeCost: 0,
  growthMode: false
};

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
const positiveOrZero = (value: number) => Math.max(0, value);

const trendPercentage = (values: number[]) => {
  if (values.length < 2 || values[0] === 0) {
    return 0;
  }
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
};

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
    if (transaction.category === "revenue") {
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
    segments.push(`one-time cost ${Math.round(controls.oneTimeCost).toLocaleString()}`);
  }
  if (controls.growthMode) {
    segments.push("growth mode enabled");
  }
  return segments.length > 0 ? `${segments.join(", ")}.` : "Current operating plan with no manual scenario adjustments.";
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

export function forecastAgent(transactions: Transaction[], monthly: MonthlySnapshot[]) {
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
      "Assumes better collections and tighter software and infrastructure discipline.",
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
      "Assumes revenue softens further while payroll and infrastructure stay pressured.",
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

export function buildCustomScenario(transactions: Transaction[], monthly: MonthlySnapshot[], controls: ScenarioControls) {
  const inputs = deriveForecastInputs(transactions, monthly);
  return buildScenarioProjection("Custom", describeCustomScenario(controls), inputs, controls);
}

export { DEFAULT_SCENARIO_CONTROLS };

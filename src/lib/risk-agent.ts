import type { CategorySpend, MonthlySnapshot, RiskFinding, Transaction, VendorSpend } from "@/lib/types";
import { labelizeCategory } from "@/lib/formatters";

const AGENT_NAME = "Risk Agent" as const;

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
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const severityWeight = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

const addUniqueRisk = (risks: RiskFinding[], risk: RiskFinding) => {
  if (!risks.some((existing) => existing.title === risk.title)) {
    risks.push(risk);
  }
};

export function riskAgent(
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

  const categoryValues = new Map<string, number[]>();
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
      title: `Unusual ${labelizeCategory(anomalyCandidate.transaction.category).toLowerCase()} spike`,
      description: `${anomalyCandidate.transaction.vendor} posted a ${Math.round(anomalyCandidate.ratio * 10) / 10}x jump versus recent spend in that category.`,
      severity: anomalyCandidate.transaction.absAmount > 12000 ? "critical" : "high",
      metric: `${Math.round(anomalyCandidate.ratio * 10) / 10}x normal level`,
      recommendation: "Verify whether the charge is one-time, negotiable, or likely to recur next month.",
      agent: AGENT_NAME
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
      agent: AGENT_NAME
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
        agent: AGENT_NAME
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
        agent: AGENT_NAME
      });
    }
  }

  const concentrationLeader = topVendors.filter((vendor) => vendor.category !== "payroll")[0];
  if (concentrationLeader && concentrationLeader.share > 0.28) {
    addUniqueRisk(risks, {
      id: "vendor-concentration",
      title: "Vendor concentration risk is elevated",
      description: `${concentrationLeader.vendor} represents ${(concentrationLeader.share * 100).toFixed(1)}% of recent non-payroll outflow.`,
      severity: concentrationLeader.share > 0.38 ? "high" : "medium",
      metric: `${(concentrationLeader.share * 100).toFixed(1)}% of recent spend`,
      recommendation: "Review negotiating leverage, lock-in exposure, and fallback options with this vendor.",
      agent: AGENT_NAME
    });
  }

  const softwareCategory = topCategories.find((category) => category.category === "software");
  const recentRevenue = average(monthly.slice(-Math.min(3, monthly.length)).map((item) => item.revenue));
  if (softwareCategory && recentRevenue > 0 && softwareCategory.amount / recentRevenue > 0.12) {
    addUniqueRisk(risks, {
      id: "software-sprawl",
      title: "Recurring software load is getting heavy",
      description: "Software subscriptions are taking a meaningful share of current revenue relative to this stage.",
      severity: softwareCategory.amount / recentRevenue > 0.18 ? "high" : "medium",
      metric: `${((softwareCategory.amount / recentRevenue) * 100).toFixed(1)}% of trailing revenue`,
      recommendation: "Consolidate tools, remove duplicated seats, and renegotiate annual plans before renewal.",
      agent: AGENT_NAME
    });
  }

  if (risks.length == 0) {
    addUniqueRisk(risks, {
      id: "steady-state",
      title: "No acute risk triggered in the current window",
      description: "The recent dataset does not show a material anomaly or concentration spike beyond the configured thresholds.",
      severity: "low",
      metric: "Within configured thresholds",
      recommendation: "Keep monitoring monthly trends and test downside scenarios regularly.",
      agent: AGENT_NAME
    });
  }

  return risks.sort((left, right) => severityWeight[right.severity] - severityWeight[left.severity]).slice(0, 6);
}

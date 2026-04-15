        import { formatCurrency, formatPercent, formatRunway } from "@/lib/formatters";
        import type { AnalysisResult, ForecastScenario, StrategyResponse } from "@/lib/types";

        export function buildFounderReport({
          analysis,
          scenario,
          strategy
        }: {
          analysis: AnalysisResult;
          scenario: ForecastScenario;
          strategy: StrategyResponse | null;
        }) {
          const generatedAt = new Date().toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short"
          });

          const topRisks = analysis.risks.slice(0, 3);
          const riskSection = topRisks.length > 0
            ? topRisks.map((risk, index) => `${index + 1}. ${risk.title} (${risk.metric})
   ${risk.description}
   Action: ${risk.recommendation}`).join("

")
            : "1. No acute risk triggered in the current review window.";

          const actionSection = strategy?.recommended_actions?.length
            ? strategy.recommended_actions.map((action, index) => `${index + 1}. ${action}`).join("
")
            : [
                "1. Review the highest-risk spend category and confirm which items are one-time versus recurring.",
                "2. Stress-test the current plan against a softer revenue month.",
                "3. Remove duplicated or low-value software commitments before renewal."
              ].join("
");

          return [
            "# RunwayPilot Founder Report",
            "",
            `Generated: ${generatedAt}`,
            `Dataset: ${analysis.datasetLabel}`,
            "",
            "## Executive Summary",
            strategy?.summary ?? "AI summary pending or NVIDIA NIM not configured. Deterministic financial insights are available below.",
            "",
            "## KPI Snapshot",
            `- Cash balance: ${formatCurrency(analysis.summary.cashBalance)}`,
            `- Monthly burn: ${formatCurrency(analysis.summary.monthlyBurn)}`,
            `- Net cashflow: ${formatCurrency(analysis.summary.netCashflow)}`,
            `- Runway remaining: ${formatRunway(analysis.summary.runwayMonthsRemaining)}`,
            `- Revenue trend: ${formatPercent(analysis.summary.revenueTrendPct)}`,
            `- Expense trend: ${formatPercent(analysis.summary.expenseTrendPct)}`,
            `- Largest cost category: ${analysis.summary.largestCostCategory}`,
            `- Highest-risk alert: ${analysis.summary.highestRiskAlert}`,
            "",
            "## Top Risks",
            riskSection,
            "",
            "## Scenario View",
            `- Scenario: ${scenario.name}`,
            `- Assumption: ${scenario.assumption}`,
            `- Scenario runway: ${formatRunway(scenario.runwayMonths)}`,
            `- Ending 6-month balance: ${formatCurrency(scenario.endingBalance)}`,
            "",
            "## Recommended Actions",
            actionSection,
            "",
            "## Board-Ready Note",
            strategy?.board_ready_note ?? "Fact: the deterministic model identifies current burn, runway, and spend risk. Inference and recommendations become richer when NVIDIA NIM is configured.",
            ""
          ].join("
");
        }

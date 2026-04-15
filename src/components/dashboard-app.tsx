"use client";

import { type ChangeEvent, type FormEvent, useDeferredValue, useEffect, useEffectEvent, useState, useTransition } from "react";
import { AlertTriangle, Download, Moon, RefreshCw, Sparkles, Sun, Upload } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  buildAnalysisFromCsv,
  buildCustomScenario,
  DEFAULT_QUESTION,
  DEFAULT_SCENARIO_CONTROLS,
  QUICK_QUESTIONS,
  toStrategyAnalysisInput
} from "@/lib/analysis";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatRunway,
  formatSignedCurrency,
  labelizeCategory,
  severityTone
} from "@/lib/formatters";
import { buildFounderReport } from "@/lib/report";
import type { AnalysisResult, ForecastScenario, RiskFinding, ScenarioControls, StrategyResponse } from "@/lib/types";

type Theme = "light" | "dark";
type LoadState = "idle" | "loading" | "ready";
type StrategyMode = "idle" | "nim" | "fallback";

const FORECAST_COLORS = {
  actual: "#102A2B",
  baseline: "#0D7B74",
  custom: "#D2872C",
  revenue: "#0D7B74",
  outflow: "#102A2B"
};

function MetricCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="panel p-5">
      <div className="metric-label">{label}</div>
      <div className={`metric-value mt-3 ${tone === "warning" ? "text-[var(--warning)]" : ""}`}>{value}</div>
      {hint ? <p className="mt-3 text-sm text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "%",
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-[var(--text)]">{label}</span>
        <span className="font-mono text-[var(--text-muted)]">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function ScenarioCard({
  title,
  runway,
  endingBalance,
  assumption,
  accent
}: {
  title: string;
  runway: number;
  endingBalance: number;
  assumption: string;
  accent: string;
}) {
  return (
    <div className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-sm font-medium" style={{ color: accent }}>
        {title}
      </div>
      <div className="mt-3 text-3xl font-bold tracking-[-0.04em] text-[var(--text)]">{formatRunway(runway)}</div>
      <div className="mt-1 text-sm text-[var(--text-muted)]">Ending balance {formatCurrency(endingBalance)}</div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{assumption}</p>
    </div>
  );
}

function RiskRow({ risk }: { risk: RiskFinding }) {
  const tone = severityTone(risk.severity);
  return (
    <div className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]"
          style={{ background: tone.background, color: tone.color }}
        >
          {risk.severity}
        </span>
        <span className="font-semibold text-[var(--text)]">{risk.title}</span>
        <span className="text-sm text-[var(--text-muted)]">{risk.metric}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{risk.description}</p>
      <p className="mt-2 text-sm font-medium text-[var(--text)]">Action: {risk.recommendation}</p>
    </div>
  );
}

function buildForecastChartData(analysis: AnalysisResult, customScenario: ForecastScenario) {
  return [
    ...analysis.monthly.map((item) => ({
      month: item.monthLabel,
      actual: item.cashBalance,
      baseline: null,
      custom: null
    })),
    ...analysis.forecast.baseline.points.map((point, index) => ({
      month: point.monthLabel,
      actual: null,
      baseline: point.cashBalance,
      custom: customScenario.points[index]?.cashBalance ?? null
    }))
  ];
}

export default function DashboardApp() {
  const [theme, setTheme] = useState<Theme>("light");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("idle");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [insightLoading, setInsightLoading] = useState(false);
  const [scenarioControls, setScenarioControls] = useState<ScenarioControls>(DEFAULT_SCENARIO_CONTROLS);
  const deferredScenario = useDeferredValue(scenarioControls);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const saved = window.localStorage.getItem("runwaypilot-theme");
    const nextTheme: Theme = saved === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  const applyTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("runwaypilot-theme", nextTheme);
  };

  const customScenario = analysis ? buildCustomScenario(analysis, deferredScenario) : null;

  const requestStrategy = useEffectEvent(async (nextQuestion: string) => {
    if (!analysis || !customScenario) {
      return;
    }

    setInsightLoading(true);
    setInsightError(null);

    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          analysis: toStrategyAnalysisInput(analysis),
          scenario: customScenario,
          question: nextQuestion
        })
      });

      if (!response.ok) {
        throw new Error("Unable to reach the AI CFO endpoint.");
      }

      const payload = (await response.json()) as {
        strategy: StrategyResponse;
        mode: StrategyMode;
      };

      setStrategy(payload.strategy);
      setStrategyMode(payload.mode);
    } catch (error) {
      console.error(error);
      setInsightError("Unable to generate the AI CFO explanation right now.");
    } finally {
      setInsightLoading(false);
    }
  });

  useEffect(() => {
    if (analysis) {
      void requestStrategy(DEFAULT_QUESTION);
    }
  }, [analysis]);

  const loadCsvText = async (csvText: string, label: string) => {
    try {
      setLoadState("loading");
      setLoadError(null);
      setInsightError(null);
      const nextAnalysis = buildAnalysisFromCsv(csvText, label);
      startTransition(() => {
        setAnalysis(nextAnalysis);
        setStrategy(null);
        setQuestion(DEFAULT_QUESTION);
        setScenarioControls(DEFAULT_SCENARIO_CONTROLS);
        setStrategyMode("idle");
        setLoadState("ready");
      });
    } catch (error) {
      console.error(error);
      setLoadState("idle");
      setLoadError(error instanceof Error ? error.message : "Unable to load the CSV.");
    }
  };

  const loadDemoData = async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const response = await fetch("/demo/runwaypilot-sample.csv");
      const csvText = await response.text();
      await loadCsvText(csvText, "RunwayPilot sample startup data");
    } catch (error) {
      console.error(error);
      setLoadState("idle");
      setLoadError("Unable to load the bundled demo data.");
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const csvText = await file.text();
    await loadCsvText(csvText, file.name);
    event.target.value = "";
  };

  const handleQuestionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await requestStrategy(question);
  };

  const handleDownloadReport = () => {
    if (!analysis || !customScenario) {
      return;
    }

    const report = buildFounderReport({
      analysis,
      scenario: customScenario,
      strategy
    });

    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "runwaypilot-founder-report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const busy = loadState === "loading" || isPending;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1400px] space-y-8">
        <header className="panel grid-background overflow-hidden p-8 lg:p-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-5">
              <span className="pill">Orion Build Challenge 2026 | Fintech + AI + Enterprise SaaS</span>
              <div className="space-y-4">
                <h1 className="text-5xl font-semibold tracking-[-0.06em] text-[var(--text)] sm:text-6xl">
                  Catch runway compression before it becomes a board-level emergency.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-[var(--text-muted)]">
                  RunwayPilot turns raw finance transactions into burn visibility, anomaly detection, scenario planning, and an AI CFO explanation layer for founders, operators, and small business owners.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadDemoData}
                  disabled={busy}
                  className="button-primary inline-flex items-center gap-2 px-5 py-3 text-sm font-medium"
                >
                  <Sparkles size={16} />
                  {busy ? "Loading sample..." : "Load sample startup data"}
                </button>
                <label className="button-secondary inline-flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-medium">
                  <Upload size={16} />
                  Upload CSV
                  <input type="file" accept=".csv,text/csv" onChange={handleUpload} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
                  className="button-secondary inline-flex items-center gap-2 px-4 py-3 text-sm font-medium"
                >
                  {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </button>
              </div>
            </div>
            <div className="panel-muted max-w-sm space-y-4 p-5 lg:w-[360px]">
              <div className="eyebrow">What judges see in under 10 seconds</div>
              <div className="space-y-3 text-sm leading-7 text-[var(--text-muted)]">
                <p>1. Current cash balance and runway.</p>
                <p>2. The specific spend anomaly or duplicated tool charge creating drag.</p>
                <p>3. The downside scenario showing exactly how fast runway compresses.</p>
                <p>4. A founder-ready explanation with the top three actions to take next.</p>
              </div>
            </div>
          </div>
        </header>

        {loadError ? (
          <div className="panel border-[var(--danger)] p-5 text-sm text-[var(--danger)]">{loadError}</div>
        ) : null}

        {!analysis ? (
          <section className="grid gap-6 lg:grid-cols-3">
            {[
              {
                title: "Cashflow Dashboard",
                copy: "Monthly inflows, monthly outflows, burn, runway, and a clear balance trend with no spreadsheet gymnastics."
              },
              {
                title: "Spend Intelligence",
                copy: "Classified expenses, anomaly detection, duplicated subscriptions, vendor concentration, and recurring waste surfaced automatically."
              },
              {
                title: "AI CFO Copilot",
                copy: "NVIDIA NIM turns the structured finance facts into plain-language risks, recommendations, and a board-ready note."
              }
            ].map((feature) => (
              <div key={feature.title} className="panel p-6">
                <div className="eyebrow">MVP pillar</div>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">{feature.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{feature.copy}</p>
              </div>
            ))}
          </section>
        ) : customScenario ? (
          <>
            <section className="panel p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <div className="eyebrow">Current dataset</div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--text)]">{analysis.datasetLabel}</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    {analysis.rawInputCount} transactions analyzed across {analysis.monthly.length} operating months.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => requestStrategy(question)}
                    className="button-secondary inline-flex items-center gap-2 px-4 py-3 text-sm font-medium"
                  >
                    <RefreshCw size={16} />
                    Refresh AI insight
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    className="button-primary inline-flex items-center gap-2 px-4 py-3 text-sm font-medium"
                  >
                    <Download size={16} />
                    Export founder report
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <MetricCard label="Cash balance" value={formatCurrency(analysis.summary.cashBalance)} hint="Current operating balance after observed cashflow." />
              <MetricCard label="Monthly burn" value={formatCurrency(analysis.summary.monthlyBurn)} hint="Average trailing burn across the latest months." />
              <MetricCard label="Net cashflow" value={formatSignedCurrency(analysis.summary.netCashflow)} hint="Latest month inflows minus outflows." />
              <MetricCard label="Runway remaining" value={formatRunway(analysis.summary.runwayMonthsRemaining)} hint="Baseline runway using current burn." />
              <MetricCard label="Revenue trend" value={formatPercent(analysis.summary.revenueTrendPct)} hint="Latest period versus prior operating window." />
              <MetricCard label="Expense trend" value={formatPercent(analysis.summary.expenseTrendPct)} hint="Outflow trend across recent months." />
              <MetricCard label="Largest cost category" value={analysis.summary.largestCostCategory} hint="Trailing spend concentration by category." />
              <MetricCard label="Highest-risk alert" value={analysis.summary.highestRiskAlert} hint="Top risk ranked by severity." tone="warning" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
              <div className="space-y-6">
                <div className="panel p-6 chart-shell">
                  <div className="flex flex-col gap-2">
                    <div className="eyebrow">Cash balance trajectory</div>
                    <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">Actual runway versus baseline and custom scenario</h3>
                  </div>
                  <div className="mt-6 h-[320px] w-full">
                    <ResponsiveContainer>
                      <LineChart data={buildForecastChartData(analysis, customScenario)}>
                        <CartesianGrid strokeDasharray="4 4" />
                        <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                        <YAxis tickFormatter={(value) => formatCompactCurrency(Number(value))} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                        <Legend />
                        <Line type="monotone" dataKey="actual" stroke={FORECAST_COLORS.actual} strokeWidth={3} dot={false} name="Actual" />
                        <Line type="monotone" dataKey="baseline" stroke={FORECAST_COLORS.baseline} strokeWidth={3} dot={false} strokeDasharray="6 5" name="Baseline forecast" />
                        <Line type="monotone" dataKey="custom" stroke={FORECAST_COLORS.custom} strokeWidth={3} dot={false} strokeDasharray="2 4" name="Custom scenario" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="panel p-6 chart-shell">
                  <div className="flex flex-col gap-2">
                    <div className="eyebrow">Operating flow</div>
                    <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">Monthly inflows versus outflows</h3>
                  </div>
                  <div className="mt-6 h-[300px] w-full">
                    <ResponsiveContainer>
                      <BarChart data={analysis.monthly}>
                        <CartesianGrid strokeDasharray="4 4" />
                        <XAxis dataKey="monthLabel" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                        <YAxis tickFormatter={(value) => formatCompactCurrency(Number(value))} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                        <Legend />
                        <Bar dataKey="revenue" name="Inflows" fill={FORECAST_COLORS.revenue} radius={[10, 10, 0, 0]} />
                        <Bar dataKey="outflow" name="Outflows" fill={FORECAST_COLORS.outflow} radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <aside className="panel p-6 xl:sticky xl:top-6 xl:h-fit">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="eyebrow">AI CFO Copilot</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">Structured strategy explanation</h3>
                  </div>
                  <div className="pill">{strategyMode === "nim" ? "NVIDIA NIM" : strategyMode === "fallback" ? "Rules fallback" : "Idle"}</div>
                </div>

                <div className="mt-6 space-y-5">
                  {insightLoading ? <div className="text-sm text-[var(--text-muted)]">Generating the CFO explanation...</div> : null}
                  {insightError ? <div className="rounded-2xl bg-[rgba(181,78,59,0.12)] px-4 py-3 text-sm text-[var(--danger)]">{insightError}</div> : null}
                  {strategyMode === "fallback" ? (
                    <div className="rounded-2xl bg-[rgba(210,135,44,0.12)] px-4 py-3 text-sm text-[var(--warning)]">
                      NVIDIA NIM is unavailable or timed out, so the dashboard is showing a deterministic backup explanation.
                    </div>
                  ) : null}
                  {strategy ? (
                    <>
                      <div className="rounded-[1.4rem] bg-[var(--surface-muted)] p-4">
                        <div className="eyebrow">Summary</div>
                        <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{strategy.summary}</p>
                      </div>
                      <div>
                        <div className="eyebrow">Top risks</div>
                        <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--text-muted)]">
                          {strategy.top_risks.map((risk) => (
                            <li key={risk} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="eyebrow">Recommended actions</div>
                        <ol className="mt-3 space-y-3 text-sm leading-6 text-[var(--text-muted)]">
                          {strategy.recommended_actions.map((action, index) => (
                            <li key={action} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                              <span className="font-semibold text-[var(--text)]">{index + 1}. </span>
                              {action}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="rounded-[1.4rem] bg-[var(--surface-muted)] p-4">
                        <div className="eyebrow">Board-ready note</div>
                        <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{strategy.board_ready_note}</p>
                        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          Confidence: {strategy.confidence}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[1.4rem] bg-[var(--surface-muted)] p-4 text-sm leading-7 text-[var(--text-muted)]">
                      Load the sample data or upload a CSV to generate the AI CFO explanation.
                    </div>
                  )}

                  <form onSubmit={handleQuestionSubmit} className="space-y-3">
                    <label className="eyebrow">Ask a question</label>
                    <input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none"
                      placeholder="Ask about runway, costs, or scenario impact"
                    />
                    <button type="submit" className="button-primary inline-flex items-center gap-2 px-4 py-3 text-sm font-medium">
                      <Sparkles size={16} />
                      Ask the copilot
                    </button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    {QUICK_QUESTIONS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setQuestion(preset);
                          void requestStrategy(preset);
                        }}
                        className="button-secondary px-3 py-2 text-xs font-medium"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="panel p-6">
                <div className="flex flex-col gap-2">
                  <div className="eyebrow">Spend intelligence</div>
                  <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">What is driving risk right now</h3>
                </div>
                <div className="mt-6 space-y-4">
                  {analysis.risks.map((risk) => (
                    <RiskRow key={risk.id} risk={risk} />
                  ))}
                </div>
              </div>

              <div className="panel p-6">
                <div className="flex flex-col gap-2">
                  <div className="eyebrow">Cost structure</div>
                  <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text)]">Where the spend is concentrated</h3>
                </div>
                <div className="mt-6 space-y-6">
                  <div className="space-y-4">
                    {analysis.topCategories.map((category) => (
                      <div key={category.category} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-[var(--text)]">{labelizeCategory(category.category)}</span>
                          <span className="text-[var(--text-muted)]">{formatCurrency(category.amount)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-[var(--surface-muted)]">
                          <div
                            className="h-3 rounded-full bg-[var(--accent)]"
                            style={{ width: `${Math.max(category.share * 100, 4)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="eyebrow">Top vendors</div>
                    {analysis.topVendors.map((vendor) => (
                      <div key={vendor.vendor} className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
                        <span className="font-medium text-[var(--text)]">{vendor.vendor}</span>
                        <span className="text-[var(--text-muted)]">{formatCurrency(vendor.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="eyebrow">Scenario simulator</div>
                  <h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--text)]">Simulate downside or efficiency moves before they become real</h3>
                </div>
                <div className="rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)]">
                  Custom vs baseline: {customScenario.runwayMonths - analysis.forecast.baseline.runwayMonths >= 0 ? "+" : ""}
                  {(customScenario.runwayMonths - analysis.forecast.baseline.runwayMonths).toFixed(1)} months
                </div>
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-4 md:grid-cols-2">
                  <SliderField
                    label="Revenue up or down"
                    value={scenarioControls.revenueChangePct}
                    min={-40}
                    max={40}
                    onChange={(value) => setScenarioControls((current) => ({ ...current, revenueChangePct: value }))}
                  />
                  <SliderField
                    label="Payroll up or down"
                    value={scenarioControls.payrollChangePct}
                    min={-20}
                    max={25}
                    onChange={(value) => setScenarioControls((current) => ({ ...current, payrollChangePct: value }))}
                  />
                  <SliderField
                    label="Software spend up or down"
                    value={scenarioControls.softwareChangePct}
                    min={-40}
                    max={40}
                    onChange={(value) => setScenarioControls((current) => ({ ...current, softwareChangePct: value }))}
                  />
                  <SliderField
                    label="Infrastructure spend up or down"
                    value={scenarioControls.infraChangePct}
                    min={-30}
                    max={60}
                    onChange={(value) => setScenarioControls((current) => ({ ...current, infraChangePct: value }))}
                  />
                  <label className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 md:col-span-2">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium text-[var(--text)]">One-time cost addition</span>
                      <span className="font-mono text-[var(--text-muted)]">{formatCurrency(scenarioControls.oneTimeCost)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50000}
                      step={500}
                      value={scenarioControls.oneTimeCost}
                      onChange={(event) =>
                        setScenarioControls((current) => ({
                          ...current,
                          oneTimeCost: Number(event.target.value)
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 md:col-span-2">
                    <div className="text-sm font-medium text-[var(--text)]">Growth mode</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                      Growth mode assumes the team pushes expansion, which can improve revenue but usually adds operating pressure too.
                    </p>
                    <div className="mt-4 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setScenarioControls((current) => ({ ...current, growthMode: false }))}
                        className={`rounded-full px-4 py-2 text-sm font-medium ${!scenarioControls.growthMode ? "button-primary" : "button-secondary"}`}
                      >
                        Stabilize
                      </button>
                      <button
                        type="button"
                        onClick={() => setScenarioControls((current) => ({ ...current, growthMode: true }))}
                        className={`rounded-full px-4 py-2 text-sm font-medium ${scenarioControls.growthMode ? "button-primary" : "button-secondary"}`}
                      >
                        Growth
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ScenarioCard
                      title="Baseline"
                      runway={analysis.forecast.baseline.runwayMonths}
                      endingBalance={analysis.forecast.baseline.endingBalance}
                      assumption={analysis.forecast.baseline.assumption}
                      accent={FORECAST_COLORS.baseline}
                    />
                    <ScenarioCard
                      title="Custom"
                      runway={customScenario.runwayMonths}
                      endingBalance={customScenario.endingBalance}
                      assumption={customScenario.assumption}
                      accent={FORECAST_COLORS.custom}
                    />
                    <ScenarioCard
                      title="Optimistic"
                      runway={analysis.forecast.optimistic.runwayMonths}
                      endingBalance={analysis.forecast.optimistic.endingBalance}
                      assumption={analysis.forecast.optimistic.assumption}
                      accent="#0A8A60"
                    />
                    <ScenarioCard
                      title="Conservative"
                      runway={analysis.forecast.conservative.runwayMonths}
                      endingBalance={analysis.forecast.conservative.endingBalance}
                      assumption={analysis.forecast.conservative.assumption}
                      accent="#BF6F23"
                    />
                  </div>
                  <div className="rounded-[1.6rem] border border-[var(--border)] bg-[var(--surface)] p-4 chart-shell">
                    <div className="h-[250px] w-full">
                      <ResponsiveContainer>
                        <LineChart data={customScenario.points.map((point, index) => ({
                          month: point.monthLabel,
                          baseline: analysis.forecast.baseline.points[index]?.cashBalance ?? null,
                          custom: point.cashBalance
                        }))}>
                          <CartesianGrid strokeDasharray="4 4" />
                          <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                          <YAxis tickFormatter={(value) => formatCompactCurrency(Number(value))} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                          <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          <Legend />
                          <Line type="monotone" dataKey="baseline" stroke={FORECAST_COLORS.baseline} strokeWidth={3} dot={false} />
                          <Line type="monotone" dataKey="custom" stroke={FORECAST_COLORS.custom} strokeWidth={3} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

# Hackathon Deck Source

This file is the public, editable source outline for `public/Hackathon.pptx`.

Anyone can propose changes through the public GitHub repository:

- Repo: `https://github.com/Rohan5commit/RunwayPilot`
- Deck download: `https://runwaypilot.vercel.app/Hackathon.pptx`

## Slide 1

**Title:** RunwayPilot

**Subtitle:** An AI finance copilot for startups and SMBs that predicts runway, detects risky spending patterns, and recommends actions before cash problems become existential.

**Supporting points**

- Orion Build Challenge 2026
- Solo builder: Rohan Santhosh Kumar
- AI + Fintech + Enterprise SaaS
- Innovation: AI CFO + deterministic finance
- Presentation: premium demo flow
- Functionality: end-to-end MVP
- Problem Solving: earlier cash-risk detection

## Slide 2

**Title:** Founders usually discover cash problems too late.

**Supporting points**

- Burn creeps up through payroll drift, infrastructure spikes, and contractor expansion.
- Duplicate software subscriptions and recurring waste remain hidden for months.
- Revenue softening or delayed receivables compress runway before leadership reacts.
- By the time the issue is visible, fixing it is already more expensive.

**Target users**

- Student founders and indie hackers
- Startup operators and finance leads
- Small business owners with limited finance tooling
- Accelerators managing portfolio health

## Slide 3

**Title:** RunwayPilot makes the value obvious in under 10 seconds.

**Workflow**

1. Load demo or CSV data.
2. Read cash balance, burn, runway, revenue trend, expense trend, and highest-risk alert.
3. Inspect anomalies, duplicate spend, concentration, and deterioration drivers.
4. Simulate revenue, payroll, software, infra, and one-time cost changes.
5. Use NVIDIA NIM to generate concise founder actions.

**Core MVP modules**

- Cashflow dashboard
- Spend intelligence
- Runway forecasting
- AI CFO copilot
- Scenario simulator
- Founder report export

## Slide 4

**Title:** The dashboard gives judges a complete operating picture immediately.

**Key takeaways**

- Current cash balance and remaining runway
- Revenue trend weakening while expenses rise
- Highest-risk alert surfaced without manual analysis
- Charts connect current state to future runway compression

## Slide 5

**Title:** RunwayPilot turns anomalies into explainable next actions.

**Key risks in the seeded dataset**

- Unusual AWS infrastructure spike
- Duplicated Figma subscription
- Burn deterioration
- Weakening revenue momentum

**Why the AI layer is credible**

- Uses NVIDIA NIM for founder-facing interpretation and recommendations
- Receives structured findings instead of raw, ambiguous data
- Returns strict JSON: summary, top risks, actions, confidence, board note
- Falls back safely if the AI path is unavailable
- Separates fact, inference, and recommendation

## Slide 6

**Title:** The scenario simulator makes runway risk decision-ready.

**Scenario controls**

- Revenue up/down %
- Payroll up/down %
- Software spend change
- Infrastructure spend change
- One-time cost addition
- Growth mode toggle

**Why this matters**

- Connects finance data directly to operating decisions
- Shows downside risk before it becomes existential
- Makes the demo interactive instead of passive

## Slide 7

**Title:** Five agents power a deterministic finance pipeline plus explainable AI.

**Agents**

1. Intake Agent: validates CSV/demo data and standardizes fields.
2. Classification Agent: maps transactions into business categories.
3. Forecast Agent: calculates burn, runway, and projected scenarios.
4. Risk Agent: detects anomalies, concentration, recurring waste, and deterioration.
5. Strategy Agent: uses NVIDIA NIM to generate structured business-language guidance.

**Stack**

- Next.js
- TypeScript
- Tailwind CSS
- Recharts
- NVIDIA NIM
- Zod
- Papa Parse
- Vercel
- GitHub Actions

## Slide 8

**Title:** RunwayPilot is optimized directly against Orion’s judging criteria.

**Innovation**

- Deterministic finance intelligence plus explainable AI strategy output

**Presentation**

- Premium fintech UI, fast demo path, visible anomaly story, strong information hierarchy

**Functionality**

- CSV ingestion, analytics, forecasting, scenario simulation, AI guidance, and export

**Problem Solving**

- Addresses a painful, expensive real-world problem shared by founders, SMBs, and accelerators

## Slide 9

**Title:** Cash problems should be visible before they become existential.

**Submission links**

- Live demo: `https://runwaypilot.vercel.app`
- Public repo: `https://github.com/Rohan5commit/RunwayPilot`
- Deck download: `https://runwaypilot.vercel.app/Hackathon.pptx`

**Solo team**

- Rohan Santhosh Kumar
- Product, engineering, design, AI, and demo

**Closing**

RunwayPilot turns fragmented finance data into a clear operating signal, shows what is driving runway compression, and recommends the next actions before the problem becomes existential.

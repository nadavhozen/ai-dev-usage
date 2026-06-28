# AI Dev Usage Survey

Measure how a development team actually uses AI coding tools — adoption *and*
judgment — and read the results at a glance.

## Contents

- [Overview](#overview)
- [1. Create the survey form (Google Apps Script)](#1-create-the-survey-form-google-apps-script)
- [2. Collect responses, then export to CSV](#2-collect-responses-then-export-to-csv)
- [3. Run the dashboard](#3-run-the-dashboard)
- [What you see](#what-you-see)
- [AI analysis (optional)](#ai-analysis-optional)
- [How the form maps to the dashboard](#how-the-form-maps-to-the-dashboard)
- [What's where](#whats-where)

## Overview

**The goal:** give a manager an honest, actionable picture of how their team
uses AI coding tools — not just *how much*, but *how well*. Most "AI adoption"
metrics stop at usage counts; this measures the harder thing — deliberate tool
choice, output review, repeatable workflows, and shared standards — so a team
with high usage but weak verification stands out instead of hiding behind a
green number.

**Why it's useful:**

- **Adoption *and* judgment** — 35 questions across 7 sections cover reach
  (how much AI is used) *and* rigor (how carefully), surfacing real gaps.
- **Manager-first read-out** — per-topic, color-coded bars (red = not doing it
  → green = fully adopted); plain language, no jargon, no composite score.
- **Profile cross-cuts** — filter by role, seniority, experience, and AI tenure
  to see where one group behaves differently (slices under 5 people are hidden).
- **Private by default** — the CSV is parsed in your browser; the only optional
  outbound call is the AI summary, which runs through Gong's own AWS Bedrock.

**How it works — three steps:**

1. **Create & publish** — run `ai_dev_usage_survey.gs` in Google Apps Script to
   generate the form, then share its link with your team.
   → [step 1](#1-create-the-survey-form-google-apps-script)
2. **Collect & export** — once responses are in, download them as a CSV from the
   linked Google Sheet. → [step 2](#2-collect-responses-then-export-to-csv)
3. **Load & analyze** — start the dashboard, load the CSV, and read the
   per-topic results (optionally summarized by AI).
   → [step 3](#3-run-the-dashboard)

```
ai-dev-usage/
├── ai_dev_usage_survey.gs    # Apps Script — builds the Google Form
├── usage-dashboard.sh        # launcher console for the dashboard
└── usage-dashboard/          # the dashboard app (Node static server + browser CSV)
    ├── server.js
    ├── package.json
    └── public/
```

The flow is: **create the form → collect responses → export to CSV → load the
CSV in the dashboard.**

---

## 1. Create the survey form (Google Apps Script)

The survey is defined in code (`ai_dev_usage_survey.gs`) so it's reproducible
and version-controlled. To turn it into a live Google Form you run it once
inside Google Apps Script — it can't run locally; the `FormApp` API only exists
in Google's environment.

1. Go to **[script.google.com](https://script.google.com)** and create a **New
   project**.
2. Delete the placeholder `Code.gs` contents and paste in the full contents of
   **`ai_dev_usage_survey.gs`**.
3. Select the **`createSurveyForm`** function in the toolbar dropdown and click
   **Run**.
4. Approve the one-time authorization prompt (it needs permission to create a
   Form on your account).
5. Open **View → Logs** (or **Execution log**). The script logs two URLs:
   - **Edit URL** — to tweak/preview the form,
   - **Live URL** — to share with respondents.

**Anonymous by default.** `createSurveyForm()` collects no identity. Respondents
may *optionally* tick a box and type their email; otherwise they stay anonymous.
To force email collection instead, run `createSurveyForm(false)`.

The form builds these sections (Q1–Q35): Profile & Segmentation, Adoption &
Baseline, Core Coding Workflow, Advanced Tooling & Extensibility, SDLC
Integration, Quality & Control, Impact & Sentiment, and one open-text question.

---

## 2. Collect responses, then export to CSV

1. Open the form's **Edit URL** → **Responses** tab → link or open the
   **Google Sheet** of responses (the green Sheets icon).
2. In the Sheet: **File → Download → Comma-separated values (.csv)**.
3. That file is exactly what the dashboard expects — one row per respondent, one
   column per question.

You don't need to clean or rename columns. The dashboard matches each question
by its leading `Q<n>.` token (so exact header wording can vary) and the
seniority column by the word "seniority". A file missing the expected question
columns is rejected with a clear message.

> Run the survey separately per group. Load each group's CSV in turn — no
> rebuild. Each run is self-contained; the dashboard never compares groups, and
> refreshing the page resets to the empty state.

---

## 3. Run the dashboard

No dependencies to install — the server is plain Node, and ECharts + PapaParse
are vendored locally.

### Easiest: the launcher console

```bash
./usage-dashboard.sh
```

It finds a free port (starting at 4173), starts the server quietly, opens the
dashboard in your browser, and drops you into a small console:

| Key | Action |
|-----|--------|
| `l` | view live server logs (Ctrl+C or `q` returns to the menu) |
| `r` | restart the server (picks up code changes) |
| `o` | open the dashboard in the browser again |
| `q` | quit (stops the server cleanly) |

**Auto-alias:** on first run the script adds a `survey-dashboard` alias to your
shell profile (`~/.zshrc` or `~/.bashrc`) automatically — no manual editing. It
only writes it if it isn't already there. Because a script can't modify the
shell that launched it, run `source ~/.zshrc` once (or open a new terminal) to
activate it; after that, just type `survey-dashboard` from anywhere to launch.

### Or run the server directly

```bash
cd usage-dashboard
npm start          # plain server on port 4173
```

Then open **http://localhost:4173** and **Load CSV** (or drag the file onto the
page). The CSV is parsed in your browser; nothing is uploaded.

---

## What you see

- **Filter** — multi-select dropdowns for Role, Seniority, Experience, and AI
  tenure. Pick several values (OR within a dimension, AND across dimensions);
  active picks show as removable chips with a *Clear all*. Any slice that drops
  below 5 people is suppressed (too small to read into).
- **At a glance** — people in view, share using AI for half their work or more,
  share using AI daily, share who built a skill/MCP, and share reviewing output
  regularly.
- **Survey results — key findings** — a **Summarize the results** button runs
  Claude over the response *numbers* and returns plain-English findings, each
  expanding to the concrete counts behind it.
- **By topic** — one card per category, each with a red→green **heat pill**, a
  one-line plain description, a **high-level bar** showing how many answers land
  at each engagement level, and the **strongest / typical / weakest** question
  in that topic. Click a card to expand the per-question bars.
- **What they wrote** — raw comments, plus a **Summarize the comments** button
  that returns findings, each expanding to supporting quotes.

### Color = the answer

Every bar is colored by the answer itself: **red** = never / not doing it →
**green** = core to workflow / fully adopted. Reverse-coded questions (e.g. "how
often do you code without AI", "bugs caught late") are flipped so green always
means good. Bars show counts.

---

## AI analysis (optional)

The **Summarize** buttons post the (numeric or open-text) data to
`/api/analyze`, which calls Claude on **AWS Bedrock** and returns plain-English
findings with supporting evidence.

This is the **only** outbound network call in the whole app — everything else is
fully offline. There is **no API key** to manage: the server shells out to the
already-authenticated `aws` CLI (Gong runs Claude through Bedrock, not the
Anthropic API), so it uses whatever `AWS_PROFILE` your shell has — the same path
Claude Code itself uses here.

Requirements:
- `aws` CLI v2 on PATH (already present in the Gong dev environment)
- Valid AWS credentials for a profile with `bedrock:InvokeModel` (refresh via
  Leapp/Klopper if they've expired)

**Pick the model in the UI** — a dropdown next to the button lists the Claude
models available on this Bedrock account (Opus 4.8 default, plus Opus 4.7,
Sonnet 4.6, Opus 4.5, Opus 4.1, Sonnet 4.5, Sonnet 4, Haiku 4.5). The server
only invokes IDs from its own allowlist, so the choice can't be tampered with.
Region defaults to `us-east-1` (`AWS_REGION`), and `BEDROCK_MODEL` overrides the
default selection.

If credentials are expired or a model isn't available on your account, the
button shows a clear error and the rest of the dashboard works normally.

---

## How the form maps to the dashboard

The dashboard's `public/js/config.js` mirrors the `.gs` form: same answer scales
(`Never…Core to my workflow`, `Strongly disagree…Strongly agree`, the Yes/No and
custom scales for Q4/Q7/Q11/Q21/Q26/Q30/Q34), with reverse-coding where a low
answer is the good one. Questions roll up into six topics:

| Topic (shown) | Questions |
|---|---|
| How much they use AI | Q4–Q7 |
| Choosing the right tool | Q8–Q13 |
| Where in their work they use AI | Q22–Q26 |
| Checking & controlling AI output | Q27–Q31 |
| Repeatable workflows & automation | Q14–Q21 |
| How the team feels | Q32–Q34 |

If you edit the form's questions or answer options, mirror the change in
`config.js` so the bars and colors stay correct.

---

## What's where

| Path | Purpose |
|------|---------|
| `ai_dev_usage_survey.gs` | Apps Script form generator (run in Google Apps Script) |
| `usage-dashboard.sh` | Launcher console — auto-port, quiet start, browser open, live-logs/restart/reopen keys, self-aliasing |
| `usage-dashboard/server.js` | Zero-dep static server (port 4173) + `/api/analyze` (Claude via Bedrock CLI) |
| `usage-dashboard/public/index.html` | Section scaffold + file picker |
| `usage-dashboard/public/css/styles.css` | White theme; color lives inside the bars |
| `usage-dashboard/public/js/config.js` | Question → topic mapping, answer scales, color ramp |
| `usage-dashboard/public/js/score.js` | Per-question distributions, topic aggregates, extremes |
| `usage-dashboard/public/js/charts.js` | ECharts builders (stacked bars, diverging sentiment) |
| `usage-dashboard/public/js/app.js` | Loads CSV, renders sections, filters, AI analysis |
| `usage-dashboard/public/vendor/` | ECharts + PapaParse (vendored, offline) |

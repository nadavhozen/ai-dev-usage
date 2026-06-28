/*
 * config.js — the question→category mapping, in plain manager terms.
 *
 * Source of truth: question_category_mapping.md. The CSV keeps the exact
 * Google Forms shape; this file carries the structure. Columns are matched
 * by their leading "Q<n>." token (robust to header wording), plus the two
 * non-Q profile columns (seniority) matched by text.
 *
 * Design goal for this rebuild: a manager glances at the page and sees, per
 * topic, how the team answered — in colored bars. No composite score, no
 * jargon. Color encodes the ANSWER (red = not doing it … green = fully
 * adopted), not an abstract status.
 */

// --- Column resolution ---------------------------------------------------
function resolveColumns(headerFields) {
    const byNum = {};
    headerFields.forEach((h) => {
        const m = /^Q(\d+)\b/.exec(h.trim());
        if (m) byNum[Number(m[1])] = h;
    });
    // profile columns that are not Q-numbered
    const sen = headerFields.find((h) => /seniority/i.test(h));
    if (sen) byNum.seniority = sen;
    return byNum;
}

// --- Answer scales -------------------------------------------------------
// Ordinal level 0..4 (low→high engagement) drives the color ramp. The label
// order below is what we render left→right in stacked bars.
const ORDER_MAT = ["Never", "Tried it", "Occasionally", "Regularly", "Core to my workflow"];
const ORDER_AGR = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const ORDER_YN = ["No", "Yes"];

// Q11 — model selection gradient (3 levels mapped onto the ramp).
const ORDER_Q11 = ["Always the same model", "Mostly one, occasionally switch", "Deliberately choose per task type"];
// Q26 — methodology maturity.
const ORDER_Q26 = ["No methodology", "Informal verbal norms", "Informal personal habits", "Documented personal approach", "Team-wide defined methodology"];
// Q21 — team standards.
const ORDER_Q21 = ["None", "Informal verbal norms", "Some documented", "Codified and enforced (e.g. CLAUDE.md in repos)"];
// Q30 — bugs caught late (reverse: "Never" is best). Rendered green→red so
// the visual still reads "green = good".
const ORDER_Q30 = ["Never", "Rarely", "Sometimes", "Often", "Very often"];
// Q34 — feeling about pace (qualitative; mapped negative→positive).
const ORDER_Q34 = [
    "Significant stress / overwhelm",
    "FOMO — worried I'm falling behind",
    "Mild stress",
    "Neutral",
    "Energized",
];

// Map an answer label to a 0..4 ramp position for a given scale ("good"
// direction = 4). Returns null if unknown. reverse flag flips it.
function rampPosition(label, orderArray, reverse) {
    const i = orderArray.indexOf(label);
    if (i < 0) return null;
    const max = orderArray.length - 1;
    const pos = max === 0 ? 0 : i / max; // 0..1
    const ramp = Math.round((reverse ? 1 - pos : pos) * 4);
    return ramp;
}

// --- Color ramp: red (not doing it) → green (fully adopted) ---------------
const RAMP = ["#DC2626", "#F59E0B", "#FBBF24", "#86C440", "#16A34A"];
const RAMP_LABELS = ["not yet", "dabbling", "sometimes", "mostly", "fully"];
function rampColor(pos) {
    if (pos == null) return "#CBD5E1";
    return RAMP[Math.max(0, Math.min(4, pos))];
}

// --- Topics (categories) in the mapping's logical order ------------------
// Each scored question carries the scale order + whether it's reverse-coded,
// so charts.js can color segments without knowing the analytics.
const TOPICS = [
    {
        id: "adoption",
        name: "How much they use AI",
        plain: "How widely AI has been adopted day-to-day. This is reach, not skill.",
        questions: [4, 5, 6, 7],
    },
    {
        id: "selection",
        name: "Choosing the right tool",
        plain: "Whether people pick tools and models deliberately, and refine instead of taking the first output.",
        questions: [8, 9, 10, 11, 12, 13],
    },
    {
        id: "lifecycle",
        name: "Where in their work they use AI",
        plain: "How far across the workflow AI reaches — research, design, and a defined way of working.",
        questions: [22, 23, 24, 25, 26],
    },
    {
        id: "quality",
        name: "Checking & controlling AI output",
        plain: "Reviewing, catching issues, and keeping decisions — the closest read on output quality.",
        questions: [27, 28, 29, 30, 31],
    },
    {
        id: "workflow",
        name: "Repeatable workflows & automation",
        plain: "Skills, MCPs, automations and shared team standards. Operational maturity.",
        questions: [14, 15, 16, 17, 18, 19, 20, 21],
    },
    {
        id: "sentiment",
        name: "How the team feels",
        plain: "Feelings, not facts — useful for spotting stress, FOMO, or whether people feel AI is helping.",
        questions: [32, 33, 34],
    },
];

// Per-question render spec.
//   scaleOrder: the answer labels left→right.
//   reverse: true if low label = good (so we flip the color ramp).
//   yesno / multi / openText: special rendering.
//   tier: "fact" (behavioral, solid) | "self" (self-rated, lighter) | "rel".
const QUESTIONS = {
    // Profile (filters)
    1: { label: "Primary role", profile: true },
    2: { label: "Years of experience", profile: true },
    3: { label: "How long using AI tools", profile: true },

    // Adoption
    4: { label: "Share of coding tasks using AI", scaleOrder: ["None", "< 25%", "25–50%", "50–75%", "75–100%"], tier: "self" },
    5: { label: "How often they code without AI", scaleOrder: ORDER_MAT, reverse: true, tier: "self" },
    6: { label: "Which AI tools they use", multi: true, tier: "fact" },
    7: { label: "Daily AI interaction", scaleOrder: ["Never", "A few times", "Hourly", "Constantly throughout the day"], tier: "self" },

    // Choosing the right tool
    8: { label: "How deliberately they craft prompts", scaleOrder: ORDER_MAT, tier: "self" },
    9: { label: "Use plan mode before generating", scaleOrder: ORDER_MAT, tier: "self" },
    10: { label: "Use to-do lists / task breakdowns", scaleOrder: ORDER_MAT, tier: "self" },
    11: { label: "Same model vs. choose per task", scaleOrder: ORDER_Q11, tier: "self" },
    12: { label: "What drives model choice", multi: true, tier: "rel", marker: true },
    13: { label: "Iterate vs. accept first output", scaleOrder: ORDER_MAT, tier: "self" },

    // Where they use AI
    22: { label: "Use AI for research / understanding code", scaleOrder: ORDER_MAT, tier: "self" },
    23: { label: "Which tools for research", multi: true, tier: "fact" },
    24: { label: "Use AI for design work", scaleOrder: ORDER_MAT, tier: "self" },
    25: { label: "Which SDLC stages use AI", multi: true, tier: "rel" },
    26: { label: "Defined methodology for AI", scaleOrder: ORDER_Q26, tier: "rel" },

    // Checking & controlling output
    27: { label: "How thoroughly they inspect output", scaleOrder: ORDER_MAT, tier: "self" },
    28: { label: "Use tools to review AI output", scaleOrder: ORDER_MAT, tier: "self" },
    29: { label: "Persist designs / decisions / rationale", scaleOrder: ORDER_MAT, tier: "fact" },
    30: { label: "AI introduces bugs caught only later", scaleOrder: ORDER_Q30, reverse: true, tier: "self" },
    31: { label: "Feel in control of AI output", scaleOrder: ORDER_AGR, tier: "self" },

    // Workflows & automation
    14: { label: "Use Skills", scaleOrder: ORDER_MAT, tier: "self" },
    15: { label: "Use MCP servers / connectors", scaleOrder: ORDER_MAT, tier: "self" },
    16: { label: "Built their own Skills", yesno: true, tier: "fact" },
    17: { label: "Built / configured MCP servers", yesno: true, tier: "fact" },
    18: { label: "Built automations for daily work", scaleOrder: ORDER_MAT, tier: "self" },
    19: { label: "Reusable defined workflows", scaleOrder: ORDER_MAT, tier: "self" },
    20: { label: "Share workflows with the team", yesno: true, tier: "fact" },
    21: { label: "Team has codified AI standards", scaleOrder: ORDER_Q21, tier: "rel" },

    // How the team feels (sentiment)
    32: { label: "AI is improving my velocity", scaleOrder: ORDER_AGR, tier: "self" },
    33: { label: "I keep track of AI trends", scaleOrder: ORDER_MAT, tier: "self" },
    34: { label: "Feeling about the pace of new tooling", scaleOrder: ORDER_Q34, tier: "self" },

    // Open-text (kept simple for now)
    35: { label: "Biggest blocker + most-valued workflow", openText: true, tier: "qual" },
};

// --- Filter floor --------------------------------------------------------
const N_FLOOR = 5;

window.DASH_CONFIG = {
    resolveColumns,
    rampPosition,
    rampColor,
    RAMP,
    RAMP_LABELS,
    ORDER_MAT,
    ORDER_AGR,
    ORDER_YN,
    TOPICS,
    QUESTIONS,
    N_FLOOR,
};

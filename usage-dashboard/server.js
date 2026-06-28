/*
 * server.js — zero-dependency static file server for the dashboard.
 * Serves ./public on port 4173. No external calls, no npm deps.
 */
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 4173;
const ROOT = path.join(__dirname, "public");

// LLM analysis runs on AWS Bedrock (same path Claude Code uses here), invoked
// through the already-authenticated `aws` CLI so we add no npm dependency and
// no hand-rolled SigV4. Override the model/region via env if needed.
// Claude models available on this Bedrock account (probed). The UI picks one;
// the server only ever invokes an ID from this allowlist.
// IDs verified to invoke on the rnd-ai-tools Bedrock account. Newer models use
// the dateless inference-profile form (e.g. us.anthropic.claude-opus-4-8) — the
// same IDs Claude Code uses here; older ones use the dated -vN:0 form.
const BEDROCK_MODELS = [
    { id: "us.anthropic.claude-opus-4-8", label: "Opus 4.8 (most capable, default)" },
    { id: "us.anthropic.claude-opus-4-7", label: "Opus 4.7" },
    { id: "us.anthropic.claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
    { id: "us.anthropic.claude-opus-4-5-20251101-v1:0", label: "Opus 4.5" },
    { id: "us.anthropic.claude-opus-4-1-20250805-v1:0", label: "Opus 4.1" },
    { id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Sonnet 4.5" },
    { id: "us.anthropic.claude-sonnet-4-20250514-v1:0", label: "Sonnet 4" },
    { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Haiku 4.5 (fastest)" },
];
const DEFAULT_MODEL = process.env.BEDROCK_MODEL || BEDROCK_MODELS[0].id;
const BEDROCK_REGION = process.env.AWS_REGION || "us-east-1";

// Resolve which AWS profile the spawned `aws` CLI should use. The CLI doesn't
// inherit a profile unless one is named or a [default] exists — and in this
// environment ~/.aws/credentials has only named profiles. Order: $AWS_PROFILE
// → "default" if present → first named profile found.
function resolveAwsProfile() {
    if (process.env.AWS_PROFILE) return process.env.AWS_PROFILE;
    try {
        const text = fs.readFileSync(path.join(os.homedir(), ".aws", "credentials"), "utf8");
        const names = (text.match(/^\s*\[([^\]]+)\]/gm) || [])
            .map((s) => s.replace(/[[\]\s]/g, ""));
        if (names.includes("default")) return "default";
        if (names.length) return names[0];
    } catch (_) { /* no credentials file */ }
    return null;
}
const AWS_PROFILE = resolveAwsProfile();

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".map": "application/json; charset=utf-8",
};

// The sample CSV lives outside public/ (in ./sample). Expose it read-only at
// /sample/* so the "Load sample" button works without duplicating the file.
const EXTRA_ROOTS = { "/sample/": path.join(__dirname, "sample") };

function safeJoin(base, target) {
    const resolved = path.normalize(path.join(base, target));
    if (!resolved.startsWith(base)) return null; // path traversal guard
    return resolved;
}

// POST /api/analyze — send the open-text answers to Claude on AWS Bedrock and
// return 5 plain-English conclusions with supporting quotes. This is the ONLY
// outbound call the server makes; the rest of the dashboard is fully offline.
//
// Auth/transport: we shell out to the `aws` CLI (already authenticated via the
// AWS_PROFILE in this environment), so there's no npm dependency and no
// hand-rolled SigV4. The CLI signs and sends the Bedrock InvokeModel request.
function handleAnalyze(req, res) {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (_) {
            return sendJson(res, 400, { error: "Bad request body." });
        }
        const modelId = BEDROCK_MODELS.some((m) => m.id === parsed.model) ? parsed.model : DEFAULT_MODEL;
        const kind = parsed.kind === "survey" ? "survey" : "comments";

        // The user may override the human "instruction" part of the prompt; the
        // data block and the JSON-shape contract are always appended by the
        // server so a custom instruction can't break response parsing.
        const instruction = (typeof parsed.instruction === "string" && parsed.instruction.trim())
            ? parsed.instruction.trim()
            : DEFAULT_INSTRUCTIONS[kind];

        const prompt = kind === "survey"
            ? buildSurveyPrompt(instruction, parsed.summary)
            : buildCommentsPrompt(instruction, parsed.answers);
        if (!prompt) {
            return sendJson(res, 400, { error: "Nothing to analyze in this view." });
        }

        const bedrockBody = JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 2048,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        });

        invokeBedrock(modelId, bedrockBody, (err, modelText) => {
            if (err) return sendJson(res, 502, { error: err });
            const result = extractFindings(modelText);
            if (!result) return sendJson(res, 502, { error: "Could not parse the model response into findings." });
            sendJson(res, 200, result);
        });
    });
}

// The editable instruction per kind. Exposed via /api/models so the UI can
// prefill the inline prompt editor and offer a "reset to default".
const DEFAULT_INSTRUCTIONS = {
    survey:
        "You are a senior engineering analyst helping a manager understand how their development team " +
        "uses AI coding tools, based on survey results.\n\n" +
        "You are given three things: (1) the team's profile composition, (2) a per-respondent table " +
        "pairing each person's profile (role, seniority, experience, AI tenure) with their key answers, " +
        "and (3) full answer distributions per question. Answers run from low engagement (e.g. \"Never\") " +
        "to high (e.g. \"Core to my workflow\").\n\n" +
        "Surface the findings that most change what a manager should do next. Prioritise:\n" +
        "- Cross-cuts by profile: where a role, seniority, or experience band behaves differently from the rest " +
        "(e.g. \"seniors review output far less than juniors\").\n" +
        "- Gaps between adoption and judgment: high usage paired with weak verification, review, or deliberate tool choice.\n" +
        "- Concentration: whether a weakness is the whole team or a specific segment.\n\n" +
        "Rules:\n" +
        "- Ground every claim in the data provided. Only assert a profile correlation when the per-respondent rows " +
        "actually support it; if a segment is too small to trust (under ~3 people), say so rather than overclaiming.\n" +
        "- Counts only — never invent percentages or averages.\n" +
        "- Plain language a manager understands; no survey jargon, no maturity scores.\n" +
        "- Each evidence item must cite specific numbers and, where relevant, the profile segment " +
        "(e.g. \"3 of 4 Senior engineers inspect output only occasionally\").",
    comments:
        "You are a senior engineering analyst helping a manager understand the free-text comments from a " +
        "survey of their development team's AI coding tool usage. Each comment states the person's biggest " +
        "blocker AND their most-valued workflow, and is prefixed with that person's profile " +
        "[role | seniority | experience | AI tenure].\n\n" +
        "Surface the findings that most change what a manager should do next. Across them, cover BOTH sides — " +
        "the blockers holding people back and the workflows already delivering value — don't return only " +
        "problems. Prioritise:\n" +
        "- Recurring themes: a blocker or a valued workflow echoed by several people.\n" +
        "- Profile patterns: when a theme clusters in a role, seniority, or experience band " +
        "(e.g. \"trust/verification worries come mostly from less-experienced devs\").\n" +
        "- Signal over noise: a theme several people raise outweighs a vivid one-off.\n\n" +
        "Use \"type\": \"gap\" for a blocker/risk, \"strength\" for a workflow or capability clearly working well, " +
        "\"solid\" for one that's working decently, \"watch\" for something mixed.\n\n" +
        "Rules:\n" +
        "- Ground every finding in the actual comments. Only claim a profile pattern when the prefixes support " +
        "it; if a segment is too small to trust (under ~3 people), say \"whole team\" or note the limit rather " +
        "than overclaiming.\n" +
        "- Each evidence item is a short verbatim quote. When the point is a profile pattern, start the quote " +
        "with the segment, e.g. [Mid level, <1yr] \"I still write most things myself\".\n" +
        "- Plain language; no jargon. Capture both blockers and what's delivering value.",
};

// Appended to every prompt regardless of the (editable) instruction — keeps the
// response machine-parseable. Not user-editable.
const SHAPE_INSTRUCTION =
    "\n\nReturn only the findings that are genuinely supported by the data — the real key insights, " +
    "no more. Return as few as the data warrants and at most 10. Do NOT pad to reach a number or repeat " +
    "the same point; if there are only 3 real insights, return 3. Order them most important first.\n" +
    "Each finding has: a ONE-sentence plain-English headline (no jargon, no scores); " +
    "a \"type\" of exactly one of:\n" +
    "  \"gap\"      — a weakness or risk worth acting on;\n" +
    "  \"strength\" — something clearly working well, a real standout;\n" +
    "  \"solid\"    — working adequately/decently but not exceptional;\n" +
    "  \"watch\"    — mixed, ambiguous, or worth monitoring.\n" +
    "Only label something \"strength\" if it is genuinely strong; if it is merely fine, use \"solid\". " +
    "Don't manufacture a strength that isn't there.\n" +
    "Also include a \"segment\" naming who it's about — use \"whole team\" unless it genuinely concentrates " +
    "in one group, then name it briefly (e.g. \"juniors\", \"Data/ML\", \"Senior 1\"); " +
    "and 2-4 short pieces of supporting evidence.\n" +
    "Respond with ONLY a JSON object, no prose, no markdown fences, in exactly this shape:\n" +
    '{"findings":[{"headline":"...","type":"gap","segment":"whole team","evidence":["...","..."]}]}';

function buildSurveyPrompt(instruction, summary) {
    if (!summary || typeof summary !== "string" || !summary.trim()) return null;
    return instruction + "\n\n--- DATA ---\n" + summary + SHAPE_INSTRUCTION;
}

function buildCommentsPrompt(instruction, answers) {
    if (!Array.isArray(answers) || answers.length === 0) return null;
    return instruction +
        "\n\n--- COMMENTS (each prefixed with the author's profile " +
        "[role | seniority | experience | AI-tenure]) ---\n" +
        answers.map((a, i) => `#${i + 1} ${a}`).join("\n") + SHAPE_INSTRUCTION;
}

// Invoke Bedrock InvokeModel via the aws CLI. The request body goes through a
// temp file (--body fileb://...) and the model response is written to a second
// temp file, which we read back. Both are cleaned up afterwards.
let invokeSeq = 0;
function invokeBedrock(modelId, requestBody, cb) {
    let reqFile, outFile;
    try {
        // unique per call (counter) so concurrent requests can't collide on name
        const tag = process.pid + "-" + Date.now() + "-" + (++invokeSeq);
        reqFile = path.join(os.tmpdir(), "bedrock-req-" + tag + ".json");
        outFile = path.join(os.tmpdir(), "bedrock-out-" + tag + ".json");
        fs.writeFileSync(reqFile, requestBody);
    } catch (e) {
        return cb("Could not stage the request: " + e.message);
    }

    const cleanup = () => {
        try { fs.unlinkSync(reqFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
    };

    const args = [
        "bedrock-runtime", "invoke-model",
        "--region", BEDROCK_REGION,
        "--model-id", modelId,
        "--body", "fileb://" + reqFile,
        outFile,
    ];
    if (AWS_PROFILE) args.push("--profile", AWS_PROFILE);
    /* eslint-disable no-console */
    console.log("[analyze] invoking " + modelId + " in " + BEDROCK_REGION);
    const proc = spawn("aws", args, { stdio: ["ignore", "ignore", "pipe"] });
    let errOut = "";
    proc.stderr.on("data", (d) => (errOut += d));
    proc.on("error", (e) => {
        cleanup();
        console.error("[analyze] could not run aws CLI:", e.message);
        cb("Could not run the aws CLI: " + e.message);
    });
    proc.on("close", (code) => {
        if (code !== 0) {
            cleanup();
            // Full AWS stderr to the server console so the real cause is
            // visible even when the browser only shows the friendly hint.
            console.error("[analyze] aws exited " + code + " — full stderr:\n" + errOut.trim());
            // Only call it a credential problem on the actual auth/expiry error
            // types — not any message that happens to contain "token"
            // (e.g. max_tokens validation errors).
            const lastLine = errOut.trim().split("\n").pop() || "aws CLI exited with code " + code;
            let hint = lastLine;
            if (/NoCredentials|unable to locate credentials/i.test(errOut)) {
                hint = AWS_PROFILE
                    ? "No AWS credentials for profile '" + AWS_PROFILE + "'. Refresh your AWS login (Leapp/Klopper), or start the server with AWS_PROFILE set to a valid profile."
                    : "No AWS profile found. Start the server with AWS_PROFILE=<your-profile> (e.g. AWS_PROFILE=rnd-ai-tools npm start).";
            } else if (/ExpiredToken|InvalidClientTokenId|UnrecognizedClientException|expired|SSO|sso session/i.test(errOut)) {
                hint = "AWS credentials look expired — refresh them (Leapp/Klopper) and retry.";
            }
            return cb(hint);
        }
        try {
            const modelObj = JSON.parse(fs.readFileSync(outFile, "utf8"));
            const textBlock = (modelObj.content || []).find((b) => b.type === "text");
            cb(null, textBlock ? textBlock.text : "");
        } catch (e) {
            cb("Could not read the Bedrock response: " + e.message);
        } finally {
            cleanup();
        }
    });
}

// Pull the findings object out of the model's text (tolerates stray prose).
function extractFindings(text) {
    if (!text) return null;
    const tryParse = (s) => {
        try {
            const o = JSON.parse(s);
            if (o && Array.isArray(o.findings)) return o;
        } catch (_) { /* not valid here */ }
        return null;
    };
    let o = tryParse(text);
    if (o) return o;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
        o = tryParse(text.slice(start, end + 1));
        if (o) return o;
    }
    return null;
}

function sendJson(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/models") {
        sendJson(res, 200, { models: BEDROCK_MODELS, default: DEFAULT_MODEL, instructions: DEFAULT_INSTRUCTIONS });
        return;
    }
    if (req.method === "POST" && req.url === "/api/analyze") {
        handleAnalyze(req, res);
        return;
    }

    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    // route /sample/* to the sample directory
    let filePath = null;
    const extra = Object.keys(EXTRA_ROOTS).find((p) => urlPath.startsWith(p));
    if (extra) {
        filePath = safeJoin(EXTRA_ROOTS[extra], urlPath.slice(extra.length));
    } else {
        filePath = safeJoin(ROOT, urlPath);
    }

    if (!filePath) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found: " + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
    });
});

server.listen(PORT, () => {
    /* eslint-disable no-console */
    console.log("AI Usage Dashboard running at http://localhost:" + PORT);
    console.log("Serving " + ROOT);
    console.log("AI analysis: AWS profile = " + (AWS_PROFILE || "(none found — set AWS_PROFILE)") +
        ", region = " + BEDROCK_REGION);
    console.log("Open the URL, then Load CSV (or Load sample) to render a group.");
});

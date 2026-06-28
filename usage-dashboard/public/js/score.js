/*
 * score.js — builds the data structures the charts need.
 *
 * No composite score. For each question we produce:
 *   - a distribution: how many people gave each answer
 *   - a plain-English summary line
 *   - an overall ramp position (0–4, bad→good) for the topic heat pill
 *
 * Blanks are non-response — counted but never coerced to 0.
 */
(function () {
    const C = window.DASH_CONFIG;

    function isBlank(v) {
        return v == null || String(v).trim() === "";
    }

    // Distribution for a single-select ordinal question.
    // Returns [{ label, count, ramp }] in the order defined by scaleOrder.
    function ordinalDist(rows, colKey, qSpec) {
        const counts = {};
        qSpec.scaleOrder.forEach((l) => (counts[l] = 0));
        let blanks = 0;
        rows.forEach((r) => {
            const v = String(r[colKey] || "").trim();
            if (isBlank(v)) { blanks++; return; }
            if (Object.prototype.hasOwnProperty.call(counts, v)) counts[v]++;
            // else unknown answer — ignore quietly
        });
        const n = rows.length - blanks;
        const max = qSpec.scaleOrder.length - 1;
        return {
            type: "ordinal",
            items: qSpec.scaleOrder.map((label, i) => {
                const rawPos = max === 0 ? 0 : i / max; // 0..1 through scale
                const ramp = Math.round((qSpec.reverse ? 1 - rawPos : rawPos) * 4);
                return { label, count: counts[label] || 0, ramp };
            }),
            n,
            blanks,
            // mean ramp position (0–4), used only for topic heat — blanks excluded
            meanRamp: meanRampOf(rows, colKey, qSpec),
        };
    }

    function meanRampOf(rows, colKey, qSpec) {
        const max = qSpec.scaleOrder.length - 1;
        let sum = 0, cnt = 0;
        rows.forEach((r) => {
            const v = String(r[colKey] || "").trim();
            const i = qSpec.scaleOrder.indexOf(v);
            if (i < 0) return;
            const rawPos = max === 0 ? 0 : i / max;
            sum += (qSpec.reverse ? 1 - rawPos : rawPos) * 4;
            cnt++;
        });
        return cnt > 0 ? sum / cnt : null;
    }

    // Yes/No question — returns two-item dist.
    function yesnoDist(rows, colKey) {
        const counts = { No: 0, Yes: 0 };
        let blanks = 0;
        rows.forEach((r) => {
            const v = String(r[colKey] || "").trim();
            if (isBlank(v)) { blanks++; return; }
            if (v === "Yes") counts.Yes++;
            else counts.No++;
        });
        const pctYes = (counts.No + counts.Yes) > 0
            ? counts.Yes / (counts.No + counts.Yes)
            : 0;
        return {
            type: "yesno",
            items: [
                { label: "No", count: counts.No, ramp: 0 },
                { label: "Yes", count: counts.Yes, ramp: 4 },
            ],
            n: counts.No + counts.Yes,
            blanks,
            meanRamp: pctYes * 4,
        };
    }

    // Multi-select — each person may tick several. Returns flat count per token.
    function multiDist(rows, colKey) {
        const counts = {};
        let respondents = 0;
        rows.forEach((r) => {
            const v = String(r[colKey] || "").trim();
            if (isBlank(v)) return;
            respondents++;
            v.split(",").map((s) => s.trim()).filter(Boolean).forEach((tok) => {
                counts[tok] = (counts[tok] || 0) + 1;
            });
        });
        return {
            type: "multi",
            items: Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => ({ label, count, ramp: null })),
            respondents,
            blanks: rows.length - respondents,
        };
    }

    // Build distribution for one question.
    function questionDist(rows, cols, qNum) {
        const spec = C.QUESTIONS[qNum];
        if (!spec) return null;
        const col = cols[qNum];
        if (!col) return null;
        if (spec.multi || spec.marker) return multiDist(rows, col);
        if (spec.yesno) return yesnoDist(rows, col);
        if (spec.scaleOrder) return ordinalDist(rows, col, spec);
        return null;
    }

    // Topic-level mean ramp (0–4) — average of the mean ramps of its ordinal/yesno
    // questions. Used purely for the "how is this area doing" heat pill.
    function topicMeanRamp(rows, cols, topic) {
        const ramps = [];
        topic.questions.forEach((q) => {
            const spec = C.QUESTIONS[q];
            if (!spec) return;
            const col = cols[q];
            if (!col) return;
            let mr = null;
            if (spec.yesno) mr = yesnoDist(rows, col).meanRamp;
            else if (spec.scaleOrder) mr = meanRampOf(rows, col, spec);
            if (mr != null) ramps.push(mr);
        });
        if (!ramps.length) return null;
        return ramps.reduce((a, b) => a + b, 0) / ramps.length;
    }

    // High-level topic state: total people landing at each ramp level (0–4),
    // summed across every scored question in the topic. Different questions
    // use different scales, but ramp position is normalised, so it's a fair
    // roll-up. Returns [{ ramp, count }] for ramp 0..4.
    function topicAggregate(questionDists) {
        const totals = [0, 0, 0, 0, 0];
        questionDists.forEach((qd) => {
            const d = qd.dist;
            if (!d || (d.type !== "ordinal" && d.type !== "yesno")) return;
            d.items.forEach((it) => {
                if (it.ramp != null) totals[it.ramp] += it.count;
            });
        });
        return totals.map((count, ramp) => ({ ramp, count }));
    }

    // Strongest / typical / weakest question in a topic, by mean ramp.
    // All three point at real questions: best, middle (median), worst.
    // Skips multi-select questions (no scored mean).
    function topicExtremes(questionDists) {
        const scored = questionDists
            .filter((qd) => qd.dist && qd.dist.meanRamp != null)
            .map((qd) => ({ q: qd.q, label: qd.spec.label, mean: qd.dist.meanRamp }));
        if (!scored.length) return { strongest: null, typical: null, weakest: null };
        const sorted = scored.slice().sort((a, b) => b.mean - a.mean);
        return {
            strongest: sorted[0],
            typical: sorted[Math.floor((sorted.length - 1) / 2)],
            weakest: sorted[sorted.length - 1],
        };
    }

    // Compute everything for the current rows.
    function analyzeAll(rows, cols) {
        const topics = C.TOPICS.map((topic) => {
            const questions = topic.questions.map((q) => ({
                q,
                spec: C.QUESTIONS[q],
                dist: questionDist(rows, cols, q),
            })).filter((d) => d.dist);
            const mr = topicMeanRamp(rows, cols, topic);
            const extremes = topicExtremes(questions);
            return {
                ...topic,
                questions,
                meanRamp: mr,
                aggregate: topicAggregate(questions),
                strongest: extremes.strongest,
                typical: extremes.typical,
                weakest: extremes.weakest,
            };
        });

        // summary strip: best/weakest scored topics (exclude sentiment)
        const scored = topics.filter((t) => t.id !== "sentiment" && t.meanRamp != null);
        const sorted = scored.slice().sort((a, b) => b.meanRamp - a.meanRamp);
        const best = sorted[0] || null;
        const weakest = sorted[sorted.length - 1] || null;

        // most common role
        const roleCounts = {};
        rows.forEach((r) => {
            const v = String(r[cols[1]] || "").trim();
            if (v) roleCounts[v] = (roleCounts[v] || 0) + 1;
        });
        const topRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0];

        // Q35 open text
        const openTexts = rows
            .map((r) => String(r[cols[35]] || "").trim())
            .filter(Boolean);

        return { topics, best, weakest, topRole, openTexts, n: rows.length };
    }

    // Filter-slot counts for a column.
    function slotCounts(rows, colKey) {
        const c = {};
        rows.forEach((r) => {
            const v = String(r[colKey] || "").trim();
            if (v) c[v] = (c[v] || 0) + 1;
        });
        return c;
    }

    // Profile columns used for correlation. seniority is non-Q (matched by text).
    const PROFILE_FIELDS = [
        { key: 1, label: "Role" },
        { key: "seniority", label: "Seniority" },
        { key: 2, label: "Experience" },
        { key: 3, label: "AI tenure" },
    ];

    // Judgment-critical questions paired with each respondent's profile in the
    // per-respondent table. Short labels keep rows narrow.
    const TABLE_QUESTIONS = [
        [4, "AI-share"], [9, "plan-mode"], [11, "model-choice"], [22, "AI-research"],
        [26, "methodology"], [27, "inspect"], [28, "review-tools"], [29, "persist"], [30, "late-bugs"],
    ];

    function compositionText(rows, cols) {
        const lines = ["GROUP COMPOSITION (" + rows.length + " people)"];
        PROFILE_FIELDS.forEach((f) => {
            const col = cols[f.key];
            if (!col) return;
            const c = slotCounts(rows, col);
            const parts = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v);
            lines.push(f.label + ": " + parts.join(", "));
        });
        return lines.join("\n");
    }

    // One row per respondent: profile + key answers. The real engine for
    // grounded profile correlations at n≈20.
    function respondentTable(rows, cols) {
        const lines = [
            "PER-RESPONDENT TABLE (profile [role | seniority | experience | AI-tenure] -> key answers)",
        ];
        rows.forEach((r, i) => {
            const prof = PROFILE_FIELDS.map((f) => String(r[cols[f.key]] || "-").trim()).join(" | ");
            const ans = TABLE_QUESTIONS
                .filter(([q]) => cols[q])
                .map(([q, lbl]) => lbl + "=" + (String(r[cols[q]] || "-").trim() || "-"))
                .join("; ");
            lines.push("#" + (i + 1) + " [" + prof + "]  " + ans);
        });
        return lines.join("\n");
    }

    // Full per-question answer distributions (counts only).
    function distributionsText(data) {
        const lines = ["ANSWER DISTRIBUTIONS (counts per answer level, per question)"];
        data.topics.forEach((topic) => {
            lines.push("## " + topic.name);
            topic.questions.forEach((qd) => {
                const d = qd.dist;
                if (!d) return;
                if (d.type === "ordinal" || d.type === "yesno") {
                    const parts = d.items.filter((it) => it.count > 0).map((it) => it.count + " " + it.label);
                    lines.push("- " + qd.spec.label + ": " + parts.join(", ") +
                        (d.blanks ? " (" + d.blanks + " no answer)" : ""));
                } else if (d.type === "multi") {
                    const top = d.items.slice(0, 6).map((it) => it.label + " (" + it.count + ")");
                    lines.push("- " + qd.spec.label + ": " + top.join(", "));
                }
            });
            lines.push("");
        });
        return lines.join("\n");
    }

    // The full survey data block sent to the LLM: composition + per-respondent
    // table + distributions. Profile-aware, counts only.
    function summaryText(data, rows, cols) {
        return [
            compositionText(rows, cols),
            "",
            respondentTable(rows, cols),
            "",
            distributionsText(data),
        ].join("\n");
    }

    // Q35 comments, each prefixed with the author's profile, for the LLM to
    // correlate themes against role/seniority/experience/AI-tenure.
    function profiledComments(rows, cols) {
        const out = [];
        rows.forEach((r) => {
            const t = String(r[cols[35]] || "").trim();
            if (!t) return;
            const prof = PROFILE_FIELDS.map((f) => String(r[cols[f.key]] || "-").trim()).join(" | ");
            out.push("[" + prof + "]: " + t);
        });
        return out;
    }

    window.DASH_SCORE = { analyzeAll, questionDist, slotCounts, summaryText, profiledComments, isBlank };
})();

/*
 * app.js — orchestration: load CSV, run analysis, render all sections.
 *
 * Manager-first: glance at the page, see where the team is per topic.
 * Color = answer (red→green). Filters are multi-select and combinable;
 * a slice that drops below the floor suppresses the topics honestly.
 */
(function () {
    const C = window.DASH_CONFIG;
    const S = window.DASH_SCORE;
    const CH = window.DASH_CHARTS;

    let RAW = null;            // { rows, cols }
    // active filters: { [colKey]: { title, values:Set } } — OR within a
    // dimension, AND across dimensions.
    let filters = {};
    // kinds queued to auto-run on the next render (set when a CSV loads).
    let autoRunKinds = new Set();

    // ---- DOM helpers -------------------------------------------------------
    function el(id) { return document.getElementById(id); }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

    function h(tag, attrs, children) {
        const n = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach((k) => {
                if (k === "class") n.className = attrs[k];
                else if (k === "text") n.textContent = attrs[k];
                else if (k === "html") n.innerHTML = attrs[k];
                else if (k === "style") Object.assign(n.style, attrs[k]);
                else n.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach((c) => {
            if (typeof c === "string") n.appendChild(document.createTextNode(c));
            else if (c) n.appendChild(c);
        });
        return n;
    }
    function tag(t, cls, text) { return h(t, { class: cls, text: text || "" }); }

    // ---- Main render -------------------------------------------------------
    function renderAll() {
        const rows = currentRows();
        const cols = RAW.cols;

        el("dashboard").hidden = false;
        el("dropzone-wrap").classList.add("loaded");

        renderFilterBar();

        // n=5 floor: a filtered slice under the floor is too small to read.
        if (activeFilterCount() > 0 && rows.length < C.N_FLOOR) {
            renderSuppressed(rows.length);
            return;
        }

        const data = S.analyzeAll(rows, cols);
        renderSummaryStrip(data, rows, cols);
        renderSurveyFindings(data, rows, cols);
        renderTopics(data, rows.length);
        renderOpenText(data.openTexts, S.profiledComments(rows, cols), rows.length);
    }

    function activeFilterCount() {
        return Object.values(filters).reduce((s, f) => s + f.values.size, 0);
    }

    function currentRows() {
        const active = Object.entries(filters).filter(([, f]) => f.values.size > 0);
        if (!active.length) return RAW.rows;
        return RAW.rows.filter((r) =>
            active.every(([colKey, f]) => f.values.has(String(r[colKey] || "").trim()))
        );
    }

    function renderSuppressed(n) {
        el("summary-strip").innerHTML = "";
        clear(el("topics-host"));
        clear(el("opentext-host"));
        el("topics-host").appendChild(h("p", { class: "suppressed" }, [
            "This filter matches only " + n + " " + (n === 1 ? "person" : "people") +
            ". With fewer than " + C.N_FLOOR + ", there's too little data to read into — widen the filter.",
        ]));
    }

    // ---- Summary strip — factual counts only, no verdicts ------------------
    function renderSummaryStrip(data, rows, cols) {
        const host = el("summary-strip");
        clear(host);
        const n = rows.length;

        // count rows whose answer in a column is in a given set
        const countIn = (colKey, values) => {
            const col = cols[colKey];
            if (!col) return 0;
            const set = new Set(values);
            return rows.filter((r) => set.has(String(r[col] || "").trim())).length;
        };

        const heavy = countIn(4, ["50–75%", "75–100%"]);                 // Q4 AI-share
        const daily = countIn(7, ["Hourly", "Constantly throughout the day"]); // Q7
        const builders = rows.filter((r) =>                                // Q16/Q17 behavioral
            String(r[cols[16]] || "").trim() === "Yes" ||
            String(r[cols[17]] || "").trim() === "Yes"
        ).length;
        const reviewers = countIn(28, ["Regularly", "Core to my workflow"]); // Q28

        // "people in this view" stays a plain count; the rest are share-of-team
        // metrics with a fill bar.
        host.appendChild(h("div", { class: "summary-card summary-card-total" }, [
            h("div", { class: "summary-icon", html: ICON.people }),
            h("div", { class: "summary-big" }, [String(n)]),
            h("div", { class: "summary-label" }, ["people in this view"]),
        ]));

        const metrics = [
            { count: heavy, label: "use AI for half their work or more", icon: ICON.gauge, accent: "#2563eb" },
            { count: daily, label: "use AI daily", icon: ICON.clock, accent: "#7c3aed" },
            { count: builders, label: "built their own skill or MCP", icon: ICON.wrench, accent: "#0891b2" },
            { count: reviewers, label: "review AI output regularly", icon: ICON.shield, accent: "#16a34a" },
        ];
        metrics.forEach((m) => {
            const pct = n ? Math.round((m.count / n) * 100) : 0;
            host.appendChild(h("div", { class: "summary-card summary-metric" }, [
                h("div", { class: "summary-top" }, [
                    h("span", { class: "summary-icon", style: { color: m.accent }, html: m.icon }),
                    h("span", { class: "summary-pct", style: { color: m.accent } }, [pct + "%"]),
                ]),
                h("div", { class: "summary-frac" }, [m.count + " of " + n]),
                h("div", { class: "summary-label" }, [m.label]),
                h("div", { class: "summary-bar" }, [
                    h("div", { class: "summary-bar-fill", style: { width: pct + "%", background: m.accent } }, []),
                ]),
            ]));
        });
    }

    // small inline SVG icons (stroke uses currentColor)
    const svg = (paths) =>
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' + paths + "</svg>";
    const ICON = {
        people: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
        gauge: svg('<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/>'),
        clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
        wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-2.1z"/>'),
        shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
    };

    // ---- Topics ------------------------------------------------------------
    function renderTopics(data, n) {
        const host = el("topics-host");
        clear(host);
        // Legend up top: the high-level bars are color-coded, so the key must
        // be readable before anyone expands a card.
        host.appendChild(buildLegend());
        data.topics.forEach((topic) => host.appendChild(buildTopicCard(topic, n)));
    }

    function buildTopicCard(topic, n) {
        const card = h("div", { class: "topic-card" });

        const header = h("div", { class: "topic-header" }, [
            h("div", { class: "topic-header-left" }, [
                h("span", { class: "heat-pill", style: { background: CH.heatGradient(topic.meanRamp) } }),
                h("span", { class: "topic-name" }, [topic.name]),
            ]),
            h("button", { class: "expand-btn", "aria-label": "expand" }, ["▸"]),
        ]);
        card.appendChild(header);
        card.appendChild(h("p", { class: "topic-plain" }, [topic.plain]));

        // high-level aggregate bar (sum of each level across the topic) — always
        // visible so the manager sees the topic's state at a glance.
        if (topic.id !== "sentiment" && topic.aggregate) {
            const aggWrap = h("div", { class: "topic-agg" });
            const aggEl = h("div", { class: "agg-bar" });
            aggWrap.appendChild(aggEl);
            card.appendChild(aggWrap);
            setTimeout(() => CH.topicAggregateBar(aggEl, topic.aggregate), 0);
        }

        // strongest / typical / weakest question in the topic — all real
        // questions, ranked by how the team answered them.
        if (topic.strongest && topic.weakest && topic.strongest.q !== topic.weakest.q) {
            const children = [
                h("span", { class: "extreme extreme-strong" }, [
                    h("span", { class: "extreme-tag" }, ["Strongest"]),
                    topic.strongest.label,
                ]),
            ];
            if (topic.typical && topic.typical.q !== topic.strongest.q && topic.typical.q !== topic.weakest.q) {
                children.push(h("span", { class: "extreme extreme-typical" }, [
                    h("span", { class: "extreme-tag" }, ["Typical"]),
                    topic.typical.label,
                ]));
            }
            children.push(h("span", { class: "extreme extreme-weak" }, [
                h("span", { class: "extreme-tag" }, ["Weakest"]),
                topic.weakest.label,
            ]));
            card.appendChild(h("div", { class: "topic-extremes" }, children));
        }

        const body = h("div", { class: "topic-body", hidden: "hidden" });
        card.appendChild(body);

        let built = false;
        const btn = header.querySelector("button");
        header.addEventListener("click", () => {
            if (body.hasAttribute("hidden")) {
                body.removeAttribute("hidden");
                btn.textContent = "▾";
                if (!built) { buildTopicBody(body, topic, n); built = true; }
            } else {
                body.setAttribute("hidden", "hidden");
                btn.textContent = "▸";
            }
        });
        return card;
    }

    function buildTopicBody(host, topic, n) {
        // sentiment topic: one diverging chart, plain note
        if (topic.id === "sentiment") {
            host.appendChild(h("p", { class: "sentiment-note" }, [
                "These are feelings, not facts — useful for spotting stress or FOMO.",
            ]));
            const qs = topic.questions.filter((q) => q.dist && q.dist.type === "ordinal");
            if (qs.length) {
                const chartEl = h("div", { class: "chart chart-senti" });
                host.appendChild(chartEl);
                setTimeout(() => CH.divergingSentiment(chartEl, qs, n), 0);
            }
            return;
        }

        topic.questions.forEach((qd) => {
            const spec = qd.spec, dist = qd.dist;
            if (!dist) return;
            const qWrap = h("div", { class: "q-wrap" });
            qWrap.appendChild(h("div", { class: "q-label" }, [
                "Q" + qd.q + ". " + spec.label,
                spec.tier === "fact" ? h("span", { class: "tier-tag tier-fact" }, [" behavioral"]) : null,
            ]));
            const chartEl = h("div", { class: chartClass(dist) });
            qWrap.appendChild(chartEl);
            host.appendChild(qWrap);
            setTimeout(() => {
                if (dist.type === "ordinal") CH.stacked100Bar(chartEl, [qd], { n, tier: spec.tier });
                else if (dist.type === "yesno") CH.hBar(chartEl, dist.items, { color: "#6B7280" });
                else if (dist.type === "multi") CH.hBar(chartEl, dist.items, { topN: 8 });
            }, 0);
        });
    }

    function chartClass(dist) {
        if (dist.type === "multi") return "chart chart-multi";
        if (dist.type === "yesno") return "chart chart-yesno";
        return "chart chart-ordinal";
    }

    function buildLegend() {
        const wrap = h("div", { class: "legend" });
        C.RAMP.forEach((color, i) => {
            wrap.appendChild(h("span", { class: "legend-item" }, [
                h("span", { class: "legend-swatch", style: { background: color } }),
                h("span", { class: "legend-text" }, [LEGEND_TEXT[i]]),
            ]));
        });
        return wrap;
    }
    const LEGEND_TEXT = ["Never / No", "Tried it / Rarely", "Occasionally / Sometimes", "Regularly / Often", "Core / Always"];

    // ---- Survey results findings (quantitative) ----------------------------
    function renderSurveyFindings(data, rows, cols) {
        const host = el("survey-findings-host");
        clear(host);
        const summary = S.summaryText(data, rows, cols);
        host.appendChild(buildAnalysisBlock({
            kind: "survey",
            payload: () => ({ kind: "survey", summary }),
            hint: "key findings from the response numbers",
            buttonText: "Summarize the results",
        }));
    }

    // ---- Open-text comments (qualitative) ----------------------------------
    function renderOpenText(texts, profiledTexts, n) {
        const host = el("opentext-host");
        clear(host);
        if (!texts.length) {
            host.appendChild(h("p", { class: "empty" }, ["No written responses in this view."]));
            return;
        }
        host.appendChild(h("p", { class: "ot-meta" }, [texts.length + " of " + n + " people wrote a comment."]));
        host.appendChild(buildAnalysisBlock({
            kind: "comments",
            payload: () => ({ kind: "comments", answers: profiledTexts }),
            hint: "key findings from the comments",
            buttonText: "Summarize the comments",
        }));

        // raw quotes
        const list = h("div", { class: "ot-list" });
        texts.forEach((t) => list.appendChild(h("blockquote", { class: "ot-quote" }, ["“" + t + "”"])));
        host.appendChild(h("details", { class: "ot-raw" }, [
            h("summary", {}, ["Show all " + texts.length + " raw comments"]),
            list,
        ]));
    }

    // Reusable analysis block: a collapsible panel holding a model picker, an
    // optional inline prompt editor, the run button, and the result area.
    function buildAnalysisBlock({ kind, payload, hint, buttonText }) {
        const details = h("details", { class: "ai-block", open: "open" });
        details.appendChild(h("summary", { class: "ai-block-summary" }, [buttonText]));

        const bodyEl = h("div", { class: "ai-block-body" });

        // --- inline prompt editor (collapsed by default) ---
        const promptArea = h("textarea", { class: "prompt-editor", rows: "4", spellcheck: "false" });
        const setPrompt = () => {
            promptArea.value = (instructionOverrides[kind] != null)
                ? instructionOverrides[kind]
                : (modelChoices && modelChoices.instructions && modelChoices.instructions[kind]) || "";
        };
        const resetBtn = h("button", { class: "prompt-reset" }, ["Reset to default"]);
        resetBtn.addEventListener("click", (e) => {
            e.preventDefault();
            delete instructionOverrides[kind];
            setPrompt();
        });
        promptArea.addEventListener("input", () => { instructionOverrides[kind] = promptArea.value; });
        const expandBtn = h("button", { class: "prompt-expand", title: "Expand editor" }, ["⤢"]);
        expandBtn.addEventListener("click", (e) => {
            e.preventDefault();
            promptArea.classList.toggle("expanded");
        });
        const promptDetails = h("details", { class: "prompt-edit" }, [
            h("summary", {}, ["Edit prompt"]),
            h("div", { class: "prompt-edit-body" }, [
                h("div", { class: "prompt-edit-bar" }, [expandBtn, resetBtn]),
                promptArea,
                h("p", { class: "prompt-note" }, [
                    "Your data and the required JSON format are always appended automatically — edit only the guidance.",
                ]),
            ]),
        ]);
        promptDetails.addEventListener("toggle", () => { if (promptDetails.open) setPrompt(); });
        bodyEl.appendChild(promptDetails);

        // --- run controls + result ---
        const modelSelect = h("select", { class: "model-select", "aria-label": "Claude model" });
        populateModels(modelSelect);
        const btn = h("button", { class: "btn-analyze" }, [buttonText]);
        const resultHost = h("div", { class: "ai-result" });
        const run = () => {
            const body = payload();
            if (instructionOverrides[kind] != null) body.instruction = instructionOverrides[kind];
            runAnalysis(body, modelSelect.value, btn, resultHost, buttonText);
        };
        btn.addEventListener("click", run);
        bodyEl.appendChild(h("div", { class: "ai-controls" }, [
            btn, modelSelect, h("span", { class: "ai-hint" }, [hint]),
        ]));
        bodyEl.appendChild(resultHost);

        details.appendChild(bodyEl);

        // Auto-run once per CSV load (set in handleCsv). Filter changes rebuild
        // the block but don't re-fire — those stay on-demand to avoid hammering
        // the model on every toggle.
        if (autoRunKinds.has(kind)) {
            autoRunKinds.delete(kind);
            setTimeout(run, 0);
        }
        return details;
    }

    // model list + default instructions (fetched once from the server)
    let modelChoices = null;
    const instructionOverrides = {}; // kind -> edited instruction text
    function populateModels(select) {
        const fill = () => {
            clear(select);
            (modelChoices.models || []).forEach((m) => {
                const opt = h("option", { value: m.id }, [m.label]);
                if (m.id === modelChoices.default) opt.setAttribute("selected", "selected");
                select.appendChild(opt);
            });
        };
        if (modelChoices) { fill(); return; }
        fetch("/api/models")
            .then((r) => r.json())
            .then((j) => { modelChoices = j; fill(); })
            .catch(() => { select.appendChild(h("option", { value: "" }, ["(model list unavailable)"])); });
    }

    function runAnalysis(payload, model, btn, host, buttonText) {
        btn.disabled = true;
        btn.textContent = "Analyzing…";
        clear(host);
        host.appendChild(h("div", { class: "ai-loading" }, [
            h("span", { class: "ai-spinner" }, []),
            h("span", {}, ["Analyzing… this can take a few seconds."]),
        ]));
        const done = (label) => { btn.disabled = false; btn.textContent = label; };
        fetch("/api/analyze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(Object.assign({ model: model }, payload)),
        })
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => {
                clear(host);
                if (!ok || j.error) {
                    done(buttonText);
                    host.appendChild(h("p", { class: "ai-error" }, [j.error || "Analysis failed."]));
                    return;
                }
                renderFindings(host, j.findings || [], payload.kind);
                // once done, the button becomes an on-demand re-run
                done("Re-analyze");
            })
            .catch((e) => {
                clear(host);
                done(buttonText);
                host.appendChild(h("p", { class: "ai-error" }, ["Could not reach the analysis service: " + e.message]));
            });
    }

    // Finding cards: type dot + segment chip + headline + inline evidence.
    // Survey evidence renders as plain data points; comment evidence as quotes.
    // rank drives worst→best sort order; lower = worse (shown first).
    const FINDING_TYPES = {
        gap: { label: "Gap", cls: "type-gap", rank: 0 },
        watch: { label: "Watch", cls: "type-watch", rank: 1 },
        solid: { label: "Solid", cls: "type-solid", rank: 2 },
        strength: { label: "Strength", cls: "type-strength", rank: 3 },
    };
    function renderFindings(host, findings, kind) {
        clear(host);
        if (!findings.length) {
            host.appendChild(h("p", { class: "empty" }, ["No findings returned."]));
            return;
        }
        const isComments = kind === "comments";
        // worst → best; preserve the model's order within a type (stable sort)
        const ordered = findings
            .map((f, i) => ({ f, i }))
            .sort((a, b) => {
                const ra = (FINDING_TYPES[a.f.type] || FINDING_TYPES.watch).rank;
                const rb = (FINDING_TYPES[b.f.type] || FINDING_TYPES.watch).rank;
                return ra - rb || a.i - b.i;
            })
            .map((x) => x.f);

        const wrap = h("div", { class: "finding-cards" });
        ordered.forEach((f) => {
            const t = FINDING_TYPES[f.type] || FINDING_TYPES.watch;
            const segment = (f.segment || "").trim();
            const isWhole = !segment || /^whole team$/i.test(segment);

            const meta = h("div", { class: "finding-meta" }, [
                h("span", { class: "finding-dot " + t.cls, title: t.label }, []),
                h("span", { class: "finding-type " + t.cls }, [t.label]),
            ]);
            if (!isWhole) meta.appendChild(h("span", { class: "finding-segment" }, [segment]));
            else meta.appendChild(h("span", { class: "finding-segment finding-segment-all" }, ["whole team"]));

            // collapsible: meta + headline live in <summary> (always visible);
            // evidence sits in the body and collapses. Collapsed by default.
            const ev = f.evidence || [];
            const card = h("details", { class: "finding-card " + t.cls });
            const headlineRow = h("div", { class: "finding-headline" }, [f.headline]);
            if (ev.length) {
                headlineRow.appendChild(h("span", { class: "finding-expand-hint" }, [
                    (isComments ? ev.length + " quote" + (ev.length === 1 ? "" : "s") : ev.length + " data point" + (ev.length === 1 ? "" : "s")),
                ]));
            }
            card.appendChild(h("summary", { class: "finding-summary" }, [
                meta,
                headlineRow,
            ]));
            if (ev.length) {
                const evWrap = h("ul", { class: "finding-evidence" + (isComments ? " evidence-quotes" : "") });
                ev.forEach((e) => evWrap.appendChild(h("li", { class: "evidence-item" }, [
                    isComments ? "“" + e + "”" : e,
                ])));
                card.appendChild(evWrap);
            }
            wrap.appendChild(card);
        });
        host.appendChild(wrap);
    }

    // ---- Filter bar (heading section, multi-select dropdowns) --------------
    const FILTER_DIMS = [
        { title: "Role", get: () => RAW.cols[1] },
        { title: "Seniority", get: () => RAW.cols.seniority },
        { title: "Experience", get: () => RAW.cols[2] },
        { title: "AI tenure", get: () => RAW.cols[3] },
    ];

    function renderFilterBar() {
        const host = el("filterbar");
        clear(host);

        const matched = currentRows().length;
        const controls = h("div", { class: "filter-controls" });
        FILTER_DIMS.forEach((dim) => {
            const colKey = dim.get();
            if (colKey) controls.appendChild(buildFilterDropdown(dim.title, colKey));
        });
        host.appendChild(controls);

        // active selections as removable chips + clear-all
        const chips = h("div", { class: "filter-chips" });
        let any = false;
        Object.entries(filters).forEach(([colKey, f]) => {
            f.values.forEach((value) => {
                any = true;
                const chip = h("span", { class: "filter-chip" }, [
                    f.title + ": " + value,
                    h("button", { class: "chip-x", "aria-label": "remove" }, ["×"]),
                ]);
                chip.querySelector("button").addEventListener("click", () => {
                    f.values.delete(value);
                    renderAll();
                });
                chips.appendChild(chip);
            });
        });
        if (any) {
            const clearAll = h("button", { class: "filter-clear-all" }, ["Clear all"]);
            clearAll.addEventListener("click", () => { filters = {}; renderAll(); });
            chips.appendChild(clearAll);
        }
        host.appendChild(chips);

        host.appendChild(h("p", { class: "filter-meta" }, [
            any ? matched + " of " + RAW.rows.length + " people match" : "Showing all " + RAW.rows.length + " people",
            "  ·  groups below " + C.N_FLOOR + " are too small to read.",
        ]));
    }

    function buildFilterDropdown(title, colKey) {
        const counts = S.slotCounts(RAW.rows, colKey);
        const selected = filters[colKey] ? filters[colKey].values : new Set();
        const wrap = h("details", { class: "filter-dd" });
        const sel = selected.size ? " (" + selected.size + ")" : "";
        wrap.appendChild(h("summary", { class: "filter-dd-summary" }, [title + sel]));

        // open one at a time: opening this dropdown closes any other open one
        wrap.addEventListener("toggle", () => {
            if (!wrap.open) return;
            wrap.parentNode.querySelectorAll("details.filter-dd[open]").forEach((d) => {
                if (d !== wrap) d.removeAttribute("open");
            });
        });

        const panel = h("div", { class: "filter-dd-panel" });
        Object.keys(counts).sort().forEach((value) => {
            const n = counts[value];
            const enough = n >= C.N_FLOOR;
            const id = "f_" + colKey.replace(/\W/g, "") + "_" + value.replace(/\W/g, "");
            const cb = h("input", { type: "checkbox", id });
            if (selected.has(value)) cb.checked = true;
            if (!enough) { cb.disabled = true; }
            cb.addEventListener("change", () => {
                if (!filters[colKey]) filters[colKey] = { title, values: new Set() };
                if (cb.checked) filters[colKey].values.add(value);
                else filters[colKey].values.delete(value);
                renderAll();
            });
            const row = h("label", { class: "filter-opt" + (enough ? "" : " disabled"), for: id }, [
                cb,
                h("span", {}, [value]),
                h("span", { class: "filter-opt-n" }, ["(" + n + ")"]),
            ]);
            if (!enough) row.title = "Fewer than " + C.N_FLOOR + " people — too small to read into.";
            panel.appendChild(row);
        });

        if (selected.size) {
            const clear = h("button", { class: "filter-dd-clear" }, ["Clear " + title]);
            clear.addEventListener("click", (e) => {
                e.preventDefault();
                if (filters[colKey]) filters[colKey].values.clear();
                renderAll();
            });
            panel.appendChild(clear);
        }
        wrap.appendChild(panel);
        return wrap;
    }

    // ---- CSV loading -------------------------------------------------------
    function handleCsv(text, fileName) {
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: (res) => {
                const fields = res.meta.fields || [];
                const cols = C.resolveColumns(fields);
                if (!cols[8] || !cols[27] || !cols[35]) {
                    showError("This file doesn't look like the survey export — expected question columns are missing.");
                    return;
                }
                RAW = { rows: res.data, cols };
                filters = {};
                autoRunKinds = new Set(["survey", "comments"]); // auto-run both on load
                hideError();
                el("file-name").textContent = fileName || "CSV";
                renderAll();
            },
            error: (err) => showError("Could not parse the file: " + err.message),
        });
    }

    function showError(msg) { const e = el("load-error"); e.textContent = msg; e.hidden = false; }
    function hideError() { el("load-error").hidden = true; }

    // ---- Wire up events ----------------------------------------------------
    document.addEventListener("DOMContentLoaded", () => {
        el("file-input").addEventListener("change", (ev) => {
            const f = ev.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => handleCsv(reader.result, f.name);
            reader.readAsText(f);
        });

        const dz = el("dropzone");
        ["dragover", "dragenter"].forEach((evt) =>
            dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
        ["dragleave", "drop"].forEach((evt) =>
            dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
        dz.addEventListener("drop", (e) => {
            const f = e.dataTransfer.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => handleCsv(reader.result, f.name);
            reader.readAsText(f);
        });

        el("load-sample").addEventListener("click", (e) => {
            e.preventDefault();
            fetch("sample/mock_survey_responses.csv")
                .then((r) => r.text())
                .then((t) => handleCsv(t, "sample data"))
                .catch(() => showError("Could not load the sample file."));
        });
    });

    void tag;
})();

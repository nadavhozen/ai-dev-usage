/*
 * charts.js — all ECharts builders.
 *
 * Color encodes the ANSWER on a red→green ramp:
 *   0=red (not doing it), 1=orange, 2=yellow, 3=light-green, 4=green (fully adopted).
 * Reverse-coded questions are handled in score.js before we get here —
 * ramp=0 always means "this is a gap" in every chart.
 *
 * Three chart types:
 *   1. stacked100Bar  — horizontal 100%-stacked bar per question (core view)
 *   2. hBar           — simple horizontal count bar for multi-select / yes-no
 *   3. divergingSentiment — left/right diverging for feeling questions
 */
(function () {
    const C = window.DASH_CONFIG;

    const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    const INK = "#111827";
    const LABEL = "#6B7280";
    const GRID = "#E5E7EB";
    const NEUTRAL = "#CBD5E1";
    const BG = "#FFFFFF";

    const registry = [];
    function track(c) { if (c) registry.push(c); return c; }
    window.addEventListener("resize", () => registry.forEach((c) => { try { c.resize(); } catch (_) {} }));

    function init(el) {
        return echarts.init(el, null, { renderer: "canvas" });
    }

    function baseAxis() {
        return {
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: GRID, type: "dashed" } },
            axisLabel: { fontFamily: FONT, fontSize: 11, color: LABEL },
        };
    }

    function tooltip(formatter) {
        return {
            trigger: "item",
            backgroundColor: BG,
            borderColor: GRID,
            borderWidth: 1,
            padding: [8, 12],
            textStyle: { color: INK, fontFamily: FONT, fontSize: 12 },
            formatter,
        };
    }

    // --- 1. Stacked 100% horizontal bar per question ----------------------
    // Each segment = one answer option, colored by ramp position.
    // Segments sized by count; tooltip shows "X people".
    function stacked100Bar(el, questions, opts) {
        opts = opts || {};
        const n = opts.n || 1;
        // Collect all unique answer labels across all questions so we can
        // build one series per answer (required by ECharts stacking).
        const allLabels = [];
        const seenLabels = new Set();
        questions.forEach((q) => {
            if (!q.dist || q.dist.type !== "ordinal") return;
            q.dist.items.forEach((item) => {
                if (!seenLabels.has(item.label)) {
                    seenLabels.add(item.label);
                    allLabels.push({ label: item.label, ramp: item.ramp });
                }
            });
        });
        if (!allLabels.length) { el.style.display = "none"; return null; }

        const qLabels = questions
            .filter((q) => q.dist && q.dist.type === "ordinal")
            .map((q) => truncate(q.spec.label, 55));

        if (!qLabels.length) { el.style.display = "none"; return null; }

        const series = allLabels.map(({ label, ramp }) => ({
            name: label,
            type: "bar",
            stack: "total",
            barWidth: opts.barWidth || "65%",
            label: {
                show: true,
                formatter: (p) => (p.value > 0 ? p.value : ""),
                color: ramp === 1 || ramp === 2 ? "#374151" : "#fff",
                fontFamily: FONT,
                fontSize: 11,
                fontWeight: 600,
            },
            emphasis: { focus: "series" },
            itemStyle: {
                color: C.rampColor(ramp),
                borderRadius: 0,
                opacity: opts.tier === "self" ? 0.85 : 1.0,
            },
            data: questions
                .filter((q) => q.dist && q.dist.type === "ordinal")
                .map((q) => {
                    const found = q.dist.items.find((it) => it.label === label);
                    return found ? found.count : 0;
                }),
            tooltip: {
                ...tooltip(null),
                formatter: (p) =>
                    `<b>${p.seriesName}</b><br/>${p.name}<br/>${p.value} of ${n} people`,
            },
        }));

        const chart = init(el);
        chart.setOption({
            grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
            textStyle: { fontFamily: FONT },
            legend: { show: false },
            xAxis: {
                type: "value",
                max: n,
                show: true,
                ...baseAxis(),
                axisLabel: {
                    ...baseAxis().axisLabel,
                    formatter: (v) => (v === 0 || v === n ? v : ""),
                },
                name: "people",
                nameLocation: "end",
                nameTextStyle: { color: LABEL, fontFamily: FONT, fontSize: 10 },
            },
            yAxis: {
                type: "category",
                data: qLabels,
                ...baseAxis(),
                axisLabel: {
                    ...baseAxis().axisLabel,
                    width: 260,
                    overflow: "truncate",
                    fontSize: 12,
                    color: INK,
                },
                splitLine: { show: false },
            },
            series,
        });
        return track(chart);
    }

    // --- 1b. Topic aggregate bar — total answers at each ramp level -------
    // One thin stacked bar summarising the whole topic: how many answers
    // (across all its questions) landed at each engagement level, with counts.
    function topicAggregateBar(el, aggregate) {
        const total = aggregate.reduce((s, a) => s + a.count, 0) || 1;
        const series = aggregate.map((a) => ({
            name: C.RAMP_LABELS[a.ramp],
            type: "bar",
            stack: "agg",
            data: [a.count],
            barWidth: 22,
            itemStyle: { color: C.rampColor(a.ramp) },
            label: {
                show: a.count > 0,
                formatter: () => a.count,
                color: a.ramp === 1 || a.ramp === 2 ? "#374151" : "#fff",
                fontFamily: FONT,
                fontSize: 11,
                fontWeight: 600,
            },
            tooltip: {
                ...tooltip(null),
                formatter: () => `<b>${C.RAMP_LABELS[a.ramp]}</b><br/>${a.count} of ${total} answers`,
            },
        }));
        const chart = init(el);
        chart.setOption({
            grid: { left: 0, right: 0, top: 2, bottom: 2 },
            textStyle: { fontFamily: FONT },
            xAxis: { type: "value", show: false, max: total },
            yAxis: { type: "category", show: false, data: ["agg"] },
            series,
        });
        return track(chart);
    }

    // --- 2. Horizontal count bar (multi-select, yes/no, top-N) ------------
    function hBar(el, items, opts) {
        opts = opts || {};
        const visible = items.slice(0, opts.topN || 10);
        const labels = visible.map((d) => truncate(d.label, 45));
        const counts = visible.map((d) => d.count);
        const colors = visible.map((d) =>
            d.ramp != null ? C.rampColor(d.ramp) : (opts.color || "#6B7280")
        );
        const chart = init(el);
        chart.setOption({
            grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
            textStyle: { fontFamily: FONT },
            tooltip: tooltip((p) => `${p.name}<br/>${p.value} people`),
            xAxis: {
                type: "value",
                ...baseAxis(),
                name: "people",
                nameLocation: "end",
                nameTextStyle: { color: LABEL, fontFamily: FONT, fontSize: 10 },
                minInterval: 1,
            },
            yAxis: {
                type: "category",
                data: labels,
                ...baseAxis(),
                axisLabel: {
                    ...baseAxis().axisLabel,
                    width: 220,
                    overflow: "truncate",
                    fontSize: 12,
                    color: INK,
                },
                splitLine: { show: false },
            },
            series: [{
                type: "bar",
                data: counts.map((c, i) => ({ value: c, itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] } })),
                barWidth: "55%",
                label: {
                    show: true,
                    position: "right",
                    formatter: (p) => p.value,
                    color: LABEL,
                    fontFamily: FONT,
                    fontSize: 11,
                },
            }],
        });
        return track(chart);
    }

    // --- 3. Diverging sentiment bars (centered on Neutral) ----------------
    // Items: [{ label (question), items: [{label, count}] }]
    function divergingSentiment(el, questions, n) {
        // For each question, split answers into negative / neutral / positive buckets
        const NEG_LABELS = new Set(["Strongly disagree", "Disagree", "Significant stress / overwhelm", "FOMO — worried I'm falling behind", "Mild stress"]);
        const POS_LABELS = new Set(["Agree", "Strongly agree", "Energized"]);

        const qNames = questions.map((q) => truncate(q.spec.label, 50));

        function bucket(q) {
            let neg = 0, neu = 0, pos = 0;
            if (!q.dist) return { neg, neu, pos };
            q.dist.items.forEach(({ label, count }) => {
                if (NEG_LABELS.has(label)) neg += count;
                else if (POS_LABELS.has(label)) pos += count;
                else neu += count;
            });
            return { neg: -neg, neu, pos };
        }

        const buckets = questions.map(bucket);

        const chart = init(el);
        chart.setOption({
            grid: { left: 8, right: 60, top: 12, bottom: 8, containLabel: true },
            textStyle: { fontFamily: FONT },
            legend: {
                data: ["Negative", "Neutral", "Positive"],
                top: 0,
                right: 0,
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { fontFamily: FONT, fontSize: 11, color: LABEL },
            },
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow" },
                backgroundColor: BG,
                borderColor: GRID,
                textStyle: { color: INK, fontFamily: FONT, fontSize: 12 },
                formatter: (ps) => {
                    const name = ps[0].axisValue;
                    return [name, ...ps.map((p) => `${p.seriesName}: ${Math.abs(p.value)} people`)].join("<br/>");
                },
            },
            xAxis: {
                type: "value",
                ...baseAxis(),
                axisLabel: { ...baseAxis().axisLabel, formatter: (v) => Math.abs(v) },
                name: "people",
                nameLocation: "end",
                nameTextStyle: { color: LABEL, fontFamily: FONT, fontSize: 10 },
            },
            yAxis: {
                type: "category",
                data: qNames,
                ...baseAxis(),
                axisLabel: { ...baseAxis().axisLabel, width: 220, overflow: "truncate", fontSize: 12, color: INK },
                splitLine: { show: false },
            },
            series: [
                {
                    name: "Negative",
                    type: "bar",
                    stack: "s",
                    data: buckets.map((b) => b.neg),
                    itemStyle: { color: "#F87171", borderRadius: [0, 0, 0, 0] },
                    barWidth: "55%",
                },
                {
                    name: "Neutral",
                    type: "bar",
                    stack: "s",
                    data: buckets.map((b) => b.neu),
                    itemStyle: { color: NEUTRAL },
                    barWidth: "55%",
                },
                {
                    name: "Positive",
                    type: "bar",
                    stack: "s",
                    data: buckets.map((b) => b.pos),
                    itemStyle: { color: "#86C440", borderRadius: [0, 4, 4, 0] },
                    barWidth: "55%",
                },
            ],
        });
        void n;
        return track(chart);
    }

    // --- heat pill gradient background -----------------------------------
    // Used in the topic header to show overall position on the ramp.
    function heatGradient(meanRamp) {
        if (meanRamp == null) return "#E5E7EB";
        const pos = Math.max(0, Math.min(1, meanRamp / 4));
        // interpolate from red through yellow to green
        if (pos < 0.5) {
            const t = pos * 2;
            return lerpColor("#DC2626", "#FBBF24", t);
        }
        const t = (pos - 0.5) * 2;
        return lerpColor("#FBBF24", "#16A34A", t);
    }

    function lerpColor(a, b, t) {
        const ah = parseInt(a.slice(1), 16);
        const bh = parseInt(b.slice(1), 16);
        const r = Math.round(((ah >> 16) & 0xff) * (1 - t) + ((bh >> 16) & 0xff) * t);
        const g = Math.round(((ah >> 8) & 0xff) * (1 - t) + ((bh >> 8) & 0xff) * t);
        const bl = Math.round((ah & 0xff) * (1 - t) + (bh & 0xff) * t);
        return "#" + [r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("");
    }

    function truncate(s, n) {
        return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    window.DASH_CHARTS = { stacked100Bar, topicAggregateBar, hBar, divergingSentiment, heatGradient, track };
    void NEUTRAL;
})();

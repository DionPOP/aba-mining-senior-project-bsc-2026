function createReviewService({ queries, normalizers }) {
    const { normalizeTopic, normalizeSentiment } = normalizers;
    const {
        resolveTopicContext,
        fetchSingleHeadClaimByTopicSentiment,
        getExistingTables,
        fetchReviewRowsByClaim,
        fetchPropositionCountsByClaim,
        fetchContrariesByAssumptions,
        fetchHeadRowsForRatios,
        fetchClaimTotalByTopicTable,
    } = queries;

    async function getReviewData(query) {
        const topicRaw = query.topic || "staff";
        const uiSentiment = query.sentiment || "positive";

        const topic = normalizeTopic(topicRaw);
        const sentiment = normalizeSentiment(uiSentiment);

        if (!sentiment) {
            return { topic, sentiment: uiSentiment, head: null, rows: [] };
        }

        const topicContext = await resolveTopicContext(topic, true);
        if (!topicContext.supported || !topicContext.tablesExist) {
            return { topic, sentiment, head: null, rows: [] };
        }
        const { topicTable, contraryTable } = topicContext;

        const headKey = await fetchSingleHeadClaimByTopicSentiment(topic, sentiment);
        if (!headKey) {
            return { topic, sentiment, head: null, rows: [] };
        }

        const oppositeSentiment = sentiment === "Positive" ? "Negative" : "Positive";
        const oppositeHeadKey = await fetchSingleHeadClaimByTopicSentiment(topic, oppositeSentiment);

        const mainRows = await fetchReviewRowsByClaim(topicTable, headKey);

        if (!mainRows.length) {
            return { topic, sentiment, head: headKey, rows: [] };
        }

        const cntByProposition = new Map();
        if (oppositeHeadKey) {
            const oppositeCntRows = await fetchPropositionCountsByClaim(topicTable, oppositeHeadKey);

            for (const row of oppositeCntRows) {
                cntByProposition.set(row.proposition, Number(row.cnt || 0));
            }
        }

        const assumptions = [
            ...new Set(
                mainRows
                    .map((r) => r.assumption)
                    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
            ),
        ];

        let contraryRows = [];
        if (assumptions.length > 0) {
            contraryRows = await fetchContrariesByAssumptions(contraryTable, assumptions);
        }

        const contraryMap = new Map();
        for (const row of contraryRows) {
            const key = row.assumption;
            if (!contraryMap.has(key)) {
                contraryMap.set(key, []);
            }
            contraryMap.get(key).push({
                proposition: row.proposition,
                cnt: cntByProposition.get(row.proposition) ?? 0,
            });
        }

        for (const [key, list] of contraryMap.entries()) {
            list.sort((a, b) => {
                const diff = Number(b.cnt || 0) - Number(a.cnt || 0);
                if (diff !== 0) return diff;
                return String(a.proposition || "").localeCompare(String(b.proposition || ""));
            });
            contraryMap.set(key, list);
        }

        const rowsOut = mainRows.map((r) => ({
            proposition: r.proposition,
            cnt: r.cnt,
            contraries: contraryMap.get(r.assumption) || [],
        }));

        return {
            topic,
            sentiment,
            head: headKey,
            rows: rowsOut,
        };
    }

    async function getTopicRatios() {
        const headRows = await fetchHeadRowsForRatios();
        const existingTables = await getExistingTables(Object.values(normalizers.TOPIC_TABLES));

        const map = {};

        for (const row of headRows) {
            const topic = row.topic;
            const claim = row.claim;
            const sentiment = row.Sentiment;

            const topicTable = queries.getTopicTable(topic);
            if (!topicTable) continue;

            let total = 0;
            if (existingTables.has(topicTable)) {
                total = await fetchClaimTotalByTopicTable(topicTable, claim);
            }

            if (!map[topic]) {
                map[topic] = {
                    posTotal: 0,
                    negTotal: 0,
                    posPct: 0,
                    negPct: 0,
                };
            }

            if (sentiment === "Positive") {
                map[topic].posTotal += total;
            } else if (sentiment === "Negative") {
                map[topic].negTotal += total;
            }
        }

        for (const topic of Object.keys(map)) {
            const pos = map[topic].posTotal;
            const neg = map[topic].negTotal;
            const sum = pos + neg;

            if (sum > 0) {
                map[topic].posPct = Math.round((pos / sum) * 100);
                map[topic].negPct = 100 - map[topic].posPct;
            }
        }

        return map;
    }

    return {
        getReviewData,
        getTopicRatios,
    };
}

module.exports = {
    createReviewService,
};

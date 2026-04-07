const { TOPIC_TABLES } = require("../utils/normalizers");

function createQueryLayer({ pool, dbName }) {
    function getTopicTable(topic) {
        return TOPIC_TABLES[topic] || null;
    }

    function getContraryTable(topic) {
        const base = getTopicTable(topic);
        return base ? `contrary_${base}` : null;
    }

    async function getExistingTables(tableNames) {
        const uniqueNames = [...new Set((tableNames || []).filter(Boolean))];
        if (!uniqueNames.length) return new Set();
        const [rows] = await pool.query(
            `
            SELECT TABLE_NAME
            FROM information_schema.tables
            WHERE table_schema = ?
              AND TABLE_NAME IN (?)
            `,
            [dbName, uniqueNames]
        );
        return new Set((rows || []).map((r) => String(r.TABLE_NAME || "")));
    }

    async function resolveTopicContext(topic, requireContrary = true) {
        const topicTable = getTopicTable(topic);
        const contraryTable = getContraryTable(topic);
        if (!topicTable || (requireContrary && !contraryTable)) {
            return {
                supported: false,
                tablesExist: false,
                topicTable,
                contraryTable,
            };
        }
        const needed = requireContrary ? [topicTable, contraryTable] : [topicTable];
        const existing = await getExistingTables(needed);
        const hasTopic = existing.has(topicTable);
        const hasContrary = requireContrary ? existing.has(contraryTable) : true;
        return {
            supported: true,
            tablesExist: hasTopic && hasContrary,
            topicTable,
            contraryTable,
        };
    }

    async function fetchHeadClaimsByTopic(topic, sentimentOrAll = "All", limit = null) {
        const params = [topic];
        let where = "LOWER(Topic) = ?";
        if (sentimentOrAll !== "All") {
            where += " AND Sentiment = ?";
            params.push(sentimentOrAll);
        }
        const limitSql = limit != null ? "LIMIT ?" : "";
        if (limit != null) params.push(limit);
        const [rows] = await pool.query(`SELECT * FROM head WHERE ${where} ${limitSql}`, params);
        return rows || [];
    }

    async function fetchSingleHeadClaimByTopicSentiment(topic, sentiment) {
        const [rows] = await pool.query(
            `
            SELECT claim
            FROM head
            WHERE LOWER(Topic) = ?
              AND Sentiment = ?
            LIMIT 1
            `,
            [topic, sentiment]
        );
        return rows[0]?.claim || null;
    }

    async function fetchTopAssumptionsByClaim(topicTable, claim, limit = null) {
        const params = [claim];
        const limitSql = limit != null ? "LIMIT ?" : "";
        if (limit != null) params.push(limit);
        const [rows] = await pool.query(
            `SELECT assumption, MAX(cnt) AS cnt
             FROM \`${topicTable}\`
             WHERE claim = ?
             GROUP BY assumption
             ORDER BY cnt DESC, assumption ASC
             ${limitSql}`,
            params
        );
        return rows || [];
    }

    async function fetchTopPropositionsByClaim(topicTable, claim, limit = null) {
        const params = [claim];
        const limitSql = limit != null ? "LIMIT ?" : "";
        if (limit != null) params.push(limit);
        const [rows] = await pool.query(
            `SELECT proposition, MAX(cnt) AS cnt
             FROM \`${topicTable}\`
             WHERE claim = ?
             GROUP BY proposition
             ORDER BY cnt DESC, proposition ASC
             ${limitSql}`,
            params
        );
        return rows || [];
    }

    async function fetchAssumptionsAttackingPropositions(topicTable, contraryTable, claim, propositionList, limit) {
        const [rows] = await pool.query(
            `SELECT a.assumption, MAX(a.cnt) AS cnt
             FROM \`${topicTable}\` a
             JOIN \`${contraryTable}\` c ON c.assumption = a.assumption AND c.isContrary = 1
             WHERE a.claim = ?
               AND c.proposition IN (?)
             GROUP BY a.assumption
             ORDER BY cnt DESC, a.assumption ASC
             LIMIT ?`,
            [claim, propositionList, limit]
        );
        return rows || [];
    }

    async function fetchReviewRowsByClaim(topicTable, claim) {
        const [rows] = await pool.query(
            `
            SELECT proposition, assumption, cnt
            FROM \`${topicTable}\`
            WHERE claim = ?
            ORDER BY cnt DESC, proposition ASC
            `,
            [claim]
        );
        return rows || [];
    }

    async function fetchPropositionCountsByClaim(topicTable, claim) {
        const [rows] = await pool.query(
            `
            SELECT proposition, cnt
            FROM \`${topicTable}\`
            WHERE claim = ?
            ORDER BY proposition
            `,
            [claim]
        );
        return rows || [];
    }

    async function fetchContrariesByAssumptions(contraryTable, assumptions) {
        if (!assumptions || !assumptions.length) return [];
        const [rows] = await pool.query(
            `
            SELECT assumption, proposition
            FROM \`${contraryTable}\`
            WHERE assumption IN (?)
              AND isContrary = 1
            ORDER BY assumption, proposition
            `,
            [assumptions]
        );
        return rows || [];
    }

    async function fetchHeadRowsForRatios() {
        const [rows] = await pool.query(`
            SELECT
                claim,
                LOWER(Topic) AS topic,
                Sentiment
            FROM head
        `);
        return rows || [];
    }

    async function fetchClaimTotalByTopicTable(topicTable, claim) {
        const [rows] = await pool.query(
            `
            SELECT COALESCE(SUM(cnt), 0) AS total
            FROM \`${topicTable}\`
            WHERE claim = ?
            `,
            [claim]
        );
        return Number(rows[0]?.total || 0);
    }

    function addClaimScores(rows, claimScores, claimToSkip, allowedClaimsSet) {
        for (const r of rows || []) {
            if (!r.claim || r.claim === claimToSkip || !allowedClaimsSet.has(r.claim)) continue;
            const score = 1 + Number(r.cnt || 0) / 1000;
            claimScores.set(r.claim, (claimScores.get(r.claim) || 0) + score);
        }
    }

    return {
        getTopicTable,
        getContraryTable,
        getExistingTables,
        resolveTopicContext,
        fetchHeadClaimsByTopic,
        fetchSingleHeadClaimByTopicSentiment,
        fetchTopAssumptionsByClaim,
        fetchTopPropositionsByClaim,
        fetchAssumptionsAttackingPropositions,
        fetchReviewRowsByClaim,
        fetchPropositionCountsByClaim,
        fetchContrariesByAssumptions,
        fetchHeadRowsForRatios,
        fetchClaimTotalByTopicTable,
        addClaimScores,
    };
}

module.exports = {
    createQueryLayer,
};

const TOPIC_TABLES = {
    "check-in": "check_in",
    check_in: "check_in",
    "check-out": "check_out",
    check_out: "check_out",
    staff: "staff",
    price: "price",
};

function normalizeTopic(raw) {
    return String(raw || "").trim().toLowerCase();
}

function normalizeSentiment(uiValue) {
    const value = String(uiValue || "").toLowerCase();
    if (value === "negative") return "Negative";
    if (value === "positive") return "Positive";
    return null;
}

function normalizeSentimentOrAll(uiValue) {
    const value = String(uiValue || "").trim().toLowerCase();
    if (value === "all") return "All";
    if (value === "negative") return "Negative";
    if (value === "positive") return "Positive";
    return null;
}

function getHeadClaim(row) {
    if (!row || typeof row !== "object") return null;
    return row.claim || row.Head || row.head || null;
}

function classifyAtomType(raw, fallbackType) {
    const atom = String(raw || "");
    const lower = atom.toLowerCase();
    if (lower.startsWith("no_evident_")) return "assumption";
    if (lower.startsWith("have_evident_")) return "proposition";
    return fallbackType;
}

module.exports = {
    TOPIC_TABLES,
    normalizeTopic,
    normalizeSentiment,
    normalizeSentimentOrAll,
    getHeadClaim,
    classifyAtomType,
};

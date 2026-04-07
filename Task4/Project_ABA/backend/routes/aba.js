const express = require("express");

function createAbaRouter({ abaGraphService }) {
    const router = express.Router();

    router.get("/api/aba-graph", async (req, res) => {
        try {
            const payload = await abaGraphService.getAbaGraph(req.query || {});
            return res.json(payload);
        } catch (err) {
            console.error("[/api/aba-graph] error:", err);
            const status = Number(err.status) || 500;
            if (err.payload && typeof err.payload === "object") {
                return res.status(status).json(err.payload);
            }
            return res.status(status).json({ error: String(err.message || err) });
        }
    });

    router.post("/api/pyarg/evaluate", async (req, res) => {
        try {
            const body = req.body || {};
            const result = await abaGraphService.runPreferred(body);
            if (result && result.error) {
                return res.status(400).json(result);
            }
            return res.json(result);
        } catch (err) {
            console.error("[/api/pyarg/evaluate] error:", err);
            return res.status(500).json({
                error: String(err),
                hint: "Ensure Python and py_arg are installed, or set PYTHON_EXECUTABLE.",
            });
        }
    });

    router.post("/api/llm/translate-extension", async (req, res) => {
        try {
            const body = req.body || {};
            const result = await abaGraphService.translateExtensionsToNaturalLanguage(body);
            return res.json(result);
        } catch (err) {
            console.error("[/api/llm/translate-extension] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
                hint: "Configure OPENAI_API_KEY or GEMINI_API_KEY in backend env.",
            });
        }
    });

    return router;
}

module.exports = {
    createAbaRouter,
};

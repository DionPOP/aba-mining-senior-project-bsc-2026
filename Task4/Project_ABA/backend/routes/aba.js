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
            const result = await abaGraphService.evaluatePyArg(body);
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

    router.post("/api/pyarg/evaluate/jobs", async (req, res) => {
        try {
            const body = req.body || {};
            const job = await abaGraphService.createPyArgEvaluationJob(body);
            return res.status(202).json(job);
        } catch (err) {
            console.error("[/api/pyarg/evaluate/jobs] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
                hint: "Ensure Python and py_arg are installed, or set PYTHON_EXECUTABLE.",
            });
        }
    });

    router.get("/api/pyarg/evaluate/jobs/:jobId", async (req, res) => {
        try {
            res.set("Cache-Control", "no-store, max-age=0");
            res.set("Pragma", "no-cache");
            const jobId = String(req.params?.jobId || "").trim();
            const job = await abaGraphService.getPyArgEvaluationJob(jobId);
            if (!job) {
                return res.status(404).json({
                    error: "PyArg job not found or expired",
                });
            }
            return res.json(job);
        } catch (err) {
            console.error("[/api/pyarg/evaluate/jobs/:jobId] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
            });
        }
    });

    router.post("/api/llm/translate-extension", async (req, res) => {
        try {
            const body = req.body || {};
            const result = await abaGraphService.generateLlmExplanation(body);
            return res.json(result);
        } catch (err) {
            console.error("[/api/llm/translate-extension] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
                hint: "Ensure Ollama is running and set OLLAMA_BASE_URL if needed.",
            });
        }
    });

    router.post("/api/llm/translate-extension/jobs", async (req, res) => {
        try {
            const body = req.body || {};
            const job = await abaGraphService.createLlmExplanationJob(body);
            return res.status(202).json(job);
        } catch (err) {
            console.error("[/api/llm/translate-extension/jobs] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
                hint: "Ensure Ollama is running and set OLLAMA_BASE_URL if needed.",
            });
        }
    });

    router.get("/api/llm/translate-extension/jobs/:jobId", async (req, res) => {
        try {
            res.set("Cache-Control", "no-store, max-age=0");
            res.set("Pragma", "no-cache");
            const jobId = String(req.params?.jobId || "").trim();
            const job = await abaGraphService.getLlmExplanationJob(jobId);
            if (!job) {
                return res.status(404).json({
                    error: "LLM job not found or expired",
                });
            }
            return res.json(job);
        } catch (err) {
            console.error("[/api/llm/translate-extension/jobs/:jobId] error:", err);
            return res.status(500).json({
                error: String(err.message || err),
            });
        }
    });

    return router;
}

module.exports = {
    createAbaRouter,
};

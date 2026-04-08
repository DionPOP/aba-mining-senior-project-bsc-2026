const express = require("express");

function createReviewRouter({ reviewService }) {
    const router = express.Router();

    router.get("/api/review-data", async (req, res) => {
        try {
            const payload = await reviewService.getReviewData(req.query || {});
            return res.json(payload);
        } catch (err) {
            console.error("[/api/review-data] error:", err);
            return res.status(500).json({ error: String(err) });
        }
    });

    router.get("/api/topic-ratios", async (req, res) => {
        try {
            const payload = await reviewService.getTopicRatios();
            return res.json(payload);
        } catch (err) {
            console.error("[/api/topic-ratios] error:", err);
            return res.status(500).json({ error: String(err) });
        }
    });

    return router;
}

module.exports = {
    createReviewRouter,
};

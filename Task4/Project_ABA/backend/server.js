console.log("[A] server.js started");

const fs = require("fs");
const path = require("path");

function loadEnvFile() {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = String(line || "").trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] == null || process.env[key] === "") {
            process.env[key] = value;
        }
    }
}

loadEnvFile();

process.on("uncaughtException", (err) => {
    console.error("[FATAL] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
    console.error("[FATAL] unhandledRejection:", err);
});

console.log("[B] loading modules...");
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const normalizers = require("./utils/normalizers");
const { createQueryLayer } = require("./db/queries");
const { createReviewService } = require("./services/reviewService");
const { createAbaGraphService } = require("./services/abaGraphService");
const { createReviewRouter } = require("./routes/review");
const { createAbaRouter } = require("./routes/aba");

const schemaCompatReady = Promise.resolve();

console.log("[C] creating app...");
const app = express();
app.use(cors());
app.use(express.json());
app.use(async (req, res, next) => {
    await schemaCompatReady;
    next();
});

console.log("[D] creating mysql pool...");
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "aba";
const DB_PASSWORD = process.env.DB_PASSWORD || "aba12345";
const DB_NAME = process.env.DB_NAME || "ABA";

const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

const queries = createQueryLayer({ pool, dbName: DB_NAME });
const reviewService = createReviewService({ queries, normalizers });
const abaGraphService = createAbaGraphService({ pool, queries, normalizers });

app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS ok");
        res.json({ ok: true, db: rows && rows[0] && rows[0].ok === 1 });
    } catch (err) {
        console.error("[/api/health] DB error:", err);
        res.status(500).json({ ok: false, db: false, error: String(err) });
    }
});

app.use(createReviewRouter({ reviewService }));
app.use(createAbaRouter({ abaGraphService }));

const PORT = Number(process.env.PORT || 3000);
console.log("[E] about to listen on port", PORT);

app.listen(PORT, () => {
    console.log("[F] API running at http://localhost:" + PORT);

    pool.query("SELECT DATABASE() AS db")
        .then(([rows]) => console.log("[G] DB connected to:", rows && rows[0] && rows[0].db))
        .catch((err) => console.error("[G] DB connect failed:", err));
});

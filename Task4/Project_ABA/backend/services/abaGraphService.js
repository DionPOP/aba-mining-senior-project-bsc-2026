const { spawn } = require("child_process");
const path = require("path");

function createHttpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function runPyArgPreferred(payload) {
    return new Promise((resolve, reject) => {
        const defaultPythonCmd = process.platform === "win32" ? "python" : "python3";
        const pythonCmd = process.env.PYTHON_EXECUTABLE || defaultPythonCmd;
        const scriptPath = path.join(__dirname, "..", "scripts", "pyarg_runner.py");
        const child = spawn(pythonCmd, [scriptPath], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (err) => {
            reject(new Error(`Failed to run Python: ${err.message}`));
        });
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error((stderr || stdout || `Python exited with code ${code}`).trim()));
                return;
            }
            try {
                resolve(JSON.parse(stdout || "{}"));
            } catch (err) {
                reject(new Error(`Invalid JSON from Python: ${String(err)}`));
            }
        });

        child.stdin.write(JSON.stringify(payload || {}));
        child.stdin.end();
    });
}

function buildTranslatePrompt(body) {
    const payload = body && typeof body === "object" ? body : {};
    const task = String(payload?.task || "translate_extension").trim().toLowerCase();
    const semantics = String(payload?.semantics || "Preferred");
    const strategy = String(payload?.strategy || "Credulous");
    const topic = String(payload?.topic || "");
    const sentiment = String(payload?.sentiment || "");
    const supporting = String(payload?.supporting || "");
    const rawOutputLanguage = String(payload?.outputLanguage || "English").trim();
    const targetLanguage = /^en\b/i.test(rawOutputLanguage) ? "English" : rawOutputLanguage;
    if (task === "graph_summary") {
        const graphNodes = Array.isArray(payload?.graphNodes) ? payload.graphNodes : [];
        const compactNodes = graphNodes.slice(0, 60).map((n) => ({
            type: n?.type || "",
            label: n?.label || "",
            count: Number.isFinite(Number(n?.count)) ? Number(n.count) : null,
        }));
        const systemPrompt =
            "You are a customer-facing assistant. Summarize Argument-Based Analysis results in plain language. Focus on the main supporting reasons, the main challenges, the defenses against those challenges, and the final customer-friendly verdict. Do not output technical analysis or generic review-style summaries.";
        const userPrompt = [
            "Summarize the final outcome for the selected topic in easy, customer-friendly language.",
            `Language: ${targetLanguage}`,
            `Semantics: ${semantics}`,
            `Evaluation Strategy: ${strategy}`,
            topic ? `Topic: ${topic}` : "",
            sentiment ? `Sentiment: ${sentiment}` : "",
            supporting ? `Supporting: ${supporting}` : "",
            `Graph nodes sample (JSON): ${JSON.stringify(compactNodes)}`,
            "Important context:",
            "- This is an Argument-Based Analysis, not a generic review summary.",
            "- The data represents structured reasoning about a topic, including strengths, challenges, and defenses.",
            "- Summarize based on which reasons are better supported overall.",
            "- If the evidence is conflicting, reflect that clearly instead of forcing a one-sided conclusion.",
            "Evidence weighting:",
            "- Badge numbers represent evidence weight.",
            "- A higher badge number means that point is supported by more evidence.",
            "- Prioritize claims and reasons with higher badge values in the summary.",
            "- Do not treat all points as equally important.",
            "- Still mention important challenges or defenses even if their badge is smaller, if they materially affect the final verdict.",
            "Output requirements:",
            "- Write exactly 4 bullet points in this order:",
            "  1) Main strengths (what most strongly supports the claim).",
            "  2) Main attacks (what most strongly challenges the claim).",
            "  3) Main counter-attacks/defenses (what weakens those challenges).",
            "  4) Final overall verdict (good / mixed / poor) with one short reason.",
            "- Keep each bullet short and practical.",
            "- Focus on the most important points first.",
            "- Do not include counts, node/edge balance, or semantics explanation.",
            "- Do not use graph jargon such as node, edge, extension, or assumption.",
            "- Do not summarize it like a normal product or hotel review.",
            "- No markdown heading.",
        ]
            .filter(Boolean)
            .join("\n");
        return { systemPrompt, userPrompt };
    }

    const extensions = Array.isArray(payload?.extensions) ? payload.extensions : [];
    const acceptedAssumptions = Array.isArray(payload?.acceptedAssumptions) ? payload.acceptedAssumptions : [];
    const currentExtensionText = String(payload?.currentExtensionText || "").trim();
    const systemPrompt =
        "You are an assistant that rewrites technical ABA extension output into plain language for non-technical readers. Be concise and faithful to input.";
    const userPrompt = [
        "Translate only the provided current extension to natural language. Do not summarize the full graph.",
        `Language: ${targetLanguage}`,
        currentExtensionText ? `Current extension (text): ${currentExtensionText}` : "",
        `Extensions (JSON): ${JSON.stringify(extensions)}`,
        `Accepted assumptions (JSON): ${JSON.stringify(acceptedAssumptions)}`,
        "Output requirements:",
        "- 2-4 short bullet points.",
        "- Focus only on the provided current extension text.",
        "- Do not summarize the whole graph.",
        "- Explain in everyday language.",
        "- Keep key domain words if needed, but avoid code-like naming unless necessary.",
        "- No markdown heading.",
    ]
        .filter(Boolean)
        .join("\n");

    return { systemPrompt, userPrompt };
}

async function translateWithOpenAI({ apiKey, model, systemPrompt, userPrompt }) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        const message = data?.error?.message || `OpenAI request failed: ${resp.status}`;
        throw new Error(message);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response has no content");
    return String(text).trim();
}

async function translateWithGemini({ apiKey, model, systemPrompt, userPrompt }) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: userPrompt }],
                },
            ],
            generationConfig: {
                temperature: 0.2,
            },
        }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        const message = data?.error?.message || `Gemini request failed: ${resp.status}`;
        throw new Error(message);
    }
    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map((p) => String(p?.text || ""))
            .join("\n")
            .trim() || "";
    if (!text) throw new Error("Gemini response has no content");
    return text;
}

async function translateWithOllama({ baseUrl, model, systemPrompt, userPrompt }) {
    const endpoint = `${String(baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/chat`;
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            stream: false,
            options: { temperature: 0.2 },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        const message = data?.error || `Ollama request failed: ${resp.status}`;
        throw new Error(message);
    }
    const text = String(data?.message?.content || "").trim();
    if (!text) throw new Error("Ollama response has no content");
    return text;
}

function buildPyArgPayloadFromGraph(nodes, edges, query) {
    const idToNode = new Map((nodes || []).map((n) => [n.id, n]));
    const language = new Set();
    const assumptions = new Set();
    const rules = [];
    const contraries = {};
    const warnings = [];
    const seenRule = new Set();

    for (const n of nodes || []) {
        const label = String(n.label || "").trim();
        if (!label) continue;
        language.add(label);
        if (n.type === "assumption") assumptions.add(label);
    }

    for (const e of edges || []) {
        if (e.type !== "support") continue;
        const src = idToNode.get(e.source);
        const tgt = idToNode.get(e.target);
        if (!src || !tgt) continue;
        const premise = String(src.label || "").trim();
        const conclusion = String(tgt.label || "").trim();
        if (!premise || !conclusion || premise === conclusion) continue;
        const key = `${premise}=>${conclusion}`;
        if (seenRule.has(key)) continue;
        seenRule.add(key);
        rules.push({
            name: `Rule${rules.length + 1}`,
            premises: [premise],
            conclusion,
        });
        language.add(premise);
        language.add(conclusion);
    }

    for (const e of edges || []) {
        if (e.type !== "attack") continue;
        const src = idToNode.get(e.source);
        const tgt = idToNode.get(e.target);
        if (!src || !tgt || tgt.type !== "assumption") continue;
        const attacker = String(src.label || "").trim();
        const targetAssumption = String(tgt.label || "").trim();
        if (!attacker || !targetAssumption) continue;
        language.add(attacker);
        if (!contraries[targetAssumption]) {
            contraries[targetAssumption] = attacker;
        } else if (contraries[targetAssumption] !== attacker) {
            warnings.push(
                `assumption '${targetAssumption}' has multiple attackers (${contraries[targetAssumption]}, ${attacker}); using first only`
            );
        }
    }

    for (const a of assumptions) {
        if (!contraries[a]) {
            const synthetic = `not_${a}`;
            contraries[a] = synthetic;
            language.add(synthetic);
            warnings.push(`assumption '${a}' had no attacker; added synthetic contrary '${synthetic}'`);
        }
    }

    return {
        payload: {
            language: [...language],
            assumptions: [...assumptions],
            contraries,
            rules,
            query: query || null,
        },
        warnings,
    };
}

async function resolveSupportingContext({ pool, topicTable, supporting, allowedClaims }) {
    const [assumptionMatch] = await pool.query(`SELECT claim, cnt FROM \`${topicTable}\` WHERE assumption = ?`, [
        supporting,
    ]);
    const [propositionMatch] = await pool.query(`SELECT claim, cnt FROM \`${topicTable}\` WHERE proposition = ?`, [
        supporting,
    ]);

    const propositionInScope = (propositionMatch || []).find((r) => allowedClaims.has(r.claim));
    const assumptionInScope = (assumptionMatch || []).find((r) => allowedClaims.has(r.claim));

    if (propositionInScope) {
        return {
            supportOrigin: "proposition",
            claimA: propositionInScope.claim,
            supportCount: Number(propositionInScope.cnt) || null,
        };
    }
    if (assumptionInScope) {
        return {
            supportOrigin: "assumption",
            claimA: assumptionInScope.claim,
            supportCount: Number(assumptionInScope.cnt) || null,
        };
    }
    if (propositionMatch.length) {
        return {
            supportOrigin: "proposition",
            claimA: propositionMatch[0].claim,
            supportCount: Number(propositionMatch[0].cnt) || null,
        };
    }
    if (assumptionMatch.length) {
        return {
            supportOrigin: "assumption",
            claimA: assumptionMatch[0].claim,
            supportCount: Number(assumptionMatch[0].cnt) || null,
        };
    }

    return null;
}

function selectTopClaimByScore(claimScores) {
    let claim = null;
    let topScore = -1;
    for (const [candidate, score] of claimScores.entries()) {
        if (score > topScore) {
            topScore = score;
            claim = candidate;
        }
    }
    return claim;
}


function createAbaGraphService({ pool, queries, normalizers }) {
    const { normalizeTopic, normalizeSentimentOrAll, getHeadClaim } = normalizers;
    const {
        resolveTopicContext,
        fetchHeadClaimsByTopic,
        fetchTopAssumptionsByClaim,
        fetchTopPropositionsByClaim,
        fetchAssumptionsAttackingPropositions,
        addClaimScores,
    } = queries;

async function getAbaGraph(query) {
    try {
        const topicRaw = String(query.topic || "").trim();
        const supporting = String(query.supporting || "").trim();
        const sentimentRaw = query.sentiment || "All";
        const sentiment = normalizeSentimentOrAll(sentimentRaw);
        const topic = normalizeTopic(topicRaw);
        const kRaw = Number(query.k);
        const K = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(Math.floor(kRaw), 50) : 8;
        const attackModeRaw = String(query.attack_mode || "all").trim().toLowerCase();
        const attackMode = attackModeRaw === "cross" ? "cross" : "all";
        const attackDepthRaw = Number(query.attack_depth);
        const attackDepth = attackDepthRaw === 2 ? 2 : 1;
        const focusOnlyRaw = String(query.focus_only || "1").trim().toLowerCase();
        const focusOnly = focusOnlyRaw === "1" || focusOnlyRaw === "true" || focusOnlyRaw === "yes";
        const showAllContraryRaw = String(query.show_all_contrary || "0").trim().toLowerCase();
        const showAllContrary = showAllContraryRaw === "1" || showAllContraryRaw === "true" || showAllContraryRaw === "yes";

        if (!topic || !supporting) throw createHttpError(400, "topic and supporting are required");
        if (!sentiment) throw createHttpError(400, "sentiment must be Positive, Negative, or All");
        const topicContext = await resolveTopicContext(topic, true);
        if (!topicContext.supported) {
            throw createHttpError(400, `Unsupported topic: ${topic}`);
        }
        if (!topicContext.tablesExist) {
            throw createHttpError(404, `Missing topic tables for ${topic}`);
        }
        const { topicTable, contraryTable } = topicContext;

        const headRows = await fetchHeadClaimsByTopic(topic, sentiment);
        const allowedClaims = new Set(
            (headRows || [])
                .map((r) => getHeadClaim(r))
                .filter(Boolean)
        );
        if (!allowedClaims.size) throw createHttpError(404, "No claims found for this topic/sentiment");

        const supportingContext = await resolveSupportingContext({
            pool,
            topicTable,
            supporting,
            allowedClaims,
        });
        if (!supportingContext) {
            throw createHttpError(404, "Supporting atom not found in assumption/proposition");
        }
        const { supportOrigin, claimA, supportCount } = supportingContext;
        if (!allowedClaims.has(claimA)) {
            throw createHttpError(404, "Supporting does not belong to selected topic/sentiment claim set");
        }

        const [claimAPropsAll] = await pool.query(
            `SELECT t.proposition, MAX(t.cnt) AS cnt
             FROM \`${topicTable}\` t
             WHERE t.claim = ?
               AND EXISTS (
                   SELECT 1
                   FROM \`${contraryTable}\` c
                   WHERE c.isContrary = 1
                     AND c.proposition = t.proposition
                )
             GROUP BY t.proposition
             ORDER BY cnt DESC, t.proposition ASC`,
            [claimA]
        );
        const claimAAssumptionsAll = await fetchTopAssumptionsByClaim(topicTable, claimA);
        const [claimAAttackPairs] = await pool.query(
            `SELECT DISTINCT c.proposition, c.assumption
             FROM \`${contraryTable}\` c
             JOIN \`${topicTable}\` p ON p.proposition = c.proposition
             JOIN \`${topicTable}\` a ON a.assumption = c.assumption
             WHERE c.isContrary = 1
               AND p.claim = ?
               AND a.claim = ?`,
            [claimA, claimA]
        );

        const nodeMap = new Map();
        const edgeMap = new Map();
        const clusters = [];
        const clusterClaimById = new Map();
        function addNode(id, label, type, clusterId, isFocus = false, count = null) {
            if (!id) return;
            const prev = nodeMap.get(id);
            if (prev) {
                prev.isFocus = Boolean(prev.isFocus || isFocus);
                if (count != null) {
                    const current = Number(prev.count) || 0;
                    prev.count = Math.max(current, Number(count) || 0) || null;
                }
                return;
            }
            nodeMap.set(id, {
                id,
                label,
                type,
                clusterId: clusterId || null,
                isFocus: Boolean(isFocus),
                count: count != null ? (Number(count) || null) : null,
            });
        }
        function addEdge(source, target, type) {
            if (!source || !target) return;
            const key = `${type}::${source}::${target}`;
            if (edgeMap.has(key)) return;
            edgeMap.set(key, { id: `e_${edgeMap.size + 1}`, source, target, type });
        }
        function parseNodeId(nodeId) {
            const i = nodeId.indexOf("::A::");
            if (i >= 0) return { clusterId: nodeId.slice(0, i), role: "A", raw: nodeId.slice(i + 5) };
            const j = nodeId.indexOf("::P::");
            if (j >= 0) return { clusterId: nodeId.slice(0, j), role: "P", raw: nodeId.slice(j + 5) };
            const k = nodeId.indexOf("::C::");
            if (k >= 0) return { clusterId: nodeId.slice(0, k), role: "C", raw: nodeId.slice(k + 5) };
            const m = nodeId.indexOf("::R::");
            if (m >= 0) return { clusterId: nodeId.slice(0, m), role: "R", raw: nodeId.slice(m + 5) };
            return null;
        }
        // claimA cluster
        const clusterAId = `arg::${topic}::${supporting}::${claimA}`;
        clusters.push({ id: clusterAId, label: clusterAId });
        clusterClaimById.set(clusterAId, claimA);
        const claimANodeId = `${clusterAId}::C::${claimA}`;
        addNode(claimANodeId, claimA, "claim", clusterAId, false);

        if (supportOrigin === "proposition") {
            const focusP = `${clusterAId}::P::${supporting}`;
            addNode(focusP, supporting, "proposition", clusterAId, true, supportCount);
            addEdge(focusP, claimANodeId, "support");
        } else {
            const focusA = `${clusterAId}::A::${supporting}`;
            addNode(focusA, supporting, "assumption", clusterAId, true, supportCount);
            addEdge(focusA, claimANodeId, "support");
        }

        let assumpRows = [];
        let preferredAssumptionRow = null;
        if (supportOrigin === "proposition") {
            const claimLower = String(claimA || "").toLowerCase();
            const expectedPrefix = claimLower.startsWith("good_")
                ? "no_evident_not_"
                : (claimLower.startsWith("bad_") ? "have_evident_" : null);
            if (expectedPrefix) {
                const expectedAssumption = `${expectedPrefix}${supporting}`;
                const [prefRows] = await pool.query(
                    `SELECT assumption, cnt
                     FROM \`${topicTable}\`
                     WHERE claim = ?
                       AND assumption = ?
                     LIMIT 1`,
                    [claimA, expectedAssumption]
                );
                preferredAssumptionRow = prefRows[0] || null;
            }
        }

        if (focusOnly && supportOrigin === "assumption") {
            const [focusAssumptionRows] = await pool.query(
                `SELECT assumption, cnt
                 FROM \`${topicTable}\`
                 WHERE claim = ?
                   AND assumption = ?
                 LIMIT 1`,
                [claimA, supporting]
            );
            if (focusAssumptionRows.length) {
                assumpRows = focusAssumptionRows;
            } else {
                assumpRows = [{ assumption: supporting, cnt: supportCount ?? null }];
            }
        } else if (focusOnly && supportOrigin === "proposition") {
            if (preferredAssumptionRow) {
                assumpRows = [preferredAssumptionRow];
            } else {
                [assumpRows] = await pool.query(
                    `SELECT
                        a.assumption,
                        MAX(a.cnt) AS cnt,
                        SUM(CASE WHEN p2.claim IS NOT NULL AND p2.claim <> ? THEN 1 ELSE 0 END) AS cross_claim_hits
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                     LEFT JOIN \`${contraryTable}\` c2 ON c2.assumption = a.assumption AND c2.isContrary = 1
                     LEFT JOIN \`${topicTable}\` p2 ON p2.proposition = c2.proposition
                     WHERE c.isContrary = 1
                       AND c.proposition = ?
                       AND a.claim = ?
                     GROUP BY a.assumption
                     ORDER BY cross_claim_hits DESC, cnt DESC, a.assumption ASC
                     LIMIT 1`,
                    [claimA, supporting, claimA]
                );
                if (!assumpRows.length) {
                    [assumpRows] = await pool.query(
                        `SELECT
                            a.assumption,
                            MAX(a.cnt) AS cnt,
                            CASE
                                WHEN a.assumption LIKE CONCAT('%', ?, '%') THEN 1
                                ELSE 0
                            END AS match_supporting,
                            SUM(CASE WHEN p.claim IS NOT NULL AND p.claim <> ? THEN 1 ELSE 0 END) AS cross_claim_hits
                         FROM \`${topicTable}\` a
                         LEFT JOIN \`${contraryTable}\` c ON c.assumption = a.assumption AND c.isContrary = 1
                         LEFT JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                         WHERE a.claim = ?
                         GROUP BY a.assumption
                         ORDER BY match_supporting DESC, cross_claim_hits DESC, cnt DESC, a.assumption ASC
                         LIMIT 1`,
                        [supporting, claimA, claimA]
                    );
                }
            }
        } else {
            assumpRows = await fetchTopAssumptionsByClaim(topicTable, claimA, K);
        }
        for (const r of assumpRows) {
            if (supportOrigin === "assumption" && r.assumption === supporting) continue;
            const aid = `${clusterAId}::A::${r.assumption}`;
            addNode(aid, r.assumption, "assumption", clusterAId, false, r.cnt);
            addEdge(aid, claimANodeId, "support");
        }
        const focalAssumptionRaw =
            focusOnly && supportOrigin === "proposition" && assumpRows.length
                ? assumpRows[0].assumption
                : null;

        // choose claimB by contrary around supporting
        const claimScores = new Map();
        if (supportOrigin === "proposition") {
            if (focalAssumptionRaw) {
                const [rows] = await pool.query(
                    `SELECT p.claim AS claim, p.cnt AS cnt
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND c.assumption = ?`,
                    [focalAssumptionRaw]
                );
                addClaimScores(rows, claimScores, claimA, allowedClaims);
            } else {
                const [rows] = await pool.query(
                    `SELECT a.claim AS claim, a.cnt AS cnt
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                     WHERE c.isContrary = 1
                       AND c.proposition = ?`,
                    [supporting]
                );
                addClaimScores(rows, claimScores, claimA, allowedClaims);
            }
        } else {
            const [rows] = await pool.query(
                `SELECT p.claim AS claim, p.cnt AS cnt
                 FROM \`${contraryTable}\` c
                 JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                 WHERE c.isContrary = 1
                   AND c.assumption = ?`,
                [supporting]
            );
            addClaimScores(rows, claimScores, claimA, allowedClaims);
        }
        let claimB = selectTopClaimByScore(claimScores);
        if (!claimB) {
            const [fallback] = await pool.query(
                `SELECT * FROM head WHERE LOWER(Topic)=? LIMIT 50`,
                [topic]
            );
            for (const row of fallback) {
                const c = getHeadClaim(row);
                if (c && c !== claimA) {
                    claimB = c;
                    break;
                }
            }
        }

        let contraryCandidatesCount = 0;
        let assumpRowsB = [];
        let claimC = null;
        let claimALevel5Pairs = [];
        if (claimB) {
            const clusterBId = `arg::${topic}::${supporting}::${claimB}`;
            clusters.push({ id: clusterBId, label: clusterBId });
            clusterClaimById.set(clusterBId, claimB);
            const claimBNodeId = `${clusterBId}::C::${claimB}`;
            addNode(claimBNodeId, claimB, "claim", clusterBId, false);

            let propsB = [];
            if (supportOrigin === "proposition" && focalAssumptionRaw) {
                const [countRows] = await pool.query(
                    `SELECT COUNT(DISTINCT p.proposition) AS total
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND c.assumption = ?
                       AND p.claim = ?`,
                    [focalAssumptionRaw, claimB]
                );
                contraryCandidatesCount = Number((countRows[0] && countRows[0].total) || 0);
                if (showAllContrary) {
                    const [rows] = await pool.query(
                        `SELECT p.proposition, MAX(p.cnt) AS cnt
                         FROM \`${contraryTable}\` c
                         JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                         WHERE c.isContrary = 1
                           AND c.assumption = ?
                           AND p.claim = ?
                         GROUP BY p.proposition
                         ORDER BY cnt DESC, p.proposition ASC`,
                        [focalAssumptionRaw, claimB]
                    );
                    propsB = rows;
                } else {
                    const [rows] = await pool.query(
                        `SELECT p.proposition, MAX(p.cnt) AS cnt
                         FROM \`${contraryTable}\` c
                         JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                         WHERE c.isContrary = 1
                           AND c.assumption = ?
                           AND p.claim = ?
                         GROUP BY p.proposition
                         ORDER BY cnt DESC, p.proposition ASC
                         LIMIT ?`,
                        [focalAssumptionRaw, claimB, K]
                    );
                    propsB = rows;
                }
            } else {
                propsB = await fetchTopPropositionsByClaim(topicTable, claimB, K);
                contraryCandidatesCount = propsB.length;
            }
            for (const r of propsB) {
                const pid = `${clusterBId}::P::${r.proposition}`;
                addNode(pid, r.proposition, "proposition", clusterBId, false, r.cnt);
                addEdge(pid, claimBNodeId, "support");
            }

            // Level 4 assumptions are tied to propositionB that actually attacks level-1 assumptions of claimA.
            assumpRowsB = await fetchTopAssumptionsByClaim(topicTable, claimB, K);
            const propsBRaw = (propsB || []).map((r) => r.proposition).filter(Boolean);
            let assumpRowsBForGraph = assumpRowsB;
            if (propsBRaw.length) {
                if (focusOnly) {
                    const claimBLower = String(claimB || "").toLowerCase();
                    const expectedPrefixB = claimBLower.startsWith("bad_")
                        ? "have_evident_"
                        : (claimBLower.startsWith("good_") ? "no_evident_not_" : null);

                    const expectedAssumptions = expectedPrefixB
                        ? propsBRaw.map((p) => `${expectedPrefixB}${p}`)
                        : [];
                    const [expectedRows] = expectedAssumptions.length
                        ? await pool.query(
                            `SELECT assumption, MAX(cnt) AS cnt
                             FROM \`${topicTable}\`
                             WHERE claim = ?
                               AND assumption IN (?)
                             GROUP BY assumption`,
                            [claimB, expectedAssumptions]
                        )
                        : [[]];
                    const expectedSet = new Set((expectedRows || []).map((r) => String(r.assumption || "")));
                    const expectedCnt = new Map(
                        (expectedRows || []).map((r) => [String(r.assumption || ""), Number(r.cnt || 0)])
                    );

                    const [pairRows] = await pool.query(
                        `SELECT
                            c.proposition,
                            a.assumption AS assumption,
                            MAX(a.cnt) AS cnt
                         FROM \`${contraryTable}\` c
                         JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                         WHERE c.isContrary = 1
                           AND c.proposition IN (?)
                           AND a.claim = ?
                         GROUP BY c.proposition, a.assumption`,
                        [propsBRaw, claimB]
                    );

                    const bestByProposition = new Map();
                    for (const row of pairRows || []) {
                        const p = String(row.proposition || "");
                        const a = String(row.assumption || "");
                        const c = Number(row.cnt || 0);
                        const prev = bestByProposition.get(p);
                        if (!prev || c > prev.cnt || (c === prev.cnt && a.localeCompare(prev.assumption) < 0)) {
                            bestByProposition.set(p, { assumption: a, cnt: c });
                        }
                    }

                    const chosenByAssumption = new Map();
                    for (const p of propsBRaw) {
                        const expected = expectedPrefixB ? `${expectedPrefixB}${p}` : null;
                        if (expected && expectedSet.has(expected)) {
                            chosenByAssumption.set(expected, {
                                assumption: expected,
                                cnt: expectedCnt.get(expected) ?? 0,
                            });
                            continue;
                        }
                        const best = bestByProposition.get(p);
                        if (best && best.assumption) {
                            chosenByAssumption.set(best.assumption, {
                                assumption: best.assumption,
                                cnt: best.cnt ?? 0,
                            });
                        }
                    }

                    const chosenRows = Array.from(chosenByAssumption.values())
                        .sort((a, b) => {
                            const diff = Number(b.cnt || 0) - Number(a.cnt || 0);
                            if (diff !== 0) return diff;
                            return String(a.assumption || "").localeCompare(String(b.assumption || ""));
                        })
                        .slice(0, K);
                    if (chosenRows.length) {
                        assumpRowsBForGraph = chosenRows;
                    } else {
                        const rows = await fetchAssumptionsAttackingPropositions(topicTable, contraryTable, claimB, propsBRaw, K);
                        if (rows.length) assumpRowsBForGraph = rows;
                    }
                } else {
                    const rows = await fetchAssumptionsAttackingPropositions(topicTable, contraryTable, claimB, propsBRaw, K);
                    if (rows.length) assumpRowsBForGraph = rows;
                }
            }
            for (const r of assumpRowsBForGraph) {
                const aid = `${clusterBId}::A::${r.assumption}`;
                addNode(aid, r.assumption, "assumption", clusterBId, false, r.cnt);
                addEdge(aid, claimBNodeId, "support");
            }

            // Level 5-7 source: find claimC and propositionC from attacks on rendered assumptionB.
            const assB = assumpRowsBForGraph.map((r) => r.assumption).filter(Boolean);
            if (assB.length) {
                const [rowsPairs] = await pool.query(
                    `SELECT DISTINCT c.proposition, c.assumption, p.cnt
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND p.claim = ?
                       AND c.assumption IN (?)
                     ORDER BY p.cnt DESC, c.proposition ASC, c.assumption ASC`,
                    [claimA, assB]
                );
                claimALevel5Pairs = rowsPairs || [];
            }
            let propsC = [];
            if (assB.length) {
                const [scoreRows] = await pool.query(
                    `SELECT p.claim AS claim, COUNT(DISTINCT p.proposition) AS score
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND c.assumption IN (?)
                       AND p.claim <> ?
                       AND p.claim <> ?
                     GROUP BY p.claim
                     ORDER BY score DESC, p.claim ASC`,
                    [assB, claimA, claimB]
                );
                if (!focusOnly) {
                    const inTopic = (scoreRows || []).find((r) => allowedClaims.has(r.claim));
                    if (inTopic) claimC = inTopic.claim;
                }
            }
            if (!focusOnly && claimC && assB.length) {
                const [rows] = await pool.query(
                    `SELECT p.proposition, MAX(p.cnt) AS cnt
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND c.assumption IN (?)
                       AND p.claim = ?
                     GROUP BY p.proposition
                     ORDER BY cnt DESC, p.proposition ASC
                     LIMIT ?`,
                    [assB, claimC, K]
                );
                propsC = rows || [];
                if (!propsC.length) claimC = null;
            }

            if (!focusOnly && claimC) {
                const clusterCId = `arg::${topic}::${supporting}::${claimC}`;
                clusters.push({ id: clusterCId, label: clusterCId });
                clusterClaimById.set(clusterCId, claimC);
                const claimCNodeId = `${clusterCId}::C::${claimC}`;
                addNode(claimCNodeId, claimC, "claim", clusterCId, false);

                for (const r of propsC) {
                    const pid = `${clusterCId}::P::${r.proposition}`;
                    addNode(pid, r.proposition, "proposition", clusterCId, false, r.cnt);
                    addEdge(pid, claimCNodeId, "support");
                }

                const assumpRowsC = await fetchTopAssumptionsByClaim(topicTable, claimC, K);
                for (const r of assumpRowsC) {
                    const aid = `${clusterCId}::A::${r.assumption}`;
                    addNode(aid, r.assumption, "assumption", clusterCId, false, r.cnt);
                    addEdge(aid, claimCNodeId, "support");
                }
            }
        }

        // ABA attacks from contrary (proposition -> assumption only)
        async function buildAttackEdges() {
            const propositionNodeIdsByRaw = new Map();
            const assumptionNodeIdsByRaw = new Map();
            const propositionRaws = new Set();
            const assumptionRaws = new Set();

            for (const n of nodeMap.values()) {
                if (n.type === "proposition") {
                    const p = parseNodeId(n.id);
                    if (!p) continue;
                    propositionRaws.add(p.raw);
                    if (!propositionNodeIdsByRaw.has(p.raw)) propositionNodeIdsByRaw.set(p.raw, []);
                    propositionNodeIdsByRaw.get(p.raw).push(n.id);
                } else if (n.type === "assumption") {
                    const a = parseNodeId(n.id);
                    if (!a) continue;
                    assumptionRaws.add(a.raw);
                    if (!assumptionNodeIdsByRaw.has(a.raw)) assumptionNodeIdsByRaw.set(a.raw, []);
                    assumptionNodeIdsByRaw.get(a.raw).push(n.id);
                }
            }
            if (!propositionRaws.size || !assumptionRaws.size) return { attackEdges: [], attackers: [], targets: [] };

            const seen = new Set();
            const gathered = [];
            if (claimB) {
                const [rows] = await pool.query(
                    `SELECT
                        c.proposition,
                        c.assumption,
                        p.claim AS proposition_claim,
                        a.claim AS assumption_claim
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                     WHERE c.isContrary = 1
                       AND c.proposition IN (?)
                       AND c.assumption IN (?)`,
                    [[...propositionRaws], [...assumptionRaws]]
                );
                for (const r of rows) {
                    const k = `${r.proposition}::${r.assumption}::${r.proposition_claim}::${r.assumption_claim}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    gathered.push(r);
                }
            } else {
                let frontierP = new Set();
                let frontierA = new Set();
                if (supportOrigin === "proposition") frontierP.add(supporting);
                if (supportOrigin === "assumption") frontierA.add(supporting);
                for (let d = 0; d < attackDepth; d += 1) {
                    if (!frontierP.size && !frontierA.size) break;
                    const [rows] = await pool.query(
                        `SELECT
                            c.proposition,
                            c.assumption,
                            p.claim AS proposition_claim,
                            a.claim AS assumption_claim
                         FROM \`${contraryTable}\` c
                         JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                         JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                         WHERE c.isContrary = 1
                           AND (c.proposition IN (?) OR c.assumption IN (?))`,
                        [[...frontierP], [...frontierA]]
                    );
                    frontierP = new Set();
                    frontierA = new Set();
                    for (const r of rows) {
                        const k = `${r.proposition}::${r.assumption}::${r.proposition_claim}::${r.assumption_claim}`;
                        if (seen.has(k)) continue;
                        seen.add(k);
                        gathered.push(r);
                        frontierP.add(r.proposition);
                        frontierA.add(r.assumption);
                    }
                }
            }

            const out = [];
            const attackers = new Set();
            const targets = new Set();
            for (const r of gathered) {
                if (!propositionRaws.has(r.proposition) || !assumptionRaws.has(r.assumption)) continue;
                const pIds = propositionNodeIdsByRaw.get(r.proposition) || [];
                const aIds = assumptionNodeIdsByRaw.get(r.assumption) || [];
                for (const pId of pIds) {
                    const pInfo = parseNodeId(pId);
                    if (!pInfo) continue;
                    const claimSrc = clusterClaimById.get(pInfo.clusterId);
                    if (r.proposition_claim && claimSrc && r.proposition_claim !== claimSrc) continue;
                    for (const aId of aIds) {
                        const aInfo = parseNodeId(aId);
                        if (!aInfo) continue;
                        const claimTgt = clusterClaimById.get(aInfo.clusterId);
                        if (r.assumption_claim && claimTgt && r.assumption_claim !== claimTgt) continue;
                        if (attackMode === "cross" && pInfo.clusterId === aInfo.clusterId) continue;
                        if ((claimB || claimC) && claimSrc && claimTgt) {
                            const allowedClaimsForEdges = new Set([claimA, claimB, claimC].filter(Boolean));
                            const ok = allowedClaimsForEdges.has(claimSrc) && allowedClaimsForEdges.has(claimTgt);
                            if (!ok) continue;
                        }
                        out.push({ source: pId, target: aId, type: "attack" });
                        attackers.add(r.proposition);
                        targets.add(r.assumption);
                    }
                }
            }
            return { attackEdges: out, attackers: [...attackers], targets: [...targets] };
        }

        const attackBuild = await buildAttackEdges();
        for (const e of attackBuild.attackEdges) addEdge(e.source, e.target, "attack");

        const allNodes = Array.from(nodeMap.values());
        const allEdges = Array.from(edgeMap.values());
        const pyargBuild = buildPyArgPayloadFromGraph(allNodes, allEdges, claimA);
        let pyargResult = null;
        try {
            pyargResult = await runPyArgPreferred(pyargBuild.payload);
        } catch (pyErr) {
            pyargResult = { error: String(pyErr) };
        }

        return {
            clusters,
            nodes: allNodes.map((n) => ({ data: n })),
            edges: allEdges.map((e) => ({ data: e })),
            meta: {
                claimA,
                claimB: claimB || null,
                claimC: claimC || null,
                attackEdgesCount: attackBuild.attackEdges.length,
                attackersCount: attackBuild.attackers.length,
                targetsCount: attackBuild.targets.length,
                attackMode,
                attackDepth,
                focusOnly,
                showAllContrary,
                contraryCandidatesCount,
                k: K,
                claimAPropositionsAll: (claimAPropsAll || []).map((r) => ({
                    proposition: r.proposition,
                    count: Number(r.cnt) || 0,
                })),
                claimAAssumptionsAll: (claimAAssumptionsAll || []).map((r) => ({
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                claimAAttackPairs: (claimAAttackPairs || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                })),
                claimALevel5Pairs: (claimALevel5Pairs || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                pyarg: pyargResult,
                pyargPayload: pyargBuild.payload,
                pyargWarnings: pyargBuild.warnings,
            },
        };
    } catch (err) {
        if (err && err.status) throw err;
        throw createHttpError(500, String(err));
    }
}

    async function runPreferred(body) {
        return runPyArgPreferred(body || {});
    }

    async function translateExtensionsToNaturalLanguage(body) {
        const extensions = Array.isArray(body?.extensions) ? body.extensions : [];
        const task = String(body?.task || "translate_extension").trim().toLowerCase();
        const graphNodes = Array.isArray(body?.graphNodes) ? body.graphNodes : [];
        if (task === "graph_summary" && !graphNodes.length) {
            return { text: "-", provider: "none", model: null };
        }
        if (task !== "graph_summary" && !extensions.length) {
            return { text: "-", provider: "none", model: null };
        }
        const requestedProviderRaw = String(body?.provider || "auto").trim().toLowerCase();
        const requestedProvider = ["auto", "ollama", "openai", "gemini"].includes(requestedProviderRaw)
            ? requestedProviderRaw
            : "auto";
        const requestedModelRaw = String(body?.model || "").trim();

        const modelProviderMap = {
            "gpt-4o": "openai",
            "gemini-2.5-pro": "gemini",
            "qwen2.5": "ollama",
            "gemma3:4b": "ollama",
        };
        const providerFromModel = modelProviderMap[requestedModelRaw] || "auto";
        const effectiveProvider = requestedProvider === "auto" ? providerFromModel : requestedProvider;

        const { systemPrompt, userPrompt } = buildTranslatePrompt(body || {});

        const openaiKey = process.env.OPENAI_API_KEY || "";
        const geminiKey = process.env.GEMINI_API_KEY || "";
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
        const envOllamaModel = String(process.env.OLLAMA_TRANSLATE_MODEL || "qwen2.5").trim();
        const ollamaAliasMap = {
            "qwen2.5": "qwen2.5:7b",
            "gemma3:4b": "gemma3:4b",
        };
        const normalizeOllamaModel = (value) => {
            const key = String(value || "").trim();
            if (!key) return "";
            if (ollamaAliasMap[key]) return ollamaAliasMap[key];
            return key;
        };
        const normalizedRequestedModel = normalizeOllamaModel(requestedModelRaw);
        const normalizedEnvModel = normalizeOllamaModel(envOllamaModel);
        const ollamaModel = normalizedRequestedModel || normalizedEnvModel || "qwen2.5:7b";
        const errors = [];
        const openaiModel = requestedModelRaw === "gpt-4o" ? "gpt-4o" : process.env.LLM_TRANSLATE_MODEL || "gpt-4o-mini";
        const geminiModel =
            requestedModelRaw === "gemini-2.5-pro"
                ? "gemini-2.5-pro"
                : process.env.GEMINI_TRANSLATE_MODEL || "gemini-2.5-pro";

        if (effectiveProvider === "ollama") {
            const text = await translateWithOllama({
                baseUrl: ollamaBaseUrl,
                model: ollamaModel,
                systemPrompt,
                userPrompt,
            });
            return { text, provider: "ollama", model: ollamaModel };
        }

        if (effectiveProvider === "openai") {
            if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured.");
            const text = await translateWithOpenAI({
                apiKey: openaiKey,
                model: openaiModel,
                systemPrompt,
                userPrompt,
            });
            return { text, provider: "openai", model: openaiModel };
        }

        if (effectiveProvider === "gemini") {
            if (!geminiKey) throw new Error("GEMINI_API_KEY is not configured.");
            const text = await translateWithGemini({
                apiKey: geminiKey,
                model: geminiModel,
                systemPrompt,
                userPrompt,
            });
            return { text, provider: "gemini", model: geminiModel };
        }

        try {
            const text = await translateWithOllama({
                baseUrl: ollamaBaseUrl,
                model: ollamaModel,
                systemPrompt,
                userPrompt,
            });
            return { text, provider: "ollama", model: ollamaModel };
        } catch (err) {
            errors.push(`ollama: ${String(err.message || err)}`);
        }

        if (openaiKey) {
            try {
                const text = await translateWithOpenAI({
                    apiKey: openaiKey,
                    model: openaiModel,
                    systemPrompt,
                    userPrompt,
                });
                return { text, provider: "openai", model: openaiModel };
            } catch (err) {
                errors.push(`openai: ${String(err.message || err)}`);
            }
        }

        if (geminiKey) {
            try {
                const text = await translateWithGemini({
                    apiKey: geminiKey,
                    model: geminiModel,
                    systemPrompt,
                    userPrompt,
                });
                return { text, provider: "gemini", model: geminiModel };
            } catch (err) {
                errors.push(`gemini: ${String(err.message || err)}`);
            }
        }

        if (!openaiKey && !geminiKey) {
            throw new Error(`Ollama failed and no cloud provider is configured. ${errors.join(" | ")}`);
        }

        throw new Error(`All LLM providers failed. ${errors.join(" | ")}`);
    }

    return {
        getAbaGraph,
        runPreferred,
        translateExtensionsToNaturalLanguage,
    };
}

module.exports = {
    createAbaGraphService,
};

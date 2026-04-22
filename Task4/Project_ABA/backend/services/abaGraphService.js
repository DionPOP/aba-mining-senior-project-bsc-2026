const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const path = require("path");
const { createClient } = require("redis");

function createHttpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function runPyArgEvaluation(payload) {
    return new Promise((resolve, reject) => {
        const configuredPythonCmd = String(process.env.PYTHON_EXECUTABLE || "").trim();
        const maxStdoutBytes = Number(process.env.PYARG_MAX_STDOUT_BYTES || 2 * 1024 * 1024);
        const pythonCandidates = configuredPythonCmd
            ? [configuredPythonCmd]
            : process.platform === "win32"
              ? ["python"]
              : ["python3", "python"];
        const scriptPath = path.join(__dirname, "..", "scripts", "pyarg_runner.py");
        let attemptIndex = 0;

        function trySpawnNext() {
            const pythonCmd = pythonCandidates[attemptIndex++];
            if (!pythonCmd) {
                reject(new Error("Failed to run Python: no available interpreter (tried python3, python)"));
                return;
            }
            const child = spawn(pythonCmd, [scriptPath], {
                stdio: ["pipe", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => {
                stdout += String(chunk);
                if (maxStdoutBytes > 0 && Buffer.byteLength(stdout, "utf8") > maxStdoutBytes) {
                    child.kill("SIGKILL");
                }
            });
            child.stderr.on("data", (chunk) => {
                stderr += String(chunk);
                if (maxStdoutBytes > 0 && Buffer.byteLength(stderr, "utf8") > maxStdoutBytes) {
                    child.kill("SIGKILL");
                }
            });
            child.on("error", (err) => {
                if (err && err.code === "ENOENT") {
                    trySpawnNext();
                    return;
                }
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
        }

        trySpawnNext();
    });
}

function sanitizePyArgResult(result) {
    if (!result || typeof result !== "object") return result;

    const includeDebug = String(process.env.PYARG_INCLUDE_DEBUG_FIELDS || "0").trim() === "1";
    const maxExtensions = Number(process.env.PYARG_MAX_EXTENSIONS || 200);

    const normalizedExtensions = Array.isArray(result.extensions)
        ? result.extensions
        : [];
    const clippedExtensions = maxExtensions > 0
        ? normalizedExtensions.slice(0, maxExtensions)
        : normalizedExtensions;

    const sanitized = {
        ...result,
        extensions: clippedExtensions,
        count: Array.isArray(result.extensions) ? result.extensions.length : Number(result.count || 0) || 0,
    };

    if (!includeDebug) {
        delete sanitized.raw_extensions;
        delete sanitized.derived;
    }

    return sanitized;
}

function serializeJson(value) {
    if (value == null) return null;
    try {
        return JSON.stringify(value);
    } catch (err) {
        return JSON.stringify({ error: "Failed to serialize value", detail: String(err?.message || err) });
    }
}

function parseJsonOrNull(value) {
    if (value == null) return null;
    const text = String(value);
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (err) {
        return null;
    }
}

function buildTranslatePrompt(body) {
    const payload = body && typeof body === "object" ? body : {};
    const task = String(payload?.task || "translate_extension").trim().toLowerCase();
    const topic = String(payload?.topic || "");
    const sentiment = String(payload?.sentiment || "");
    const supporting = String(payload?.supporting || "");
    const rawOutputLanguage = String(payload?.outputLanguage || "English").trim();
    const targetLanguage = /^en\b/i.test(rawOutputLanguage) ? "English" : rawOutputLanguage;
    if (task === "graph_summary") {
        const graphNodes = Array.isArray(payload?.graphNodes) ? payload.graphNodes : [];
        const graphEdges = Array.isArray(payload?.graphEdges) ? payload.graphEdges : [];
        const graphEdgeStats =
            payload?.graphEdgeStats && typeof payload.graphEdgeStats === "object"
                ? payload.graphEdgeStats
                : {};
        const systemPrompt = `
You are a helpful assistant explaining the outcome of an argument analysis to a general audience.
The analysis evaluated reasons for and against a conclusion.

Your role is to translate this into plain, natural language — like a knowledgeable friend summarizing both sides of an issue.

Strict language rules:
- NEVER output snake_case text (e.g., "allow_to_check_out_later"). Always convert to natural readable phrases (e.g., "being allowed to check out later").
- NEVER use words like: node, proposition, assumption, edge, claim, support edge, attack edge, graph.
- NEVER say "the graph shows" or "the graph argues". Just state the ideas directly.
- Write as if explaining to someone who has never seen the analysis tool.
- Output exactly one paragraph. No headings, no bullet points.
`.trim();
        const userPrompt = [
            `Output language: ${targetLanguage}`,
            topic ? `Topic being analyzed: ${topic}` : "",
            sentiment ? `Main conclusion being evaluated: ${sentiment}` : "",
            supporting ? `Key supporting idea to highlight: ${supporting}` : "",
            "",
            `Argument nodes: ${JSON.stringify(graphNodes)}`,
            `Argument connections: ${JSON.stringify(graphEdges)}`,
            `Connection statistics: ${JSON.stringify(graphEdgeStats)}`,
            "",
            "Write one plain-language paragraph for a general reader. Follow this exact structure:",
            "",
            "1. STATE the main conclusion clearly in everyday language.",
            "2. EXPLAIN the strongest reasons that support it — rephrase any snake_case names into natural phrases.",
            "3. EXPLAIN the main opposing argument(s), if any — in plain language.",
            "4. END with whether this conclusion is strong, uncertain, or depends on the situation — based on how balanced the two sides are.",
            "",
            "Rules:",
            "- One paragraph only.",
            "- Convert every snake_case identifier into readable text. Example: 'late_departure_no_extra_cost' -> 'no extra charge for a late departure'.",
            "- Never mention node names, IDs, or any technical labels in your output.",
            "- Be specific — name the actual ideas, not vague phrases like 'several positive factors' or 'some concerns'.",
            "- Do not give advice or recommendations unless the argument itself contains them.",
            "- If supporting reasons clearly outweigh opposition -> say the conclusion is well-supported.",
            "- If both sides carry significant weight -> say the conclusion is debatable or depends on circumstances.",
            "- One paragraph only. No lists. No headings.",
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
            selectedClaim: propositionInScope.claim,
            supportCount: Number(propositionInScope.cnt) || null,
        };
    }
    if (assumptionInScope) {
        return {
            supportOrigin: "assumption",
            selectedClaim: assumptionInScope.claim,
            supportCount: Number(assumptionInScope.cnt) || null,
        };
    }
    if (propositionMatch.length) {
        return {
            supportOrigin: "proposition",
            selectedClaim: propositionMatch[0].claim,
            supportCount: Number(propositionMatch[0].cnt) || null,
        };
    }
    if (assumptionMatch.length) {
        return {
            supportOrigin: "assumption",
            selectedClaim: assumptionMatch[0].claim,
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

function uniqueByLabelAndCount(rows, labelKey) {
    const out = new Map();
    for (const row of rows || []) {
        const label = String(row?.[labelKey] || "").trim();
        if (!label) continue;
        const count = Number(row?.cnt || row?.count || 0) || 0;
        const prev = out.get(label);
        if (!prev || count > prev.count) {
            out.set(label, {
                label,
                count: count || null,
            });
        }
    }
    return [...out.values()];
}

function findAttackPairsFromGraph(nodes, edges, attackerLabels, targetLabels) {
    const nodeById = new Map((nodes || []).map((n) => [n.id, n]));
    const attackerSet = new Set((attackerLabels || []).map((x) => String(x || "").trim()).filter(Boolean));
    const targetSet = new Set((targetLabels || []).map((x) => String(x || "").trim()).filter(Boolean));
    const seen = new Set();
    const out = [];

    for (const edge of edges || []) {
        if (edge?.type !== "attack") continue;
        const src = nodeById.get(edge.source);
        const tgt = nodeById.get(edge.target);
        const attacker = String(src?.label || "").trim();
        const target = String(tgt?.label || "").trim();
        if (!attackerSet.has(attacker) || !targetSet.has(target)) continue;
        const key = `${attacker}::${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ attacker, target });
    }

    return out;
}

function createCanonicalFrameworkContext({
    topic,
    supporting,
    selectedClaim,
    opposingClaim,
    defenseLayerLabel,
}) {
    return {
        topic,
        supporting,
        selectedClaim: selectedClaim || null,
        opposingClaim: opposingClaim || null,
        defenseLayerLabel: defenseLayerLabel || null,
        atomMeta: new Map(),
        supportRules: [],
        compoundSupportRules: [],
        attackPairs: [],
        warnings: [],
    };
}

function makeSyntheticDefenseLayerLabel(selectedClaim) {
    const base = String(selectedClaim || "").trim();
    if (!base) return "synthetic_defense_claim";
    if (base.endsWith("_defense")) return `${base}_2`;
    return `${base}_defense`;
}

function normalizeFrameworkAtomType(rawType) {
    return rawType === "claim" ? "claim" : (rawType === "assumption" ? "assumption" : "proposition");
}

function getFrameworkClusterClaim(ctx, spec, type) {
    if (type === "claim") return String(spec?.label || "").trim();
    return String(spec?.clusterClaim || ctx.selectedClaim || "").trim() || null;
}

function makeFrameworkAtomKey({ clusterClaim, type, label }) {
    return `atom::${String(clusterClaim || "").trim()}::${normalizeFrameworkAtomType(type)}::${String(label || "").trim()}`;
}

function resolveFrameworkAtomKey(ctx, spec) {
    const label = String(spec?.label || "").trim();
    if (!label) return null;
    const type = normalizeFrameworkAtomType(spec?.type);
    const clusterClaim = getFrameworkClusterClaim(ctx, spec, type);
    if (!clusterClaim) return null;
    const key = makeFrameworkAtomKey({ clusterClaim, type, label });
    return ctx.atomMeta.has(key) ? key : null;
}

function registerFrameworkAtom(ctx, spec) {
    const label = String(spec?.label || "").trim();
    if (!label) return;
    const type = normalizeFrameworkAtomType(spec?.type);
    const clusterClaim = getFrameworkClusterClaim(ctx, spec, type);
    if (!clusterClaim) return null;
    const atomKey = makeFrameworkAtomKey({ clusterClaim, type, label });
    const existing = ctx.atomMeta.get(atomKey);
    const countValue = Number(spec?.count || 0) || null;
    const next = existing
        ? { ...existing }
        : {
            key: atomKey,
            label,
            type,
            clusterClaim,
            count: null,
            isFocus: false,
            level: Number.isFinite(Number(spec?.level)) ? Number(spec.level) : null,
        };

    if (type === "claim") {
        next.clusterClaim = label;
    } else if (!next.clusterClaim && spec?.clusterClaim) {
        next.clusterClaim = String(spec.clusterClaim).trim() || null;
    }
    if (countValue != null) {
        const prev = Number(next.count || 0);
        next.count = Math.max(prev, countValue) || null;
    }
    if (spec?.isFocus) next.isFocus = true;
    if (Number.isFinite(Number(spec?.level))) {
        const level = Number(spec.level);
        next.level = next.level == null ? level : Math.min(Number(next.level), level);
    }
    ctx.atomMeta.set(atomKey, next);
    return atomKey;
}

function registerSupportRule(ctx, premiseSpec, conclusionSpec, level) {
    const premiseKey = resolveFrameworkAtomKey(ctx, premiseSpec);
    const conclusionKey = resolveFrameworkAtomKey(ctx, conclusionSpec);
    if (!premiseKey || !conclusionKey || premiseKey === conclusionKey) return;
    const key = `support::${premiseKey}::${conclusionKey}`;
    if (ctx.supportRules.some((rule) => rule.key === key)) return;
    ctx.supportRules.push({
        key,
        premiseKey,
        conclusionKey,
        level: Number.isFinite(Number(level)) ? Number(level) : null,
    });
}

function registerCompoundSupportRule(ctx, premiseSpecs, conclusionSpec, level) {
    const premiseKeys = [];
    const seen = new Set();
    for (const premiseSpec of premiseSpecs || []) {
        const premiseKey = resolveFrameworkAtomKey(ctx, premiseSpec);
        if (!premiseKey || seen.has(premiseKey)) continue;
        seen.add(premiseKey);
        premiseKeys.push(premiseKey);
    }
    const conclusionKey = resolveFrameworkAtomKey(ctx, conclusionSpec);
    if (!conclusionKey || premiseKeys.length < 2) return;
    const key = `compound_support::${premiseKeys.join("::")}::${conclusionKey}`;
    if (ctx.compoundSupportRules.some((rule) => rule.key === key)) return;
    ctx.compoundSupportRules.push({
        key,
        premiseKeys,
        conclusionKey,
        level: Number.isFinite(Number(level)) ? Number(level) : null,
    });
}

function registerAttackPair(ctx, attackerSpec, targetSpec, level) {
    const attackerKey = resolveFrameworkAtomKey(ctx, attackerSpec);
    const targetKey = resolveFrameworkAtomKey(ctx, targetSpec);
    if (!attackerKey || !targetKey) return;
    const key = `attack::${attackerKey}::${targetKey}`;
    if (ctx.attackPairs.some((pair) => pair.key === key)) return;
    ctx.attackPairs.push({
        key,
        attackerKey,
        targetKey,
        level: Number.isFinite(Number(level)) ? Number(level) : null,
    });
}

function buildPyArgPayloadFromFrameworkSelection(ctx, selection) {
    const atomKeys = new Set(selection.atomKeys || []);
    const language = new Set();
    const assumptions = new Set();
    const contraries = {};
    const helperContraries = {};
    const rules = [];
    const warnings = [...(ctx.warnings || [])];

    for (const atomKey of atomKeys) {
        const meta = ctx.atomMeta.get(atomKey);
        if (!meta) continue;
        language.add(meta.label);
        if (meta.type === "assumption") {
            assumptions.add(meta.label);
        }
    }

    const conclusionsWithCompoundSupport = new Set(
        (selection.compoundSupportRules || []).map((rule) => rule?.conclusionKey).filter(Boolean)
    );

    for (const rule of selection.compoundSupportRules || []) {
        const premiseMetas = (rule.premiseKeys || []).map((premiseKey) => ctx.atomMeta.get(premiseKey)).filter(Boolean);
        const conclusionMeta = ctx.atomMeta.get(rule.conclusionKey);
        if (!conclusionMeta || premiseMetas.length < 2) continue;
        premiseMetas.forEach((meta) => language.add(meta.label));
        language.add(conclusionMeta.label);
        rules.push({
            name: `Rule${rules.length + 1}`,
            premises: premiseMetas.map((meta) => meta.label),
            conclusion: conclusionMeta.label,
        });
    }

    for (const rule of selection.supportRules || []) {
        const premiseMeta = ctx.atomMeta.get(rule.premiseKey);
        const conclusionMeta = ctx.atomMeta.get(rule.conclusionKey);
        if (!premiseMeta || !conclusionMeta) continue;
        if (conclusionsWithCompoundSupport.has(rule.conclusionKey)) continue;
        language.add(premiseMeta.label);
        language.add(conclusionMeta.label);
        rules.push({
            name: `Rule${rules.length + 1}`,
            premises: [premiseMeta.label],
            conclusion: conclusionMeta.label,
        });
    }

    for (const pair of selection.attackPairs || []) {
        const attackerMeta = ctx.atomMeta.get(pair.attackerKey);
        const targetMeta = ctx.atomMeta.get(pair.targetKey);
        if (!attackerMeta || !targetMeta) continue;
        if (!assumptions.has(targetMeta.label)) continue;
        language.add(attackerMeta.label);
        const contraryAtom = contraries[targetMeta.label] || `__ctr__${targetMeta.label}`;
        contraries[targetMeta.label] = contraryAtom;
        helperContraries[targetMeta.label] = contraryAtom;
        language.add(contraryAtom);
        rules.push({
            name: `Rule${rules.length + 1}`,
            premises: [attackerMeta.label],
            conclusion: contraryAtom,
        });
    }

    for (const assumption of assumptions) {
        if (!contraries[assumption]) {
            const synthetic = `__ctr__${assumption}`;
            contraries[assumption] = synthetic;
            helperContraries[assumption] = synthetic;
            language.add(synthetic);
            warnings.push(`assumption '${assumption}' had no attacker; added synthetic contrary '${synthetic}'`);
        }
    }

        return {
            payload: {
            language: [...language],
            assumptions: [...assumptions],
            contraries,
            helperContraries,
            rules,
            query: ctx.selectedClaim || null,
        },
        warnings,
    };
}

function makeFrameworkNodeId(meta) {
    const prefix = meta.type === "claim" ? "C" : (meta.type === "assumption" ? "A" : "P");
    return `framework::${meta.clusterClaim || meta.label}::${prefix}::${meta.label}`;
}

function buildDisplayRowsFromFrameworkSelection(ctx, selection) {
    const atoms = [...(selection.atomKeys || [])]
        .map((atomKey) => ctx.atomMeta.get(atomKey))
        .filter(Boolean);
    const rowsByLevel = new Map();

    function sortForDisplay(a, b) {
        const typeRank = { claim: 0, proposition: 1, assumption: 2 };
        const rankDiff = (typeRank[a?.type] ?? 9) - (typeRank[b?.type] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        if (!!a?.isFocus !== !!b?.isFocus) return a?.isFocus ? -1 : 1;
        const countDiff = Number(b?.count || 0) - Number(a?.count || 0);
        if (countDiff !== 0) return countDiff;
        return String(a?.label || "").localeCompare(String(b?.label || ""));
    }

    for (const meta of atoms) {
        const level = Number.isFinite(Number(meta?.level)) ? Number(meta.level) : 99;
        if (!rowsByLevel.has(level)) rowsByLevel.set(level, []);
        rowsByLevel.get(level).push(meta);
    }

    return [...rowsByLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, metas]) => metas.sort(sortForDisplay).map((meta) => makeFrameworkNodeId(meta)))
        .filter((row) => row.length);
}

function buildGraphFromFrameworkSelection(ctx, selection) {
    const clusterLabels = [ctx.selectedClaim, ctx.opposingClaim, ctx.defenseLayerLabel]
        .filter(Boolean)
        .filter((claim) =>
            selection.atomKeys.has(
                makeFrameworkAtomKey({
                    clusterClaim: claim,
                    type: "claim",
                    label: claim,
                })
            )
        );
    const clusters = clusterLabels.map((claim) => ({
        id: `framework::${claim}`,
        label: claim,
    }));
    const nodes = [];
    const edges = [];
    const nodeIdByKey = new Map();

    for (const atomKey of selection.atomKeys) {
        const meta = ctx.atomMeta.get(atomKey);
        if (!meta) continue;
        const clusterClaim = meta.type === "claim" ? meta.label : (meta.clusterClaim || ctx.selectedClaim || meta.label);
        const clusterId = `framework::${clusterClaim}`;
        const nodeId = makeFrameworkNodeId(meta);
        nodeIdByKey.set(atomKey, nodeId);
        nodes.push({
            data: {
                id: nodeId,
                label: meta.label,
                type: meta.type,
                clusterId,
                clusterSentiment: String(clusterClaim || "").startsWith("bad_") ? "bad" : "good",
                count: meta.count != null ? Number(meta.count) || null : null,
                isFocus: Boolean(meta.isFocus),
                level: meta.level,
            },
        });
    }

    const seenEdges = new Set();
    function pushEdge(sourceKey, targetKey, type) {
        const source = nodeIdByKey.get(sourceKey);
        const target = nodeIdByKey.get(targetKey);
        if (!source || !target) return;
        const key = `${type}::${source}::${target}`;
        if (seenEdges.has(key)) return;
        seenEdges.add(key);
        edges.push({
            data: {
                id: `e_${edges.length + 1}`,
                source,
                target,
                type,
            },
        });
    }

    for (const rule of selection.supportRules || []) {
        pushEdge(rule.premiseKey, rule.conclusionKey, "support");
    }
    for (const pair of selection.attackPairs || []) {
        pushEdge(pair.attackerKey, pair.targetKey, "attack");
    }

    return {
        clusters,
        nodes,
        edges,
        displayRows: buildDisplayRowsFromFrameworkSelection(ctx, selection),
    };
}

function getLayerModeMaxLevel(layerMode) {
    return layerMode === "layer1" ? 4 : 7;
}

function selectFrameworkView(ctx, options = {}) {
    const layerMode = String(options?.layerMode || "layer2").trim().toLowerCase() === "layer1" ? "layer1" : "layer2";
    const maxLevel = getLayerModeMaxLevel(layerMode);
    const atomKeys = new Set(
        [...ctx.atomMeta.entries()]
            .filter(([, meta]) => Number.isFinite(Number(meta?.level)) ? Number(meta.level) <= maxLevel : true)
            .map(([atomKey]) => atomKey)
    );
    const supportRules = (ctx.supportRules || []).filter((rule) =>
        (Number.isFinite(Number(rule?.level)) ? Number(rule.level) <= maxLevel : true) &&
        atomKeys.has(rule.premiseKey) &&
        atomKeys.has(rule.conclusionKey)
    );
    const attackPairs = (ctx.attackPairs || []).filter((pair) =>
        (Number.isFinite(Number(pair?.level)) ? Number(pair.level) <= maxLevel : true) &&
        atomKeys.has(pair.attackerKey) &&
        atomKeys.has(pair.targetKey)
    );

    return {
        layerMode,
        maxLevel,
        atomKeys,
        supportRules,
        compoundSupportRules: (ctx.compoundSupportRules || []).filter((rule) =>
            (Number.isFinite(Number(rule?.level)) ? Number(rule.level) <= maxLevel : true) &&
            (rule.premiseKeys || []).every((premiseKey) => atomKeys.has(premiseKey)) &&
            atomKeys.has(rule.conclusionKey)
        ),
        attackPairs,
    };
}

async function evaluateFrameworkSelection(ctx, selection, options = {}) {
    const semanticsRaw = String(options?.semantics || "Preferred").trim();
    const strategyRaw = String(options?.strategy || "Credulous").trim();
    const semantics = semanticsRaw || "Preferred";
    const strategy = strategyRaw === "Skeptical" ? "Skeptical" : "Credulous";
    const frameworkBuild = buildPyArgPayloadFromFrameworkSelection(ctx, selection);
    const payload = {
        ...frameworkBuild.payload,
        semantics_specification: semantics,
        strategy_specification: strategy,
    };
    let result = null;
    try {
        result = await runPyArgEvaluation(payload);
    } catch (pyErr) {
        result = { error: String(pyErr) };
    }
    return {
        payload,
        warnings: frameworkBuild.warnings,
        result,
    };
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
    const LLM_JOB_TTL_MS = Number(process.env.LLM_JOB_TTL_MS || 5 * 60 * 1000);
    const LLM_JOB_MAX = Number(process.env.LLM_JOB_MAX || 120);
    const PYARG_JOB_TTL_MS = Number(process.env.PYARG_JOB_TTL_MS || 20 * 60 * 1000);
    const PYARG_JOB_MAX = Number(process.env.PYARG_JOB_MAX || 120);
    const REDIS_URL = String(process.env.REDIS_URL || process.env.REDIS_TLS_URL || "").trim();
    const JOB_PREFIX = String(process.env.ASYNC_JOB_REDIS_PREFIX || "aba:job").trim() || "aba:job";
    const REDIS_IS_TLS = /^rediss:\/\//i.test(REDIS_URL);
    const REDIS_TLS_REJECT_UNAUTHORIZED = String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || "0").trim() === "1";
    const JOB_TYPE_PYARG = "pyarg_evaluate";
    const JOB_TYPE_LLM = "llm_translate_extension";
    const redisClient = createClient(
        REDIS_URL
            ? {
                  url: REDIS_URL,
                  ...(REDIS_IS_TLS
                      ? {
                            socket: {
                                tls: true,
                                rejectUnauthorized: REDIS_TLS_REJECT_UNAUTHORIZED,
                            },
                        }
                      : {}),
              }
            : {}
    );
    let redisConnectPromise = null;
    redisClient.on("error", (err) => {
        console.error("[jobs] redis error:", err?.message || err);
    });

    function getJobKey(jobType, id) {
        return `${JOB_PREFIX}:${jobType}:${id}`;
    }

    function getJobIndexKey(jobType) {
        return `${JOB_PREFIX}:index:${jobType}`;
    }

    async function ensureRedisReady() {
        if (!REDIS_URL) {
            throw new Error("REDIS_URL is not set. Configure Heroku Redis before using async job endpoints.");
        }
        if (redisClient.isOpen) return;
        if (!redisConnectPromise) {
            redisConnectPromise = redisClient.connect().catch((err) => {
                redisConnectPromise = null;
                throw err;
            });
        }
        await redisConnectPromise;
    }

    function mapJobRowForResponse(job, fallbackError) {
        return {
            job_id: job.id,
            status: job.status,
            created_at: Number(job.created_at),
            updated_at: Number(job.updated_at),
            started_at: job.started_at == null ? null : Number(job.started_at),
            completed_at: job.completed_at == null ? null : Number(job.completed_at),
            result: job.status === "done" ? parseJsonOrNull(job.result_json) : null,
            error: job.status === "failed" ? String(job.error_text || fallbackError) : null,
        };
    }

    async function setRedisJob(jobType, job, ttlMs) {
        await ensureRedisReady();
        const key = getJobKey(jobType, job.id);
        const ttlSeconds = Math.max(1, Math.ceil(Number(ttlMs || 1000) / 1000));
        await redisClient.set(key, serializeJson(job), {
            EX: ttlSeconds,
        });
    }

    async function pruneJobs(jobType, ttlMs, maxCount) {
        await ensureRedisReady();
        if (!(maxCount > 0)) return;
        const indexKey = getJobIndexKey(jobType);
        const total = await redisClient.zCard(indexKey);
        const overflow = Number(total || 0) - maxCount;
        if (overflow <= 0) return;
        const oldIds = await redisClient.zRange(indexKey, 0, overflow - 1);
        if (!oldIds.length) return;

        const multi = redisClient.multi();
        multi.zRem(indexKey, oldIds);
        for (const id of oldIds) {
            multi.del(getJobKey(jobType, id));
        }
        await multi.exec();
    }

    async function createJob(jobType, ttlMs, body) {
        await pruneJobs(jobType, ttlMs, jobType === JOB_TYPE_PYARG ? PYARG_JOB_MAX : LLM_JOB_MAX);
        const now = Date.now();
        const id = randomUUID();
        const job = {
            id,
            status: "queued",
            created_at: now,
            updated_at: now,
            started_at: null,
            completed_at: null,
            payload_json: serializeJson(body || {}),
            result_json: null,
            error_text: null,
        };
        await setRedisJob(jobType, job, ttlMs);
        await ensureRedisReady();
        await redisClient.zAdd(getJobIndexKey(jobType), [{ score: now, value: id }]);
        return job;
    }

    async function getRedisJob(jobType, id) {
        await ensureRedisReady();
        const raw = await redisClient.get(getJobKey(jobType, id));
        return parseJsonOrNull(raw);
    }

    async function markJobRunning(jobType, id, ttlMs) {
        const job = await getRedisJob(jobType, id);
        if (!job) return;
        const now = Date.now();
        job.status = "running";
        job.started_at = job.started_at == null ? now : job.started_at;
        job.updated_at = now;
        await setRedisJob(jobType, job, ttlMs);
    }

    async function markJobDone(jobType, id, result, ttlMs) {
        const job = await getRedisJob(jobType, id);
        if (!job) return;
        const now = Date.now();
        job.status = "done";
        job.result_json = serializeJson(result);
        job.error_text = null;
        job.completed_at = now;
        job.updated_at = now;
        await setRedisJob(jobType, job, ttlMs);
    }

    async function markJobFailed(jobType, id, message, ttlMs) {
        const job = await getRedisJob(jobType, id);
        if (!job) return;
        const now = Date.now();
        job.status = "failed";
        job.error_text = String(message || "Job failed");
        job.completed_at = now;
        job.updated_at = now;
        await setRedisJob(jobType, job, ttlMs);
    }

    async function getJob(jobType, id) {
        return getRedisJob(jobType, id);
    }

    function parseAbaGraphRequest(query) {
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
        const layerModeRaw = String(query.layer_mode || "layer2").trim().toLowerCase();
        const layerMode = layerModeRaw === "layer1" ? "layer1" : "layer2";
        const focusOnlyRaw = String(query.focus_only || "1").trim().toLowerCase();
        const focusOnly = focusOnlyRaw === "1" || focusOnlyRaw === "true" || focusOnlyRaw === "yes";
        const showAllContraryRaw = String(query.show_all_contrary || "0").trim().toLowerCase();
        const showAllContrary = showAllContraryRaw === "1" || showAllContraryRaw === "true" || showAllContraryRaw === "yes";
        const semanticsRaw = String(query.semantics || "Preferred").trim();
        const semantics = semanticsRaw || "Preferred";
        const strategyRaw = String(query.strategy || "Credulous").trim();
        const strategy = strategyRaw === "Skeptical" ? "Skeptical" : "Credulous";

        return {
            topic,
            supporting,
            sentiment,
            k: K,
            attackMode,
            attackDepth,
            layerMode,
            focusOnly,
            showAllContrary,
            semantics,
            strategy,
        };
    }

async function buildCanonicalFrameworkFromDb(request) {
    try {
        const {
            topic,
            supporting,
            sentiment,
            k: K,
            attackMode,
            attackDepth,
            layerMode,
            focusOnly,
            showAllContrary,
            semantics,
            strategy,
        } = request;

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
        const { supportOrigin, selectedClaim, supportCount } = supportingContext;
        if (!allowedClaims.has(selectedClaim)) {
            throw createHttpError(404, "Supporting does not belong to selected topic/sentiment claim set");
        }

        const [selectedClaimPropositionsAll] = await pool.query(
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
            [selectedClaim]
        );
        const selectedClaimAssumptionsAll = await fetchTopAssumptionsByClaim(topicTable, selectedClaim);
        const [selectedClaimSupportPairsAll] = await pool.query(
            `SELECT t.proposition, t.assumption, MAX(t.cnt) AS cnt
             FROM \`${topicTable}\` t
             WHERE t.claim = ?
             GROUP BY t.proposition, t.assumption
             ORDER BY cnt DESC, t.proposition ASC, t.assumption ASC`,
            [selectedClaim]
        );
        const [selectedClaimAttackPairs] = await pool.query(
            `SELECT DISTINCT c.proposition, c.assumption
             FROM \`${contraryTable}\` c
             JOIN \`${topicTable}\` p ON p.proposition = c.proposition
             JOIN \`${topicTable}\` a ON a.assumption = c.assumption
             WHERE c.isContrary = 1
               AND p.claim = ?
               AND a.claim = ?`,
            [selectedClaim, selectedClaim]
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
        // selected-claim cluster
        const selectedClaimClusterId = `arg::${topic}::${supporting}::${selectedClaim}`;
        clusters.push({ id: selectedClaimClusterId, label: selectedClaimClusterId });
        clusterClaimById.set(selectedClaimClusterId, selectedClaim);
        const selectedClaimNodeId = `${selectedClaimClusterId}::C::${selectedClaim}`;
        addNode(selectedClaimNodeId, selectedClaim, "claim", selectedClaimClusterId, false);

        if (supportOrigin === "proposition") {
            const focusP = `${selectedClaimClusterId}::P::${supporting}`;
            addNode(focusP, supporting, "proposition", selectedClaimClusterId, true, supportCount);
            addEdge(focusP, selectedClaimNodeId, "support");
        } else {
            const focusA = `${selectedClaimClusterId}::A::${supporting}`;
            addNode(focusA, supporting, "assumption", selectedClaimClusterId, true, supportCount);
            addEdge(focusA, selectedClaimNodeId, "support");
        }

        let assumpRows = [];
        let preferredAssumptionRow = null;
        if (supportOrigin === "proposition") {
            const claimLower = String(selectedClaim || "").toLowerCase();
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
                    [selectedClaim, expectedAssumption]
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
                [selectedClaim, supporting]
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
                    [selectedClaim, supporting, selectedClaim]
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
                        [supporting, selectedClaim, selectedClaim]
                    );
                }
            }
        } else {
            assumpRows = await fetchTopAssumptionsByClaim(topicTable, selectedClaim, K);
        }
        let selectedClaimAssumptionRowsForGraph = [...assumpRows];
        const focalAssumptionRaw =
            focusOnly && supportOrigin === "proposition" && assumpRows.length
                ? assumpRows[0].assumption
                : null;

        // choose opposing claim by contrary around the selected support
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
                addClaimScores(rows, claimScores, selectedClaim, allowedClaims);
            } else {
                const [rows] = await pool.query(
                    `SELECT a.claim AS claim, a.cnt AS cnt
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` a ON a.assumption = c.assumption
                     WHERE c.isContrary = 1
                       AND c.proposition = ?`,
                    [supporting]
                );
                addClaimScores(rows, claimScores, selectedClaim, allowedClaims);
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
            addClaimScores(rows, claimScores, selectedClaim, allowedClaims);
        }
        let opposingClaim = selectTopClaimByScore(claimScores);
        if (!opposingClaim) {
            const [fallback] = await pool.query(
                `SELECT * FROM head WHERE LOWER(Topic)=? LIMIT 50`,
                [topic]
            );
            for (const row of fallback) {
                const c = getHeadClaim(row);
                if (c && c !== selectedClaim) {
                    opposingClaim = c;
                    break;
                }
            }
        }

        let contraryCandidatesCount = 0;
        let assumpRowsB = [];
        let assumpRowsBForGraph = [];
        let selectedClaimDefenseAttackPairs = [];
        let opposingClaimSupportPairsAll = [];
        if (opposingClaim) {
            const opposingClaimClusterId = `arg::${topic}::${supporting}::${opposingClaim}`;
            clusters.push({ id: opposingClaimClusterId, label: opposingClaimClusterId });
            clusterClaimById.set(opposingClaimClusterId, opposingClaim);
            const opposingClaimNodeId = `${opposingClaimClusterId}::C::${opposingClaim}`;
            addNode(opposingClaimNodeId, opposingClaim, "claim", opposingClaimClusterId, false);
            const [claimBSupportRows] = await pool.query(
                `SELECT t.proposition, t.assumption, MAX(t.cnt) AS cnt
                 FROM \`${topicTable}\` t
                 WHERE t.claim = ?
                 GROUP BY t.proposition, t.assumption
                 ORDER BY cnt DESC, t.proposition ASC, t.assumption ASC`,
                [opposingClaim]
            );
            opposingClaimSupportPairsAll = claimBSupportRows || [];

            let propsB = [];
            if (supportOrigin === "proposition" && focalAssumptionRaw) {
                const [countRows] = await pool.query(
                    `SELECT COUNT(DISTINCT p.proposition) AS total
                     FROM \`${contraryTable}\` c
                     JOIN \`${topicTable}\` p ON p.proposition = c.proposition
                     WHERE c.isContrary = 1
                       AND c.assumption = ?
                       AND p.claim = ?`,
                    [focalAssumptionRaw, opposingClaim]
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
                        [focalAssumptionRaw, opposingClaim]
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
                        [focalAssumptionRaw, opposingClaim, K]
                    );
                    propsB = rows;
                }
            } else {
                propsB = await fetchTopPropositionsByClaim(topicTable, opposingClaim, K);
                contraryCandidatesCount = propsB.length;
            }
            for (const r of propsB) {
                const pid = `${opposingClaimClusterId}::P::${r.proposition}`;
                addNode(pid, r.proposition, "proposition", opposingClaimClusterId, false, r.cnt);
                addEdge(pid, opposingClaimNodeId, "support");
            }

            // Level 4 assumptions are tied to opposing propositions that actually attack level-1 assumptions of the selected claim.
            assumpRowsB = await fetchTopAssumptionsByClaim(topicTable, opposingClaim, K);
            const propsBRaw = (propsB || []).map((r) => r.proposition).filter(Boolean);
            assumpRowsBForGraph = assumpRowsB;
            if (propsBRaw.length) {
                if (focusOnly) {
                    const claimBLower = String(opposingClaim || "").toLowerCase();
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
                            [opposingClaim, expectedAssumptions]
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
                        [propsBRaw, opposingClaim]
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
                        });
                    if (chosenRows.length) {
                        assumpRowsBForGraph = chosenRows;
                    } else {
                        const rows = await fetchAssumptionsAttackingPropositions(topicTable, contraryTable, opposingClaim, propsBRaw);
                        if (rows.length) assumpRowsBForGraph = rows;
                    }
                } else {
                    const rows = await fetchAssumptionsAttackingPropositions(topicTable, contraryTable, opposingClaim, propsBRaw);
                    if (rows.length) assumpRowsBForGraph = rows;
                }
            }
            for (const r of assumpRowsBForGraph) {
                const aid = `${opposingClaimClusterId}::A::${r.assumption}`;
                addNode(aid, r.assumption, "assumption", opposingClaimClusterId, false, r.cnt);
                addEdge(aid, opposingClaimNodeId, "support");
            }

            // Level 5-7 source: build the defense layer from propositions attacking rendered assumptionB.
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
                    [selectedClaim, assB]
                );
                selectedClaimDefenseAttackPairs = rowsPairs || [];
            }
        }

        for (const r of selectedClaimAssumptionRowsForGraph) {
            if (supportOrigin === "assumption" && r.assumption === supporting) continue;
            const aid = `${selectedClaimClusterId}::A::${r.assumption}`;
            addNode(aid, r.assumption, "assumption", selectedClaimClusterId, false, r.cnt);
            addEdge(aid, selectedClaimNodeId, "support");
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
            if (opposingClaim) {
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
                        if (opposingClaim && claimSrc && claimTgt) {
                            const allowedClaimsForEdges = new Set([selectedClaim, opposingClaim].filter(Boolean));
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
        const selectedClaimAssumptionRows = uniqueByLabelAndCount(selectedClaimAssumptionRowsForGraph || [], "assumption");
        const opposingClaimAssumptionRows = uniqueByLabelAndCount(assumpRowsBForGraph || [], "assumption");
        const opposingClaimPropositionRows = uniqueByLabelAndCount(
            allNodes
                .filter((node) => node.clusterId === `arg::${topic}::${supporting}::${opposingClaim}` && node.type === "proposition")
                .map((node) => ({ proposition: node.label, cnt: node.count })),
            "proposition"
        );
        const selectedClaimAssumptionLabels = selectedClaimAssumptionRows.map((row) => row.label);
        const selectedClaimPropositionRows = uniqueByLabelAndCount(
            allNodes
                .filter((node) => node.clusterId === selectedClaimClusterId && node.type === "proposition")
                .map((node) => ({ proposition: node.label, cnt: node.count })),
            "proposition"
        );
        const selectedClaimPropositionLabels = selectedClaimPropositionRows.map((row) => row.label);
        const opposingClaimPropositionLabels = opposingClaimPropositionRows.map((row) => row.label);
        const opposingClaimAssumptionLabels = opposingClaimAssumptionRows.map((row) => row.label);
        const layer1AttackPairs = findAttackPairsFromGraph(
            allNodes,
            allEdges,
            opposingClaimPropositionLabels,
            selectedClaimAssumptionLabels
        );
        const opposingClaimPropCountByLabel = new Map(opposingClaimPropositionRows.map((row) => [row.label, row.count]));
        const attackingOpposingClaimProps = opposingClaimPropositionRows.filter((row) =>
            layer1AttackPairs.some((pair) => pair.attacker === row.label)
        );
        const effectiveOpposingClaimProps = attackingOpposingClaimProps.length ? attackingOpposingClaimProps : opposingClaimPropositionRows;
        const opposingClaimLabelsForFramework = effectiveOpposingClaimProps.map((row) => row.label);
        const effectiveLayer1AttackPairs = layer1AttackPairs.filter((pair) => opposingClaimLabelsForFramework.includes(pair.attacker));

        const opposingClaimAssumptionLabelSet = new Set(opposingClaimAssumptionLabels);
        const selectedClaimPropCountByLabel = new Map(
            (selectedClaimPropositionsAll || []).map((row) => [String(row?.proposition || "").trim(), Number(row?.cnt || 0) || null])
        );
        const defensePropLabels = [...new Set(
            (selectedClaimDefenseAttackPairs || [])
                .filter((row) => opposingClaimAssumptionLabelSet.has(String(row?.assumption || "").trim()))
                .map((row) => String(row?.proposition || "").trim())
                .filter(Boolean)
        )];
        const defensePropRows = defensePropLabels.map((label) => ({
            label,
            count: selectedClaimPropCountByLabel.get(label) ?? null,
        }));
        const defenseSupportPairs = (selectedClaimSupportPairsAll || []).filter((row) =>
            defensePropLabels.includes(String(row?.proposition || "").trim())
        );
        const defenseAssumptionRows = uniqueByLabelAndCount(defenseSupportPairs, "assumption");
        const defenseAssumptionLabels = defenseAssumptionRows.map((row) => row.label);
        const defenseAttackPairs = [...new Set(
            (selectedClaimDefenseAttackPairs || [])
                .filter((row) => defensePropLabels.includes(String(row?.proposition || "").trim()))
                .filter((row) => opposingClaimAssumptionLabelSet.has(String(row?.assumption || "").trim()))
                .map((row) => `${String(row?.proposition || "").trim()}::${String(row?.assumption || "").trim()}`)
        )].map((key) => {
            const [attacker, target] = key.split("::");
            return { attacker, target };
        });
        const selectedClaimSupportPairsVisible = (selectedClaimSupportPairsAll || []).filter((row) =>
            selectedClaimPropositionLabels.includes(String(row?.proposition || "").trim()) &&
            selectedClaimAssumptionLabels.includes(String(row?.assumption || "").trim())
        );
        const opposingClaimSupportPairsVisible = (opposingClaimSupportPairsAll || []).filter((row) =>
            opposingClaimLabelsForFramework.includes(String(row?.proposition || "").trim()) &&
            opposingClaimAssumptionLabels.includes(String(row?.assumption || "").trim())
        );
        const defenseSupportPairsVisible = (defenseSupportPairs || []).filter((row) =>
            defensePropLabels.includes(String(row?.proposition || "").trim()) &&
            defenseAssumptionLabels.includes(String(row?.assumption || "").trim())
        );
        const defenseLayerLabel = (defensePropRows.length || defenseAssumptionRows.length)
            ? makeSyntheticDefenseLayerLabel(selectedClaim)
            : null;
        const isSyntheticDefenseLayer = Boolean(defenseLayerLabel);

        const frameworkCtx = createCanonicalFrameworkContext({
            topic,
            supporting,
            selectedClaim,
            opposingClaim: opposingClaim && opposingClaimLabelsForFramework.length ? opposingClaim : null,
            defenseLayerLabel,
        });

        registerFrameworkAtom(frameworkCtx, {
            label: selectedClaim,
            type: "claim",
            clusterClaim: selectedClaim,
            level: 0,
        });
        if (frameworkCtx.opposingClaim) {
            registerFrameworkAtom(frameworkCtx, {
                label: frameworkCtx.opposingClaim,
                type: "claim",
                clusterClaim: frameworkCtx.opposingClaim,
                level: 3,
            });
        }
        if (frameworkCtx.defenseLayerLabel) {
            registerFrameworkAtom(frameworkCtx, {
                label: frameworkCtx.defenseLayerLabel,
                type: "claim",
                clusterClaim: frameworkCtx.defenseLayerLabel,
                level: 6,
            });
        }

        if (supportOrigin === "proposition") {
            registerFrameworkAtom(frameworkCtx, {
                label: supporting,
                type: "proposition",
                clusterClaim: selectedClaim,
                count: supportCount,
                isFocus: true,
                level: 1,
            });
            registerSupportRule(
                frameworkCtx,
                { label: supporting, type: "proposition", clusterClaim: selectedClaim },
                { label: selectedClaim, type: "claim", clusterClaim: selectedClaim },
                1
            );
        } else {
            registerFrameworkAtom(frameworkCtx, {
                label: supporting,
                type: "assumption",
                clusterClaim: selectedClaim,
                count: supportCount,
                isFocus: true,
                level: 1,
            });
            registerSupportRule(
                frameworkCtx,
                { label: supporting, type: "assumption", clusterClaim: selectedClaim },
                { label: selectedClaim, type: "claim", clusterClaim: selectedClaim },
                1
            );
        }

        for (const row of selectedClaimAssumptionRows) {
            registerFrameworkAtom(frameworkCtx, {
                label: row.label,
                type: "assumption",
                clusterClaim: selectedClaim,
                count: row.count,
                isFocus: supportOrigin === "assumption" && row.label === supporting,
                level: 1,
            });
            registerSupportRule(
                frameworkCtx,
                { label: row.label, type: "assumption", clusterClaim: selectedClaim },
                { label: selectedClaim, type: "claim", clusterClaim: selectedClaim },
                1
            );
        }
        for (const row of selectedClaimSupportPairsVisible) {
            registerCompoundSupportRule(
                frameworkCtx,
                [
                    { label: row.proposition, type: "proposition", clusterClaim: selectedClaim },
                    { label: row.assumption, type: "assumption", clusterClaim: selectedClaim },
                ],
                { label: selectedClaim, type: "claim", clusterClaim: selectedClaim },
                1
            );
        }

        if (frameworkCtx.opposingClaim) {
            for (const row of effectiveOpposingClaimProps) {
                registerFrameworkAtom(frameworkCtx, {
                    label: row.label,
                    type: "proposition",
                    clusterClaim: frameworkCtx.opposingClaim,
                    count: row.count,
                    level: 2,
                });
                registerSupportRule(
                    frameworkCtx,
                    { label: row.label, type: "proposition", clusterClaim: frameworkCtx.opposingClaim },
                    { label: frameworkCtx.opposingClaim, type: "claim", clusterClaim: frameworkCtx.opposingClaim },
                    2
                );
            }
            for (const row of opposingClaimAssumptionRows) {
                registerFrameworkAtom(frameworkCtx, {
                    label: row.label,
                    type: "assumption",
                    clusterClaim: frameworkCtx.opposingClaim,
                    count: row.count,
                    level: 4,
                });
                registerSupportRule(
                    frameworkCtx,
                    { label: row.label, type: "assumption", clusterClaim: frameworkCtx.opposingClaim },
                    { label: frameworkCtx.opposingClaim, type: "claim", clusterClaim: frameworkCtx.opposingClaim },
                    4
                );
            }
            for (const pair of effectiveLayer1AttackPairs) {
                registerAttackPair(
                    frameworkCtx,
                    { label: pair.attacker, type: "proposition", clusterClaim: frameworkCtx.opposingClaim },
                    { label: pair.target, type: "assumption", clusterClaim: selectedClaim },
                    2
                );
            }
            for (const row of opposingClaimSupportPairsVisible) {
                registerCompoundSupportRule(
                    frameworkCtx,
                    [
                        { label: row.proposition, type: "proposition", clusterClaim: frameworkCtx.opposingClaim },
                        { label: row.assumption, type: "assumption", clusterClaim: frameworkCtx.opposingClaim },
                    ],
                    { label: frameworkCtx.opposingClaim, type: "claim", clusterClaim: frameworkCtx.opposingClaim },
                    4
                );
            }
            if (frameworkCtx.defenseLayerLabel) {
                for (const row of defensePropRows) {
                    registerFrameworkAtom(frameworkCtx, {
                        label: row.label,
                        type: "proposition",
                        clusterClaim: frameworkCtx.defenseLayerLabel,
                        count: row.count,
                        level: 5,
                    });
                    registerSupportRule(
                        frameworkCtx,
                        { label: row.label, type: "proposition", clusterClaim: frameworkCtx.defenseLayerLabel },
                        { label: frameworkCtx.defenseLayerLabel, type: "claim", clusterClaim: frameworkCtx.defenseLayerLabel },
                        5
                    );
                }
                for (const row of defenseAssumptionRows) {
                    registerFrameworkAtom(frameworkCtx, {
                        label: row.label,
                        type: "assumption",
                        clusterClaim: frameworkCtx.defenseLayerLabel,
                        count: row.count,
                        level: 7,
                    });
                    registerSupportRule(
                        frameworkCtx,
                        { label: row.label, type: "assumption", clusterClaim: frameworkCtx.defenseLayerLabel },
                        { label: frameworkCtx.defenseLayerLabel, type: "claim", clusterClaim: frameworkCtx.defenseLayerLabel },
                        7
                    );
                }
                for (const pair of defenseAttackPairs) {
                    registerAttackPair(
                        frameworkCtx,
                        { label: pair.attacker, type: "proposition", clusterClaim: frameworkCtx.defenseLayerLabel },
                        { label: pair.target, type: "assumption", clusterClaim: frameworkCtx.opposingClaim },
                        5
                    );
                }
                for (const row of defenseSupportPairsVisible) {
                    registerCompoundSupportRule(
                        frameworkCtx,
                        [
                            { label: row.proposition, type: "proposition", clusterClaim: frameworkCtx.defenseLayerLabel },
                            { label: row.assumption, type: "assumption", clusterClaim: frameworkCtx.defenseLayerLabel },
                        ],
                        { label: frameworkCtx.defenseLayerLabel, type: "claim", clusterClaim: frameworkCtx.defenseLayerLabel },
                        7
                    );
                }
            }
        }

        return {
            frameworkCtx,
            request: {
                topic,
                supporting,
                sentiment,
                semantics,
                strategy,
                attackMode,
                attackDepth,
                layerMode,
                focusOnly,
                showAllContrary,
                k: K,
            },
            meta: {
                selectedClaim,
                opposingClaim: frameworkCtx.opposingClaim || null,
                defenseLayerLabel: frameworkCtx.defenseLayerLabel || null,
                defenseLayerSynthetic: isSyntheticDefenseLayer,
                defenseLayerSourceClaim: selectedClaim,
                attackMode,
                attackDepth,
                layerMode,
                focusOnly,
                showAllContrary,
                semantics,
                strategy,
                contraryCandidatesCount,
                k: K,
                selectedClaimPropositionsAll: (selectedClaimPropositionsAll || []).map((r) => ({
                    proposition: r.proposition,
                    count: Number(r.cnt) || 0,
                })),
                selectedClaimSupportPairsAll: (selectedClaimSupportPairsAll || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                selectedClaimAssumptionsAll: (selectedClaimAssumptionsAll || []).map((r) => ({
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                opposingClaimSupportPairsAll: (opposingClaimSupportPairsAll || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                selectedClaimAttackPairs: (selectedClaimAttackPairs || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                })),
                selectedClaimDefenseAttackPairs: (selectedClaimDefenseAttackPairs || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
                defenseSupportPairs: (defenseSupportPairs || []).map((r) => ({
                    proposition: r.proposition,
                    assumption: r.assumption,
                    count: Number(r.cnt) || 0,
                })),
            },
        };
    } catch (err) {
        if (err && err.status) throw err;
        throw createHttpError(500, String(err));
    }
}

async function getAbaGraph(query) {
    const request = parseAbaGraphRequest(query || {});
    const canonical = await buildCanonicalFrameworkFromDb(request);
    const selection = selectFrameworkView(canonical.frameworkCtx, {
        layerMode: request.layerMode,
    });
    const graphBuild = buildGraphFromFrameworkSelection(canonical.frameworkCtx, selection);
    const frameworkBuild = buildPyArgPayloadFromFrameworkSelection(canonical.frameworkCtx, selection);
    const attackEdgesCount = graphBuild.edges.filter((edge) => edge?.data?.type === "attack").length;
    const attackersCount = [...new Set((selection.attackPairs || []).map((pair) => pair.attackerKey))].length;
    const targetsCount = [...new Set((selection.attackPairs || []).map((pair) => pair.targetKey))].length;

    return {
        clusters: graphBuild.clusters,
        nodes: graphBuild.nodes,
        edges: graphBuild.edges,
        displayRows: graphBuild.displayRows,
        framework: {
            payload: frameworkBuild.payload,
            warnings: frameworkBuild.warnings,
        },
        evaluation: null,
        meta: {
            ...canonical.meta,
            layerMode: selection.layerMode,
            layerMaxLevel: selection.maxLevel,
            attackEdgesCount,
            attackersCount,
            targetsCount,
            pyarg: null,
            pyargPayload: frameworkBuild.payload,
            pyargWarnings: frameworkBuild.warnings,
        },
    };
}

    async function evaluatePyArg(body) {
        const result = await runPyArgEvaluation(body || {});
        return sanitizePyArgResult(result);
    }

    async function createPyArgEvaluationJob(body) {
        const job = await createJob(JOB_TYPE_PYARG, PYARG_JOB_TTL_MS, body || {});

        Promise.resolve()
            .then(async () => {
                await markJobRunning(JOB_TYPE_PYARG, job.id, PYARG_JOB_TTL_MS);
                try {
                    const result = await evaluatePyArg(body || {});
                    if (result && result.error) {
                        await markJobFailed(JOB_TYPE_PYARG, job.id, String(result.error || "PyArg evaluation failed"), PYARG_JOB_TTL_MS);
                    } else {
                        await markJobDone(JOB_TYPE_PYARG, job.id, result, PYARG_JOB_TTL_MS);
                    }
                } catch (err) {
                    await markJobFailed(JOB_TYPE_PYARG, job.id, String(err?.message || err || "PyArg evaluation failed"), PYARG_JOB_TTL_MS);
                } finally {
                    await pruneJobs(JOB_TYPE_PYARG, PYARG_JOB_TTL_MS, PYARG_JOB_MAX);
                }
            })
            .catch(async () => {
                try {
                    await markJobFailed(JOB_TYPE_PYARG, job.id, "Unhandled PyArg job error", PYARG_JOB_TTL_MS);
                } catch (markErr) {
                    console.error("[jobs] failed to mark unhandled PyArg job error:", markErr);
                }
            });

        return mapJobRowForResponse(job, "PyArg job failed");
    }

    async function getPyArgEvaluationJob(jobId) {
        const id = String(jobId || "").trim();
        if (!id) return null;
        const job = await getJob(JOB_TYPE_PYARG, id);
        if (!job) return null;
        return mapJobRowForResponse(job, "PyArg job failed");
    }

    async function generateLlmExplanation(body) {
        const provider = String(process.env.LLM_PROVIDER || "ollama").trim().toLowerCase();
        if (provider && provider !== "ollama") {
            throw new Error(`Unsupported LLM_PROVIDER '${provider}'. Only 'ollama' is supported.`);
        }
        const prompts = buildTranslatePrompt(body || {});
        const startedAt = Date.now();

        const rawModel = String(body?.model || process.env.OLLAMA_TRANSLATE_MODEL || "qwen2.5:7b").trim();
        const allowedModels = new Set(["gemma3:4b", "deepseek-r1:7b", "qwen2.5:7b"]);
        const model = allowedModels.has(rawModel) ? rawModel : "qwen2.5:7b";
        const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
        const text = await translateWithOllama({
            baseUrl,
            model,
            systemPrompt: prompts.systemPrompt,
            userPrompt: prompts.userPrompt,
        });
        return {
            text,
            provider: "ollama",
            model,
            elapsed_ms: Math.max(0, Date.now() - startedAt),
        };
    }

    async function createLlmExplanationJob(body) {
        const job = await createJob(JOB_TYPE_LLM, LLM_JOB_TTL_MS, body || {});

        Promise.resolve()
            .then(async () => {
                await markJobRunning(JOB_TYPE_LLM, job.id, LLM_JOB_TTL_MS);
                try {
                    const result = await generateLlmExplanation(body || {});
                    await markJobDone(JOB_TYPE_LLM, job.id, result, LLM_JOB_TTL_MS);
                } catch (err) {
                    await markJobFailed(JOB_TYPE_LLM, job.id, String(err?.message || err || "LLM job failed"), LLM_JOB_TTL_MS);
                } finally {
                    await pruneJobs(JOB_TYPE_LLM, LLM_JOB_TTL_MS, LLM_JOB_MAX);
                }
            })
            .catch(async () => {
                try {
                    await markJobFailed(JOB_TYPE_LLM, job.id, "Unhandled LLM job error", LLM_JOB_TTL_MS);
                } catch (markErr) {
                    console.error("[jobs] failed to mark unhandled LLM job error:", markErr);
                }
            });

        return mapJobRowForResponse(job, "LLM job failed");
    }

    async function getLlmExplanationJob(jobId) {
        const id = String(jobId || "").trim();
        if (!id) return null;
        const job = await getJob(JOB_TYPE_LLM, id);
        if (!job) return null;
        return mapJobRowForResponse(job, "LLM job failed");
    }

    return {
        getAbaGraph,
        evaluatePyArg,
        createPyArgEvaluationJob,
        getPyArgEvaluationJob,
        generateLlmExplanation,
        createLlmExplanationJob,
        getLlmExplanationJob,
    };
}

module.exports = {
    createAbaGraphService,
};

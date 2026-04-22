(function () {
  const svg = document.getElementById("main-graph-canvas");
  const metaEl = document.getElementById("graph-meta");
  const jsonOutputEl = document.getElementById("json-output");
  const preferredMetaEl = document.getElementById("preferred-meta");
  const preferredOutputEl = document.getElementById("preferred-output");
  const payloadJsonOutputEl = document.getElementById("payload-json-output");
  
  const backLink = document.getElementById("back-link");
  const toggleAllBtn = document.getElementById("toggle-all-btn");
  const statTopicEl = document.getElementById("stat-topic");
  const statSentimentEl = document.getElementById("stat-sentiment");
  const statClaimEl = document.getElementById("stat-claim");
  const statSupportingEl = document.getElementById("stat-supporting");
  const statAttacksEl = document.getElementById("stat-attacks");
  const statSemanticsEl = document.getElementById("stat-semantics");
  const semanticsTitleEl = document.getElementById("semantics-title");
  const layerModeSelectEl = document.getElementById("layer-mode-select");
  const semanticsSelectEl = document.getElementById("semantics-select");
  const strategySelectEl = document.getElementById("strategy-select");
  const llmModelSelectEls = Array.from(document.querySelectorAll("[data-llm-model-select]"));
  const extensionListEl = document.getElementById("extension-list");
  const extensionNaturalLanguageEl = document.getElementById("extension-natural-language");
  const extensionNaturalMetaEl = document.getElementById("extension-natural-meta");
  const acceptedAssumptionsEl = document.getElementById("accepted-assumptions");
  const acceptedNaturalLanguageEl = document.getElementById("accepted-natural-language");
  const acceptedNaturalMetaEl = document.getElementById("accepted-natural-meta");
  const graphSummaryTextEl = document.getElementById("graph-summary-text");
  const graphSummaryMetaEl = document.getElementById("graph-summary-meta");
  const graphZoomOutBtnEl = document.getElementById("graph-zoom-out-btn");
  const graphZoomInBtnEl = document.getElementById("graph-zoom-in-btn");
  const graphFitBtnEl = document.getElementById("graph-fit-btn");
  const graphFullscreenBtnEl = document.getElementById("graph-fullscreen-btn");
  const graphWorkspacePanelEl = document.querySelector(".graph-workspace-panel");
  const sidebarStackEl = document.querySelector(".sidebar-stack");
  const graphSummaryCardEl = sidebarStackEl ? sidebarStackEl.querySelector(".sidebar-card") : null;
  const graphDefinitionCardEl = sidebarStackEl ? sidebarStackEl.querySelector(".mini-guide-card.step-guide") : null;
  const graphDefinitionListEl = graphDefinitionCardEl
    ? graphDefinitionCardEl.querySelector(".graph-definition-list")
    : null;
  const nodeTypesCardEl = document.getElementById("node-types-card");

  const SUPPORTED_SEMANTICS = [
    "Stable",
    "Preferred",
    "Conflict-Free",
    "Naive",
    "Admissible",
    "Complete",
    "SemiStable",
    "Grounded",
  ];
  const SUPPORTED_STRATEGIES = ["Credulous", "Skeptical"];
  const SUPPORTED_LAYER_MODES = ["layer1", "layer2"];
  const SUPPORTED_LLM_MODELS = ["gemma3:4b", "deepseek-r1:7b", "qwen2.5:7b"];

  const params = new URLSearchParams(window.location.search);
  const topic = String(params.get("topic") || "").trim();
  const sentiment = String(params.get("sentiment") || "all").trim();
  const supporting = String(params.get("supporting") || "").trim();
  const selectedTopicLabel = String(params.get("selected_topic") || topic || "").trim();
  const attackMode = String(params.get("attack_mode") || "all").trim().toLowerCase();
  const attackDepth = String(params.get("attack_depth") || "1").trim();
  const focusOnly = String(params.get("focus_only") || "1").trim().toLowerCase();
  let selectedLayerMode = String(params.get("layer_mode") || "layer2").trim().toLowerCase();
  if (!SUPPORTED_LAYER_MODES.includes(selectedLayerMode)) selectedLayerMode = "layer2";
  let showAllContrary = String(params.get("show_all_contrary") || "1").trim().toLowerCase();
  let selectedSemantics = String(params.get("semantics") || "Preferred").trim();
  if (!SUPPORTED_SEMANTICS.includes(selectedSemantics)) selectedSemantics = "Preferred";
  let selectedStrategy = String(params.get("strategy") || "Credulous").trim();
  if (!SUPPORTED_STRATEGIES.includes(selectedStrategy)) selectedStrategy = "Credulous";
  let selectedLlmModel = String(params.get("llm_model") || "gemma3:4b").trim();
  if (!SUPPORTED_LLM_MODELS.includes(selectedLlmModel)) selectedLlmModel = "gemma3:4b";
  let lastLoadedGraph = null;
  let lastSemanticsResult = null;
  let lastSemanticsPayload = null;
  let preferredRequestSeq = 0;
  let llmRequestSeq = 0;
  let graphSummarySeq = 0;
  const semanticsResultCache = new Map();
  const graphSummaryPending = new Map();
  const llmJobPendingByKey = new Map();
  const pyargJobPendingByKey = new Map();
  const API_TIMEOUT_MS = 12000;
  const PYARG_TIMEOUT_MS = 0;
  const PYARG_JOB_POLL_INTERVAL_MS = 3000;
  const PYARG_JOB_POLL_TIMEOUT_MS = 1800000;
  const LLM_JOB_POLL_INTERVAL_MS = 1200;
  const LLM_JOB_POLL_TIMEOUT_MS = 120000;
  const JOB_NOT_FOUND_RECREATE_MAX = 0;
  const apiClient = window.createApiClient({
    params,
    defaultTimeoutMs: API_TIMEOUT_MS,
    timeoutResolver: (path) =>
      String(path || "").startsWith("/api/pyarg/evaluate?")
        || String(path || "").trim() === "/api/pyarg/evaluate"
        ? PYARG_TIMEOUT_MS
        : API_TIMEOUT_MS,
  });
  const { apiFetch } = apiClient;
  let layoutSyncRaf = 0;

  function syncWorkspaceSidebarHeight() {
    if (!graphWorkspacePanelEl || !sidebarStackEl) return;
    if (window.innerWidth < 1080) {
      sidebarStackEl.style.height = "";
      sidebarStackEl.style.maxHeight = "";
      if (graphDefinitionListEl) graphDefinitionListEl.style.maxHeight = "";
      return;
    }

    const targetHeight = Math.max(0, Math.floor(graphWorkspacePanelEl.getBoundingClientRect().height));
    if (!targetHeight) return;

    if (!graphDefinitionCardEl || !graphDefinitionListEl) {
      sidebarStackEl.style.height = "";
      sidebarStackEl.style.maxHeight = "";
      return;
    }

    sidebarStackEl.style.height = `${targetHeight}px`;
    sidebarStackEl.style.maxHeight = `${targetHeight}px`;

    if (!graphDefinitionListEl || !graphDefinitionCardEl || !graphSummaryCardEl || !nodeTypesCardEl) return;

    const gap = parseFloat(window.getComputedStyle(sidebarStackEl).rowGap || "0") || 0;
    const summaryHeight = Math.ceil(graphSummaryCardEl.getBoundingClientRect().height);
    const nodeTypesHeight = Math.ceil(nodeTypesCardEl.getBoundingClientRect().height);
    const defCardHeight = Math.ceil(graphDefinitionCardEl.getBoundingClientRect().height);
    const defListHeight = Math.ceil(graphDefinitionListEl.getBoundingClientRect().height);
    const defCardChrome = Math.max(0, defCardHeight - defListHeight);
    const availableListHeight = Math.floor(
      targetHeight - summaryHeight - nodeTypesHeight - (gap * 2) - defCardChrome
    );
    const minListHeight = 140;
    graphDefinitionListEl.style.maxHeight = `${Math.max(minListHeight, availableListHeight)}px`;
  }

  function scheduleWorkspaceLayoutSync() {
    if (layoutSyncRaf) cancelAnimationFrame(layoutSyncRaf);
    layoutSyncRaf = window.requestAnimationFrame(() => {
      layoutSyncRaf = 0;
      syncWorkspaceSidebarHeight();
    });
  }

  function renderMainGraphMessage(title, detail, tone = "error") {
    if (!svg) return;
    const width = 1280;
    const height = 540;
    const titleColor = tone === "error" ? "#7f1d1d" : "#1f2937";
    const detailColor = tone === "error" ? "#4b5563" : "#374151";
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const g = createSvgEl("g", {});
    const titleEl = createSvgEl("text", {
      x: width / 2,
      y: height / 2 - 14,
      "text-anchor": "middle",
      "font-size": 22,
      "font-weight": 700,
      fill: titleColor,
    });
    titleEl.textContent = String(title || "Graph unavailable");
    const detailEl = createSvgEl("text", {
      x: width / 2,
      y: height / 2 + 18,
      "text-anchor": "middle",
      "font-size": 14,
      "font-weight": 500,
      fill: detailColor,
    });
    detailEl.textContent = String(detail || "");
    g.appendChild(titleEl);
    g.appendChild(detailEl);
    svg.appendChild(g);
  }

  if (!topic || !supporting) {
    metaEl.textContent = "Missing query params: topic and supporting are required.";
    if (preferredMetaEl) preferredMetaEl.textContent = metaEl.textContent;
    renderMainGraphMessage("Missing query params", "Please open from Review page so topic/supporting are included.");
    return;
  }

  const backParams = new URLSearchParams();
  backParams.set("type", String(sentiment || "").toLowerCase());
  if (selectedTopicLabel) backParams.set("topic", selectedTopicLabel);
  backLink.href = `./review_category.html?${backParams.toString()}`;
  metaEl.textContent = `topic=${topic}, sentiment=${sentiment}, supporting=${supporting}, layer_mode=${selectedLayerMode}, attack_mode=${attackMode}, attack_depth=${attackDepth}, focus_only=${focusOnly}`;

  function setToggleButton(meta) {
    if (!toggleAllBtn || !meta) return;
    // Always show all contrary from "Show" entrypoint; hide toggle to prevent accidental top-K switch.
    toggleAllBtn.hidden = false;
    toggleAllBtn.style.display = "none";
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value == null ? "-" : String(value);
  }

  function updateSemanticsHeader() {
    const semanticsName = selectedSemantics || "Preferred";
    if (semanticsTitleEl) semanticsTitleEl.textContent = `Main Graph (${semanticsName})`;
    if (statSemanticsEl) setText(statSemanticsEl, semanticsName);
  }

  function setNaturalLanguageOutput(text, meta = "") {
    if (extensionNaturalLanguageEl) {
      extensionNaturalLanguageEl.textContent = text == null || text === "" ? "-" : String(text);
    }
    if (extensionNaturalMetaEl) {
      extensionNaturalMetaEl.textContent = meta;
    }
  }

  function setGraphSummaryOutput(text, meta = "") {
    if (graphSummaryTextEl) {
      graphSummaryTextEl.textContent = text == null || text === "" ? "-" : String(text);
    }
    if (graphSummaryMetaEl) {
      graphSummaryMetaEl.textContent = meta;
    }
    scheduleWorkspaceLayoutSync();
  }

  function setAcceptedNaturalLanguageOutput(text, meta = "") {
    if (acceptedNaturalLanguageEl) {
      acceptedNaturalLanguageEl.textContent = text == null || text === "" ? "-" : String(text);
    }
    if (acceptedNaturalMetaEl) {
      acceptedNaturalMetaEl.textContent = meta;
    }
  }

  function setLlmWaitingForSemantics() {
    setNaturalLanguageOutput(
      "Waiting for semantics evaluation...",
      "LLM will start after semantics are ready."
    );
    setAcceptedNaturalLanguageOutput(
      "Waiting for semantics evaluation...",
      "LLM will start after semantics are ready."
    );
  }

  function buildFallbackGraphSummary() {
    const nodes = (lastLoadedGraph?.nodes || []).map((n) => n?.data || n).filter(Boolean);
    const assumptions = nodes.filter((n) => String(n?.type || "") === "assumption");
    const claims = nodes.filter((n) => String(n?.type || "") === "claim");
    const supportCount = (lastLoadedGraph?.edges || []).filter((e) => String((e?.data || e)?.type || "") === "support").length;
    const attackCount = (lastLoadedGraph?.edges || []).filter((e) => String((e?.data || e)?.type || "") === "attack").length;
    if (!nodes.length) return "-";
    const lines = [
      `- This graph contains ${nodes.length} node(s), including ${claims.length} main claim node(s) and ${assumptions.length} assumption node(s).`,
      `- There are ${supportCount} supporting link(s) and ${attackCount} conflicting link(s).`,
      "- This summary is based on the current graph structure rather than a specific semantics filter.",
      "- Focus on how supporting and conflicting links shape the final interpretation.",
    ];
    return lines.join("\n");
  }

  function formatLlmMeta(data) {
    const provider = String(data?.provider || "ollama").trim();
    const model = String(data?.model || selectedLlmModel || "").trim();
    const parts = [model ? `${provider}:${model}` : provider];
    const elapsedMs = Number(data?.elapsed_ms);
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      parts.push(`elapsed=${formatDurationMs(elapsedMs)}`);
    }
    return parts.join(", ");
  }

  function buildGraphSummaryCacheKey(nodes, edges) {
    return JSON.stringify({
      topic,
      sentiment,
      supporting,
      layerMode: selectedLayerMode,
      attackMode,
      attackDepth,
      focusOnly,
      showAllContrary,
      model: selectedLlmModel,
      nodes: Array.isArray(nodes)
        ? nodes.map((n) => ({
            id: n?.id || "",
            type: n?.type || "",
            label: n?.label || "",
            clusterSentiment: n?.clusterSentiment || "",
            count: n?.count ?? null,
          }))
        : [],
      edges: Array.isArray(edges)
        ? edges.map((e) => ({
            source: e?.source || "",
            target: e?.target || "",
            type: e?.type || "",
          }))
        : [],
    });
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  async function requestLlmExplanationJob(payload) {
    const payloadObj = payload || {};
    const payloadKey = stableStringify(payloadObj);
    const existing = llmJobPendingByKey.get(payloadKey);
    if (existing) return existing;

    const pending = (async () => {
      async function createLlmJob() {
        const createResp = await apiFetch("/api/llm/translate-extension/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadObj),
        });
        const created = await createResp.json();
        if (!createResp.ok || !created?.job_id) {
          throw new Error(created?.error || "Failed to create LLM job");
        }
        const id = String(created.job_id || "").trim();
        if (!id) throw new Error("Invalid LLM job id");
        return id;
      }

      let recreateCount = 0;
      let jobId = await createLlmJob();
      const deadline = Date.now() + LLM_JOB_POLL_TIMEOUT_MS;

      while (Date.now() <= deadline) {
        const statusResp = await apiFetch(
          `/api/llm/translate-extension/jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`,
          {
          method: "GET",
          cache: "no-store",
          timeoutMs: 15000,
        });
        const statusData = await statusResp.json();
        if (!statusResp.ok) {
          if (statusResp.status === 404 && recreateCount < JOB_NOT_FOUND_RECREATE_MAX) {
            recreateCount += 1;
            jobId = await createLlmJob();
            await waitMs(LLM_JOB_POLL_INTERVAL_MS);
            continue;
          }
          throw new Error(statusData?.error || "Failed to fetch LLM job status");
        }
        const status = String(statusData?.status || "").trim().toLowerCase();
        if (status === "done") {
          if (!statusData?.result?.text) throw new Error("LLM job completed without content");
          return statusData.result;
        }
        if (status === "failed") {
          throw new Error(statusData?.error || "LLM job failed");
        }
        await waitMs(LLM_JOB_POLL_INTERVAL_MS);
      }

      throw new Error("LLM job polling timed out");
    })()
      .finally(() => {
        llmJobPendingByKey.delete(payloadKey);
      });

    llmJobPendingByKey.set(payloadKey, pending);
    return pending;
  }

  async function requestPyArgEvaluationJob(payload, options = {}) {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const payloadObj = payload || {};
    const payloadKey = stableStringify(payloadObj);
    const existing = pyargJobPendingByKey.get(payloadKey);
    if (existing) {
      if (onProgress) {
        onProgress({
          status: "running",
          jobId: existing.jobId || null,
          elapsedMs: Math.max(0, Date.now() - existing.startedAt),
        });
      }
      return existing.promise;
    }

    const state = {
      jobId: null,
      startedAt: Date.now(),
      promise: null,
    };

    state.promise = (async () => {
      async function createPyArgJob() {
        const createResp = await apiFetch("/api/pyarg/evaluate/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeoutMs: 15000,
          body: JSON.stringify(payloadObj),
        });
        const created = await createResp.json();
        if (!createResp.ok || !created?.job_id) {
          throw new Error(created?.error || "Failed to create PyArg job");
        }
        const id = String(created.job_id || "").trim();
        if (!id) throw new Error("Invalid PyArg job id");
        return id;
      }

      let recreateCount = 0;
      let jobId = await createPyArgJob();
      state.jobId = jobId;
      const deadline = Date.now() + PYARG_JOB_POLL_TIMEOUT_MS;
      if (onProgress) onProgress({ status: "queued", jobId, elapsedMs: 0 });

      while (Date.now() <= deadline) {
        const statusResp = await apiFetch(
          `/api/pyarg/evaluate/jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`,
          {
          method: "GET",
          cache: "no-store",
          timeoutMs: 15000,
        });
        const statusData = await statusResp.json();
        if (!statusResp.ok) {
          if (statusResp.status === 404 && recreateCount < JOB_NOT_FOUND_RECREATE_MAX) {
            recreateCount += 1;
            jobId = await createPyArgJob();
            state.jobId = jobId;
            if (onProgress) {
              onProgress({
                status: "requeued",
                jobId,
                elapsedMs: Math.max(0, Date.now() - state.startedAt),
              });
            }
            await waitMs(PYARG_JOB_POLL_INTERVAL_MS);
            continue;
          }
          throw new Error(statusData?.error || "Failed to fetch PyArg job status");
        }
        const status = String(statusData?.status || "").trim().toLowerCase();
        if (onProgress) {
          onProgress({
            status: status || "running",
            jobId,
            elapsedMs: Math.max(0, Date.now() - state.startedAt),
          });
        }
        if (status === "done") {
          if (!statusData?.result) throw new Error("PyArg job completed without result");
          return statusData.result;
        }
        if (status === "failed") {
          throw new Error(statusData?.error || "PyArg job failed");
        }
        await waitMs(PYARG_JOB_POLL_INTERVAL_MS);
      }

      throw new Error("PyArg job polling timed out");
    })()
      .finally(() => {
        pyargJobPendingByKey.delete(payloadKey);
      });

    pyargJobPendingByKey.set(payloadKey, state);
    return state.promise;
  }

  async function summarizeGraphForUsers(requestId = graphSummarySeq) {
    if (!graphSummaryTextEl) return;
    const nodes = (lastLoadedGraph?.nodes || []).map((n) => n?.data || n).filter(Boolean);
    const edges = (lastLoadedGraph?.edges || []).map((e) => e?.data || e).filter(Boolean);
    const supportCount = edges.filter((e) => String(e?.type || "") === "support").length;
    const attackCount = edges.filter((e) => String(e?.type || "") === "attack").length;
    if (!nodes.length) {
      setGraphSummaryOutput("-", "");
      return;
    }
    const cacheKey = buildGraphSummaryCacheKey(nodes, edges);
    setGraphSummaryOutput("LLM is evaluating this graph for users...", `${selectedLlmModel} is processing...`);
    try {
      let pending = graphSummaryPending.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const data = await requestLlmExplanationJob({
            task: "graph_summary",
            model: selectedLlmModel,
            topic,
            sentiment,
            supporting,
            graphNodes: nodes.map((n) => ({
              id: n.id,
              type: n.type,
              label: n.label,
              clusterSentiment: n.clusterSentiment,
              count: n.count,
            })),
            graphEdges: edges.map((e) => ({
              source: e.source,
              target: e.target,
              type: e.type,
            })),
            graphEdgeStats: {
              total: edges.length,
              support: supportCount,
              attack: attackCount,
            },
            outputLanguage: "en",
          });
          return {
            text: String(data.text || "-"),
            meta: formatLlmMeta(data),
          };
        })()
          .finally(() => {
            graphSummaryPending.delete(cacheKey);
          });
        graphSummaryPending.set(cacheKey, pending);
      }
      const entry = await pending;
      if (requestId !== graphSummarySeq) return;
      setGraphSummaryOutput(String(entry.text || "-"), String(entry.meta || ""));
    } catch (err) {
      if (requestId !== graphSummarySeq) return;
      console.error(err);
      setGraphSummaryOutput(buildFallbackGraphSummary(), "LLM unavailable");
    }
  }

  async function explainFormalSemantics(result) {
    if (!extensionNaturalLanguageEl) return;
    lastSemanticsResult = result || null;
    const extensions = getCurrentExplanationExtensions(result);
    const acceptedAssumptions = getCurrentExplanationAcceptedAssumptions(result);
    const requestId = ++llmRequestSeq;
    if (!extensions.length) {
      setNaturalLanguageOutput("-", "");
      setAcceptedNaturalLanguageOutput("-", "");
      return;
    }
    setNaturalLanguageOutput("LLM is evaluating the current extension set...", `${selectedLlmModel} is processing...`);
    try {
      const currentExtensionText = extensions.map((ext) => `{${ext.join(", ")}}`).join("\n");
      const data = await requestLlmExplanationJob({
        task: "translate_current_extension",
        model: selectedLlmModel,
        topic,
        sentiment,
        supporting,
        semantics: selectedSemantics,
        strategy: selectedStrategy,
        extensions,
        acceptedAssumptions,
        currentExtensionText,
        outputLanguage: "en",
      });
      if (requestId !== llmRequestSeq) return;
      if (!data?.text) throw new Error("Translation API failed");
      setNaturalLanguageOutput(String(data.text || "-"), formatLlmMeta(data));
    } catch (err) {
      if (requestId !== llmRequestSeq) return;
      console.error(err);
      setNaturalLanguageOutput("Cannot explain the formal semantics right now.", "LLM unavailable");
    }
  }

  function normalizeExtensions(extensions) {
    if (!Array.isArray(extensions)) return [];
    return extensions
      .filter((ext) => Array.isArray(ext))
      .map((ext) => ext.map((x) => String(x)).filter(Boolean));
  }

  function makeHelperContraryAtom(assumption) {
    return `__ctr__${String(assumption || "").trim()}`;
  }

  function getHelperContrarySet(payload) {
    const values = Object.values(payload?.helperContraries || {});
    return new Set(values.map((x) => String(x || "").trim()).filter(Boolean));
  }

  function filterExtensionsForDisplay(extensions, payload) {
    const helperContrarySet = getHelperContrarySet(payload);
    const assumptionsSet = new Set((payload?.assumptions || []).map((x) => String(x || "").trim()).filter(Boolean));
    return normalizeExtensions(extensions).map((ext) =>
      ext.filter((item) => {
        const value = String(item || "").trim();
        if (!value) return false;
        if (helperContrarySet.has(value) || value.startsWith("__ctr__")) return false;
        if (assumptionsSet.size && !assumptionsSet.has(value)) return false;
        return true;
      })
    );
  }

  function getExtensionSetsForDisplay(result) {
    const rawExts = normalizeExtensions(result?.raw_extensions);
    if (rawExts.length) return rawExts;
    return normalizeExtensions(result?.extensions);
  }

  function getCurrentExplanationExtensions(result) {
    const filteredExts = filterExtensionsForDisplay(result?.extensions, lastSemanticsPayload);
    return filteredExts.length ? filteredExts : [];
  }

  function getCurrentExplanationAcceptedAssumptions(result) {
    const currentExts = getCurrentExplanationExtensions(result);
    return computeAcceptedAssumptions(currentExts, selectedStrategy);
  }

  function computeAcceptedAssumptions(extensions, strategy) {
    const normalized = normalizeExtensions(extensions);
    if (!normalized.length) return [];
    if (strategy === "Skeptical") {
      const base = new Set(normalized[0]);
      for (let i = 1; i < normalized.length; i += 1) {
        const next = new Set(normalized[i]);
        for (const item of [...base]) {
          if (!next.has(item)) base.delete(item);
        }
      }
      return [...base].sort((a, b) => a.localeCompare(b));
    }
    const out = new Set();
    for (const ext of normalized) {
      for (const item of ext) out.add(item);
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  function renderTokens(container, values, emptyLabel) {
    if (!container) return;
    container.innerHTML = "";
    const items = Array.isArray(values) ? values : [];
    if (!items.length) {
      const token = document.createElement("span");
      token.className = "token";
      token.textContent = emptyLabel || "-";
      container.appendChild(token);
      return;
    }
    for (const value of items) {
      const token = document.createElement("span");
      token.className = "token";
      token.textContent = String(value);
      container.appendChild(token);
    }
  }

  function setPayloadJsonOutput(value) {
    if (!payloadJsonOutputEl) return;
    payloadJsonOutputEl.textContent = value == null || value === "" ? "-" : String(value);
  }

  function buildSemanticsCacheKey(payload) {
    return JSON.stringify({
      topic,
      sentiment,
      supporting,
      layerMode: selectedLayerMode,
      semantics: payload?.semantics_specification || selectedSemantics,
      strategy: payload?.strategy_specification || selectedStrategy,
      attackMode,
      attackDepth,
      focusOnly,
      showAllContrary,
      query: payload?.query || null,
      language: Array.isArray(payload?.language) ? payload.language : [],
      assumptions: Array.isArray(payload?.assumptions) ? payload.assumptions : [],
      contraries: payload?.contraries || {},
      rules: Array.isArray(payload?.rules)
        ? payload.rules.map((rule) => ({
            premises: Array.isArray(rule?.premises) ? rule.premises : [],
            conclusion: rule?.conclusion || "",
          }))
        : [],
    });
  }

  function buildCachedSemanticsDisplay(result) {
    const displayedExts = getExtensionSetsForDisplay(result);
    return {
      extensionLabels: displayedExts.length
        ? displayedExts.map((ext) => `{${ext.join(", ")}}`)
        : ["{}"],
      acceptedAssumptions: getCurrentExplanationAcceptedAssumptions(result),
      summary: buildSemanticsSummary(result),
    };
  }

  function renderCachedSemanticsDisplay(display) {
    renderTokens(extensionListEl, display?.extensionLabels || ["{}"], "{}");
    renderTokens(acceptedAssumptionsEl, display?.acceptedAssumptions || [], "-");
  }

  function setSemanticsWaitingDisplay() {
    renderTokens(
      extensionListEl,
      ["Waiting for semantics evaluation..."],
      "Waiting for semantics evaluation..."
    );
    renderTokens(
      acceptedAssumptionsEl,
      ["Waiting for semantics evaluation..."],
      "Waiting for semantics evaluation..."
    );
  }

  function renderFilterResults(result) {
    const displayedExts = getExtensionSetsForDisplay(result);
    const extensionLabels = displayedExts.length
      ? displayedExts.map((ext) => `{${ext.join(", ")}}`)
      : ["{}"];
    const accepted = getCurrentExplanationAcceptedAssumptions(result);
    renderTokens(extensionListEl, extensionLabels, "{}");
    renderTokens(acceptedAssumptionsEl, accepted, "-");
  }

  function buildSemanticsSummary(result) {
    const displayedExts = getExtensionSetsForDisplay(result);
    const accepted = getCurrentExplanationAcceptedAssumptions(result);
    const extensionCount = Number(result?.count);
    const safeExtensionCount = Number.isFinite(extensionCount) ? extensionCount : displayedExts.length;
    const elapsedMs = Number(result?.elapsed_ms);
    const parts = [
      `extensions=${safeExtensionCount}`,
      `accepted=${accepted.length}`,
      `strategy=${selectedStrategy}`,
      `credulous=${result?.credulous == null ? "-" : String(result.credulous)}`,
      `skeptical=${result?.skeptical == null ? "-" : String(result.skeptical)}`,
    ];
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      parts.push(`elapsed=${formatDurationMs(elapsedMs)}`);
    }
    return parts.join(", ");
  }

  function formatDurationMs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return "-";
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`;
  }

  const BASE_CANVAS_WIDTH = 1560;
  const BASE_CANVAS_HEIGHT = 900;
  const view = { x: 0, y: 0, scale: 1 };

  const nodePos = new Map();
  const nodeById = new Map();
  const nodeMetrics = new Map();
  const connectedByNode = new Map();
  const LEVEL5 = 5;
  let scene = null;

  const LOCK_AUTO_LAYOUT = false;
  function createSvgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  const textMeasureCanvas = document.createElement("canvas");
  const textMeasureCtx = textMeasureCanvas.getContext("2d");

  function measureTextWidth(text, fontSize = 13, fontWeight = 500) {
    if (!textMeasureCtx) return String(text || "").length * fontSize * 0.58;
    textMeasureCtx.font = `${fontWeight} ${fontSize}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
    return textMeasureCtx.measureText(String(text || "")).width;
  }

  function fitTextWithEllipsis(text, maxWidth, fontSize, fontWeight) {
    const raw = String(text || "");
    if (measureTextWidth(raw, fontSize, fontWeight) <= maxWidth) return raw;
    const ell = "...";
    let out = raw;
    while (out.length > 0 && measureTextWidth(`${out}${ell}`, fontSize, fontWeight) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}${ell}`;
  }

  function wrapTextWithMaxWidth(text, maxWidth, fontSize = 13, fontWeight = 500, maxLines = 3) {
    const display = String(text || "");
    const words = display.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];

    function splitLongToken(token) {
      const chunks = [];
      let current = "";
      for (const ch of token) {
        const trial = `${current}${ch}`;
        if (!current || measureTextWidth(trial, fontSize, fontWeight) <= maxWidth) {
          current = trial;
        } else {
          chunks.push(current);
          current = ch;
        }
      }
      if (current) chunks.push(current);
      return chunks;
    }

    const lines = [];
    let line = "";
    let truncated = false;
    for (const word of words) {
      if (measureTextWidth(word, fontSize, fontWeight) > maxWidth) {
        if (line) {
          lines.push(line);
          line = "";
          if (lines.length >= maxLines) {
            truncated = true;
            break;
          }
        }
        const parts = splitLongToken(word);
        for (let i = 0; i < parts.length; i += 1) {
          const part = parts[i];
          const isLast = i === parts.length - 1;
          if (!isLast) {
            lines.push(part);
            if (lines.length >= maxLines) {
              truncated = true;
              break;
            }
          } else {
            line = part;
          }
        }
        if (truncated) break;
        continue;
      }

      const trial = line ? `${line} ${word}` : word;
      if (measureTextWidth(trial, fontSize, fontWeight) <= maxWidth) {
        line = trial;
        continue;
      }
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) {
        truncated = true;
        break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length > maxLines) lines.length = maxLines;
    if (words.length && (truncated || lines.length === maxLines)) {
      lines[maxLines - 1] = fitTextWithEllipsis(lines[maxLines - 1], maxWidth, fontSize, fontWeight);
    }
    return lines;
  }

  function getMainNodeMetric(node) {
    const cached = node && node.id ? nodeMetrics.get(node.id) : null;
    if (cached) return cached;
    const minW = 190;
    const maxW = node?.type === "claim" ? 340 : 460;
    const fontSize = 13;
    const fontWeight = node?.isFocus ? 700 : (node?.type === "claim" ? 700 : 500);
    const padX = 24;
    const padY = 16;
    const lineHeight = 16;
    const maxTextW = maxW - padX * 2;
    const lines = wrapTextWithMaxWidth(node?.label || "", maxTextW, fontSize, fontWeight, 3);
    const widest = Math.max(...lines.map((l) => measureTextWidth(l, fontSize, fontWeight)), 0);
    const w = clamp(widest + padX * 2, minW, maxW);
    const h = Math.max(58, lines.length * lineHeight + padY * 2);
    const metric = { w, h, lines, fontSize, fontWeight, lineHeight };
    if (node && node.id) nodeMetrics.set(node.id, metric);
    return metric;
  }

  function nodeSize(node) {
    return getMainNodeMetric(node);
  }

  function applyNodeLabel(textEl, metric, color) {
    const lines = metric.lines || [""];
    const offset = -((lines.length - 1) * metric.lineHeight) / 2 + 5;
    textEl.setAttribute("fill", color || "#111827");
    textEl.setAttribute("font-size", String(metric.fontSize));
    textEl.setAttribute("font-weight", String(metric.fontWeight));
    textEl.setAttribute("text-anchor", "middle");
    textEl.setAttribute("x", "0");
    textEl.setAttribute("y", String(offset));
    textEl.textContent = "";
    lines.forEach((line, idx) => {
      const tspan = createSvgEl("tspan", {
        x: 0,
        dy: idx === 0 ? 0 : metric.lineHeight,
      });
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });
  }

  function resolveNodeDisplayCount(node, degreeMap) {
    if (!node || node.type === "assumption") return null;
    const rawCount = Number(node?.count);
    if (Number.isFinite(rawCount) && rawCount > 0) return rawCount;
    return null;
  }

  function appendCountBadge(group, nodeSizeInfo, countValue) {
    if (countValue == null) return;
    const text = String(countValue);
    const badgeTextW = Math.max(18, measureTextWidth(text, 11, 700) + 12);
    const badgeH = 18;
    const badgeX = nodeSizeInfo.w / 2 - badgeTextW / 2 - 10;
    const badgeY = -nodeSizeInfo.h / 2 + badgeH / 2 + 8;
    const badgeBg = createSvgEl("rect", {
      x: badgeX - badgeTextW / 2,
      y: badgeY - badgeH / 2,
      width: badgeTextW,
      height: badgeH,
      rx: 9,
      fill: "#111827",
      "fill-opacity": 0.88,
      stroke: "#f8fafc",
      "stroke-width": 1.2,
    });
    const badgeLabel = createSvgEl("text", {
      x: badgeX,
      y: badgeY + 3.5,
      "text-anchor": "middle",
      "font-size": 11,
      "font-weight": 700,
      fill: "#f8fafc",
    });
    badgeLabel.textContent = text;
    group.appendChild(badgeBg);
    group.appendChild(badgeLabel);
  }

  function resolveNodeSide(node) {
    const side = String(node?.clusterSentiment || "").toLowerCase();
    if (side === "good" || side === "bad") return side;
    const label = String(node?.label || "").toLowerCase();
    if (label.startsWith("good_")) return "good";
    if (label.startsWith("bad_")) return "bad";
    return "good";
  }

  function typeStyle(node) {
    if (node?.type === "claim") return { fill: "#d1d5db", stroke: "#4b5563" };
    const side = resolveNodeSide(node);
    if (side === "bad") return { fill: "#fecaca", stroke: "#b91c1c" };
    return { fill: "#86efac", stroke: "#166534" };
  }

  function setWorldTransform() {
    if (!scene) return;
    scene.world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
  }

  function zoomGraphByFactor(factor) {
    if (!svg || !scene) return;
    const panel = svg.closest(".graph-panel");
    if (!panel) return;
    const rect = svg.getBoundingClientRect();
    const centerClientX = rect.left + panel.clientWidth / 2;
    const centerClientY = rect.top + panel.clientHeight / 2;
    const worldBefore = clientToWorld(centerClientX, centerClientY);
    view.scale = clamp(view.scale * factor, 0.55, 3.2);
    view.x = centerClientX - rect.left - worldBefore.x * view.scale;
    view.y = centerClientY - rect.top - worldBefore.y * view.scale;
    setWorldTransform();
  }

  function clientToWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  function getVisibleMainBounds() {
    if (!scene || !scene.nodeItems?.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const item of scene.nodeItems) {
      const p = nodePos.get(item?.node?.id);
      if (!p) continue;
      const sz = nodeSize(item.node);
      minX = Math.min(minX, p.x - sz.w / 2);
      maxX = Math.max(maxX, p.x + sz.w / 2);
      minY = Math.min(minY, p.y - sz.h / 2);
      maxY = Math.max(maxY, p.y + sz.h / 2);
      count += 1;
    }
    if (!count) return null;
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  function autoFitMainViewport() {
    if (!svg || !scene) return;
    const panel = svg.closest(".graph-panel");
    if (!panel) return;
    const bounds = getVisibleMainBounds();
    if (!bounds) return;
    const viewportW = Math.max(1, panel.clientWidth);
    const viewportH = Math.max(1, panel.clientHeight);
    const pad = 44;
    const fitW = Math.max(1, viewportW - pad * 2);
    const fitH = Math.max(1, viewportH - pad * 2);
    const safeMargin = 120;
    const fitScale = Math.min(
      fitW / (bounds.width + safeMargin * 2),
      fitH / (bounds.height + safeMargin * 2)
    );
    const minReadableScale = 0.78;
    const nextScale = clamp(fitScale, minReadableScale, 3.2);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    view.scale = nextScale;
    view.x = viewportW / 2 - cx * nextScale;
    view.y = viewportH / 2 - cy * nextScale;
    panel.scrollLeft = 0;
    panel.scrollTop = 0;
    const screenMinX = bounds.minX * view.scale + view.x - panel.scrollLeft;
    const screenMaxX = bounds.maxX * view.scale + view.x - panel.scrollLeft;
    const screenMinY = bounds.minY * view.scale + view.y - panel.scrollTop;
    const screenMaxY = bounds.maxY * view.scale + view.y - panel.scrollTop;
    const dx = viewportW / 2 - (screenMinX + screenMaxX) / 2;
    const dy = viewportH / 2 - (screenMinY + screenMaxY) / 2;
    view.x += dx;
    view.y += dy;
    setWorldTransform();
  }

  function buildDisplayGraphModel(rawGraph) {
    const focusSupportingLabel = String(supporting || "").trim().toLowerCase();
    const selectedClaim = String(rawGraph?.meta?.selectedClaim || "").trim();
    const opposingClaim = String(rawGraph?.meta?.opposingClaim || "").trim();
    const defenseLayerLabel = rawGraph?.meta?.defenseLayerSynthetic
      ? String(rawGraph?.meta?.defenseLayerLabel || "").trim()
      : "";
    const defenseLayerDisplay = rawGraph?.meta?.defenseLayerSynthetic
      ? String(rawGraph?.meta?.selectedClaim || "").trim()
      : "";
    const allNodes = (rawGraph.nodes || []).map((n) => {
      const data = n.data;
      if (
        data &&
        data.type === "claim" &&
        defenseLayerLabel &&
        defenseLayerDisplay &&
        String(data.label || "").trim() === defenseLayerLabel
      ) {
        return {
          ...data,
          label: defenseLayerDisplay,
        };
      }
      return data;
    });
    const selectedClaimClusterId = selectedClaim ? `framework::${selectedClaim}` : "";
    const opposingClaimClusterId = opposingClaim ? `framework::${opposingClaim}` : "";
    const defenseLayerClusterId = defenseLayerLabel ? `framework::${defenseLayerLabel}` : "";
    const duplicateNodeRedirects = new Map();
    if (selectedClaimClusterId && defenseLayerClusterId) {
      const selectedClaimPropositionsByLabel = new Map();
      for (const node of allNodes) {
        if (node?.type !== "proposition" || String(node?.clusterId || "") !== selectedClaimClusterId) continue;
        const key = String(node?.label || "").trim().toLowerCase();
        if (key && !selectedClaimPropositionsByLabel.has(key)) selectedClaimPropositionsByLabel.set(key, node.id);
      }
      for (const node of allNodes) {
        if (node?.type !== "proposition" || String(node?.clusterId || "") !== defenseLayerClusterId) continue;
        const key = String(node?.label || "").trim().toLowerCase();
        const keeperId = selectedClaimPropositionsByLabel.get(key);
        if (keeperId && keeperId !== node.id) {
          duplicateNodeRedirects.set(node.id, keeperId);
        }
      }
    }
    const allEdges = (rawGraph.edges || []).map((e) => {
      const data = e.data || {};
      return {
        ...data,
        source: duplicateNodeRedirects.get(data.source) || data.source,
        target: duplicateNodeRedirects.get(data.target) || data.target,
      };
    });
    const clusters = rawGraph.clusters || [];

    const claimsByCluster = new Map();
    const rulesByCluster = new Map();
    const nodeById = new Map();
    for (const n of allNodes) {
      nodeById.set(n.id, n);
      if (n.type === "claim") claimsByCluster.set(n.clusterId, n.id);
      if (n.type === "rule") rulesByCluster.set(n.clusterId, n.id);
    }

    const nodesToHide = new Set();
    if (defenseLayerClusterId) {
      for (const node of allNodes) {
        if (String(node?.clusterId || "") !== defenseLayerClusterId) continue;
        if (selectedLayerMode === "layer1") {
          nodesToHide.add(node.id);
          continue;
        }
        if (node?.type === "claim" || node?.type === "assumption") {
          nodesToHide.add(node.id);
        }
      }
    }

    // For UI Layer 1, keep only the opposite propositions that attack selected-side assumptions.
    if (selectedLayerMode === "layer1" && opposingClaimClusterId) {
      for (const node of allNodes) {
        if (String(node?.clusterId || "") !== opposingClaimClusterId) continue;
    
        if (node?.type === "claim" || node?.type === "assumption") {
          nodesToHide.add(node.id);
        }
      }
    } else if (opposingClaimClusterId) {
      let opposingClusterHasAttack = false;
      for (const edge of allEdges) {
        if (edge?.type !== "attack") continue;
        const srcNode = nodeById.get(edge.source);
        const tgtNode = nodeById.get(edge.target);
        if (!srcNode || !tgtNode) continue;
        if (
          String(srcNode.clusterId || "") === opposingClaimClusterId ||
          String(tgtNode.clusterId || "") === opposingClaimClusterId
        ) {
          opposingClusterHasAttack = true;
          break;
        }
      }
      if (!opposingClusterHasAttack) {
        const opposingClaimNodeId = claimsByCluster.get(opposingClaimClusterId);
        if (opposingClaimNodeId) nodesToHide.add(opposingClaimNodeId);
      }
    }

    // Hide rule nodes and synthetic-C proposition duplicates that are merged into cluster A.
    const visibleNodes = allNodes.filter((n) => {
      if (n.type === "rule") return false;
      if (duplicateNodeRedirects.has(n.id)) return false;
      if (nodesToHide.has(n.id)) return false;
      return true;
    });
    const visibleById = new Set(visibleNodes.map((n) => n.id));

    const uiEdgeMap = new Map();
    function addUiEdge(source, target, type) {
      if (!source || !target || source === target) return;
      if (!visibleById.has(source) || !visibleById.has(target)) return;
      const k = `${type}::${source}::${target}`;
      if (!uiEdgeMap.has(k)) {
        uiEdgeMap.set(k, { id: `ui_${uiEdgeMap.size + 1}`, source, target, type, weight: 1 });
      } else if (type === "attack") {
        uiEdgeMap.get(k).weight += 1;
      }
    }

    // flatten support: premise -> claim (rule hidden)
    for (const e of allEdges) {
      if (e.type !== "support") continue;
      const srcNode = nodeById.get(e.source);
      const tgtNode = nodeById.get(e.target);
      if (!srcNode || !tgtNode) continue;
      if (srcNode.type === "rule" || tgtNode.type === "rule") {
        const clusterId = srcNode.type === "rule" ? srcNode.clusterId : tgtNode.clusterId;
        const claimId = claimsByCluster.get(clusterId);
        const premiseId = srcNode.type === "rule" ? e.target : e.source;
        const premiseNode = nodeById.get(premiseId);
        if (premiseNode && premiseNode.type !== "claim" && premiseNode.type !== "rule") {
          addUiEdge(premiseId, claimId, "support");
        }
      } else {
        addUiEdge(e.source, e.target, "support");
      }
    }

    // keep attack edges directly between visible nodes
    for (const e of allEdges) {
      if (e.type !== "attack") continue;
      const srcNode = nodeById.get(e.source);
      const tgtNode = nodeById.get(e.target);
      if (!srcNode || !tgtNode) continue;

      // Hide direct attacks from the selected supporting reason to assumptions
      // under the opposing claim cluster (works for all topics via query param).
      const srcLabel = String(srcNode.label || "").trim().toLowerCase();
      const isFromFocusedSupporting = focusSupportingLabel && srcLabel === focusSupportingLabel;
      const isTargetOpposingAssumption =
        tgtNode.type === "assumption" &&
        String(tgtNode.clusterId || "") === String(opposingClaimClusterId || "");
      if (isFromFocusedSupporting && isTargetOpposingAssumption) continue;

      addUiEdge(e.source, e.target, "attack");
    }

    return {
      clusters,
      nodes: visibleNodes,
      edges: Array.from(uiEdgeMap.values()),
      claimsByCluster,
      rulesByCluster,
      displayRows: Array.isArray(rawGraph?.displayRows) ? rawGraph.displayRows : [],
    };
  }

  function uniqueNodes(nodes) {
    const seen = new Set();
    const out = [];
    for (const node of nodes || []) {
      if (!node?.id || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push(node);
    }
    return out;
  }

  function sortNodesForRow(nodes) {
    return [...(nodes || [])].sort((a, b) => {
      const typeRank = { claim: 0, proposition: 1, assumption: 2 };
      const rankDiff = (typeRank[a?.type] ?? 9) - (typeRank[b?.type] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      if (!!a?.isFocus !== !!b?.isFocus) return a?.isFocus ? -1 : 1;
      return String(a?.label || "").localeCompare(String(b?.label || ""));
    });
  }

  function splitRowIntoChunks(nodes, maxPerChunk = 8) {
    if (!Array.isArray(nodes) || !nodes.length) return [];
    const chunks = [];
    for (let i = 0; i < nodes.length; i += maxPerChunk) {
      chunks.push(nodes.slice(i, i + maxPerChunk));
    }
    return chunks;
  }

  function buildLayoutRows(graph) {
    const nodeById = new Map((graph?.nodes || []).map((node) => [node.id, node]));
    const explicitRows = Array.isArray(graph?.displayRows) ? graph.displayRows : [];
    const mappedRows = explicitRows
      .map((row) => (Array.isArray(row) ? row.map((id) => nodeById.get(id)).filter(Boolean) : []))
      .map((row) => sortNodesForRow(uniqueNodes(row)))
      .filter((row) => row.length);

    if (mappedRows.length) return mappedRows;

    const rowsByLevel = new Map();
    for (const node of graph?.nodes || []) {
      const level = Number.isFinite(Number(node?.level)) ? Number(node.level) : 99;
      if (!rowsByLevel.has(level)) rowsByLevel.set(level, []);
      rowsByLevel.get(level).push(node);
    }
    return [...rowsByLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, rowNodes]) => sortNodesForRow(uniqueNodes(rowNodes)))
      .filter((row) => row.length);
  }

  function positionRowNodes(rowNodes, y, canvasWidth) {
    const gap = rowNodes.some((node) => node.type === "claim") ? 40 : 28;
    const rowWidth = rowNodes.reduce((sum, node) => sum + nodeSize(node).w, 0) + gap * Math.max(0, rowNodes.length - 1);
    let x = (canvasWidth - rowWidth) / 2;
    let tallest = 0;
    for (const node of rowNodes) {
      const metric = nodeSize(node);
      tallest = Math.max(tallest, metric.h);
      nodePos.set(node.id, {
        x: x + metric.w / 2,
        y: y + metric.h / 2,
      });
      x += metric.w + gap;
    }
    return tallest;
  }

  function buildInitialLayout(graph) {
    nodePos.clear();
    nodeById.clear();
    for (const n of graph.nodes) nodeById.set(n.id, n);

    const logicalRows = buildLayoutRows(graph);
    const rows = logicalRows.flatMap((row) => splitRowIntoChunks(row, 8));
    const outerPadX = 64;
    const outerPadY = 56;
    const rowGap = 44;
    const widestRow = rows.reduce((max, row) => {
      const gap = row.some((node) => node.type === "claim") ? 40 : 28;
      const width = row.reduce((sum, node) => sum + nodeSize(node).w, 0) + gap * Math.max(0, row.length - 1);
      return Math.max(max, width);
    }, 0);
    const canvasWidth = Math.max(BASE_CANVAS_WIDTH, widestRow + outerPadX * 2);

    let y = outerPadY;
    for (const row of rows) {
      const tallest = positionRowNodes(row, y, canvasWidth);
      y += tallest + rowGap;
    }

    const canvasHeight = Math.max(BASE_CANVAS_HEIGHT, y - rowGap + outerPadY);
    const canvasBounds = {
      x: outerPadX / 2,
      y: outerPadY / 2,
      w: canvasWidth - outerPadX,
      h: canvasHeight - outerPadY,
    };

    for (const n of graph.nodes) {
      const pos = nodePos.get(n.id);
      if (!pos) continue;
      const sz = nodeSize(n);
      pos.x = clamp(pos.x, canvasBounds.x + sz.w / 2, canvasBounds.x + canvasBounds.w - sz.w / 2);
      pos.y = clamp(pos.y, canvasBounds.y + sz.h / 2, canvasBounds.y + canvasBounds.h - sz.h / 2);
    }

    return { canvasWidth, canvasHeight, canvasBounds };
  }

  function updateScene() {
    if (!scene) return;

    function edgeAnchor(fromId, toId) {
      const from = nodePos.get(fromId);
      const to = nodePos.get(toId);
      const fromNode = nodeById.get(fromId);
      const toNode = nodeById.get(toId);
      if (!from || !to || !fromNode || !toNode) return null;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      const fs = nodeSize(fromNode);
      const ts = nodeSize(toNode);
      const frx = fs.w / 2;
      const fry = fs.h / 2;
      const trx = ts.w / 2;
      const try_ = ts.h / 2;

      const fromDist = 1 / Math.sqrt((ux * ux) / (frx * frx) + (uy * uy) / (fry * fry));
      const toDist = 1 / Math.sqrt((ux * ux) / (trx * trx) + (uy * uy) / (try_ * try_));

      return {
        sx: from.x + ux * fromDist,
        sy: from.y + uy * fromDist,
        tx: to.x - ux * toDist,
        ty: to.y - uy * toDist,
      };
    }

    for (const e of scene.edgeItems) {
      const p = edgeAnchor(e.edge.source, e.edge.target);
      if (!p) continue;
      if (e.edge.type === "attack") {
        const mx = (p.sx + p.tx) / 2;
        const my = (p.sy + p.ty) / 2 - 26;
        e.path.setAttribute("d", `M ${p.sx} ${p.sy} Q ${mx} ${my} ${p.tx} ${p.ty}`);
      } else {
        e.path.setAttribute("d", `M ${p.sx} ${p.sy} L ${p.tx} ${p.ty}`);
      }
      if (e.label) {
        e.label.setAttribute("x", String((p.sx + p.tx) / 2));
        e.label.setAttribute("y", String((p.sy + p.ty) / 2 - 6));
      }
    }
    for (const n of scene.nodeItems) {
      const p = nodePos.get(n.node.id);
      if (!p) continue;
      n.group.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  }

  function attachNodeDrag(group, node, boundsRect) {
    let dragging = false;
    let offset = null;

    function onMove(ev) {
      if (!dragging) return;
      const world = clientToWorld(ev.clientX, ev.clientY);
      const p = nodePos.get(node.id);
      const sz = nodeSize(node);
      p.x = world.x - offset.x;
      p.y = world.y - offset.y;
      if (boundsRect) {
        p.x = clamp(p.x, boundsRect.x + sz.w / 2, boundsRect.x + boundsRect.w - sz.w / 2);
        p.y = clamp(p.y, boundsRect.y + sz.h / 2, boundsRect.y + boundsRect.h - sz.h / 2);
      }
      updateScene();
    }

    function onUp() {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    group.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      const p = nodePos.get(node.id);
      const world = clientToWorld(ev.clientX, ev.clientY);
      offset = { x: world.x - p.x, y: world.y - p.y };
      dragging = true;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  function drawGraph(rawGraph, options = {}) {
    const preserveView = options && options.preserveView === true;
    const graph = buildDisplayGraphModel(rawGraph);
    nodeMetrics.clear();
    for (const n of graph.nodes) nodeMetrics.set(n.id, getMainNodeMetric(n));
    svg.innerHTML = "";
    const defs = createSvgEl("defs", {});
    const supportMarker = createSvgEl("marker", {
      id: "arrow-support",
      markerWidth: 14,
      markerHeight: 14,
      refX: 12,
      refY: 4,
      orient: "auto",
      markerUnits: "strokeWidth",
    });
    supportMarker.appendChild(createSvgEl("path", { d: "M0,0 L0,8 L12,4 z", fill: "#111827" }));
    defs.appendChild(supportMarker);

    const attackMarker = createSvgEl("marker", {
      id: "arrow-attack",
      markerWidth: 14,
      markerHeight: 14,
      refX: 12,
      refY: 4,
      orient: "auto",
      markerUnits: "strokeWidth",
    });
    attackMarker.appendChild(createSvgEl("path", { d: "M0,0 L0,8 L12,4 z", fill: "#dc2626" }));
    defs.appendChild(attackMarker);
    svg.appendChild(defs);

    const world = createSvgEl("g", {});
    svg.appendChild(world);

    const layout = buildInitialLayout(graph);
    const canvasWidth = layout.canvasWidth || BASE_CANVAS_WIDTH;
    const canvasHeight = layout.canvasHeight || BASE_CANVAS_HEIGHT;
    const canvasBounds = layout.canvasBounds || {
      x: 32,
      y: 32,
      w: canvasWidth - 64,
      h: canvasHeight - 64,
    };
    svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    svg.setAttribute("width", String(canvasWidth));
    svg.setAttribute("height", String(canvasHeight));

    const edgeLayer = createSvgEl("g", {});
    const nodeLayer = createSvgEl("g", {});
    world.appendChild(edgeLayer);
    world.appendChild(nodeLayer);

    const edgeItems = [];
    for (const e of graph.edges) {
      const isAttack = e.type === "attack";
      const path = createSvgEl("path", {
        d: "M0 0 L0 0",
        fill: "none",
        stroke: isAttack ? "#d53932" : "#4b5563",
        "stroke-opacity": isAttack ? 0.54 : 0.32,
        "stroke-width": isAttack ? 2.1 : 1.5,
        "marker-end": isAttack ? "url(#arrow-attack)" : "url(#arrow-support)",
      });
      path.dataset.edgeId = e.id;
      edgeLayer.appendChild(path);
      let label = null;
      if (isAttack && e.weight > 1) {
        label = createSvgEl("text", {
          x: 0,
          y: 0,
          "text-anchor": "middle",
          "font-size": 12,
          "font-weight": 700,
          fill: "#991b1b",
        });
        label.textContent = `x${e.weight}`;
        edgeLayer.appendChild(label);
      }
      edgeItems.push({ edge: e, path, label });
    }

    connectedByNode.clear();
    for (const e of graph.edges) {
      if (!connectedByNode.has(e.source)) connectedByNode.set(e.source, new Set());
      if (!connectedByNode.has(e.target)) connectedByNode.set(e.target, new Set());
      connectedByNode.get(e.source).add(e.id);
      connectedByNode.get(e.target).add(e.id);
    }
    const degreeByNode = new Map();
    for (const n of graph.nodes) {
      degreeByNode.set(n.id, (connectedByNode.get(n.id) || new Set()).size);
    }

    const nodeItems = [];
    const nodeItemsById = new Map();
    for (const n of graph.nodes) {
      const p = nodePos.get(n.id);
      if (!p) continue;
      const style = typeStyle(n);
      const sz = nodeSize(n);

      const g = createSvgEl("g", { transform: `translate(${p.x} ${p.y})` });
      g.dataset.nodeId = n.id;
      const shape = createSvgEl("ellipse", {
        cx: 0,
        cy: 0,
        rx: sz.w / 2,
        ry: sz.h / 2,
        fill: style.fill,
        stroke: style.stroke,
        "stroke-width": n.isFocus ? 3.2 : 2,
        "stroke-dasharray": n.type === "assumption" ? "8 5" : "none",
      });
      g.appendChild(shape);

      const text = createSvgEl("text", {
        fill: "#111827",
      });
      applyNodeLabel(text, nodeSize(n), "#111827");
      g.appendChild(text);
      const displayCount = resolveNodeDisplayCount(n, degreeByNode);
      appendCountBadge(g, sz, displayCount);
      const titleEl = createSvgEl("title", {});
      titleEl.textContent = displayCount != null ? `${String(n.label || "")} (count=${displayCount})` : String(n.label || "");
      g.appendChild(titleEl);

      if (!LOCK_AUTO_LAYOUT) attachNodeDrag(g, n, canvasBounds);

      g.addEventListener("mouseenter", () => {
        const connected = connectedByNode.get(n.id) || new Set();
        for (const ei of edgeItems) {
          const on = connected.has(ei.edge.id);
          ei.path.setAttribute("stroke-opacity", on ? "1" : "0.1");
          ei.path.setAttribute("stroke-width", ei.edge.type === "attack" ? (on ? "2.9" : "1.4") : (on ? "2.1" : "1.05"));
          if (ei.label) ei.label.setAttribute("opacity", on ? "1" : "0.2");
        }
      });
      g.addEventListener("mouseleave", () => {
        for (const ei of edgeItems) {
          ei.path.setAttribute("stroke-opacity", ei.edge.type === "attack" ? "0.54" : "0.32");
          ei.path.setAttribute("stroke-width", ei.edge.type === "attack" ? "2.1" : "1.5");
          if (ei.label) ei.label.setAttribute("opacity", "1");
        }
      });

      nodeLayer.appendChild(g);
      const item = { node: n, group: g };
      nodeItems.push(item);
      nodeItemsById.set(n.id, item);
    }

    const level5AttackersByTarget = new Map();
    for (const e of graph.edges) {
      if (e?.type !== "attack") continue;
      const attacker = nodeById.get(e.source);
      if (!attacker) continue;
      const attackerLevel = Number(attacker.level);
      if (!Number.isFinite(attackerLevel) || attackerLevel !== LEVEL5) continue;
      if (!level5AttackersByTarget.has(e.target)) level5AttackersByTarget.set(e.target, new Set());
      level5AttackersByTarget.get(e.target).add(e.source);
    }
    const allLevel5AttackerIds = new Set(
      Array.from(level5AttackersByTarget.values()).flatMap((ids) => Array.from(ids || []))
    );
    const toggleTargetIds = new Set(level5AttackersByTarget.keys());
    const collapsedTargetIds = new Set();
    const level5AttackPairs = [];
    for (const e of graph.edges) {
      if (e?.type !== "attack") continue;
      if (!allLevel5AttackerIds.has(e.source)) continue;
      if (!toggleTargetIds.has(e.target)) continue;
      level5AttackPairs.push({ source: e.source, target: e.target, edgeId: e.id });
    }

    function applyCollapsedVisibility() {
      const hiddenLevel5AttackEdgeIds = new Set();
      const visibleLevel5AttackerIds = new Set();
      for (const pair of level5AttackPairs) {
        if (collapsedTargetIds.has(pair.target)) {
          hiddenLevel5AttackEdgeIds.add(pair.edgeId);
          continue;
        }
        visibleLevel5AttackerIds.add(pair.source);
      }

      const hiddenNodeIds = new Set();
      for (const [id, item] of nodeItemsById.entries()) {
        const isHidden =
          allLevel5AttackerIds.has(id) &&
          !toggleTargetIds.has(id) &&
          !visibleLevel5AttackerIds.has(id);
        if (isHidden) hiddenNodeIds.add(id);
        item.group.style.display = isHidden ? "none" : "";
      }

      for (const ei of edgeItems) {
        const srcHidden = hiddenNodeIds.has(ei.edge.source);
        const tgtHidden = hiddenNodeIds.has(ei.edge.target);
        const hiddenByCollapsedTarget =
          ei.edge.type === "attack" &&
          hiddenLevel5AttackEdgeIds.has(ei.edge.id);
        const hidden = srcHidden || tgtHidden || hiddenByCollapsedTarget;
        ei.path.style.display = hidden ? "none" : "";
        if (ei.label) ei.label.style.display = hidden ? "none" : "";
      }
    }

    function updateTargetCollapse(targetId) {
      const attackers = level5AttackersByTarget.get(targetId);
      if (!attackers || !attackers.size) return;
      if (collapsedTargetIds.has(targetId)) collapsedTargetIds.delete(targetId);
      else collapsedTargetIds.add(targetId);
      applyCollapsedVisibility();
    }

    for (const item of nodeItems) {
      const targetId = item?.node?.id;
      const attackers = level5AttackersByTarget.get(targetId);
      const canToggleAttackers = !!(attackers && attackers.size);
      item.group.style.cursor = canToggleAttackers ? "pointer" : "grab";
      if (!canToggleAttackers) continue;
      item.group.addEventListener("click", (ev) => {
        ev.stopPropagation();
        updateTargetCollapse(targetId);
      });
    }

    scene = { world, edgeItems, nodeItems };
    setWorldTransform();
    updateScene();
    if (!preserveView) {
      requestAnimationFrame(() => {
        autoFitMainViewport();
      });
    }
  }

  function attachPanZoom() {
    let panning = false;
    let panStart = null;

    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const worldBefore = clientToWorld(ev.clientX, ev.clientY);
      const delta = ev.deltaY < 0 ? 1.08 : 0.92;
      view.scale = clamp(view.scale * delta, 0.55, 3.2);
      const rect = svg.getBoundingClientRect();
      view.x = ev.clientX - rect.left - worldBefore.x * view.scale;
      view.y = ev.clientY - rect.top - worldBefore.y * view.scale;
      setWorldTransform();
    }, { passive: false });

    svg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target !== svg) return;
      panning = true;
      panStart = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      svg.style.cursor = "grabbing";
      svg.setPointerCapture?.(ev.pointerId);
    });

    svg.addEventListener("pointermove", (ev) => {
      if (!panning || !panStart) return;
      view.x = panStart.vx + (ev.clientX - panStart.x);
      view.y = panStart.vy + (ev.clientY - panStart.y);
      setWorldTransform();
    });

    function stopPan(ev) {
      if (!panning) return;
      panning = false;
      panStart = null;
      svg.style.cursor = "";
      if (ev?.pointerId != null) svg.releasePointerCapture?.(ev.pointerId);
    }

    svg.addEventListener("pointerup", stopPan);
    svg.addEventListener("pointercancel", stopPan);
    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        autoFitMainViewport();
      });
    });
  }

  async function loadPreferred(rawGraph) {
    if (!preferredMetaEl || !preferredOutputEl) return;
    const basePayload = rawGraph?.framework?.payload || rawGraph?.meta?.pyargPayload || null;
    const warnings = Array.isArray(rawGraph?.framework?.warnings)
      ? rawGraph.framework.warnings
      : (Array.isArray(rawGraph?.meta?.pyargWarnings) ? rawGraph.meta.pyargWarnings : []);
    const requestId = ++preferredRequestSeq;
    llmRequestSeq += 1;

    if (!basePayload) {
      preferredMetaEl.textContent = "No backend framework payload was returned.";
      preferredOutputEl.textContent = JSON.stringify(rawGraph || {}, null, 2);
      setPayloadJsonOutput("-");
      renderFilterResults({ extensions: [] });
      setNaturalLanguageOutput("-", "");
      setAcceptedNaturalLanguageOutput("-", "");
      setGraphSummaryOutput("-", "");
      return;
    }

    const payload = {
      ...basePayload,
      semantics_specification: selectedSemantics,
      strategy_specification: selectedStrategy,
    };
    lastSemanticsPayload = payload;
    setPayloadJsonOutput(JSON.stringify(payload, null, 2));
    const cacheKey = buildSemanticsCacheKey(payload);

    if (!payload.rules.length) {
      preferredMetaEl.textContent = `Not enough graph data to compute ${selectedSemantics} extensions.`;
      preferredOutputEl.textContent = JSON.stringify({ assumptions: payload.assumptions.length, rules: payload.rules.length }, null, 2);
      renderFilterResults({ extensions: [] });
      setNaturalLanguageOutput("-", "");
      setAcceptedNaturalLanguageOutput("-", "");
      setGraphSummaryOutput("-", "");
      return;
    }

    if (semanticsResultCache.has(cacheKey)) {
      const cached = semanticsResultCache.get(cacheKey);
      if (cached?.error) {
        // Do not reuse stale semantics failures; retry evaluation on every request.
        semanticsResultCache.delete(cacheKey);
      }
      if (cached?.rawEvaluation) {
        lastSemanticsResult = cached.rawEvaluation;
        preferredMetaEl.textContent = `${cached.display.summary} (cached)`;
        preferredOutputEl.textContent = JSON.stringify({
          summary: cached.display.summary,
          result: cached.rawEvaluation,
          payload,
          warnings,
          cached: true,
        }, null, 2);
        renderCachedSemanticsDisplay(cached.display);
        await explainFormalSemantics(cached.rawEvaluation);
        return;
      }
    }

    preferredMetaEl.textContent = `Evaluating ${selectedSemantics} semantics...`;
    preferredOutputEl.textContent = JSON.stringify({ payload, warnings, status: "running" }, null, 2);
    setSemanticsWaitingDisplay();
    setLlmWaitingForSemantics();

    let data = null;
    const evalStartedAt = performance.now();
    try {
      data = await requestPyArgEvaluationJob(payload, {
        onProgress: ({ status, elapsedMs }) => {
          if (requestId !== preferredRequestSeq) return;
          const elapsedSec = Math.max(0, Math.floor((Number(elapsedMs) || 0) / 1000));
          preferredMetaEl.textContent =
            `Evaluating ${selectedSemantics} semantics... job=${status || "running"} elapsed=${elapsedSec}s (this can take 10-20 minutes)`;
        },
      });
    } catch (err) {
      if (requestId !== preferredRequestSeq) return;
      const elapsedMs = Math.max(0, performance.now() - evalStartedAt);
      preferredMetaEl.textContent = err?.message || `Failed to compute ${selectedSemantics} extensions.`;
      preferredOutputEl.textContent = JSON.stringify({
        payload,
        warnings,
        elapsed_ms: Math.round(elapsedMs),
        elapsed_seconds: Number((elapsedMs / 1000).toFixed(3)),
        error: String(err?.message || err),
      }, null, 2);
      semanticsResultCache.set(cacheKey, {
        error: String(err?.message || err),
        rawEvaluation: null,
        display: {
          extensionLabels: ["{}"],
          acceptedAssumptions: [],
          summary: String(err?.message || err),
        },
      });
      renderFilterResults({ extensions: [] });
      setNaturalLanguageOutput("Cannot start the LLM explanation because semantics evaluation failed.", "Semantics evaluation failed");
      setAcceptedNaturalLanguageOutput("Cannot start the accepted assumptions explanation because semantics evaluation failed.", "Semantics evaluation failed");
      return;
    }
    if (requestId !== preferredRequestSeq) return;

    const elapsedMs = Math.max(0, performance.now() - evalStartedAt);
    data = {
      ...data,
      elapsed_ms: Math.round(elapsedMs),
      elapsed_seconds: Number((elapsedMs / 1000).toFixed(3)),
    };
    const display = buildCachedSemanticsDisplay(data);
    semanticsResultCache.set(cacheKey, {
      error: null,
      rawEvaluation: data,
      display,
    });
    preferredMetaEl.textContent = display.summary;
    lastSemanticsResult = data;
    renderCachedSemanticsDisplay(display);
    await explainFormalSemantics(data);
    preferredOutputEl.textContent = JSON.stringify(
      {
        summary: display.summary,
        result: data,
        payload,
        warnings,
      },
      null,
      2
    );
  }

  async function loadGraph() {
    try {
      llmRequestSeq += 1;
      renderMainGraphMessage("Loading graph...", "Waiting for /api/aba-graph response.", "info");
      metaEl.textContent = `Loading graph for topic=${topic}, sentiment=${sentiment}, supporting=${supporting}...`;
      if (preferredMetaEl) preferredMetaEl.textContent = "Loading semantics...";
      if (preferredOutputEl) preferredOutputEl.textContent = "Waiting for backend evaluation...";
      setPayloadJsonOutput("Loading payload...");
      setSemanticsWaitingDisplay();
      setLlmWaitingForSemantics();
      const q = new URLSearchParams({
        topic,
        sentiment,
        supporting,
        layer_mode: selectedLayerMode,
        attack_mode: attackMode,
        attack_depth: attackDepth,
        focus_only: focusOnly,
        show_all_contrary: showAllContrary,
        semantics: selectedSemantics,
        strategy: selectedStrategy,
      });
      const resp = await apiFetch(`/api/aba-graph?${q.toString()}`);
      const data = await resp.json();
      if (!resp.ok) {
        metaEl.textContent = data.error || "Failed to load graph.";
        renderMainGraphMessage("Failed to load graph", data.error || "The backend returned an error for /api/aba-graph.");
        jsonOutputEl.textContent = JSON.stringify(data || {}, null, 2);
        setPayloadJsonOutput("-");
        if (preferredMetaEl) preferredMetaEl.textContent = "Cannot load semantics because graph API failed.";
        if (preferredOutputEl) preferredOutputEl.textContent = JSON.stringify(data || {}, null, 2);
        setNaturalLanguageOutput("-", "");
        setAcceptedNaturalLanguageOutput("-", "");
        setGraphSummaryOutput("-", "");
        return;
      }

      if (!Array.isArray(data.nodes) || !data.nodes.length) {
        metaEl.textContent = "Graph API returned no nodes.";
        renderMainGraphMessage("No graph nodes returned", "The backend response succeeded but did not contain any drawable nodes.");
        jsonOutputEl.textContent = JSON.stringify(data || {}, null, 2);
        setPayloadJsonOutput(JSON.stringify(data?.framework?.payload || {}, null, 2));
        if (preferredMetaEl) preferredMetaEl.textContent = "No graph nodes were returned.";
        if (preferredOutputEl) preferredOutputEl.textContent = JSON.stringify(data || {}, null, 2);
        setNaturalLanguageOutput("-", "");
        setAcceptedNaturalLanguageOutput("-", "");
        setGraphSummaryOutput("-", "");
        return;
      }

      if (data.meta) {
        const selectedClaim = data.meta.selectedClaim ?? "-";
        const opposingClaim = data.meta.opposingClaim ?? "-";
        const defenseLayer = data.meta.defenseLayerLabel ?? "-";
        metaEl.textContent =
          `topic=${topic}, sentiment=${sentiment}, supporting=${supporting}, ` +
          `layer_mode=${data.meta.layerMode ?? selectedLayerMode}, ` +
          `selectedClaim=${selectedClaim}, opposingClaim=${opposingClaim}, defenseLayer=${defenseLayer}, ` +
          `attacks=${data.meta.attackEdgesCount ?? 0}, contrary_candidates=${data.meta.contraryCandidatesCount ?? 0}, ` +
          `mode=${data.meta.attackMode ?? attackMode}, depth=${data.meta.attackDepth ?? attackDepth}, focus_only=${data.meta.focusOnly ?? focusOnly}`;
        setToggleButton(data.meta);
      }
      lastLoadedGraph = data;
      updateSemanticsHeader();
      drawGraph(data);
      scheduleWorkspaceLayoutSync();
      jsonOutputEl.textContent = JSON.stringify(data, null, 2);
      const graphSummaryRequestId = ++graphSummarySeq;
      await summarizeGraphForUsers(graphSummaryRequestId);
      await loadPreferred(data);
    } catch (err) {
      console.error(err);
      metaEl.textContent = "Cannot connect to backend API.";
      renderMainGraphMessage("Cannot connect to backend API", String(err?.message || err || "Unknown error"));
      if (preferredMetaEl) preferredMetaEl.textContent = "Cannot load semantics because graph API failed.";
      if (preferredOutputEl) preferredOutputEl.textContent = String(err?.stack || err?.message || err || "");
      if (jsonOutputEl) jsonOutputEl.textContent = String(err?.stack || err?.message || err || "");
      setPayloadJsonOutput("-");
      setNaturalLanguageOutput("-", "");
      setAcceptedNaturalLanguageOutput("-", "");
      setGraphSummaryOutput("-", "");
    }
  }

  attachPanZoom();
  if (llmModelSelectEls.length) {
    for (const el of llmModelSelectEls) {
      el.value = selectedLlmModel;
      el.disabled = false;
      el.title = "Uses your local Ollama server";
    }
  }
  if (layerModeSelectEl) layerModeSelectEl.value = selectedLayerMode;
  if (semanticsSelectEl) semanticsSelectEl.value = selectedSemantics;
  if (strategySelectEl) strategySelectEl.value = selectedStrategy;
  updateSemanticsHeader();

  function applyFilterFromControls() {
    selectedSemantics = semanticsSelectEl && SUPPORTED_SEMANTICS.includes(semanticsSelectEl.value)
      ? semanticsSelectEl.value
      : "Preferred";
    selectedStrategy = strategySelectEl && SUPPORTED_STRATEGIES.includes(strategySelectEl.value)
      ? strategySelectEl.value
      : "Credulous";
    const u = new URL(window.location.href);
    u.searchParams.set("layer_mode", selectedLayerMode);
    u.searchParams.set("semantics", selectedSemantics);
    u.searchParams.set("strategy", selectedStrategy);
    window.history.replaceState(null, "", u.toString());
    updateSemanticsHeader();
    if (lastLoadedGraph) {
      loadPreferred(lastLoadedGraph);
    } else {
      loadGraph();
    }
  }

  function applyLayerModeFromControls() {
    selectedLayerMode = layerModeSelectEl && SUPPORTED_LAYER_MODES.includes(layerModeSelectEl.value)
      ? layerModeSelectEl.value
      : "layer2";
    const u = new URL(window.location.href);
    u.searchParams.set("layer_mode", selectedLayerMode);
    u.searchParams.set("semantics", selectedSemantics);
    u.searchParams.set("strategy", selectedStrategy);
    window.history.replaceState(null, "", u.toString());
    loadGraph();
  }

  if (layerModeSelectEl) layerModeSelectEl.addEventListener("change", applyLayerModeFromControls);
  if (semanticsSelectEl) semanticsSelectEl.addEventListener("change", applyFilterFromControls);
  if (strategySelectEl) strategySelectEl.addEventListener("change", applyFilterFromControls);
  if (llmModelSelectEls.length) {
    for (const modelSelectEl of llmModelSelectEls) {
      modelSelectEl.addEventListener("change", () => {
        selectedLlmModel = String(modelSelectEl.value || "gemma3:4b").trim();
        if (!SUPPORTED_LLM_MODELS.includes(selectedLlmModel)) selectedLlmModel = "gemma3:4b";
        for (const otherEl of llmModelSelectEls) {
          if (otherEl.value !== selectedLlmModel) otherEl.value = selectedLlmModel;
        }
        const u = new URL(window.location.href);
        u.searchParams.set("layer_mode", selectedLayerMode);
        u.searchParams.set("llm_model", selectedLlmModel);
        window.history.replaceState(null, "", u.toString());
        if (lastLoadedGraph) {
          const graphSummaryRequestId = ++graphSummarySeq;
          summarizeGraphForUsers(graphSummaryRequestId);
        }
        if (lastSemanticsResult) {
          explainFormalSemantics(lastSemanticsResult);
        }
      });
    }
  }
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      const nowAll = showAllContrary === "1" || showAllContrary === "true" || showAllContrary === "yes";
      showAllContrary = nowAll ? "0" : "1";
      const u = new URL(window.location.href);
      u.searchParams.set("layer_mode", selectedLayerMode);
      u.searchParams.set("show_all_contrary", showAllContrary);
      u.searchParams.set("semantics", selectedSemantics);
      u.searchParams.set("strategy", selectedStrategy);
      window.history.replaceState(null, "", u.toString());
      loadGraph();
    });
  }
  if (graphZoomOutBtnEl) graphZoomOutBtnEl.addEventListener("click", () => zoomGraphByFactor(0.9));
  if (graphZoomInBtnEl) graphZoomInBtnEl.addEventListener("click", () => zoomGraphByFactor(1.1));
  if (graphFitBtnEl) graphFitBtnEl.addEventListener("click", () => autoFitMainViewport());
  if (graphFullscreenBtnEl && graphWorkspacePanelEl) {
    graphFullscreenBtnEl.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === graphWorkspacePanelEl) {
          await document.exitFullscreen();
        } else {
          await graphWorkspacePanelEl.requestFullscreen();
        }
      } catch (err) {
        console.warn("Fullscreen toggle failed:", err);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const isFullscreen = document.fullscreenElement === graphWorkspacePanelEl;
      graphFullscreenBtnEl.textContent = isFullscreen ? "Exit full screen" : "Full screen";
      scheduleWorkspaceLayoutSync();
      requestAnimationFrame(() => autoFitMainViewport());
    });
  }
  const accordionEls = Array.from(document.querySelectorAll(".accordion-card"));
  for (const card of accordionEls) {
    card.addEventListener("toggle", () => {
      if (!card.open) return;
      for (const other of accordionEls) {
        if (other !== card) other.open = false;
      }
      scheduleWorkspaceLayoutSync();
    });
  }
  window.addEventListener("resize", scheduleWorkspaceLayoutSync);
  scheduleWorkspaceLayoutSync();
  loadGraph();
})();

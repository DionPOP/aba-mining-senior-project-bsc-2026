(function () {
  const preferredSvg = document.getElementById("main-graph-canvas");
  const svg = preferredSvg;
  const metaEl = document.getElementById("graph-meta");
  const jsonOutputEl = document.getElementById("json-output");
  const preferredMetaEl = document.getElementById("preferred-meta");
  const preferredOutputEl = document.getElementById("preferred-output");
  
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
  const llmModelSelectEl = document.getElementById("llm-model-select");
  const extensionListEl = document.getElementById("extension-list");
  const extensionNaturalLanguageEl = document.getElementById("extension-natural-language");
  const extensionNaturalMetaEl = document.getElementById("extension-natural-meta");
  const acceptedAssumptionsEl = document.getElementById("accepted-assumptions");
  const graphSummaryTextEl = document.getElementById("graph-summary-text");
  const graphSummaryMetaEl = document.getElementById("graph-summary-meta");

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

  const params = new URLSearchParams(window.location.search);
  const topic = String(params.get("topic") || "").trim();
  const sentiment = String(params.get("sentiment") || "all").trim();
  const supporting = String(params.get("supporting") || "").trim();
  const attackMode = String(params.get("attack_mode") || "all").trim().toLowerCase();
  const attackDepth = String(params.get("attack_depth") || "1").trim();
  const focusOnly = String(params.get("focus_only") || "1").trim().toLowerCase();
  let showAllContrary = String(params.get("show_all_contrary") || "1").trim().toLowerCase();
  let selectedSemantics = String(params.get("semantics") || "Preferred").trim();
  if (!SUPPORTED_SEMANTICS.includes(selectedSemantics)) selectedSemantics = "Preferred";
  let selectedStrategy = String(params.get("strategy") || "Credulous").trim();
  if (!SUPPORTED_STRATEGIES.includes(selectedStrategy)) selectedStrategy = "Credulous";
  let selectedLayerMode = String(params.get("layer_mode") || "layer2").trim().toLowerCase();
  if (!SUPPORTED_LAYER_MODES.includes(selectedLayerMode)) selectedLayerMode = "layer2";
  let selectedLlmModel = String(params.get("llm_model") || "qwen2.5").trim();
  if (!["gpt-4o", "gemini-2.5-pro", "qwen2.5", "gemma3:4b"].includes(selectedLlmModel)) selectedLlmModel = "qwen2.5";
  let lastLoadedGraph = null;
  let lastSemanticsResult = null;
  const apiBases = (() => {
    const fromQuery = String(params.get("api_base") || "").trim();
    if (fromQuery) return [fromQuery.replace(/\/+$/, "")];
    if (window.location.protocol === "file:") return ["http://localhost:3000"];
    if (window.location.port === "3000") return [""];
    const sameOrigin = "";
    const port3000 = `${window.location.protocol}//${window.location.hostname}:3000`;
    return [sameOrigin, port3000];
  })();

  async function apiFetch(path, options) {
    let lastError = null;
    for (const base of apiBases) {
      const url = `${base}${path}`;
      try {
        const resp = await fetch(url, options);
        if (resp.status === 404 && base !== apiBases[apiBases.length - 1]) {
          continue;
        }
        return resp;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("API request failed");
  }

  if (!topic || !supporting) {
    metaEl.textContent = "Missing query params: topic and supporting are required.";
    if (preferredMetaEl) preferredMetaEl.textContent = metaEl.textContent;
    if (preferredSvg) {
      const emptyW = 1280;
      const emptyH = 540;
      preferredSvg.innerHTML = "";
      preferredSvg.setAttribute("viewBox", `0 0 ${emptyW} ${emptyH}`);
      const g = createSvgEl("g", {});
      const t1 = createSvgEl("text", {
        x: emptyW / 2,
        y: emptyH / 2 - 10,
        "text-anchor": "middle",
        "font-size": 20,
        "font-weight": 700,
        fill: "#7f1d1d",
      });
      t1.textContent = "Missing query params";
      const t2 = createSvgEl("text", {
        x: emptyW / 2,
        y: emptyH / 2 + 20,
        "text-anchor": "middle",
        "font-size": 14,
        "font-weight": 500,
        fill: "#374151",
      });
      t2.textContent = "Please open from Review page so topic/supporting are included.";
      g.appendChild(t1);
      g.appendChild(t2);
      preferredSvg.appendChild(g);
    }
    return;
  }

  backLink.href = `./review_category.html?type=${encodeURIComponent(sentiment.toLowerCase())}`;
  metaEl.textContent = `topic=${topic}, sentiment=${sentiment}, supporting=${supporting}, attack_mode=${attackMode}, attack_depth=${attackDepth}, focus_only=${focusOnly}`;

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
      `- Under ${selectedSemantics} + ${selectedStrategy}, the graph structure is analyzed as one reasoning map.`,
      "- Focus on how supporting and conflicting links shape the final interpretation.",
    ];
    return lines.join("\n");
  }

  async function summarizeGraphForUsers(result) {
    if (!graphSummaryTextEl) return;
    const nodes = (lastLoadedGraph?.nodes || []).map((n) => n?.data || n).filter(Boolean);
    const edges = (lastLoadedGraph?.edges || []).map((e) => e?.data || e).filter(Boolean);
    const supportCount = edges.filter((e) => String(e?.type || "") === "support").length;
    const attackCount = edges.filter((e) => String(e?.type || "") === "attack").length;
    const acceptedAssumptions = Array.isArray(result?.accepted_assumptions) ? result.accepted_assumptions : [];
    if (!nodes.length) {
      setGraphSummaryOutput("-", "");
      return;
    }

    setGraphSummaryOutput("Summarizing graph with LLM...", "");
    try {
      const resp = await apiFetch("/api/llm/translate-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "graph_summary",
          model: selectedLlmModel,
          topic,
          sentiment,
          supporting,
          semantics: selectedSemantics,
          strategy: selectedStrategy,
          graphNodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.label,
            clusterSentiment: n.clusterSentiment,
          })),
          graphEdgeStats: {
            total: edges.length,
            support: supportCount,
            attack: attackCount,
          },
          acceptedAssumptions,
          outputLanguage: "en",
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Graph summary API failed");
      const text = String(data?.text || "-");
      const meta = data?.provider ? `LLM: ${data.provider}${data.model ? ` (${data.model})` : ""}` : "";
      setGraphSummaryOutput(text, meta);
    } catch (err) {
      console.error(err);
      setGraphSummaryOutput(buildFallbackGraphSummary(), "LLM unavailable (fallback summary)");
    }
  }

  async function translateExtensionsToNaturalLanguage(result) {
    if (!extensionNaturalLanguageEl) return;
    lastSemanticsResult = result || null;
    const extensions = getCurrentExplanationExtensions(result);
    const acceptedAssumptions = getCurrentExplanationAcceptedAssumptions(result);
    if (!extensions.length) {
      setNaturalLanguageOutput("-", "");
      setGraphSummaryOutput("-", "");
      return;
    }
    setNaturalLanguageOutput("Translating with LLM...", "");
    setGraphSummaryOutput("Summarizing graph with LLM...", "");
    try {
      const currentExtensionText = extensions.length
        ? extensions.map((ext) => `{${ext.join(", ")}}`).join("\n")
        : "{}";
      const resp = await apiFetch("/api/llm/translate-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Translation API failed");
      const text = String(data?.text || "-");
      const meta = data?.provider ? `LLM: ${data.provider}${data.model ? ` (${data.model})` : ""}` : "";
      setNaturalLanguageOutput(text, meta);
    } catch (err) {
      console.error(err);
      setNaturalLanguageOutput("Cannot translate to natural language right now (LLM is unavailable).", "LLM unavailable");
    }
    await summarizeGraphForUsers(result);
  }

  function normalizeExtensions(extensions) {
    if (!Array.isArray(extensions)) return [];
    return extensions
      .filter((ext) => Array.isArray(ext))
      .map((ext) => ext.map((x) => String(x)).filter(Boolean));
  }

  function getCurrentExplanationExtensions(result) {
    const normalizedExts = normalizeExtensions(result?.extensions);
    if (!normalizedExts.length) return [];
    // Current Explanation should show all extension sets for the selected semantics.
    return normalizedExts;
  }

  function getCurrentExplanationAcceptedAssumptions(result) {
    const currentExts = getCurrentExplanationExtensions(result);
    if (!currentExts.length) return [];
    const merged = new Set();
    for (const ext of currentExts) {
      for (const item of ext) merged.add(String(item));
    }
    return [...merged].filter(Boolean);
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

  function renderFilterResults(result) {
    const normalizedExts = normalizeExtensions(result?.extensions);
    const currentExts = getCurrentExplanationExtensions(result);
    const extensionLabels = currentExts.length
      ? currentExts.map((ext) => `{${ext.join(", ")}}`)
      : ["{}"];
    const acceptedFromApi = Array.isArray(result?.accepted_assumptions)
      ? result.accepted_assumptions.map((x) => String(x))
      : null;
    const accepted = acceptedFromApi || computeAcceptedAssumptions(normalizedExts, selectedStrategy);
    renderTokens(extensionListEl, extensionLabels, "{}");
    renderTokens(acceptedAssumptionsEl, accepted, "-");
  }

  function getMaxVisibleLevel() {
    return selectedLayerMode === "layer1" ? 2 : 5;
  }

  const WIDTH = 1280;
  const HEIGHT = 760;
  const view = { x: 0, y: 0, scale: 1 };

  const nodePos = new Map();
  const nodeById = new Map();
  const nodeMetrics = new Map();
  const connectedByNode = new Map();
  let scene = null;

  const PREF_WIDTH = 1280;
  const PREF_HEIGHT = 540;
  const LOCK_AUTO_LAYOUT = false;
  let preferredCanvasWidth = PREF_WIDTH;
  let preferredCanvasHeight = PREF_HEIGHT;
  const preferredView = { x: 0, y: 0, scale: 1 };
  const preferredNodePos = new Map();
  const preferredNodeById = new Map();
  const preferredNodeMetrics = new Map();
  const preferredConnectedByNode = new Map();
  let preferredScene = null;

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
    const safeMargin = selectedLayerMode === "layer2" ? 120 : 72;
    const fitScale = Math.min(
      fitW / (bounds.width + safeMargin * 2),
      fitH / (bounds.height + safeMargin * 2)
    );
    const minReadableScale = selectedLayerMode === "layer2" ? 0.78 : 0.65;
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

  function preprocessGraph(rawGraph) {
    const allNodes = (rawGraph.nodes || []).map((n) => n.data);
    const allEdges = (rawGraph.edges || []).map((e) => e.data);
    const clusters = rawGraph.clusters || [];

    const claimsByCluster = new Map();
    const rulesByCluster = new Map();
    for (const n of allNodes) {
      if (n.type === "claim") claimsByCluster.set(n.clusterId, n.id);
      if (n.type === "rule") rulesByCluster.set(n.clusterId, n.id);
    }

    // hide rule nodes only
    const visibleNodes = allNodes.filter((n) => {
      if (n.type === "rule") return false;
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
      const srcNode = allNodes.find((n) => n.id === e.source);
      const tgtNode = allNodes.find((n) => n.id === e.target);
      if (!srcNode || !tgtNode) continue;
      if (srcNode.type === "rule" || tgtNode.type === "rule") {
        const clusterId = srcNode.type === "rule" ? srcNode.clusterId : tgtNode.clusterId;
        const claimId = claimsByCluster.get(clusterId);
        const premiseId = srcNode.type === "rule" ? e.target : e.source;
        const premiseNode = allNodes.find((n) => n.id === premiseId);
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
      const srcNode = allNodes.find((n) => n.id === e.source);
      const tgtNode = allNodes.find((n) => n.id === e.target);
      if (!srcNode || !tgtNode) continue;
      addUiEdge(e.source, e.target, "attack");
    }

    return {
      clusters,
      nodes: visibleNodes,
      edges: Array.from(uiEdgeMap.values()),
      claimsByCluster,
      rulesByCluster,
    };
  }

  function buildInitialLayout(graph) {
    nodePos.clear();
    nodeById.clear();
    for (const n of graph.nodes) nodeById.set(n.id, n);

    const clusterOrder = graph.clusters.map((c) => c.id);
    const clusterRects = new Map();
    if (clusterOrder[0]) clusterRects.set(clusterOrder[0], { x: 40, y: 40, w: 560, h: 680 });
    if (clusterOrder[1]) clusterRects.set(clusterOrder[1], { x: 680, y: 40, w: 560, h: 680 });

    function putNode(id, x, y) {
      nodePos.set(id, { x, y });
    }

    for (const clusterId of clusterOrder) {
      const r = clusterRects.get(clusterId);
      if (!r) continue;

      const nodes = graph.nodes.filter((n) => n.clusterId === clusterId);
      const claim = nodes.find((n) => n.type === "claim");
      const focusProp = nodes.find((n) => n.type === "proposition" && n.isFocus);
      const assumptions = nodes
        .filter((n) => n.type === "assumption")
        .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
      const otherProps = nodes
        .filter((n) => n.type === "proposition" && !n.isFocus)
        .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));

      const cx = r.x + r.w / 2;
      if (claim) putNode(claim.id, cx, r.y + 95);
      if (focusProp) putNode(focusProp.id, cx, r.y + 190);

      // row for non-focus propositions (if any)
      if (otherProps.length) {
        const step = r.w / (otherProps.length + 1);
        otherProps.forEach((p, i) => {
          putNode(p.id, r.x + step * (i + 1), r.y + 265);
        });
      }

      // assumptions in compact grid rows
      if (assumptions.length) {
        const cols = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(assumptions.length))));
        const stepX = (r.w - 140) / Math.max(cols - 1, 1);
        const baseX = r.x + 70;
        const baseY = r.y + 365;
        const stepY = 95;
        assumptions.forEach((a, idx) => {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          putNode(a.id, baseX + col * stepX, baseY + row * stepY);
        });
      }

      // clamp everything into cluster bounds
      for (const n of nodes) {
        const pos = nodePos.get(n.id);
        if (!pos) continue;
        const sz = nodeSize(n);
        pos.x = clamp(pos.x, r.x + sz.w / 2, r.x + r.w - sz.w / 2);
        pos.y = clamp(pos.y, r.y + sz.h / 2, r.y + r.h - sz.h / 2);
      }
    }

    return { clusterRects };
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

  function drawGraph(rawGraph) {
    const graph = preprocessGraph(rawGraph);
    nodeMetrics.clear();
    for (const n of graph.nodes) nodeMetrics.set(n.id, getMainNodeMetric(n));
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    svg.setAttribute("width", String(WIDTH));
    svg.setAttribute("height", String(HEIGHT));

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
    const clusterRects = layout.clusterRects;

    for (const c of graph.clusters) {
      const r = clusterRects.get(c.id);
      if (!r) continue;
      world.appendChild(createSvgEl("rect", {
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        fill: "transparent",
        stroke: "#374151",
        "stroke-width": 2,
        "stroke-dasharray": "10 8",
        rx: 14,
      }));
      const label = createSvgEl("text", {
        x: r.x + 18,
        y: r.y + 28,
        "font-size": 15,
        "font-weight": 700,
        fill: "#111827",
      });
      label.textContent = c.label;
      world.appendChild(label);
    }

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
        stroke: isAttack ? "#dc2626" : "#111827",
        "stroke-opacity": isAttack ? 0.82 : 0.55,
        "stroke-width": isAttack ? 2.4 : 1.8,
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
    for (const n of graph.nodes) {
      const p = nodePos.get(n.id);
      if (!p) continue;
      const style = typeStyle(n);
      const sz = nodeSize(n);

      const g = createSvgEl("g", { transform: `translate(${p.x} ${p.y})`, style: "cursor: grab;" });
      g.dataset.nodeId = n.id;
      const shape = createSvgEl("ellipse", {
        cx: 0,
        cy: 0,
        rx: sz.w / 2,
        ry: sz.h / 2,
        fill: style.fill,
        stroke: style.stroke,
        "stroke-width": n.isFocus ? 4 : 2,
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

      const bounds = n.clusterId ? clusterRects.get(n.clusterId) : null;
      if (!LOCK_AUTO_LAYOUT) attachNodeDrag(g, n, bounds);

      g.addEventListener("mouseenter", () => {
        const connected = connectedByNode.get(n.id) || new Set();
        for (const ei of edgeItems) {
          const on = connected.has(ei.edge.id);
          ei.path.setAttribute("stroke-opacity", on ? "1" : "0.1");
          ei.path.setAttribute("stroke-width", ei.edge.type === "attack" ? (on ? "3.1" : "1.6") : (on ? "2.3" : "1.2"));
          if (ei.label) ei.label.setAttribute("opacity", on ? "1" : "0.2");
        }
      });
      g.addEventListener("mouseleave", () => {
        for (const ei of edgeItems) {
          ei.path.setAttribute("stroke-opacity", ei.edge.type === "attack" ? "0.82" : "0.55");
          ei.path.setAttribute("stroke-width", ei.edge.type === "attack" ? "2.4" : "1.8");
          if (ei.label) ei.label.setAttribute("opacity", "1");
        }
      });

      nodeLayer.appendChild(g);
      nodeItems.push({ node: n, group: g });
    }

    scene = { world, edgeItems, nodeItems };
    setWorldTransform();
    updateScene();
    requestAnimationFrame(() => {
      autoFitMainViewport();
    });
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
    svg.addEventListener("dblclick", () => {
      autoFitMainViewport();
    });

    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        autoFitMainViewport();
      });
    });
  }

  function setPreferredWorldTransform() {
    if (!preferredScene) return;
    preferredScene.world.setAttribute(
      "transform",
      `translate(${preferredView.x} ${preferredView.y}) scale(${preferredView.scale})`
    );
  }

  function preferredClientToWorld(clientX, clientY) {
    const rect = preferredSvg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - preferredView.x) / preferredView.scale,
      y: (clientY - rect.top - preferredView.y) / preferredView.scale,
    };
  }

  function getVisiblePreferredBounds() {
    if (!preferredScene || !preferredScene.nodeItems?.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const item of preferredScene.nodeItems) {
      if (!item || !item.group || item.group.style.display === "none") continue;
      const p = preferredNodePos.get(item.node.id);
      if (!p) continue;
      const sz = preferredNodeSize(item.node);
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

  function autoFitPreferredViewport() {
    if (!preferredSvg || !preferredScene) return;
    const panel = preferredSvg.closest(".graph-panel");
    if (!panel) return;
    const bounds = getVisiblePreferredBounds();
    if (!bounds) return;

    const viewportW = Math.max(1, panel.clientWidth);
    const viewportH = Math.max(1, panel.clientHeight);
    const pad = 40;
    const fitW = Math.max(1, viewportW - pad * 2);
    const fitH = Math.max(1, viewportH - pad * 2);
    const safeMargin = selectedLayerMode === "layer2" ? 120 : 72;
    const fitScale = Math.min(
      fitW / (bounds.width + safeMargin * 2),
      fitH / (bounds.height + safeMargin * 2)
    );
    const minReadableScale = selectedLayerMode === "layer2" ? 0.78 : 0.65;
    const nextScale = clamp(fitScale, minReadableScale, 3.2);

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    preferredView.scale = nextScale;
    preferredView.x = viewportW / 2 - cx * nextScale;
    preferredView.y = viewportH / 2 - cy * nextScale;
    panel.scrollLeft = 0;
    panel.scrollTop = 0;
    const screenMinX = bounds.minX * preferredView.scale + preferredView.x - panel.scrollLeft;
    const screenMaxX = bounds.maxX * preferredView.scale + preferredView.x - panel.scrollLeft;
    const screenMinY = bounds.minY * preferredView.scale + preferredView.y - panel.scrollTop;
    const screenMaxY = bounds.maxY * preferredView.scale + preferredView.y - panel.scrollTop;
    const dx = viewportW / 2 - (screenMinX + screenMaxX) / 2;
    const dy = viewportH / 2 - (screenMinY + screenMaxY) / 2;
    preferredView.x += dx;
    preferredView.y += dy;
    setPreferredWorldTransform();
  }


  function getPreferredNodeMetric(node) {
    const cached = node && node.id ? preferredNodeMetrics.get(node.id) : null;
    if (cached) return cached;
    const isClaim = node?.type === "claim";
    const isLevel2 = !isClaim && Number(node?.level) === 2;
    const minW = isClaim ? 280 : (isLevel2 ? 150 : 190);
    const maxW = isClaim ? 520 : (isLevel2 ? 300 : 430);
    const fontSize = isClaim ? 14 : (isLevel2 ? 12 : 13);
    const fontWeight = isClaim ? 700 : 500;
    const padX = isClaim ? 28 : (isLevel2 ? 18 : 22);
    const padY = isClaim ? 16 : 14;
    const lineHeight = isClaim ? 18 : (isLevel2 ? 15 : 16);
    const maxTextW = maxW - padX * 2;
    const lines = wrapTextWithMaxWidth(node?.label || "", maxTextW, fontSize, fontWeight, 3);
    const widest = Math.max(...lines.map((l) => measureTextWidth(l, fontSize, fontWeight)), 0);
    const w = clamp(widest + padX * 2, minW, maxW);
    const h = Math.max(isClaim ? 72 : 58, lines.length * lineHeight + padY * 2);
    const metric = { w, h, lines, fontSize, fontWeight, lineHeight };
    if (node && node.id) preferredNodeMetrics.set(node.id, metric);
    return metric;
  }

  function preferredNodeSize(node) {
    return getPreferredNodeMetric(node);
  }

  function preferredTypeStyle(node) {
    if (node.type === "claim") return { fill: "#d1d5db", stroke: "#4b5563" };
    const side = resolveNodeSide(node);
    if (side === "bad") return { fill: "#fecaca", stroke: "#b91c1c" };
    return { fill: "#86efac", stroke: "#166534" };
  }

  function preferredEdgeAnchor(fromId, toId) {
    const from = preferredNodePos.get(fromId);
    const to = preferredNodePos.get(toId);
    const fromNode = preferredNodeById.get(fromId);
    const toNode = preferredNodeById.get(toId);
    if (!from || !to || !fromNode || !toNode) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const fs = preferredNodeSize(fromNode);
    const ts = preferredNodeSize(toNode);
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

  function updatePreferredScene() {
    if (!preferredScene) return;
    for (const e of preferredScene.edgeItems) {
      const p = preferredEdgeAnchor(e.edge.source, e.edge.target);
      if (!p) continue;
      if (e.edge.type === "attack") {
        const mx = (p.sx + p.tx) / 2;
        const my = (p.sy + p.ty) / 2 - 24;
        e.path.setAttribute("d", `M ${p.sx} ${p.sy} Q ${mx} ${my} ${p.tx} ${p.ty}`);
      } else {
        e.path.setAttribute("d", `M ${p.sx} ${p.sy} L ${p.tx} ${p.ty}`);
      }
    }
    for (const n of preferredScene.nodeItems) {
      const p = preferredNodePos.get(n.node.id);
      if (!p) continue;
      n.group.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  }

  function attachPreferredNodeDrag(group, node) {
    let dragging = false;
    let offset = null;

    function onMove(ev) {
      if (!dragging) return;
      const world = preferredClientToWorld(ev.clientX, ev.clientY);
      const p = preferredNodePos.get(node.id);
      const sz = preferredNodeSize(node);
      p.x = clamp(world.x - offset.x, sz.w / 2, preferredCanvasWidth - sz.w / 2);
      p.y = clamp(world.y - offset.y, sz.h / 2, preferredCanvasHeight - sz.h / 2);
      updatePreferredScene();
    }

    function onUp() {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    group.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      const p = preferredNodePos.get(node.id);
      const world = preferredClientToWorld(ev.clientX, ev.clientY);
      offset = { x: world.x - p.x, y: world.y - p.y };
      dragging = true;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  function drawPreferredGraph(preferredResult, payload, warnings, countLookup, graphMeta) {
    if (!preferredSvg) return;
    preferredSvg.innerHTML = "";
    preferredCanvasWidth = PREF_WIDTH;
    preferredCanvasHeight = PREF_HEIGHT;
    preferredSvg.setAttribute("viewBox", `0 0 ${preferredCanvasWidth} ${preferredCanvasHeight}`);
    preferredSvg.setAttribute("width", String(preferredCanvasWidth));
    preferredSvg.setAttribute("height", String(preferredCanvasHeight));

    const defs = createSvgEl("defs", {});
    const markerSupport = createSvgEl("marker", {
      id: "arrow-pref-support",
      markerWidth: 12,
      markerHeight: 12,
      refX: 10,
      refY: 4,
      orient: "auto",
      markerUnits: "strokeWidth",
    });
    markerSupport.appendChild(createSvgEl("path", { d: "M0,0 L0,8 L10,4 z", fill: "#111827" }));
    defs.appendChild(markerSupport);

    const markerAttack = createSvgEl("marker", {
      id: "arrow-pref-attack",
      markerWidth: 12,
      markerHeight: 12,
      refX: 10,
      refY: 4,
      orient: "auto",
      markerUnits: "strokeWidth",
    });
    markerAttack.appendChild(createSvgEl("path", { d: "M0,0 L0,8 L10,4 z", fill: "#dc2626" }));
    defs.appendChild(markerAttack);
    preferredSvg.appendChild(defs);

    const world = createSvgEl("g", {});
    preferredSvg.appendChild(world);

    preferredNodePos.clear();
    preferredNodeById.clear();
    preferredNodeMetrics.clear();
    preferredConnectedByNode.clear();

    const exts = preferredResult?.extensions || [];
    const derivedList = preferredResult?.derived || [];
    const query = payload?.query ? String(payload.query) : "query";
    const assumptions = (payload?.assumptions || []).map((x) => String(x));
    const rules = payload?.rules || [];
    const contraries = payload?.contraries || {};
    const nodes = [];
    const edges = [];
    const clusters = [];
    const nodeSet = new Set();
    const rulePremiseToNodeIds = new Map();
    const claimIds = [];

    const claims = Array.from(
      new Set(
        rules
          .map((r) => String(r?.conclusion || "").trim())
          .filter(Boolean)
      )
    );
    if (query && !claims.includes(query)) claims.unshift(query);
    claims.forEach((claim, idx) => {
      const clusterId = `claim_cluster_${idx + 1}_${claim}`;
      const clusterSentiment = claim.startsWith("bad_") ? "bad" : "good";
      clusters.push({ id: clusterId, label: `claim:${claim}` });
      const claimNodeId = `${clusterId}::C::${claim}`;
      claimIds.push(claimNodeId);
      const claimDerivedInAll =
        derivedList.length > 0 && derivedList.every((d) => Array.isArray(d) && d.includes(claim));
      const claimDerivedInAny =
        derivedList.length > 0 && derivedList.some((d) => Array.isArray(d) && d.includes(claim));
      nodes.push({
        id: claimNodeId,
        clusterId,
        type: "claim",
        label: claim,
        clusterSentiment,
        satisfied: claimDerivedInAll ? true : (claimDerivedInAny ? null : false),
        count: Number.isFinite(Number(countLookup?.get(`claim::${claim}`)))
          ? Number(countLookup?.get(`claim::${claim}`))
          : null,
      });
      nodeSet.add(claimNodeId);
    });

    function findClusterForClaim(claim) {
      return clusters.find((c) => c.id.endsWith(`_${claim}`)) || null;
    }

    for (const r of rules) {
      const conclusion = String(r?.conclusion || "").trim();
      const premises = Array.isArray(r?.premises) ? r.premises : [];
      if (!conclusion) continue;
      const cl = findClusterForClaim(conclusion);
      if (!cl) continue;
      const clusterSentiment = conclusion.startsWith("bad_") ? "bad" : "good";
      const claimNodeId = `${cl.id}::C::${conclusion}`;

      for (const p of premises) {
        const prem = String(p || "").trim();
        if (!prem) continue;
        const isAssumption = assumptions.includes(prem);
        const nodeType = isAssumption ? "assumption" : "proposition";
        const premiseNodeId = `${cl.id}::${isAssumption ? "A" : "P"}::${prem}`;
        if (!nodeSet.has(premiseNodeId)) {
          const premiseDbCount = Number(countLookup?.get(`${nodeType}::${prem}`));
          nodes.push({
            id: premiseNodeId,
            clusterId: cl.id,
            type: nodeType,
            label: prem,
            clusterSentiment,
            count: Number.isFinite(premiseDbCount) && premiseDbCount > 0 ? premiseDbCount : null,
          });
          nodeSet.add(premiseNodeId);
        }
        edges.push({
          id: `sup_${premiseNodeId}_${claimNodeId}`,
          source: premiseNodeId,
          target: claimNodeId,
          type: "support",
        });
        if (!rulePremiseToNodeIds.has(prem)) rulePremiseToNodeIds.set(prem, []);
        rulePremiseToNodeIds.get(prem).push(premiseNodeId);
      }
    }

    const attackerPairs = [];
    for (const a of assumptions) {
      const direct = String(contraries[a] || "").trim();
      if (direct) attackerPairs.push({ attacker: direct, target: a });
    }
    const localWarnings = Array.isArray(warnings) ? warnings.map((w) => String(w)) : [];
    for (const w of localWarnings) {
      const m = w.match(/assumption '([^']+)'.*\(([^,]+), ([^)]+)\)/);
      if (!m) continue;
      const target = String(m[1] || "").trim();
      const attacker = String(m[3] || "").trim();
      if (target && attacker) attackerPairs.push({ attacker, target });
    }
    const seenAttack = new Set();
    for (const pair of attackerPairs) {
      const attackers = rulePremiseToNodeIds.get(pair.attacker) || [];
      const targets = [];
      for (const n of nodes) {
        if (n.type === "assumption" && n.label === pair.target) targets.push(n.id);
      }
      for (const src of attackers) {
        for (const tgt of targets) {
          const key = `${src}::${tgt}`;
          if (seenAttack.has(key)) continue;
          seenAttack.add(key);
          edges.push({ id: `atk_${seenAttack.size}`, source: src, target: tgt, type: "attack" });
        }
      }
    }

    const extSet = new Set((exts[0] || []).map((x) => String(x)));
    for (const n of nodes) {
      if (n.type === "assumption" && extSet.has(n.label)) n.inPreferred = true;
    }

    const allowedClaimLabels = new Set(
      [query, graphMeta?.claimA, graphMeta?.claimB, graphMeta?.claimC]
        .filter(Boolean)
        .map((x) => String(x))
    );
    const hiddenNodeIds = new Set(
      nodes
        .filter((n) => {
          if (n.type !== "claim") return false;
          if (!allowedClaimLabels.size) return false;
          return !allowedClaimLabels.has(String(n.label || ""));
        })
        .map((n) => n.id)
    );
    if (hiddenNodeIds.size) {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (hiddenNodeIds.has(nodes[i].id)) nodes.splice(i, 1);
      }
      for (let i = edges.length - 1; i >= 0; i -= 1) {
        if (hiddenNodeIds.has(edges[i].source) || hiddenNodeIds.has(edges[i].target)) {
          edges.splice(i, 1);
        }
      }
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const claimNodes = nodes.filter((n) => n.type === "claim");
    const supportIncoming = (claimId, type = null) =>
      edges
        .filter((e) => e.type === "support" && e.target === claimId)
        .map((e) => nodeById.get(e.source))
        .filter((n) => n && (!type || n.type === type));
    const attackIncomingTo = (targetIds, type = null) =>
      edges
        .filter((e) => e.type === "attack" && targetIds.has(e.target))
        .map((e) => nodeById.get(e.source))
        .filter((n) => n && (!type || n.type === type));
    const pickClaimNode = (label) =>
      claimNodes.find((n) => String(n.label || "") === String(label || "")) || null;
    function inferClaimFromAttackers(attackerNodes, excludedLabels) {
      const attackerIds = new Set(attackerNodes.map((n) => n.id));
      const excluded = new Set((excludedLabels || []).filter(Boolean).map((x) => String(x)));
      const scores = [];
      for (const c of claimNodes) {
        const cl = String(c.label || "");
        if (excluded.has(cl)) continue;
        const supporters = supportIncoming(c.id, "proposition");
        const hit = supporters.filter((n) => attackerIds.has(n.id)).length;
        if (hit > 0) scores.push({ node: c, score: hit });
      }
      scores.sort((a, b) => b.score - a.score || String(a.node.label || "").localeCompare(String(b.node.label || "")));
      return scores.length ? scores[0].node : null;
    }

    const claimAByMeta = pickClaimNode(graphMeta?.claimA);
    const claimA =
      claimAByMeta ||
      pickClaimNode(query) ||
      claimNodes[0] ||
      null;

    if (claimA) {
      const claimBByMeta = pickClaimNode(graphMeta?.claimB);
      const level0 = new Set([claimA.id]);
      const level1NodesAll = supportIncoming(claimA.id);
      const level1 = new Set(level1NodesAll.map((n) => n.id));
      const level1Assumptions = new Set(level1NodesAll.filter((n) => n.type === "assumption").map((n) => n.id));

      const level2AttackersAll = attackIncomingTo(level1Assumptions, "proposition");
      const inferredClaimB = inferClaimFromAttackers(level2AttackersAll, [claimA.label]);
      const claimB = claimBByMeta || inferredClaimB;
      const level3 = new Set(claimB ? [claimB.id] : []);
      const claimBPropositions = claimB ? new Set(supportIncoming(claimB.id, "proposition").map((n) => n.id)) : null;
      const level2 = new Set(
        level2AttackersAll
          .filter((n) => !claimBPropositions || claimBPropositions.has(n.id))
          .map((n) => n.id)
      );
      if (!level2.size) {
        for (const n of level2AttackersAll) level2.add(n.id);
      }

      // Level 4-7 only: keep level 0-3 untouched.
      const claimBAssumptionNodes = claimB ? supportIncoming(claimB.id, "assumption") : [];
      const claimBAssumptionIds = new Set(claimBAssumptionNodes.map((n) => n.id));
      const level4 = new Set();
      const level4CloneIdsByBase = new Map();
      const attackTargetsBySrc = new Map();
      for (const e of edges) {
        if (e.type !== "attack") continue;
        if (!level2.has(e.source)) continue;
        if (!claimBAssumptionIds.has(e.target)) continue;
        if (!attackTargetsBySrc.has(e.source)) attackTargetsBySrc.set(e.source, []);
        attackTargetsBySrc.get(e.source).push(e.target);
      }
      const fallbackAssumptionIds = claimBAssumptionNodes.map((n) => n.id);
      let fallbackIdx = 0;
      for (const srcId of level2) {
        const srcNode = nodeById.get(srcId);
        if (!srcNode) continue;
        let targetBaseId = null;
        const directTargets = attackTargetsBySrc.get(srcId) || [];
        if (directTargets.length) {
          targetBaseId = directTargets[0];
        } else {
          const attackerLabel = String(srcNode.label || "").trim();
          const byContrary = claimBAssumptionNodes.find(
            (a) => String((contraries && contraries[a.label]) || "").trim() === attackerLabel
          );
          if (byContrary) targetBaseId = byContrary.id;
        }
        if (!targetBaseId && fallbackAssumptionIds.length) {
          targetBaseId = fallbackAssumptionIds[fallbackIdx % fallbackAssumptionIds.length];
          fallbackIdx += 1;
        }
        if (!targetBaseId) continue;
        const base = nodeById.get(targetBaseId);
        if (!base) continue;
        const cloneId = `${targetBaseId}::L4::${srcId}`;
        if (!nodeById.has(cloneId)) {
          const clone = { ...base, id: cloneId, isFocus: false };
          nodes.push(clone);
          nodeById.set(cloneId, clone);
        }
        level4.add(cloneId);
        if (!level4CloneIdsByBase.has(targetBaseId)) level4CloneIdsByBase.set(targetBaseId, []);
        level4CloneIdsByBase.get(targetBaseId).push(cloneId);
        edges.push({
          id: `sup_${cloneId}_${claimB.id}`,
          source: cloneId,
          target: claimB.id,
          type: "support",
        });
      }

      // Level 5 = only claimA propositions that attack assumptions.
      const level5 = new Set();
      const level5ByLabel = new Map();
      const claimAPropsMeta = Array.isArray(graphMeta?.claimAPropositionsAll) ? graphMeta.claimAPropositionsAll : [];
      const claimAPropsSource = claimAPropsMeta.length
        ? claimAPropsMeta.map((r) => ({ label: String(r.proposition || "").trim(), count: Number(r.count) || null }))
        : supportIncoming(claimA.id, "proposition").map((n) => ({ label: String(n.label || "").trim(), count: Number(n.count) || null }));
      const claimAAssMeta = Array.isArray(graphMeta?.claimAAssumptionsAll) ? graphMeta.claimAAssumptionsAll : [];
      const claimAAssSource = claimAAssMeta.length
        ? claimAAssMeta.map((r) => ({ label: String(r.assumption || "").trim(), count: Number(r.count) || null }))
        : supportIncoming(claimA.id, "assumption").map((n) => ({ label: String(n.label || "").trim(), count: Number(n.count) || null }));
      const claimAPropLabelSet = new Set(claimAPropsSource.map((p) => p.label).filter(Boolean));
      const claimAAssLabelSet = new Set(claimAAssSource.map((a) => a.label).filter(Boolean));
      const pairedLevel5Labels = new Set();
      const pairedLevel7Labels = new Set();
      const pairLinks = [];
      const level4BaseAssumptionIds = new Set(level4CloneIdsByBase.keys());
      const level4AssumptionLabels = new Set(
        [...level4BaseAssumptionIds]
          .map((id) => String(nodeById.get(id)?.label || "").trim())
          .filter(Boolean)
      );
      const claimALevel5PairsMeta = Array.isArray(graphMeta?.claimALevel5Pairs) ? graphMeta.claimALevel5Pairs : [];

      // Level 5 strict: claimA proposition that attacks Level 4 assumptions.
      for (const r of claimALevel5PairsMeta) {
        const p = String(r?.proposition || "").trim();
        const a = String(r?.assumption || "").trim();
        if (!p || !a) continue;
        if (!claimAPropLabelSet.has(p)) continue;
        if (!level4AssumptionLabels.has(a)) continue;
        pairedLevel5Labels.add(p);
      }
      if (!pairedLevel5Labels.size) {
        for (const e of edges) {
          if (e.type !== "attack") continue;
          if (!level4BaseAssumptionIds.has(e.target)) continue;
          const srcLabel = String(nodeById.get(e.source)?.label || "").trim();
          if (!claimAPropLabelSet.has(srcLabel)) continue;
          pairedLevel5Labels.add(srcLabel);
        }
        for (const aLabel of level4AssumptionLabels) {
          const attacker = String((contraries && contraries[aLabel]) || "").trim();
          if (!attacker || !claimAPropLabelSet.has(attacker)) continue;
          pairedLevel5Labels.add(attacker);
        }
      }

      // Level 7 pairing still follows claimA proposition-assumption pairs.
      const attackPairsMeta = Array.isArray(graphMeta?.claimAAttackPairs) ? graphMeta.claimAAttackPairs : [];
      for (const r of attackPairsMeta) {
        const p = String(r?.proposition || "").trim();
        const a = String(r?.assumption || "").trim();
        if (!p || !a) continue;
        if (!claimAPropLabelSet.has(p) || !claimAAssLabelSet.has(a)) continue;
        pairedLevel7Labels.add(a);
        pairLinks.push({ prop: p, ass: a });
      }
      for (const e of edges) {
        if (e.type !== "attack") continue;
        const srcLabel = String(nodeById.get(e.source)?.label || "").trim();
        const tgtLabel = String(nodeById.get(e.target)?.label || "").trim();
        if (!claimAPropLabelSet.has(srcLabel) || !claimAAssLabelSet.has(tgtLabel)) continue;
        pairedLevel7Labels.add(tgtLabel);
        pairLinks.push({ prop: srcLabel, ass: tgtLabel });
      }
      for (const a of claimAAssLabelSet) {
        const attacker = String((contraries && contraries[a]) || "").trim();
        if (!attacker || !claimAPropLabelSet.has(attacker)) continue;
        pairedLevel7Labels.add(a);
        pairLinks.push({ prop: attacker, ass: a });
      }
      const upperVisibleIdsForDedup = new Set([...level0, ...level1, ...level2, ...level3, ...level4]);
      const upperLabelsForDedup = new Set(
        [...upperVisibleIdsForDedup]
          .map((id) => String(nodeById.get(id)?.label || "").trim())
          .filter(Boolean)
      );
      for (const p of claimAPropsSource) {
        if (!p.label) continue;
        if (!pairedLevel5Labels.has(p.label)) continue;
        if (upperLabelsForDedup.has(p.label)) continue;
        const cloneId = `L5::${claimA.id}::${p.label}`;
        if (!nodeById.has(cloneId)) {
          const clone = {
            id: cloneId,
            clusterId: claimA.clusterId,
            clusterSentiment: claimA.clusterSentiment,
            type: "proposition",
            label: p.label,
            count: p.count,
            isFocus: false,
          };
          nodes.push(clone);
          nodeById.set(cloneId, clone);
        }
        level5.add(cloneId);
        level5ByLabel.set(p.label, cloneId);
      }
      // Safety fallback: if dedup removed all Level 5 nodes, restore required pair labels.
      if (!level5.size && pairedLevel5Labels.size) {
        const propCountByLabel = new Map(
          claimAPropsSource.map((p) => [String(p.label || "").trim(), Number(p.count) || null])
        );
        for (const label of pairedLevel5Labels) {
          const cloneId = `L5::${claimA.id}::${label}`;
          if (!nodeById.has(cloneId)) {
            const clone = {
              id: cloneId,
              clusterId: claimA.clusterId,
              clusterSentiment: claimA.clusterSentiment,
              type: "proposition",
              label,
              count: propCountByLabel.get(label) || null,
              isFocus: false,
            };
            nodes.push(clone);
            nodeById.set(cloneId, clone);
          }
          level5.add(cloneId);
          level5ByLabel.set(label, cloneId);
        }
      }
      const level5Labels = new Set(level5ByLabel.keys());
      const claimAAssLabelsOrdered = claimAAssSource
        .map((a) => String(a.label || "").trim())
        .filter(Boolean);
      const claimAAssLabelSet2 = new Set(claimAAssLabelsOrdered);
      const assCountByLabel = new Map(claimAAssSource.map((a) => [String(a.label || "").trim(), Number(a.count) || 0]));
      const metaPairsByProp = new Map();
      for (const r of attackPairsMeta) {
        const p = String(r?.proposition || "").trim();
        const a = String(r?.assumption || "").trim();
        if (!p || !a) continue;
        if (!claimAAssLabelSet2.has(a)) continue;
        if (!metaPairsByProp.has(p)) metaPairsByProp.set(p, []);
        metaPairsByProp.get(p).push(a);
      }
      const pairByProp = new Map();
      let fallbackIdxAss = 0;
      for (const prop of level5Labels) {
        const candidates = [];
        const fromMeta = metaPairsByProp.get(prop) || [];
        for (const a of fromMeta) candidates.push(a);
        for (const a of claimAAssLabelSet2) {
          const attacker = String((contraries && contraries[a]) || "").trim();
          if (attacker === prop) candidates.push(a);
        }
        const uniq = [...new Set(candidates.filter((a) => claimAAssLabelSet2.has(a)))];
        let picked = null;
        if (uniq.length) {
          picked = uniq[0];
          for (const a of uniq.slice(1)) {
            const pa = Number(assCountByLabel.get(picked) || 0);
            const ca = Number(assCountByLabel.get(a) || 0);
            if (ca > pa || (ca === pa && String(a).localeCompare(String(picked)) < 0)) picked = a;
          }
        } else if (claimAAssLabelsOrdered.length) {
          picked = claimAAssLabelsOrdered[fallbackIdxAss % claimAAssLabelsOrdered.length];
          fallbackIdxAss += 1;
        }
        if (picked) pairByProp.set(prop, picked);
      }
      const finalPairLinks = [];
      pairedLevel7Labels.clear();
      for (const [prop, ass] of pairByProp.entries()) {
        finalPairLinks.push({ prop, ass });
        pairedLevel7Labels.add(ass);
      }

      // Level 6 = claimA clone.
      const claimACloneId = `${claimA.id}::L6`;
      if (!nodeById.has(claimACloneId)) {
        const claimAClone = { ...claimA, id: claimACloneId, isFocus: false };
        nodes.push(claimAClone);
        nodeById.set(claimACloneId, claimAClone);
      }
      const level6 = new Set([claimACloneId]);

      // Level 7 = assumptions mapped from Level 5 propositions.
      const level7 = new Set();
      const assCountByLabelForL7 = new Map(
        claimAAssSource.map((a) => [String(a.label || "").trim(), Number(a.count) || null])
      );
      const finalPairByProp = new Map(
        finalPairLinks.map((x) => [String(x.prop || "").trim(), String(x.ass || "").trim()])
      );
      for (const [propLabel] of level5ByLabel.entries()) {
        const strictMeta = [...new Set((metaPairsByProp.get(propLabel) || []).filter((a) => claimAAssLabelSet2.has(a)))];
        let assLabel = null;
        if (strictMeta.length) {
          const sorted = strictMeta.sort((a, b) => {
            const ca = Number(assCountByLabelForL7.get(a) || 0);
            const cb = Number(assCountByLabelForL7.get(b) || 0);
            if (cb !== ca) return cb - ca;
            return String(a).localeCompare(String(b));
          });
          assLabel = sorted[0];
        } else {
          const fp = String(finalPairByProp.get(propLabel) || "").trim();
          assLabel = fp && claimAAssLabelSet2.has(fp) ? fp : null;
        }
        if (!assLabel) {
          const byContrary = [];
          for (const a of claimAAssLabelSet2) {
            const attacker = String((contraries && contraries[a]) || "").trim();
            if (attacker === propLabel) byContrary.push(a);
          }
          if (byContrary.length) {
            const sorted = [...new Set(byContrary)].sort((a, b) => {
              const ca = Number(assCountByLabelForL7.get(a) || 0);
              const cb = Number(assCountByLabelForL7.get(b) || 0);
              if (cb !== ca) return cb - ca;
              return String(a).localeCompare(String(b));
            });
            assLabel = sorted[0];
          }
        }
        if (!assLabel) continue;
        const cloneId = `L7::${claimA.id}::${assLabel}::from::${propLabel}`;
        if (!nodeById.has(cloneId)) {
          const clone = {
            id: cloneId,
            clusterId: claimA.clusterId,
            clusterSentiment: claimA.clusterSentiment,
            type: "assumption",
            label: assLabel,
            count: Number(assCountByLabelForL7.get(assLabel)) || null,
            isFocus: false,
          };
          nodes.push(clone);
          nodeById.set(cloneId, clone);
        }
        level7.add(cloneId);
      }

      // Connect level 5/7 clones to level 6 clone via support.
      for (const pId of level5) {
        edges.push({
          id: `sup_${pId}_${claimACloneId}`,
          source: pId,
          target: claimACloneId,
          type: "support",
        });
      }
      for (const aId of level7) {
        edges.push({
          id: `sup_${aId}_${claimACloneId}`,
          source: aId,
          target: claimACloneId,
          type: "support",
        });
      }

      // Mirror attack edges from original claimA propositions to level 5 clones, targeting level4 clone pairs.
      const attackEdgeKey = new Set(edges.map((e) => `${e.type}::${e.source}::${e.target}`));
      const pushAttackEdgeUnique = (source, target, idPrefix = "atk") => {
        if (!source || !target) return;
        const key = `attack::${source}::${target}`;
        if (attackEdgeKey.has(key)) return;
        attackEdgeKey.add(key);
        edges.push({
          id: `${idPrefix}_${source}_${target}`,
          source,
          target,
          type: "attack",
        });
      };

      for (const e of edges.slice()) {
        if (e.type !== "attack") continue;
        const srcLabel = String(nodeById.get(e.source)?.label || "");
        const cloneSrc = level5ByLabel.get(srcLabel);
        if (!cloneSrc) continue;
        const cloneTargets = level4CloneIdsByBase.get(e.target) || [];
        for (const t of cloneTargets) {
          pushAttackEdgeUnique(cloneSrc, t, "atk");
        }
      }

      // Ensure Level 5 attack edges are complete from SQL-derived pairs (ABA.sql),
      // not only from currently rendered raw attack edges.
      const level4CloneIdsByLabel = new Map();
      for (const [baseId, cloneIds] of level4CloneIdsByBase.entries()) {
        const label = String(nodeById.get(baseId)?.label || "").trim();
        if (!label) continue;
        if (!level4CloneIdsByLabel.has(label)) level4CloneIdsByLabel.set(label, []);
        level4CloneIdsByLabel.get(label).push(...cloneIds);
      }
      for (const pair of claimALevel5PairsMeta) {
        const prop = String(pair?.proposition || "").trim();
        const ass = String(pair?.assumption || "").trim();
        if (!prop || !ass) continue;
        const cloneSrc = level5ByLabel.get(prop);
        if (!cloneSrc) continue;
        const cloneTargets = level4CloneIdsByLabel.get(ass) || [];
        for (const t of cloneTargets) {
          pushAttackEdgeUnique(cloneSrc, t, "atkmeta");
        }
      }

      const levelToIds = new Map([
        [0, level0],
        [1, level1],
        [2, level2],
        [3, level3],
        [4, level4],
        [5, level5],
        [6, level6],
        [7, level7],
      ]);
      const maxVisibleLevel = getMaxVisibleLevel();
      const visibleIds = new Set();
      for (const [lv, ids] of levelToIds.entries()) {
        if (lv > maxVisibleLevel) continue;
        for (const id of ids) visibleIds.add(id);
      }
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (!visibleIds.has(nodes[i].id)) nodes.splice(i, 1);
      }
      for (let i = edges.length - 1; i >= 0; i -= 1) {
        const e = edges[i];
        if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) {
          edges.splice(i, 1);
          continue;
        }
        const keepSupportA = e.type === "support" && level1.has(e.source) && level0.has(e.target);
        const keepAttackAB = e.type === "attack" && level2.has(e.source) && level1Assumptions.has(e.target);
        const keepSupportB = e.type === "support" && (level2.has(e.source) || level4.has(e.source)) && level3.has(e.target);
        const keepAttackBC = e.type === "attack" && level5.has(e.source) && level4.has(e.target);
        const keepSupportC = e.type === "support" && (level5.has(e.source) || level7.has(e.source)) && level6.has(e.target);
        if (!keepSupportA && !keepAttackAB && !keepSupportB && !keepAttackBC && !keepSupportC) {
          edges.splice(i, 1);
        }
      }

      for (const n of nodes) {
        if (level0.has(n.id)) n.level = 0;
        else if (level1.has(n.id)) n.level = 1;
        else if (level2.has(n.id)) n.level = 2;
        else if (level3.has(n.id)) n.level = 3;
        else if (level4.has(n.id)) n.level = 4;
        else if (level5.has(n.id)) n.level = 5;
        else if (level6.has(n.id)) n.level = 6;
        else if (level7.has(n.id)) n.level = 7;
      }

      const sortLevelNodes = (setIds) =>
        nodes
          .filter((n) => setIds.has(n.id))
          .sort((a, b) => {
            const ta = a.type === "claim" ? 0 : (a.type === "proposition" ? 1 : 2);
            const tb = b.type === "claim" ? 0 : (b.type === "proposition" ? 1 : 2);
            if (ta !== tb) return ta - tb;
            return String(a.label || "").localeCompare(String(b.label || ""));
          });

      const levelNodes = new Map([
        [0, sortLevelNodes(level0)],
        [1, sortLevelNodes(level1)],
        [2, sortLevelNodes(level2)],
        [3, sortLevelNodes(level3)],
        [4, sortLevelNodes(level4)],
        [5, sortLevelNodes(level5)],
        [6, sortLevelNodes(level6)],
        [7, sortLevelNodes(level7)],
      ]);

      const rowGap = 26;
      const subRowGapY = 22;
      const marginX = 44;
      const topPad = 42;
      const levelGap = 72;
      const defaultMaxNodesPerSubRow = 10;

      const rowWidth = (rowNodes) =>
        rowNodes.reduce((sum, n, idx) => {
          const sz = preferredNodeSize(n);
          return sum + sz.w + (idx > 0 ? rowGap : 0);
        }, 0);
      const rowHeight = (rowNodes, fallback) =>
        rowNodes.length ? Math.max(...rowNodes.map((n) => preferredNodeSize(n).h)) : fallback;
      const splitLevelRows = (rowNodes, level) => {
        const maxNodesPerSubRow =
          level === 5 || level === 7
            ? 14
            : defaultMaxNodesPerSubRow;
        if (!rowNodes || !rowNodes.length) return [];
        if (rowNodes.length <= maxNodesPerSubRow) return [rowNodes];
        const out = [];
        for (let i = 0; i < rowNodes.length; i += maxNodesPerSubRow) {
          out.push(rowNodes.slice(i, i + maxNodesPerSubRow));
        }
        return out;
      };

      const activeLevels = [...levelNodes.entries()].filter(([, arr]) => arr.length).map(([lv]) => lv);
      const levelRows = new Map();
      for (const lv of activeLevels) levelRows.set(lv, splitLevelRows(levelNodes.get(lv), lv));
      const widest = activeLevels.length
        ? Math.max(...activeLevels.map((lv) => {
          const rows = levelRows.get(lv) || [];
          return rows.length ? Math.max(...rows.map((r) => rowWidth(r))) : 0;
        }))
        : PREF_WIDTH - marginX * 2;
      preferredCanvasWidth = clamp(Math.ceil(widest * 1.15 + marginX * 2), PREF_WIDTH, 4600);

      const levelHeights = new Map();
      for (const lv of activeLevels) {
        const rows = levelRows.get(lv) || [];
        const totalH = rows.reduce((sum, r, idx) => sum + rowHeight(r, 58) + (idx > 0 ? subRowGapY : 0), 0);
        levelHeights.set(lv, totalH || 58);
      }
      let cursorY = topPad;
      for (const lv of activeLevels) {
        const h = levelHeights.get(lv) || 58;
        cursorY += h + levelGap;
      }
      preferredCanvasHeight = clamp(Math.ceil(cursorY + 56), PREF_HEIGHT, 3200);
      preferredSvg.setAttribute("viewBox", `0 0 ${preferredCanvasWidth} ${preferredCanvasHeight}`);
      preferredSvg.setAttribute("width", String(preferredCanvasWidth));
      preferredSvg.setAttribute("height", String(preferredCanvasHeight));

      function putNode(id, x, y) {
        preferredNodePos.set(id, { x, y });
      }
      function placeRow(rowNodes, y) {
        if (!rowNodes.length) return;
        const total = rowWidth(rowNodes);
        let cursor = (preferredCanvasWidth - total) / 2;
        for (const n of rowNodes) {
          const sz = preferredNodeSize(n);
          cursor += sz.w / 2;
          putNode(n.id, cursor, y);
          cursor += sz.w / 2 + rowGap;
        }
      }

      let y = topPad;
      for (const lv of activeLevels) {
        const rows = levelRows.get(lv) || [];
        const h = levelHeights.get(lv) || 58;
        let rowY = y;
        rows.forEach((r, idx) => {
          const rh = rowHeight(r, 58);
          const centerY = rowY + rh / 2;
          // staircase: alternate left/right offset for wrapped sub-rows.
          if (idx > 0) {
            const total = rowWidth(r);
            const baseShift = Math.min(140, Math.max(36, preferredCanvasWidth * 0.035));
            const dir = idx % 2 === 1 ? 1 : -1;
            let cursor = (preferredCanvasWidth - total) / 2 + baseShift * dir;
            for (const n of r) {
              const sz = preferredNodeSize(n);
              cursor += sz.w / 2;
              putNode(n.id, cursor, centerY);
              cursor += sz.w / 2 + rowGap;
            }
          } else {
            placeRow(r, centerY);
          }
          rowY += rh + subRowGapY;
        });
        y += h + levelGap;
      }
    } else {
      preferredCanvasWidth = PREF_WIDTH;
      preferredCanvasHeight = PREF_HEIGHT;
      preferredSvg.setAttribute("viewBox", `0 0 ${preferredCanvasWidth} ${preferredCanvasHeight}`);
      preferredSvg.setAttribute("width", String(preferredCanvasWidth));
      preferredSvg.setAttribute("height", String(preferredCanvasHeight));
    }

    for (const n of nodes) preferredNodeById.set(n.id, n);
    for (const n of nodes) preferredNodeMetrics.set(n.id, getPreferredNodeMetric(n));
    for (const e of edges) {
      if (!preferredConnectedByNode.has(e.source)) preferredConnectedByNode.set(e.source, new Set());
      if (!preferredConnectedByNode.has(e.target)) preferredConnectedByNode.set(e.target, new Set());
      preferredConnectedByNode.get(e.source).add(e.id);
      preferredConnectedByNode.get(e.target).add(e.id);
    }
    const preferredDegreeByNode = new Map();
    for (const n of nodes) {
      preferredDegreeByNode.set(n.id, (preferredConnectedByNode.get(n.id) || new Set()).size);
    }

    // Cluster frames/labels intentionally hidden per UI request.

    const edgeLayer = createSvgEl("g", {});
    const nodeLayer = createSvgEl("g", {});
    world.appendChild(edgeLayer);
    world.appendChild(nodeLayer);

    const edgeItems = [];
    for (const e of edges) {
      const isAttack = e.type === "attack";
      const isDenseSupportToClone =
        !isAttack &&
        String(e.target || "").endsWith("::L6") &&
        (String(e.source || "").includes("::L5") || String(e.source || "").includes("::L7") || String(e.source || "").includes("L5::") || String(e.source || "").includes("L7::"));
      const baseStrokeWidth = isAttack ? "2.3" : (isDenseSupportToClone ? "1.2" : "1.8");
      const baseStrokeOpacity = isAttack ? "0.82" : (isDenseSupportToClone ? "0.22" : "0.55");
      const path = createSvgEl("path", {
        d: "M0 0 L0 0",
        fill: "none",
        stroke: isAttack ? "#dc2626" : "#111827",
        "stroke-width": baseStrokeWidth,
        "stroke-dasharray": "none",
        "stroke-opacity": baseStrokeOpacity,
        "marker-end": isAttack ? "url(#arrow-pref-attack)" : (isDenseSupportToClone ? "" : "url(#arrow-pref-support)"),
      });
      edgeLayer.appendChild(path);
      edgeItems.push({ edge: e, path, baseStrokeWidth, baseStrokeOpacity });
    }

    const attackIncomingByTarget = new Map();
    const attackerCandidateIds = new Set();
    for (const e of edges) {
      if (e.type !== "attack") continue;
      attackerCandidateIds.add(e.source);
      if (!attackIncomingByTarget.has(e.target)) attackIncomingByTarget.set(e.target, new Set());
      attackIncomingByTarget.get(e.target).add(e.source);
    }
    const collapsedAttackTargetIds = new Set();

    const nodeItems = [];
    const nodeItemById = new Map();
    for (const n of nodes) {
      const p = preferredNodePos.get(n.id);
      if (!p) continue;
      const st = preferredTypeStyle(n);
      const sz = preferredNodeSize(n);
      const isAttackExpandableTarget = attackIncomingByTarget.has(n.id);
      const g = createSvgEl("g", {
        transform: `translate(${p.x} ${p.y})`,
        style: `cursor: ${isAttackExpandableTarget ? "pointer" : "grab"};`,
      });
      const ellipse = createSvgEl("ellipse", {
        cx: 0,
        cy: 0,
        rx: sz.w / 2,
        ry: sz.h / 2,
        fill: st.fill,
        stroke: st.stroke,
        "stroke-width": n.type === "claim" ? 4.6 : (n.inPreferred ? 4 : 2),
        "stroke-dasharray": n.type === "assumption" ? "8 5" : "none",
      });
      const text = createSvgEl("text", {
        fill: "#0f172a",
      });
      applyNodeLabel(text, preferredNodeSize(n), "#0f172a");
      g.appendChild(ellipse);
      g.appendChild(text);
      const displayCount = resolveNodeDisplayCount(n, preferredDegreeByNode);
      appendCountBadge(g, sz, displayCount);
      const titleEl = createSvgEl("title", {});
      const baseTitle = displayCount != null ? `${String(n.label || "")} (count=${displayCount})` : String(n.label || "");
      titleEl.textContent = isAttackExpandableTarget ? `${baseTitle}\nClick: toggle attackers` : baseTitle;
      g.appendChild(titleEl);

      g.addEventListener("mouseenter", () => {
        const connected = preferredConnectedByNode.get(n.id) || new Set();
        for (const ei of edgeItems) {
          if (ei.path.style.display === "none") continue;
          const on = connected.has(ei.edge.id);
          ei.path.setAttribute("stroke-opacity", on ? "1" : "0.12");
        }
      });
      g.addEventListener("mouseleave", () => {
        for (const ei of edgeItems) {
          if (ei.path.style.display === "none") continue;
          ei.path.setAttribute("stroke-opacity", ei.baseStrokeOpacity);
          ei.path.setAttribute("stroke-width", ei.baseStrokeWidth);
        }
      });
      if (isAttackExpandableTarget) {
        g.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (collapsedAttackTargetIds.has(n.id)) collapsedAttackTargetIds.delete(n.id);
          else collapsedAttackTargetIds.add(n.id);
          applyAttackFocusVisibility();
        });
      }
      if (!LOCK_AUTO_LAYOUT) attachPreferredNodeDrag(g, n);
      nodeLayer.appendChild(g);
      const item = { node: n, group: g, ellipse };
      nodeItems.push(item);
      nodeItemById.set(n.id, item);
    }

    function applyAttackFocusVisibility() {
      const hiddenAttackEdgeKeys = new Set();
      for (const targetId of collapsedAttackTargetIds) {
        const attackers = attackIncomingByTarget.get(targetId) || new Set();
        for (const attackerId of attackers) {
          hiddenAttackEdgeKeys.add(`attack::${attackerId}::${targetId}`);
        }
      }

      const attackerHasVisibleAttack = new Map();
      for (const e of edges) {
        if (e.type !== "attack") continue;
        const key = `attack::${e.source}::${e.target}`;
        const isVisible = !hiddenAttackEdgeKeys.has(key);
        if (isVisible) attackerHasVisibleAttack.set(e.source, true);
      }

      for (const item of nodeItems) {
        const id = item.node.id;
        const shouldShow = !attackerCandidateIds.has(id) || !!attackerHasVisibleAttack.get(id);
        item.group.style.display = shouldShow ? "" : "none";

        const baseStroke =
          item.node.type === "claim"
            ? 4.6
            : (item.node.inPreferred ? 4 : 2);
        const isCollapsedTarget = collapsedAttackTargetIds.has(id);
        item.ellipse.setAttribute("stroke-width", isCollapsedTarget ? String(baseStroke) : "5");
      }

      for (const ei of edgeItems) {
        const srcItem = nodeItemById.get(ei.edge.source);
        const tgtItem = nodeItemById.get(ei.edge.target);
        const srcVisible = !!srcItem && srcItem.group.style.display !== "none";
        const tgtVisible = !!tgtItem && tgtItem.group.style.display !== "none";
        let showEdge = srcVisible && tgtVisible;
        if (showEdge && ei.edge.type === "attack") {
          const edgeKey = `attack::${ei.edge.source}::${ei.edge.target}`;
          showEdge = !hiddenAttackEdgeKeys.has(edgeKey);
        }
        ei.path.style.display = showEdge ? "" : "none";
        if (showEdge) {
          ei.path.setAttribute("stroke-opacity", ei.baseStrokeOpacity);
          ei.path.setAttribute("stroke-width", ei.baseStrokeWidth);
        }
      }
    }

    applyAttackFocusVisibility();

    preferredScene = { world, edgeItems, nodeItems };
    setPreferredWorldTransform();
    updatePreferredScene();
    requestAnimationFrame(() => {
      autoFitPreferredViewport();
    });
  }

  function attachPreferredPanZoom() {
    if (!preferredSvg) return;
    let panning = false;
    let panStart = null;

    preferredSvg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const worldBefore = preferredClientToWorld(ev.clientX, ev.clientY);
      const delta = ev.deltaY < 0 ? 1.08 : 0.92;
      preferredView.scale = clamp(preferredView.scale * delta, 0.35, 3.2);
      const rect = preferredSvg.getBoundingClientRect();
      preferredView.x = ev.clientX - rect.left - worldBefore.x * preferredView.scale;
      preferredView.y = ev.clientY - rect.top - worldBefore.y * preferredView.scale;
      setPreferredWorldTransform();
    }, { passive: false });

    preferredSvg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target !== preferredSvg) return;
      panning = true;
      panStart = {
        x: ev.clientX,
        y: ev.clientY,
        vx: preferredView.x,
        vy: preferredView.y,
      };
      preferredSvg.style.cursor = "grabbing";
      preferredSvg.setPointerCapture?.(ev.pointerId);
    });

    preferredSvg.addEventListener("pointermove", (ev) => {
      if (!panning || !panStart) return;
      preferredView.x = panStart.vx + (ev.clientX - panStart.x);
      preferredView.y = panStart.vy + (ev.clientY - panStart.y);
      setPreferredWorldTransform();
    });

    function stopPan(ev) {
      if (!panning) return;
      panning = false;
      panStart = null;
      preferredSvg.style.cursor = "";
      if (ev?.pointerId != null) preferredSvg.releasePointerCapture?.(ev.pointerId);
    }

    preferredSvg.addEventListener("pointerup", stopPan);
    preferredSvg.addEventListener("pointercancel", stopPan);
    preferredSvg.addEventListener("dblclick", () => {
      autoFitPreferredViewport();
    });

    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        autoFitPreferredViewport();
      });
    });
  }

  function buildPreferredPayload(rawGraph) {
    const nodes = (rawGraph.nodes || []).map((n) => n.data);
    const edges = (rawGraph.edges || []).map((e) => e.data);
    const idToNode = new Map(nodes.map((n) => [n.id, n]));

    const assumptions = new Set();
    const language = new Set();
    const contraries = {};
    const rules = [];
    const warnings = [];
    let ruleIdx = 1;

    for (const n of nodes) {
      const label = String(n.label || "").trim();
      if (!label) continue;
      language.add(label);
      if (n.type === "assumption") assumptions.add(label);
    }

    for (const e of edges) {
      if (e.type !== "support") continue;
      const src = idToNode.get(e.source);
      const tgt = idToNode.get(e.target);
      if (!src || !tgt) continue;
      const premise = String(src.label || "").trim();
      const conclusion = String(tgt.label || "").trim();
      if (!premise || !conclusion || premise === conclusion) continue;
      language.add(premise);
      language.add(conclusion);
      rules.push({
        name: `GraphRule${ruleIdx++}`,
        premises: [premise],
        conclusion,
      });
    }

    for (const e of edges) {
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
        contraries[a] = `not_${a}`;
        language.add(contraries[a]);
        warnings.push(`assumption '${a}' had no attacker; added synthetic contrary '${contraries[a]}'`);
      }
    }

    return {
      payload: {
        language: Array.from(language),
        assumptions: Array.from(assumptions),
        contraries,
        rules,
        semantics_specification: selectedSemantics,
        strategy_specification: selectedStrategy,
        query: rawGraph?.meta?.claimA || null,
      },
      warnings,
    };
  }

  function buildDbCountLookup(rawGraph) {
    const lookup = new Map();
    const nodes = (rawGraph?.nodes || []).map((n) => n?.data || n).filter(Boolean);
    for (const n of nodes) {
      const label = String(n?.label || "").trim();
      const type = String(n?.type || "").trim();
      const count = Number(n?.count);
      if (!label || !type) continue;
      if (!Number.isFinite(count) || count <= 0) continue;
      const key = `${type}::${label}`;
      const prev = Number(lookup.get(key) || 0);
      if (count > prev) lookup.set(key, count);
    }
    return lookup;
  }

  async function loadPreferred(rawGraph) {
    if (!preferredMetaEl || !preferredOutputEl) return;
    const dbCountLookup = buildDbCountLookup(rawGraph);
    const graphMeta = rawGraph?.meta || {};

    const built = buildPreferredPayload(rawGraph);
    const payload = built.payload;
    payload.semantics_specification = selectedSemantics;
    payload.strategy_specification = selectedStrategy;

    if (!payload.rules.length) {
      preferredMetaEl.textContent = `Not enough graph data to compute ${selectedSemantics} extensions.`;
      preferredOutputEl.textContent = JSON.stringify({ assumptions: payload.assumptions.length, rules: payload.rules.length }, null, 2);
      renderFilterResults({ extensions: [] });
      await translateExtensionsToNaturalLanguage({ extensions: [], accepted_assumptions: [] });
      return;
    }

    preferredMetaEl.textContent =
      `Running PyArg (${selectedSemantics}) with assumptions=${payload.assumptions.length}, rules=${payload.rules.length}, query=${payload.query || "-"}`;
    try {
      const resp = await apiFetch("/api/pyarg/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        // Fallback: keep graph visible even if API returns an error.
        drawPreferredGraph({ extensions: [[]], derived: [[]], count: 0 }, payload, built.warnings, dbCountLookup, graphMeta);
        preferredMetaEl.textContent = data.error || `Failed to compute ${selectedSemantics} extensions.`;
        preferredOutputEl.textContent = JSON.stringify({ payload, warnings: built.warnings }, null, 2);
        renderFilterResults({ extensions: [] });
        await translateExtensionsToNaturalLanguage({ extensions: [], accepted_assumptions: [] });
        return;
      }

      preferredMetaEl.textContent =
        `${selectedSemantics}_extensions=${data.count ?? 0}, strategy=${selectedStrategy}, credulous=${data.credulous ?? "-"}, skeptical=${data.skeptical ?? "-"}`;
      drawPreferredGraph(data, payload, built.warnings, dbCountLookup, graphMeta);
      renderFilterResults(data);
      await translateExtensionsToNaturalLanguage(data);
      preferredOutputEl.textContent = JSON.stringify(
        {
          result: data,
          payload,
          warnings: built.warnings,
        },
        null,
        2
      );
    } catch (err) {
      console.error(err);
      preferredMetaEl.textContent = "Cannot connect to /api/pyarg/evaluate.";
      // Fallback: keep graph visible even when backend is unreachable.
      drawPreferredGraph({ extensions: [[]], derived: [[]], count: 0 }, payload, built.warnings, dbCountLookup, graphMeta);
      preferredOutputEl.textContent = JSON.stringify({ payload, warnings: built.warnings }, null, 2);
      renderFilterResults({ extensions: [] });
      await translateExtensionsToNaturalLanguage({ extensions: [], accepted_assumptions: [] });
    }
  }

  async function loadGraph() {
    try {
      const q = new URLSearchParams({
        topic,
        sentiment,
        supporting,
        attack_mode: attackMode,
        attack_depth: attackDepth,
        focus_only: focusOnly,
        show_all_contrary: showAllContrary,
      });
      const resp = await apiFetch(`/api/aba-graph?${q.toString()}`);
      const data = await resp.json();
      if (!resp.ok) {
        metaEl.textContent = data.error || "Failed to load graph.";
        return;
      }

      if (data.meta) {
        metaEl.textContent =
          `topic=${topic}, sentiment=${sentiment}, supporting=${supporting}, ` +
          `claimA=${data.meta.claimA ?? "-"}, claimB=${data.meta.claimB ?? "-"}, ` +
          `attacks=${data.meta.attackEdgesCount ?? 0}, contrary_candidates=${data.meta.contraryCandidatesCount ?? 0}, ` +
          `mode=${data.meta.attackMode ?? attackMode}, depth=${data.meta.attackDepth ?? attackDepth}, focus_only=${data.meta.focusOnly ?? focusOnly}`;
        setToggleButton(data.meta);
      }
      lastLoadedGraph = data;
      updateSemanticsHeader();
      drawGraph(data);
      jsonOutputEl.textContent = JSON.stringify(data, null, 2);
      await loadPreferred(data);
    } catch (err) {
      console.error(err);
      metaEl.textContent = "Cannot connect to backend API.";
      if (preferredMetaEl) preferredMetaEl.textContent = "Cannot load semantics because graph API failed.";
      setNaturalLanguageOutput("-", "");
      setGraphSummaryOutput("-", "");
    }
  }

  attachPanZoom();
  attachPreferredPanZoom();
  if (llmModelSelectEl) llmModelSelectEl.value = selectedLlmModel;
  if (layerModeSelectEl) layerModeSelectEl.value = selectedLayerMode;
  if (semanticsSelectEl) semanticsSelectEl.value = selectedSemantics;
  if (strategySelectEl) strategySelectEl.value = selectedStrategy;
  updateSemanticsHeader();

  function applyFilterFromControls() {
    selectedLayerMode = layerModeSelectEl && SUPPORTED_LAYER_MODES.includes(String(layerModeSelectEl.value || "").trim().toLowerCase())
      ? String(layerModeSelectEl.value || "").trim().toLowerCase()
      : "layer2";
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
    if (lastLoadedGraph) loadPreferred(lastLoadedGraph);
  }

  if (layerModeSelectEl) layerModeSelectEl.addEventListener("change", applyFilterFromControls);
  if (semanticsSelectEl) semanticsSelectEl.addEventListener("change", applyFilterFromControls);
  if (strategySelectEl) strategySelectEl.addEventListener("change", applyFilterFromControls);
  if (llmModelSelectEl) {
    llmModelSelectEl.addEventListener("change", () => {
      selectedLlmModel = String(llmModelSelectEl.value || "qwen2.5").trim();
      if (!["gpt-4o", "gemini-2.5-pro", "qwen2.5", "gemma3:4b"].includes(selectedLlmModel)) selectedLlmModel = "qwen2.5";
      const u = new URL(window.location.href);
      u.searchParams.set("llm_model", selectedLlmModel);
      window.history.replaceState(null, "", u.toString());
      if (lastSemanticsResult) {
        translateExtensionsToNaturalLanguage(lastSemanticsResult);
      }
    });
  }
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      const nowAll = showAllContrary === "1" || showAllContrary === "true" || showAllContrary === "yes";
      showAllContrary = nowAll ? "0" : "1";
      const u = new URL(window.location.href);
      u.searchParams.set("show_all_contrary", showAllContrary);
      u.searchParams.set("semantics", selectedSemantics);
      u.searchParams.set("strategy", selectedStrategy);
      window.history.replaceState(null, "", u.toString());
      loadGraph();
    });
  }
  loadGraph();
})();



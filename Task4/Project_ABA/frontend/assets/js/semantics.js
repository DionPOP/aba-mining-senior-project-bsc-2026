(function (global) {
  function normalizeExtensions(extensions) {
    if (!Array.isArray(extensions)) return [];
    return extensions
      .filter((ext) => Array.isArray(ext))
      .map((ext) => ext.map((x) => String(x)).filter(Boolean));
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

  function renderFilterResults(result, opts) {
    const options = opts || {};
    const extensionListEl = options.extensionListEl;
    const acceptedAssumptionsEl = options.acceptedAssumptionsEl;
    const selectedStrategy = String(options.selectedStrategy || "Credulous");
    const normalizedExts = normalizeExtensions(result?.extensions);
    const extensionLabels = normalizedExts.length
      ? normalizedExts.map((ext) => `{${ext.join(", ")}}`)
      : ["{}"];
    const acceptedFromApi = Array.isArray(result?.accepted_assumptions)
      ? result.accepted_assumptions.map((x) => String(x))
      : null;
    const accepted = acceptedFromApi || computeAcceptedAssumptions(normalizedExts, selectedStrategy);
    renderTokens(extensionListEl, extensionLabels, "{}");
    renderTokens(acceptedAssumptionsEl, accepted, "-");
  }

  function buildPreferredPayload(rawGraph, options) {
    const opts = options || {};
    const selectedSemantics = String(opts.selectedSemantics || "Preferred");
    const selectedStrategy = String(opts.selectedStrategy || "Credulous");
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

  global.PyargSemantics = {
    normalizeExtensions,
    computeAcceptedAssumptions,
    renderTokens,
    renderFilterResults,
    buildPreferredPayload,
    buildDbCountLookup,
  };
})(window);

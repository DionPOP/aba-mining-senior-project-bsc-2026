(function (global) {
  const textMeasureCanvas = document.createElement("canvas");
  const textMeasureCtx = textMeasureCanvas.getContext("2d");

  function createSvgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

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
        for (const part of parts) {
          if (lines.length < maxLines) lines.push(part);
        }
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
        continue;
      }
      const candidate = line ? `${line} ${word}` : word;
      if (measureTextWidth(candidate, fontSize, fontWeight) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length > maxLines) lines.length = maxLines;
    if (words.length && (truncated || lines.length === maxLines)) {
      lines[maxLines - 1] = fitTextWithEllipsis(lines[maxLines - 1], maxWidth, fontSize, fontWeight);
    }
    return lines;
  }

  function resolveNodeSide(node) {
    const side = String(node?.clusterSentiment || "").toLowerCase();
    if (side === "good" || side === "bad") return side;
    const label = String(node?.label || "").toLowerCase();
    if (label.startsWith("good_")) return "good";
    if (label.startsWith("bad_")) return "bad";
    return "good";
  }

  global.PyargGraphUtils = {
    createSvgEl,
    clamp,
    measureTextWidth,
    fitTextWithEllipsis,
    wrapTextWithMaxWidth,
    resolveNodeSide,
  };
})(window);

const MAX_TAGS = 5;

(function () {
  const cards = document.querySelectorAll(".grid-cards .c-card");
  const titleEl = document.getElementById("review-title");
  const typeLabelEl = document.getElementById("review-type-label");
  const rowsContainer = document.getElementById("rows-container");
  const footText = document.getElementById("foot-text");

  const searchInput = document.getElementById("search-input");
  const sentimentFilter = document.getElementById("sentiment-filter");

  const panelEl = document.getElementById("panel");

  const DEFAULT_ENABLED_TOPICS = new Set(["check-in", "check-out", "staff", "price"]);

  function canonicalTopic(raw) {
    const t = String(raw || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
    if (t === "taxi-issue") return "taxi";
    return t;
  }

  function showPanel(show) {
    if (!panelEl) return;
    panelEl.style.display = show ? "block" : "none";
  }

  const params = new URLSearchParams(window.location.search);
  const type = (params.get("type") || "positive").toLowerCase();
  if (sentimentFilter && (type === "positive" || type === "negative")) {
    sentimentFilter.value = type;
  }

  const apiClient = window.createApiClient({ params });
  const { apiFetch } = apiClient;

  let activeTopic = null;
  let lastData = [];

  cards.forEach((card) => {
    const t = canonicalTopic(card.dataset.topic || "");
    const enabled = DEFAULT_ENABLED_TOPICS.has(t);
    card.dataset.enabled = enabled ? "1" : "0";
    if (!enabled) {
      card.classList.add("disabled");
      card.disabled = true;
    }
  });

  function setActiveCard(card) {
    cards.forEach((c) => c.classList.remove("active"));

    if (!card) {
      activeTopic = null;
      return;
    }

    card.classList.add("active");
    activeTopic = card.dataset.topic || null;
    if (titleEl) titleEl.textContent = `${activeTopic}`;
  }

  async function loadData() {
    if (!activeTopic) return;

    const sentiment = (sentimentFilter?.value || "positive").toLowerCase();
    document.body.classList.toggle("sentiment-negative", sentiment === "negative");

    const topic = canonicalTopic(activeTopic);

    if (typeLabelEl) {
      typeLabelEl.textContent = sentiment === "negative" ? "NEGATIVE REVIEW" : "POSITIVE REVIEW";
    }

    try {
      const resp = await apiFetch(
        `/api/review-data?topic=${encodeURIComponent(topic)}&sentiment=${encodeURIComponent(sentiment)}`
      );
      const data = await resp.json();
      lastData = Array.isArray(data.rows) ? data.rows : [];
      renderRows();
    } catch (e) {
      console.error(e);
      lastData = [];
      renderRows();
    }
  }

  function renderRows() {
    const keyword = (searchInput?.value || "").trim().toLowerCase();

    const filtered = lastData.filter((r) => {
      const supportText = String(r.proposition || "").toLowerCase();
      const contraryText = Array.isArray(r.contraries)
        ? r.contraries.map((x) => String(x.proposition || "")).join(" ").toLowerCase()
        : "";
      return !keyword || supportText.includes(keyword) || contraryText.includes(keyword);
    });

    rowsContainer.innerHTML = "";

    for (const r of filtered) {
      const row = document.createElement("div");
      row.className = "row";

      const support = document.createElement("div");
      support.className = "support";
      support.textContent = r.proposition ?? "";

      const count = document.createElement("div");
      count.className = "count";
      count.textContent = String(r.cnt ?? "");

      const tags = document.createElement("div");
      tags.className = "tags";

      const contraList = Array.isArray(r.contraries) ? r.contraries : [];
      let expanded = false;

      function renderTagList() {
        while (tags.firstChild) tags.removeChild(tags.firstChild);

        const showList = expanded ? contraList : contraList.slice(0, MAX_TAGS);
        for (const x of showList) {
          const label = String(x.proposition || "");
          const cnt = x.cnt ?? 0;

          const span = document.createElement("span");
          span.className = "tag";
          span.innerHTML = `${label} <b>${cnt}</b>`;
          tags.appendChild(span);
        }

        if (contraList.length > MAX_TAGS) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "tag-more";
          more.textContent = expanded ? "less" : "...";
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            expanded = !expanded;
            renderTagList();
          });
          tags.appendChild(more);
        }
      }

      renderTagList();

      const detail = document.createElement("div");
      const btn = document.createElement("button");
      btn.className = "btn-show";
      btn.type = "button";
      btn.textContent = "Show";
      btn.addEventListener("click", () => {
        if (!activeTopic) return;
        const sentiment = (sentimentFilter?.value || "positive").toLowerCase();
        const q = new URLSearchParams({
          topic: canonicalTopic(activeTopic),
          sentiment,
          supporting: String(r.proposition || ""),
          show_all_contrary: "1",
        });
        const lastWorkingApiBase = apiClient.getLastWorkingApiBase();
        if (lastWorkingApiBase) q.set("api_base", lastWorkingApiBase);
        window.location.href = `./pyarg.html?${q.toString()}`;
      });
      detail.appendChild(btn);

      row.appendChild(support);
      row.appendChild(count);
      row.appendChild(tags);
      row.appendChild(detail);

      rowsContainer.appendChild(row);
    }

    if (footText) {
      footText.textContent = `Showing data 1 to ${filtered.length} of ${lastData.length} Supporting`;
    }
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.enabled !== "1") return;
      setActiveCard(card);
      showPanel(true);
      loadData();
    });
  });

  if (sentimentFilter) sentimentFilter.addEventListener("change", loadData);
  if (searchInput) searchInput.addEventListener("input", renderRows);

  async function loadTopicRatios() {
    try {
      const resp = await apiFetch("/api/topic-ratios");
      const ratios = await resp.json();

      cards.forEach((card) => {
        const t = canonicalTopic(card.dataset.topic || "");
        const ratioBox = card.querySelector(".ratio");
        if (!ratioBox) return;

        const r = ratios[t];
        if (!r || (r.posTotal + r.negTotal) === 0) {
          ratioBox.style.display = "none";
          return;
        }

        const leftEl = ratioBox.querySelector(".neg");
        const rightEl = ratioBox.querySelector(".pos");
        if (!leftEl || !rightEl) return;

        const pageType = (new URLSearchParams(location.search).get("type") || "positive").toLowerCase();
        const isPositivePage = pageType === "positive";

        if (isPositivePage) {
          leftEl.classList.remove("neg");
          leftEl.classList.add("pos");
          rightEl.classList.remove("pos");
          rightEl.classList.add("neg");

          leftEl.textContent = `${r.posPct}%`;
          leftEl.style.width = `${r.posPct}%`;

          rightEl.textContent = `${r.negPct}%`;
          rightEl.style.width = `${r.negPct}%`;
        } else {
          leftEl.classList.remove("pos");
          leftEl.classList.add("neg");
          rightEl.classList.remove("neg");
          rightEl.classList.add("pos");

          leftEl.textContent = `${r.negPct}%`;
          leftEl.style.width = `${r.negPct}%`;

          rightEl.textContent = `${r.posPct}%`;
          rightEl.style.width = `${r.posPct}%`;
        }
      });

      const availableTopics = new Set(
        Object.entries(ratios || {})
          .filter(([, r]) => Number(r?.posTotal || 0) + Number(r?.negTotal || 0) > 0)
          .map(([k]) => canonicalTopic(k))
      );

      cards.forEach((card) => {
        const t = canonicalTopic(card.dataset.topic || "");
        const enabled = availableTopics.has(t) || DEFAULT_ENABLED_TOPICS.has(t);
        card.dataset.enabled = enabled ? "1" : "0";
        card.classList.toggle("disabled", !enabled);
        card.disabled = !enabled;
      });
    } catch (e) {
      console.error("loadTopicRatios error:", e);
    }
  }

  setActiveCard(null);
  showPanel(false);
  loadTopicRatios();
})();

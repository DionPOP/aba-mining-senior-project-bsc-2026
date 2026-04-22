(function () {
  const cards = document.querySelectorAll(".grid-cards .c-card");
  const titleEl = document.getElementById("review-title");

  const positiveRowsContainer = document.getElementById("positive-rows-container");
  const negativeRowsContainer = document.getElementById("negative-rows-container");

  const searchInput = document.getElementById("search-input");
  const panelEl = document.getElementById("panel");

  const DEFAULT_ENABLED_TOPICS = new Set(["check-in", "check-out", "staff", "price"]);
  const MAX_TAGS = 5;

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
  const apiClient = window.createApiClient({ params });
  const { apiFetch } = apiClient;

  let activeTopic = null;
  let positiveData = [];
  let negativeData = [];

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

  async function fetchReviewDataBySentiment(topic, sentiment) {
    const resp = await apiFetch(
      `/api/review-data?topic=${encodeURIComponent(topic)}&sentiment=${encodeURIComponent(sentiment)}`
    );
    const data = await resp.json();
    return Array.isArray(data.rows) ? data.rows : [];
  }

  async function loadData() {
    if (!activeTopic) return;

    const topic = canonicalTopic(activeTopic);

    try {
      const [posRows, negRows] = await Promise.all([
        fetchReviewDataBySentiment(topic, "positive"),
        fetchReviewDataBySentiment(topic, "negative"),
      ]);

      positiveData = posRows;
      negativeData = negRows;
      renderAllRows();
    } catch (e) {
      console.error(e);
      positiveData = [];
      negativeData = [];
      renderAllRows();
    }
  }

  function createRow(r, sentiment) {
    const row = document.createElement("div");
    row.className = "row row-4";

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
      tags.innerHTML = "";

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
      const q = new URLSearchParams({
        topic: canonicalTopic(activeTopic),
        selected_topic: String(activeTopic || ""),
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

    return row;
  }

  function renderRowsToContainer(rows, container, sentiment) {
    const keyword = (searchInput?.value || "").trim().toLowerCase();

    const filtered = rows.filter((r) => {
      const supportText = String(r.proposition || "").toLowerCase();
      const contraryText = Array.isArray(r.contraries)
        ? r.contraries.map((x) => String(x.proposition || "")).join(" ").toLowerCase()
        : "";
      return !keyword || supportText.includes(keyword) || contraryText.includes(keyword);
    });

    container.innerHTML = "";

    for (const r of filtered) {
      container.appendChild(createRow(r, sentiment));
    }
  }

  function renderAllRows() {
    renderRowsToContainer(positiveData, positiveRowsContainer, "positive");
    renderRowsToContainer(negativeData, negativeRowsContainer, "negative");
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.enabled !== "1") return;
      setActiveCard(card);
      showPanel(true);
      loadData();
    });
  });

  function findCardByTopicLabel(topicLabel) {
    const wanted = canonicalTopic(topicLabel);
    return Array.from(cards).find((card) => {
      const cardTopic = canonicalTopic(card.dataset.topic || "");
      return cardTopic === wanted;
    }) || null;
  }

  if (searchInput) searchInput.addEventListener("input", renderAllRows);

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

        leftEl.classList.remove("neg");
        leftEl.classList.add("pos");
        rightEl.classList.remove("pos");
        rightEl.classList.add("neg");

        leftEl.textContent = `${r.posPct}%`;
        leftEl.style.width = `${r.posPct}%`;

        rightEl.textContent = `${r.negPct}%`;
        rightEl.style.width = `${r.negPct}%`;
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

  async function initializePage() {
    setActiveCard(null);
    showPanel(false);
  
    await loadTopicRatios();
  
    const initialTopic = String(params.get("topic") || "").trim();
    if (!initialTopic) return;
  
    const targetCard = findCardByTopicLabel(initialTopic);
    if (!targetCard) return;
    if (targetCard.dataset.enabled !== "1") return;
  
    setActiveCard(targetCard);
    showPanel(true);
    await loadData();
  }
  
  initializePage();
})();
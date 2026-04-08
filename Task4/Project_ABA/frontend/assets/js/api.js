(function (global) {
  function buildApiBases(params, queryParam) {
    const qp = String(queryParam || "api_base");
    const fromQuery = String(params.get(qp) || "").trim().replace(/\/+$/, "");
    if (fromQuery) return [fromQuery];
    if (window.location.protocol === "file:") return ["http://localhost:3000"];
    if (window.location.port === "3000") return [""];
    const sameOrigin = "";
    const port3000 = `${window.location.protocol}//${window.location.hostname}:3000`;
    return [sameOrigin, port3000];
  }

  function createApiClient(options) {
    const opts = options || {};
    const params = opts.params instanceof URLSearchParams
      ? opts.params
      : new URLSearchParams(window.location.search);
    const queryParam = String(opts.queryParam || "api_base");
    const apiBases = buildApiBases(params, queryParam);
    let lastWorkingApiBase = apiBases[0] || "";

    async function apiFetch(path, fetchOptions) {
      let lastError = null;
      for (const base of apiBases) {
        const url = `${base}${path}`;
        try {
          const resp = await fetch(url, fetchOptions);
          if (resp.status === 404 && base !== apiBases[apiBases.length - 1]) {
            continue;
          }
          lastWorkingApiBase = base;
          return resp;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("API request failed");
    }

    return {
      apiFetch,
      getApiBases: () => [...apiBases],
      getLastWorkingApiBase: () => lastWorkingApiBase,
    };
  }

  global.createApiClient = createApiClient;
})(window);

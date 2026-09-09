export function initCompactView() {
  const main = document.querySelector("main.shell");
  const vitals = main?.querySelector(".metrics");
  if (!vitals || document.getElementById("compactViewBtn")) return;

  const storageKey = "geoff-thermometer-compact-view-v1";
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch {
    // Storage can be unavailable or contain invalid JSON.
  }
  let compact = saved?.enabled !== false;
  const choices = { normal: Object.create(null), compact: Object.create(null) };
  for (const mode of ["normal", "compact"]) {
    const values = saved?.[mode];
    if (values && typeof values === "object" && !Array.isArray(values)) {
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "boolean") choices[mode][key] = value;
      }
    }
  }

  const identities = new Map();
  // Only static optional panels; source disclosures and TRIX tabs own their state.
  const disclosures = [...main.querySelectorAll("details.hp-panel, details.glossary-panel, details.raw-drawer")]
    .filter((detail) => !detail.querySelector(
      "#coverageChips, #priceSource, #tempMeta, #queueMeta, [data-provenance], .provenance, [data-freshness]",
    )).map((detail) => {
      const summary = detail.querySelector(":scope > summary");
      const identity = detail.id ? `id:${detail.id}` : `label:${
        detail.getAttribute("aria-label") || summary?.textContent.trim().replace(/\s+/g, " ") || "details"
      }`;
      const occurrence = (identities.get(identity) || 0) + 1;
      identities.set(identity, occurrence);
      return {
        detail,
        key: `${identity}:${occurrence}`,
        initialOpen: detail.open,
        expectedOpen: detail.open,
      };
    });

  const row = document.createElement("div");
  row.className = "compact-view-controls";
  const button = document.createElement("button");
  button.id = "compactViewBtn";
  button.type = "button";
  button.className = "btn";
  button.title = "Switch card density; optional sections can be reopened";
  row.append(button);
  const tools = document.getElementById("vitalsTools");
  if (tools) tools.append(row);
  else vitals.before(row);

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ enabled: compact, ...choices }));
    } catch {
      // The controls still work for this visit when storage is blocked or full.
    }
  }

  function apply() {
    main.classList.toggle("compact-vitals", compact);
    document.body.classList.toggle("compact-vitals", compact);
    button.textContent = compact ? "Compact" : "Comfortable";
    button.setAttribute("aria-pressed", String(compact));
    for (const item of disclosures) {
      const mode = compact ? "compact" : "normal";
      const open = choices[mode][item.key] ?? (mode === "compact" ? false : item.initialOpen);
      // Native toggle events are asynchronous; compare against the applied state.
      item.expectedOpen = open;
      item.detail.open = open;
    }
  }

  for (const item of disclosures) {
    item.detail.addEventListener("toggle", () => {
      if (item.detail.open === item.expectedOpen) return;
      item.expectedOpen = item.detail.open;
      const mode = compact ? "compact" : "normal";
      choices[mode][item.key] = item.detail.open;
      persist();
    });
  }
  button.addEventListener("click", () => {
    // Capture current state even if its native toggle event has not fired yet.
    for (const item of disclosures) {
      const mode = compact ? "compact" : "normal";
      choices[mode][item.key] = item.detail.open;
    }
    compact = !compact;
    apply();
    persist();
  });
  apply();
}

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
  let compact = saved?.enabled === true;
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
  const disclosures = [...main.querySelectorAll("details")].map((detail) => {
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
      // Do not automatically fold source coverage or freshness inside a disclosure.
      collapsible: !detail.querySelector(
        "#coverageChips, #priceSource, #tempMeta, #queueMeta, [data-provenance], .provenance, [data-freshness]",
      ),
    };
  });

  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem;margin:0 0 0.65rem";
  const button = document.createElement("button");
  button.id = "compactViewBtn";
  button.type = "button";
  button.className = "btn";
  button.textContent = "Compact view";
  button.style.minHeight = "44px";
  button.setAttribute("aria-describedby", "compactViewHelp");
  const help = document.createElement("span");
  help.id = "compactViewHelp";
  help.style.cssText = "color:var(--muted);font-size:0.75rem;line-height:1.4";
  help.textContent = "Fold optional details. Sources and freshness stay unchanged. Reopen any section.";
  row.append(button, help);
  const label = vitals.previousElementSibling;
  (label?.matches(".deck-label") ? label : vitals).before(row);

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ enabled: compact, ...choices }));
    } catch {
      // The controls still work for this visit when storage is blocked or full.
    }
  }

  function apply() {
    button.setAttribute("aria-pressed", String(compact));
    for (const item of disclosures) {
      const mode = compact && item.collapsible ? "compact" : "normal";
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
      const mode = compact && item.collapsible ? "compact" : "normal";
      choices[mode][item.key] = item.detail.open;
      persist();
    });
  }
  button.addEventListener("click", () => {
    // Capture current state even if its native toggle event has not fired yet.
    for (const item of disclosures) {
      const mode = compact && item.collapsible ? "compact" : "normal";
      choices[mode][item.key] = item.detail.open;
      if (!compact && item.collapsible) choices.compact[item.key] = false;
    }
    compact = !compact;
    apply();
    persist();
  });
  apply();
}

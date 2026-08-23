const els = {
  reloadBtn: document.getElementById("reloadBtn"),
  heroNote: document.getElementById("heroNote"),
  hints: document.getElementById("hints"),
  manifesto: document.getElementById("manifesto"),
  frameCards: document.getElementById("frameCards"),
  scorecard: document.getElementById("scorecard"),
  liveMeta: document.getElementById("liveMeta"),
  liveGrid: document.getElementById("liveGrid"),
  incidents: document.getElementById("incidents"),
  inventories: document.getElementById("inventories"),
  priceMeta: document.getElementById("priceMeta"),
  priceBlurb: document.getElementById("priceBlurb"),
  priceWins: document.getElementById("priceWins"),
  priceQuotes: document.getElementById("priceQuotes"),
  priceSheet: document.getElementById("priceSheet"),
  priceLimits: document.getElementById("priceLimits"),
  priceSource: document.getElementById("priceSource"),
  dimTable: document.querySelector("#dimTable tbody"),
  vendors: document.getElementById("vendors"),
  menus: document.getElementById("menus"),
  footnote: document.getElementById("footnote"),
  claimsMeta: document.getElementById("claimsMeta"),
  claimBooked: document.getElementById("claimBooked"),
  claimPaid: document.getElementById("claimPaid"),
  claimChain: document.getElementById("claimChain"),
  claimChainNote: document.getElementById("claimChainNote"),
  ghostShelf: document.getElementById("ghostShelf"),
};

function fmtCompactUsd(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusClass(indicator) {
  if (!indicator || indicator === "unknown") return "unknown";
  if (indicator === "none" || indicator === "operational") return "good";
  if (indicator === "minor") return "warn";
  return "bad";
}

function statusLabel(indicator, description) {
  if (indicator === "none") return "Covered · all clear";
  if (indicator === "unknown") return "Quote pending";
  if (indicator === "minor") return "Minor claim noise";
  return description || indicator;
}

function gradeClass(grade = "") {
  if (grade.startsWith("A")) return "A";
  if (grade.startsWith("B")) return "B";
  if (grade.startsWith("C")) return grade.includes("+") ? "Cplus" : "C";
  return "C";
}

function renderHints(hints = []) {
  els.hints.innerHTML = hints
    .map((h) => `<span class="hint">${escapeHtml(h)}</span>`)
    .join("");
}

function renderManifesto(manifesto) {
  if (!manifesto) {
    els.manifesto.innerHTML = "";
    return;
  }
  els.manifesto.innerHTML = `
    <div class="manifesto-copy">
      <p class="kicker">${escapeHtml(manifesto.kicker || "Research desk")}</p>
      <h3>${escapeHtml(manifesto.title)}</h3>
      ${(manifesto.paragraphs || [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("")}
    </div>
    <aside class="manifesto-side">
      <h4>Field checklist</h4>
      <ul>
        ${(manifesto.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
      </ul>
    </aside>
  `;
}

function renderFrameCards(cards = []) {
  if (!els.frameCards) return;
  if (!cards.length) {
    els.frameCards.innerHTML = `<p class="empty">Framing notes loading…</p>`;
    return;
  }
  els.frameCards.innerHTML = cards
    .map(
      (c) => `
      <article class="frame-card${c.k === "Story lane" ? " frame-card-story" : ""}">
        <p class="frame-k">${escapeHtml(c.k)}</p>
        <h4>${escapeHtml(c.title)}</h4>
        <p>${escapeHtml(c.body)}</p>
      </article>
    `,
    )
    .join("");
}

function renderScorecard(rows = []) {
  if (!rows.length) {
    els.scorecard.innerHTML = `<p class="empty">Scorecard loading…</p>`;
    return;
  }
  els.scorecard.innerHTML = rows
    .map(
      (r) => `
      <article class="score">
        <div class="score-top">
          <div>
            <h4>${escapeHtml(r.name)}</h4>
            <p class="posture">${escapeHtml(r.posture)} · ${escapeHtml(String(r.score))}/100</p>
          </div>
          <div class="grade ${gradeClass(r.grade)}">${escapeHtml(r.grade)}</div>
        </div>
        <p class="why">${escapeHtml(r.why)}</p>
        <div class="meter"><i style="width:${Math.max(8, r.score)}%"></i></div>
        <details>
          <summary>Receipts &amp; blind spots</summary>
          <ul>
            ${(r.reveals || []).map((x) => `<li><strong>Shows:</strong> ${escapeHtml(x)}</li>`).join("")}
            ${(r.hides || []).map((x) => `<li><strong>Hides:</strong> ${escapeHtml(x)}</li>`).join("")}
          </ul>
        </details>
      </article>
    `,
    )
    .join("");
}

function renderLive(live = {}, takenAt) {
  const order = ["geoff", "grok", "openai", "copilot"];
  els.liveMeta.textContent = takenAt
    ? `Quotes refreshed ${new Date(takenAt).toLocaleString()}`
    : "Pulling live quotes…";

  els.liveGrid.innerHTML = order
    .map((id) => {
      const card = live[id] || {};
      const cls = statusClass(card.indicator);
      const comps = (card.spotlight || card.components || []).slice(0, 6);
      return `
        <article class="live-card">
          <p class="name">${escapeHtml(card.label || id)}</p>
          <p class="status ${cls}">${escapeHtml(statusLabel(card.indicator, card.description))}</p>
          <p class="desc">${escapeHtml(card.description || "—")}${card.note ? ` · ${escapeHtml(card.note)}` : ""}</p>
          <ul>
            ${comps
              .map(
                (c) => `
              <li>
                <span>${escapeHtml(c.name)}</span>
                <span>${escapeHtml(c.status)}</span>
              </li>`,
              )
              .join("")}
          </ul>
        </article>
      `;
    })
    .join("");

  const incidents = live.openai?.recentIncidents || [];
  if (!incidents.length) {
    els.incidents.innerHTML = "";
    return;
  }
  els.incidents.innerHTML = `
    <h4>OpenAI recent incidents (public status feed)</h4>
    ${incidents
      .map(
        (i) => `
      <div class="incident-row">
        <span class="impact ${escapeHtml(i.impact || "")}">${escapeHtml(i.impact || "n/a")}</span>
        <span>${escapeHtml(i.name)} · ${escapeHtml(i.status)}</span>
        <time>${escapeHtml(i.updatedAt ? new Date(i.updatedAt).toLocaleString() : "")}</time>
      </div>
    `,
      )
      .join("")}
  `;
}

function renderInventories(inventories = []) {
  if (!inventories.length) {
    els.inventories.innerHTML = `<p class="empty">No inventories yet.</p>`;
    return;
  }
  els.inventories.innerHTML = inventories
    .map(
      (inv) => `
      <article class="inventory">
        <h4>${escapeHtml(inv.title)}</h4>
        <p class="sub">${escapeHtml(inv.subtitle || "")}</p>
        <div class="chips">
          ${(inv.items || [])
            .slice(0, 28)
            .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
            .join("")}
          ${(inv.extras || [])
            .slice(0, 12)
            .map((item) => `<span class="chip extra">${escapeHtml(item)}</span>`)
            .join("")}
        </div>
      </article>
    `,
    )
    .join("");
}

function renderDimensions(dimensions = []) {
  els.dimTable.innerHTML = dimensions
    .map(
      (d) => `
      <tr>
        <td>
          <div class="dim-label">${escapeHtml(d.label)}</div>
          <p class="dim-blurb">${escapeHtml(d.blurb)}</p>
        </td>
        <td>${escapeHtml(d.scores?.geoff)}</td>
        <td>${escapeHtml(d.scores?.grok)}</td>
        <td>${escapeHtml(d.scores?.openai)}</td>
        <td>${escapeHtml(d.scores?.copilot)}</td>
      </tr>
    `,
    )
    .join("");
}

function mark(level) {
  return level === "yes"
    ? `<span class="mark yes">✓</span>`
    : `<span class="mark no">—</span>`;
}

function renderTokenPlan(plan) {
  if (!els.priceQuotes) return;
  if (!plan?.plans?.length) {
    if (els.priceMeta) els.priceMeta.textContent = "No public seats found";
    if (els.priceBlurb) els.priceBlurb.textContent = "";
    els.priceQuotes.innerHTML = `<p class="empty">Token Plan tables unavailable.</p>`;
    if (els.priceWins) els.priceWins.innerHTML = "";
    if (els.priceSheet) els.priceSheet.innerHTML = "";
    if (els.priceLimits) els.priceLimits.innerHTML = "";
    if (els.priceSource) els.priceSource.innerHTML = "";
    return;
  }

  if (els.priceMeta) {
    els.priceMeta.textContent = plan.scraped
      ? "Sniffed from docs.geoff.ai"
      : "Published docs tables";
  }
  if (els.priceBlurb) {
    els.priceBlurb.textContent =
      plan.subhead ||
      plan.model ||
      "One pool. Every modality. Public numbers.";
  }

  if (els.priceWins) {
    els.priceWins.innerHTML = (plan.wins || [])
      .map(
        (w) => `
      <article class="cover-win">
        <strong>${escapeHtml(w.k)}</strong>
        <span>${escapeHtml(w.v)}</span>
      </article>`,
      )
      .join("");
  }

  els.priceQuotes.innerHTML = plan.plans
    .map((p) => {
      const hi = p.highlighted ? " hi" : "";
      return `
      <article class="quote-tier tier-${escapeHtml(p.id)}${hi}">
        <p class="quote-badge">${escapeHtml(p.badge || p.name)}</p>
        <p class="quote-name">${escapeHtml(p.name)}</p>
        <p class="quote-price">${escapeHtml(p.price)}</p>
        <p class="quote-tokens">${escapeHtml(p.tokens)} tokens / mo</p>
        <p class="quote-pitch">${escapeHtml(p.pitch || p.why || "")}</p>
        <ul class="quote-yield">
          <li>Images ${escapeHtml(p.images || "—")}</li>
          <li>Videos (5 sec) ${escapeHtml(p.videos5s || "—")}</li>
          <li>Songs ${escapeHtml(p.songs || "—")}</li>
        </ul>
      </article>`;
    })
    .join("");

  if (els.priceSheet && plan.matrix?.length) {
    const heads = plan.plans
      .map(
        (p) =>
          `<th class="${p.highlighted ? "hi" : ""}"><span>${escapeHtml(p.name)}</span><em>${escapeHtml(p.price)}</em></th>`,
      )
      .join("");
    const rows = [
      `<tr class="metric"><th>Monthly tokens</th>${plan.plans
        .map((p) => `<td class="${p.highlighted ? "hi" : ""}"><strong>${escapeHtml(p.tokens)}</strong></td>`)
        .join("")}</tr>`,
      ...plan.matrix.map(
        (row) =>
          `<tr><th>${escapeHtml(row.label)}</th>${(row.levels || [])
            .map((lv, i) => `<td class="${plan.plans[i]?.highlighted ? "hi" : ""}">${mark(lv)}</td>`)
            .join("")}</tr>`,
      ),
    ].join("");
    els.priceSheet.innerHTML = `
      <table class="apple-sheet cover">
        <thead><tr><th>Compare</th>${heads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  if (els.priceLimits) {
    els.priceLimits.innerHTML = `
      <table class="limits-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>RPM</th>
            <th>Input TPM</th>
            <th>Output TPM</th>
          </tr>
        </thead>
        <tbody>
          ${plan.plans
            .map(
              (p) => `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td>${escapeHtml(p.rpm || "—")}</td>
              <td>${escapeHtml(p.inputTpm || "—")}</td>
              <td>${escapeHtml(p.outputTpm || "—")}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  }

  if (els.priceSource) {
    const pricing = plan.sourceUrls?.pricing || "https://docs.geoff.ai/token-plan/pricing";
    const overview =
      plan.sourceUrls?.overview || "https://docs.geoff.ai/token-plan/overview";
    const note = plan.scraped
      ? "Live scrape of public Token Plan docs"
      : plan.reason || "Cached public Token Plan tables";
    els.priceSource.innerHTML = `${escapeHtml(note)} ·
      <a href="${escapeHtml(overview)}" target="_blank" rel="noopener noreferrer">Overview sheet</a> ·
      <a href="${escapeHtml(pricing)}" target="_blank" rel="noopener noreferrer">Pricing</a>`;
  }
}

function renderVendors(vendors = [], tokenPlan = null) {
  els.vendors.innerHTML = vendors
    .map((v) => {
      const hp = v.horsepower || {};
      const geoffPlans =
        v.id === "geoff" && tokenPlan?.plans?.length
          ? `<div class="vendor-plans">
              ${tokenPlan.plans
                .map(
                  (p) =>
                    `<span><strong>${escapeHtml(p.name)}</strong> ${escapeHtml(p.price)} · ${escapeHtml(p.tokens)}</span>`,
                )
                .join("")}
            </div>`
          : "";
      return `
        <article class="vendor">
          <div class="vendor-top">
            <div>
              <h4>${escapeHtml(v.name)}</h4>
              <p class="company">${escapeHtml(v.company)}</p>
            </div>
            <span class="swatch" style="color:${escapeHtml(v.color)};background:${escapeHtml(v.color)}"></span>
          </div>
          <p class="tagline">${escapeHtml(v.tagline)}</p>
          <div class="hp">
            <div class="hp-item"><span class="k">Flagship</span><span class="v">${escapeHtml(hp.flagship)}</span></div>
            <div class="hp-item"><span class="k">Context</span><span class="v">${escapeHtml(hp.context)}</span></div>
            <div class="hp-item"><span class="k">API style</span><span class="v">${escapeHtml(hp.apiStyle)}</span></div>
            <div class="hp-item"><span class="k">Pricing</span><span class="v">${escapeHtml(
              v.id === "geoff" && tokenPlan?.plans?.length
                ? `Token Plan ${tokenPlan.plans[0].price} → ${tokenPlan.plans.at(-1).price}`
                : hp.pricingModel,
            )}</span></div>
          </div>
          ${geoffPlans}
          <ul class="delivers">
            ${(v.delivers || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("")}
          </ul>
          <div class="links">
            ${(v.research || [])
              .map(
                (r) =>
                  `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label)}</a>`,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMenus(vendors = []) {
  els.menus.innerHTML = vendors
    .map(
      (v) => `
      <article class="menu">
        <h4>${escapeHtml(v.name)} menu</h4>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Role</th>
              <th>Context</th>
              <th>In / Out</th>
            </tr>
          </thead>
          <tbody>
            ${(v.models || [])
              .map(
                (m) => `
              <tr>
                <td><strong>${escapeHtml(m.id)}</strong><div class="notes">${escapeHtml(m.notes || "")}</div></td>
                <td>${escapeHtml(m.role)}</td>
                <td>${escapeHtml(m.context)}</td>
                <td>${escapeHtml(m.input)} · ${escapeHtml(m.output)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </article>
    `,
    )
    .join("");
}

function applyPayload(data) {
  const catalog = data.catalog || {};
  const tokenPlan = data.tokenPlan || null;
  renderHints(data.compareHints || []);
  renderManifesto(data.manifesto);
  renderFrameCards(data.frameCards || []);
  renderScorecard(data.scorecard || []);
  renderLive(data.live || {}, data.takenAt);
  renderInventories(data.inventories || []);
  renderTokenPlan(tokenPlan);
  renderDimensions(catalog.dimensions || []);
  renderVendors(catalog.vendors || [], tokenPlan);
  renderMenus(catalog.vendors || []);
  els.footnote.textContent = catalog.updatedNote
    ? `${catalog.updatedNote} CoverAI scrapes public pages only. Not an insurer. Not affiliated with Progressive. Not medical advice. Just receipts.`
    : "";
}

function renderClaimsDesk(summary) {
  if (!summary || Object.keys(summary).length === 0) {
    els.claimsMeta.textContent = "Books unavailable right now";
    return;
  }
  const booked = Number(summary.metaproofsPaperworkUsd);
  const paid = Number(summary.metaproofsPaidUsd);
  els.claimBooked.textContent =
    summary.metaproofsPaperworkUsd != null ? fmtCompactUsd(booked) : "—";
  els.claimPaid.textContent =
    summary.metaproofsPaidUsd != null ? fmtCompactUsd(paid) : "—";

  const chainSol = summary.treasuryRpcOk ? Number(summary.treasuryRpcSol ?? 0) : null;
  els.claimChain.textContent =
    chainSol != null && Number.isFinite(chainSol)
      ? `${chainSol.toFixed(3)} SOL`
      : "unverified";
  const chainBits = [];
  if (summary.treasuryRpcSigCount != null)
    chainBits.push(
      `${summary.treasuryRpcSigCount} lifetime signatures`,
    );
  if (chainSol === 0 && !chainBits.length) chainBits.push("wallet never touched");
  els.claimChainNote.textContent = `${
    chainBits.length ? `${chainBits.join(" · ")} · ` : ""
  }verified via public Solana RPC`;

  const proofBit =
    summary.metaproofsTotal != null
      ? `${summary.metaproofsTotal} metaproof records · `
      : "";
  els.claimsMeta.textContent = `${proofBit}booked ${els.claimBooked.textContent} · paid ${els.claimPaid.textContent}`;

  const ghosts = Array.isArray(summary.zenGhostIds) ? summary.zenGhostIds : [];
  if (ghosts.length) {
    els.ghostShelf.hidden = false;
    els.ghostShelf.innerHTML = `<strong>Ghost shelf rider:</strong> anonymous free-tier models ride other carriers’ boards too — ${ghosts
      .map((g) => escapeHtml(g))
      .join(" · ")}. Anonymity is industry furniture, not a fingerprint.`;
  }
}

async function loadMarket() {
  els.reloadBtn.disabled = true;
  try {
    const [res, statusRes] = await Promise.all([
      fetch("/api/market"),
      fetch("/api/status", { cache: "no-store" }).catch(() => null),
    ]);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load market intel");
    applyPayload(data);
    let summary = null;
    if (statusRes && statusRes.ok) {
      try {
        const status = await statusRes.json();
        summary = status?.latest?.summary ?? null;
      } catch {}
    }
    renderClaimsDesk(summary);
  } catch (error) {
    els.liveMeta.textContent = "Load failed";
    els.liveGrid.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    console.error(error);
  } finally {
    els.reloadBtn.disabled = false;
  }
}

els.reloadBtn.addEventListener("click", loadMarket);
loadMarket();

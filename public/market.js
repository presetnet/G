const els = {
  reloadBtn: document.getElementById("reloadBtn"),
  heroNote: document.getElementById("heroNote"),
  dimTable: document.querySelector("#dimTable tbody"),
  vendors: document.getElementById("vendors"),
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


function gradeClass(grade = "") {
  if (grade.startsWith("A")) return "A";
  if (grade.startsWith("B")) return "B";
  if (grade.startsWith("C")) return grade.includes("+") ? "Cplus" : "C";
  return "C";
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
        <td>${escapeHtml(d.scores?.opencode ?? "—")}</td>
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

function renderVendors(vendors = [], tokenPlan = null) {
  els.vendors.innerHTML = vendors
    .map((v) => {
      const hp = v.horsepower || {};
      const geoffPlans =
        v.id === "geoff" && false
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
              v.id === "geoff" && false
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
  renderDimensions(catalog.dimensions || []);
  renderVendors(catalog.vendors || [], tokenPlan);
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
    els.footnote.textContent = `Load failed: ${escapeHtml(error.message)}`;
    console.error(error);
  } finally {
    els.reloadBtn.disabled = false;
  }
}

els.reloadBtn.addEventListener("click", loadMarket);
loadMarket();

const esc = (value) => String(value ?? "--").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const short = (value) => typeof value === "string" && value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
const fmt = (value, digits = 0) => num(value) === null ? "--" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const pct = (value) => num(value) === null ? "--" : `${(value * 100).toFixed(1)}%`;
const clockLeft = (at) => {
  const time = Date.parse(at || "");
  if (!Number.isFinite(time)) return "--:--:--";
  const left = Math.max(0, time - Date.now());
  const s = Math.floor(left / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const gapText = (seconds) => {
  if (num(seconds) === null) return "no gaps yet";
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  return `~${Math.round(seconds / 3600)}h`;
};
const stamp = (value) => {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "age unknown";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  return seconds < 60 ? "<1m ago" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
const link = (base, value, label) => value ? `<a href="${esc(base + encodeURIComponent(value))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "--";
const walletLink = (wallet) => link("https://solscan.io/account/", wallet, short(wallet));
const txLink = (signature) => link("https://solscan.io/tx/", signature, "receipt");
const ethAddressLink = (address) => link("https://app.blockscout.com/eth/mainnet/address/", address, "ethereum explorer");

function sourceState(src) {
  if (!src) return "Unavailable";
  if (src.ok !== true) return `Unavailable${src.status ? ` · HTTP ${src.status}` : ""}`;
  if (src.stale) return "Stale data";
  return `Checked ${stamp(src.checkedAt)}`;
}

function countdownText(at) {
  const time = Date.parse(at || "");
  if (!Number.isFinite(time)) return "deadline unknown";
  const left = time - Date.now();
  if (left <= 0) return "deadline passed";
  const totalMinutes = Math.floor(left / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

let clockTimer = null;
function startSimClock(deadline) {
  const summaryNode = document.getElementById("simCountdown");
  const clockNode = document.getElementById("simClock");
  if (!summaryNode && !clockNode) return;
  if (clockTimer !== null) return;
  clockTimer = setInterval(() => {
    if (summaryNode) summaryNode.textContent = countdownText(deadline);
    if (clockNode) {
      const left = Date.parse(deadline || "") - Date.now();
      clockNode.textContent = left <= 0 ? "00:00:00" : clockLeft(deadline);
    }
  }, 1000);
}

const simPrice = { sol: null, eth: null, at: null };
let priceTimer = null;
async function fetchSimPrices() {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
    const json = await response.json();
    simPrice.sol = num(json?.solana?.usd) ?? simPrice.sol;
    simPrice.eth = num(json?.ethereum?.usd) ?? simPrice.eth;
    simPrice.at = new Date().toISOString();
  } catch (error) {
    // keep the last known prices; a fresh desk render will still show totals.
  }
}
function startSimPriceTicker() {
  if (priceTimer !== null) return;
  priceTimer = setInterval(fetchSimPrices, 120_000);
  fetchSimPrices();
}

function buildSparkBars(rows, valueKey) {
  const nowSec = Date.now() / 1000;
  const winStart = Math.floor(nowSec / 3600) * 3600 - 23 * 3600;
  const buckets = new Array(24).fill(0);
  for (const row of rows || []) {
    if (!Number.isFinite(row?.t)) continue;
    const index = Math.floor((row.t - winStart) / 3600);
    if (index >= 0 && index < 24) buckets[index] += num(row[valueKey]) || 0;
  }
  const max = Math.max(...buckets, 1e-9);
  return buckets.map((value, index) => {
    const height = Math.max(4, Math.round((value / max) * 100));
    const hour = new Date((winStart + index * 3600) * 1000).toISOString().slice(11, 13) + "h";
    return `<span class="sim-bar" style="height:${height}%" title="${esc(hour)} ${fmt(value, 4)}"></span>`;
  }).join("");
}

export function renderSimDesk(latest) {
  const site = latest?.sources?.["sim.site"];
  const front = latest?.sources?.["sim.front"];
  const chain = latest?.sources?.["sim.chain"];
  const eth = latest?.sources?.["sim.eth"];
  const status = document.getElementById("simDeskStatus");
  const summary = document.getElementById("simSummary");
  const paymentRows = document.getElementById("simPaymentRows");
  const chainRows = document.getElementById("simChainRows");
  const sourceText = document.getElementById("simSourceText");
  if (!status || !summary || !paymentRows || !chainRows) return;

  const siteLive = site?.ok === true;
  const frontLive = front?.ok === true;
  const chainLive = chain?.ok === true;
  const ethLive = eth?.ok === true;
  status.textContent = [sourceState(site), sourceState(front), sourceState(chain), sourceState(eth)].join(" · ");

  const rates = site?.rates || {};
  const ladder = [
    rates.like, rates.reply, rates.repost, rates.mention,
  ].every((value) => num(value) !== null)
    ? `like 1,111 → reply 2,223 → repost 3,333 → mention 4,444`
    : `like ${fmt(rates.like)} · reply ${fmt(rates.reply)} · repost ${fmt(rates.repost)} · mention ${fmt(rates.mention)}`;
  const paymentRate = num(rates.payment);

  const deadline = front?.deadline || front?.deadlineFallbackAt || null;
  summary.innerHTML = `
    <span class="sim-stat"><b>${esc(site?.siteVersion ?? "--")}</b><small>site version · public config</small></span>
    <span class="sim-stat"><b>${site?.configured === true ? "X LINKED" : "no X session"}</b><small>${site?.configured === true ? "session reported on sim.tech" : "public session endpoint reports no user"}</small></span>
    <span class="sim-stat"><b>${esc(ladder)}</b><small>observed rate ladder</small></span>
    <span class="sim-stat"><b>${paymentRate === null ? "--" : `$${fmt(paymentRate)}`}</b><small>payment rate · site-controlled number</small></span>
    <span class="sim-stat"><b>${front?.brand ? esc(front.brand) : "brand unread"}</b><small>home page markers</small></span>
    <span class="sim-stat"><b id="simCountdown">${esc(countdownText(deadline))}</b><small>${deadline ? `deadline ${esc(deadline.slice(0, 10))}` : "deadline not published on home page"}</small></span>`;

  const pay = front?.paymentRail;
  paymentRows.innerHTML = frontLive
    ? `<div class="sim-pay-rail">${pay ? [
        `<span><b>${esc(pay.solAmountSol ?? "--")} SOL</b>${walletLink(pay.sol || SIM_SOL_DEST)}<small>mainnet SOL destination · ${chain?.destWallet ? walletLink(chain.destWallet) : ""}</small></span>`,
        `<span><b>${esc(pay.ethAmount ?? "--")} ETH</b>${esc(pay.eth || SIM_ETH_DEST)}${ethAddressLink(SIM_ETH_ADDR)}<small>${front.markers?.ethRailSepolia ? "site still instructs Sepolia testnet (11155111); the desk reads Ethereum mainnet" : "Ethereum mainnet rail"}</small></span>`,
        `<span><b>${pay.xmoneyUsd ? `$${pay.xmoneyUsd}` : "--"}</b>@XMONEY<small>X payment instruction</small></span>`,
      ].join("") : ""}<div class="sim-honesty"><span>The scoreboard requires an X OAuth session — no public leaderboard is kept here. ETH receipts on Ethereum mainnet; the SOL rail is mainnet.</span></div></div>`
    : `<div class="desk-empty"><span>[ - ]</span><span>${esc(front?.reason || "Waiting for the public sim.tech home page")}</span></div>`;

  chainRows.innerHTML = renderMovement(chain, eth, front);

  startSimClock(deadline);
  startSimPriceTicker();

  if (sourceText) sourceText.textContent = [
    `Site config: ${site?.sourceUrl || "https://sim.tech/api/site"}`,
    `Session: ${site?.sourceUrl?.replace("/site", "/session") || "https://sim.tech/api/session"}`,
    `Home page: ${front?.sourceUrl || "https://sim.tech/"}`,
    `Chain: ${chain?.sourceUrl || "https://solscan.io/token/CZNZLxbSB3VRTSZR5TH9FKozh2RGjrZGGUAANE8JTRiX"}`,
    `SOL destination: ${chain?.destWallet || "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C"}`,
    `ETH rail: ${eth?.sourceUrl || `https://eth.blockscout.com/api/v2/addresses/${SIM_ETH_ADDR}/transactions`}`,
    `Deadline: ${front?.deadline ?? (front?.deadlineFallbackAt || "2026-09-25T20:00:00-04:00")}`,
    `Checked: ${site?.checkedAt || "unknown"}`,
    `No leaderboard kept: the sim.tech score page requires X OAuth.`,
    `Deposit totals: SOL rail sums mainnet balance deltas (unique payer wallets, not people); ETH sums Ethereum mainnet receipts. Both are explorer/RPC observations, not sim.tech's own books. Live SOL/ETH prices are a public CoinGecko feed.`,
  ].filter(Boolean).join("\n");
}

function renderMovement(chain, eth, front) {
  const hasData = chain?.solDepositsSol != null || chain?.ok === true || eth?.ok === true || eth?.ethDepositsEth != null;
  if (!hasData) {
    return `<div class="desk-empty"><span>[ - ]</span><span>${esc(chain?.reason || "Waiting for the public Solana RPC + Ethereum explorer")}</span></div>`;
  }

  const solTotal = num(chain?.solDepositsSol);
  const ethTotal = num(eth?.ethDepositsEth);
  const solUsd = num(simPrice.sol) && num(solTotal) ? Number(simPrice.sol) * Number(solTotal) : null;
  const deadline = front?.deadline || front?.deadlineFallbackAt || null;

  const solBars = buildSparkBars(chain?.solDepositBars, "s");
  const ethBars = buildSparkBars(eth?.ethDepositBars, "w");

  const launchCandidates = [chain?.solFirstSeenAt, eth?.ethFirstSeenAt]
    .map((v) => Date.parse(v || ""))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const launchMs = launchCandidates[0] ?? null;
  const deadlineMs = Number.isFinite(Date.parse(deadline || "")) ? Date.parse(deadline) : null;

  const priceLine = num(simPrice.sol) || num(simPrice.eth)
    ? `live: ${num(simPrice.sol) ? `SOL $${fmt(simPrice.sol, 2)}` : "SOL unread"} · ${num(simPrice.eth) ? `ETH $${fmt(simPrice.eth, 2)}` : "ETH unread"}${solUsd ? ` · mainnet pot ≈ $${fmt(solUsd, 0)}` : ""}`
    : "price unread · CoinGecko";
  const priceAge = simPrice.at ? ` · ${stamp(simPrice.at)}` : "";

  const chips = [
    ["SOL this hour", chain?.solHourCount != null ? `${fmt(chain.solHourCount)} · ${fmt(chain.solHourSol, 4)} SOL` : "--"],
    ["SOL today", chain?.solTodayCount != null ? `${fmt(chain.solTodayCount)} · ${fmt(chain.solTodaySol, 4)} SOL` : "--"],
    ["ETH this hour", eth?.ethHourCount != null ? `${fmt(eth.ethHourCount)} · ${fmt(eth.ethHourEth, 4)} ETH` : "--"],
    ["ETH today", eth?.ethTodayCount != null ? `${fmt(eth.ethTodayCount)} · ${fmt(eth.ethTodayEth, 4)} ETH` : "--"],
    ["median gap", gapText(chain?.solMedianGapSec ?? eth?.ethMedianGapSec)],
  ].map(([label, value]) => `<span class="sim-chip"><b>${esc(value)}</b><small>${esc(label)}</small></span>`).join("");

  const repeat = chain?.solDepositCount != null && chain?.solDepositCount > 0
    ? (chain.solDepositCount / Math.max(chain.solUniquePayers, 1)).toFixed(2)
    : null;

  const topRow = (entry, index) => {
    const place = index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `${index + 1}th`;
    return `<li><span>${place}</span><span>${walletLink(entry.wallet)}</span><b>${fmt(entry.sol, 4)}</b><span>${pct(entry.share)}</span></li>`;
  };
  const ethRow = (entry, index) => {
    const place = index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `${index + 1}th`;
    return `<li><span>${place}</span><span>${link("https://app.blockscout.com/eth/mainnet/address/", entry.wallet, short(entry.wallet))}</span><b>${fmt(entry.eth, 4)}</b><span>${pct(entry.share)}</span></li>`;
  };
  const solLeaders = (chain?.solTopPayers || []).slice(0, 5);
  const ethLeaders = (eth?.ethTopSenders || []).slice(0, 5);

  const clockSub = deadlineMs
    ? (launchMs
        ? `run-time ${Math.max(0, Math.min(100, Math.round(((Date.now() - launchMs) / (deadlineMs - launchMs)) * 100)))}% elapsed · first payment seen ${stamp(new Date(launchMs).toISOString())}`
        : "countdown ticking · launch window not yet observed")
    : "countdown ticking";

  const clockBar = deadlineMs && launchMs
    ? `<div class="sim-progress"><i style="width:${Math.max(2, Math.min(100, Math.round(((Date.now() - launchMs) / (deadlineMs - launchMs)) * 100)))}%"></i></div>`
    : "";

  return `<div class="sim-movement">
    <div class="sim-funding">
      <div class="sim-pot">
        <span class="sim-pot-label">Mainnet · SOL pot</span>
        <b class="sim-pot-total">${solTotal != null ? `${fmt(solTotal, 4)} SOL` : "--"}</b>
        <span class="sim-pot-sub">${chain?.solRateLimited === true ? "RPC rate-limit pause · showing last observed" : solUsd != null ? `≈ $${fmt(solUsd, 0)} at live price · ` : ""}${chain?.solDepositCount != null ? `${fmt(chain.solDepositCount)} payment${chain.solDepositCount === 1 ? "" : "s"} · ${fmt(chain.solUniquePayers)} payer${chain.solUniquePayers === 1 ? "" : "s"}${repeat ? ` · ${repeat}× repeat rate` : ""}` : "awaiting the first observed payment"}</span>
      </div>
      <div class="sim-pot sim-pot-eth">
        <span class="sim-pot-label">Testnet · ETH probe</span>
        <b class="sim-pot-total">${ethTotal != null ? `${fmt(ethTotal, 4)} test ETH` : "--"}</b>
        <span class="sim-pot-sub">Ethereum mainnet · ${eth?.ethDepositCount != null ? `${fmt(eth.ethDepositCount)} tx${eth.ethDepositCount === 1 ? "" : "s"} · ${fmt(eth.ethUniqueSenders)} sender${eth.ethUniqueSenders === 1 ? "" : "s"}` : "no receipts read yet"}</span>
      </div>
      <div class="sim-clock">
        <span class="sim-clock-label">deadline</span>
        <b id="simClock">${esc(clockLeft(deadline))}</b>
        ${clockBar}
        <span class="sim-pot-sub">${esc(clockSub)}</span>
      </div>
    </div>
    <div class="sim-velocity">${chips}</div>
    <div class="sim-spark-grid">
      <div class="sim-spark"><h4>SOL received · last 24h by hour</h4><div class="sim-bars">${solBars}</div><small>${fmt(chain?.solTodayCount)} deposits today</small></div>
      <div class="sim-spark"><h4>ETH received · last 24h by hour</h4><div class="sim-bars sim-bars-eth">${ethBars}</div><small>${fmt(eth?.ethTodayCount)} txs today</small></div>
    </div>
    <div class="sim-leaders">
      <div class="sim-leader"><h4>Top payers · SOL rail</h4><ol>${solLeaders.length ? solLeaders.map(topRow).join("") : `<li><span>&mdash;</span><span>no payers observed</span></li>`}</ol></div>
      <div class="sim-leader"><h4>Top senders · ETH testnet</h4><ol>${ethLeaders.length ? ethLeaders.map(ethRow).join("") : `<li><span>&mdash;</span><span>no senders observed</span></li>`}</ol></div>
    </div>
    <div class="sim-liveprice"><span>Solana RPC ${chain?.ok === true ? "live" : "unavailable"} · Ethereum explorer ${eth?.ok === true ? "live" : "unavailable"} · ${esc(priceLine)}${esc(priceAge)}</span></div>
    <div class="sim-honesty"><span>Donations above are observer sums — not sim.tech's books. Payer/sender counts are unique wallets per rail, not people; a wallet on both rails appears in both. ETH is a testnet rail; its totals do not convert to USD.</span></div>
  </div>`;
}

const SIM_SOL_DEST = "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C";
const SIM_ETH_DEST = "void.eth";
const SIM_ETH_ADDR = "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4";
const esc = (value) => String(value ?? "--").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const short = (value) => typeof value === "string" && value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
const fmt = (value, digits = 0) => num(value) === null ? "--" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const stamp = (value) => {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "age unknown";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  return seconds < 60 ? "<1m ago" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
const link = (base, value, label) => value ? `<a href="${esc(base + encodeURIComponent(value))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "--";
const walletLink = (wallet) => link("https://solscan.io/account/", wallet, short(wallet));
const txLink = (signature) => link("https://solscan.io/tx/", signature, "receipt");

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

let countdownTimer = null;
function startSimCountdown(deadline) {
  const node = document.getElementById("simCountdown");
  if (!node) return;
  const tick = () => { node.textContent = countdownText(deadline); };
  if (countdownTimer === null) {
    countdownTimer = setInterval(tick, 30_000);
    setTimeout(tick, 500);
  } else {
    tick();
  }
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
        `<span><b>${esc(pay.solAmountSol ?? "--")} SOL</b>${walletLink(pay.sol || SIM_SOL_DEST)}<small>mainnet SOL destination</small></span>`,
        `<span><b>${esc(pay.ethAmount ?? "--")} ETH</b>${esc(pay.eth || SIM_ETH_DEST)}<small>${front.markers?.ethRailSepolia ? "Sepolia testnet rail (chain 11155111) detected on page" : "encrypted ETH rail"}</small></span>`,
        `<span><b>${pay.xmoneyUsd ? `$${pay.xmoneyUsd}` : "--"}</b>@XMONEY<small>X payment instruction</small></span>`,
      ].join("") : ""}<div class="sim-honesty"><span>The scoreboard requires an X OAuth session — no public leaderboard is kept here. ETH receipts on chain 11155111 (Sepolia) are testnet; the SOL rail is mainnet.</span></div></div>`
    : `<div class="desk-empty"><span>[ - ]</span><span>${esc(front?.reason || "Waiting for the public sim.tech home page")}</span></div>`;

  chainRows.innerHTML = (chainLive || ethLive || chain?.solDepositsSol != null || eth?.ethDepositsEth != null)
    ? `<div class="sim-chain-grid">
        <article><strong>SIM supply</strong><b>${chain?.simSupply != null ? fmt(chain.simSupply, 6) : "--"}</b><small>mint ${esc(short(chain?.tokenMint))} · not linked (token surface)</small></article>
        <article><strong>SIM mint activity</strong><b>${stamp(chain?.mintLatestAt)}</b><small>${chain?.mintLatestSignature ? txLink(chain.mintLatestSignature) : "no signature read"}</small></article>
        <article><strong>SOL rail activity</strong><b>${stamp(chain?.destLatestAt)}</b><small>${chain?.destLatestSignature ? `${txLink(chain.destLatestSignature)} · ${walletLink(chain.destWallet)}` : "no signature read"}</small></article>
        <article><strong>SOL received</strong><b>${chain?.solDepositsSol != null ? `${fmt(chain.solDepositsSol, 4)} SOL` : "--"}</b><small>${chain?.solDepositCount != null ? `${fmt(chain.solDepositCount)} payments · ${fmt(chain.solUniquePayers)} unique payers` : "mainnet balance deltas"}${chain?.ok !== true ? " · carried" : ""}</small><small>incoming ${walletLink(chain?.destWallet)} · ${esc(short(chain?.destWallet))}</small></article>
        <article><strong>ETH received</strong><b>${eth?.ethDepositsEth != null ? `${fmt(eth.ethDepositsEth, 4)} test ETH` : "--"}</b><small>${eth?.ethDepositCount != null ? `${fmt(eth.ethDepositCount)} txs · ${eth.ethUniqueSenders} senders` : "Sepolia explorer count"}${eth?.ok !== true ? " · carried" : ""}</small><small>void.eth → ${esc(short(SIM_ETH_ADDR))} · Sepolia ${eth?.ethPages ? `(paged ×${eth.ethPages})` : "11155111"}</small></article>
      </div>`
    : `<div class="desk-empty"><span>[ - ]</span><span>${esc(chain?.reason || "Waiting for the public Solana RPC")}</span></div>`;

  startSimCountdown(deadline);

  if (sourceText) sourceText.textContent = [
    `Site config: ${site?.sourceUrl || "https://sim.tech/api/site"}`,
    `Session: ${site?.sourceUrl?.replace("/site", "/session") || "https://sim.tech/api/session"}`,
    `Home page: ${front?.sourceUrl || "https://sim.tech/"}`,
    `Chain: ${chain?.sourceUrl || "https://solscan.io/token/CZNZLxbSB3VRTSZR5TH9FKozh2RGjrZGGUAANE8JTRiX"}`,
    `SOL destination: ${chain?.destWallet || "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C"}`,
    `ETH rail: ${eth?.sourceUrl || `https://eth-sepolia.blockscout.com/api/v2/addresses/${SIM_ETH_ADDR}/transactions`}`,
    `Deadline: ${front?.deadline ?? (front?.deadlineFallbackAt || "2026-09-25T20:00:00-04:00")}`,
    `Checked: ${site?.checkedAt || "unknown"}`,
    `No leaderboard kept: the sim.tech score page requires X OAuth.`,
    `Deposit totals: SOL rail sums mainnet balance deltas (unique payer wallets, not people); ETH sums Sepolia testnet receipts. Both are explorer/RPC observations, not sim.tech's own books.`,
  ].filter(Boolean).join("\n");
}

const SIM_SOL_DEST = "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C";
const SIM_ETH_DEST = "void.eth";
const SIM_ETH_ADDR = "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4";
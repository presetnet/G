#!/usr/bin/env node
// ASSET VIEWER test.
//
// Default run is fixture-based and hits NO network: it stubs globalThis.fetch
// with recorded shapes from the two endpoints the viewer uses (Solana JSON-RPC,
// Blockscout v2) and asserts the honesty rules that matter —
//   - a Solana/Ethereum address classifies, junk does not;
//   - native balance, SPL/ERC-20 amounts, NFT collections and SIM count are read;
//   - dust airdrops sort below real balances;
//   - a failed read is ok:false with null numbers, never a fake zero;
//   - a failed read after a good one serves the last good read, stale:true;
//   - capped walks (1000 sigs, >40 tokens) are reported, not hidden;
//   - no Helius key ever appears in the payload.
//
// LIVE=1 additionally reads the four default desk wallets from the real
// endpoints and prints a short observation table.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "server", "wallet-assets.js"), "utf8");
const HELIUS = "secret-helius-key-abc";
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS}`;

let failures = 0;
let checks = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- fixtures
const SOL_ADDRESS = "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU";
const EVM_ADDRESS = "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4";

function tokenAccount(mint, amount, decimals) {
  return { account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } };
}

const fixtures = {
  solanaOk: {
    getBalance: { context: { slot: 1 }, value: 140770653101 },
    getTokenAccountsByOwner: [
      // first call = legacy Token program, second = Token-2022
      { value: [tokenAccount("DustMint1111111111111111111111111111111111", "900000000000", 0), tokenAccount("RealSpl2222222222222222222222222222222222", "5000000", 6)] },
      { value: [] },
    ],
    getSignaturesForAddress: Array.from({ length: 1000 }, (_, i) => ({
      signature: `sig${i}`,
      blockTime: 1758800000 - i,
    })),
  },
  solanaBalanceDown: null, // getBalance throws
  evmOk: {
    meta: {
      coin_balance: "12418846917142472000",
      exchange_rate: "2694.31",
      is_contract: true,
      is_verified: true,
      name: "void.eth",
      ens_domain_name: "void.eth",
    },
    tokenBalances: [
      { token: { address_hash: "0xsmall", name: "Small", symbol: "SML", decimals: 18, exchange_rate: "0.01", type: "ERC-20" }, value: "1000000000000000000" },
      { token: { address_hash: "0xbig", name: "Big", symbol: "BIG", decimals: 18, exchange_rate: "3000", type: "ERC-20" }, value: "2000000000000000000" },
    ],
    nft: {
      items: [
        { token: { address_hash: "0xc3706195ff60658585b58716717ee7acc5ebca60", name: "The Simulation", symbol: "SIM", type: "ERC-721" }, value: "2" },
        { token: { address_hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", name: "Other Art", symbol: "ART", type: "ERC-721" }, value: "1" },
      ],
      next_page_params: null,
    },
    transactions: {
      items: [{ hash: "0xdeadbeef", timestamp: "2026-09-26T01:01:11.000000Z" }],
      next_page_params: { block_number: 12 },
    },
  },
  evmMetaDown: null,
};

function makeFetch(overrides = {}) {
  const calls = { solana: [], blockscout: [], jupiter: [] };
  const state = { solanaMode: "ok", evmMetaMode: "ok", jupiterMode: "ok" };
  const stub = async (url, opts) => {
    const target = String(url);
    if (opts?.method === "POST" && target.startsWith("http")) {
      const { method } = JSON.parse(opts.body);
      calls.solana.push(method);
      if (state.solanaMode === "down" && method === "getBalance") throw new Error("simulated getBalance failure");
      const value = fixtures.solanaOk[method];
      if (method === "getTokenAccountsByOwner") {
        const idx = calls.solana.filter((m) => m === "getTokenAccountsByOwner").length - 1;
        return json({ result: value[idx] });
      }
      if (method === "getSignaturesForAddress") return json({ result: overrides.sigs ?? value });
      if (value === null || value === undefined) throw new Error(`no fixture for ${method}`);
      return json({ result: value });
    }
    if (target.startsWith("https://lite-api.jup.ag/price/v3")) {
      calls.jupiter.push(target.split("ids=")[1]);
      if (state.jupiterMode === "down") return { ok: false, status: 503, json: async () => null };
      return json({
        RealSpl2222222222222222222222222222222222: { usdPrice: 2.5, liquidity: 41000, decimals: 6 },
        So11111111111111111111111111111111111111112: { usdPrice: 121.83, liquidity: 959617958, decimals: 9 },
        // DustMint deliberately absent → unpriced, must sort last
      });
    }
    if (target.includes("/api/v2/addresses/") && target.endsWith("/token-balances")) {
      calls.blockscout.push("token-balances");
      return json(fixtures.evmOk.tokenBalances);
    }
    if (target.includes("/api/v2/addresses/") && target.endsWith("/nft")) {
      calls.blockscout.push("nft");
      return json(fixtures.evmOk.nft);
    }
    if (target.includes("/api/v2/addresses/") && target.endsWith("/transactions")) {
      calls.blockscout.push("transactions");
      return json(fixtures.evmOk.transactions);
    }
    if (target.includes("/api/v2/addresses/")) {
      calls.blockscout.push("meta");
      if (state.evmMetaMode === "down") return { ok: false, status: 429, json: async () => ({ message: "rate limited" }) };
      return json(fixtures.evmOk.meta);
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  function json(value) {
    return { ok: true, status: 200, json: async () => value };
  }
  return { stub, calls, state };
}

async function loadModule(stub) {
  const context = vm.createContext({
    fetch: stub,
    process: { env: { SOLANA_RPC_URL: RPC_URL, HELIUS_API_KEY: HELIUS } },
    console,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    isNaN,
    isFinite,
  });
  context.globalThis = context;
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(async (spec) => {
    if (spec === "./config.js") return new vm.SyntheticModule([], function () {}, { context });
    if (spec === "node:crypto") {
      const m = await import("node:crypto");
      return new vm.SyntheticModule(["createHash"], function () {
        this.setExport("createHash", m.createHash);
      }, { context });
    }
    throw new Error(`unexpected import ${spec}`);
  });
  await mod.evaluate();
  return mod.namespace;
}

// ------------------------------------------------------------------- tests
console.log("asset viewer · fixtures (no network)");
{
  const { stub, calls } = makeFetch();
  const mod = await loadModule(stub);
  check("classify: solana", mod.classifyAddress(SOL_ADDRESS).chain === "solana");
  check("classify: ethereum", mod.classifyAddress(EVM_ADDRESS).chain === "ethereum");
  check("classify: mixed case ethereum", mod.classifyAddress(EVM_ADDRESS.toUpperCase().replace("0X", "0x")).chain === "ethereum");
  check("classify: junk refused", mod.classifyAddress("not-an-address").ok === false);
  check("classify: empty refused", mod.classifyAddress("").ok === false);

  const res = await mod.inspectWallets([SOL_ADDRESS, EVM_ADDRESS, "garbage"], {});
  check("three rows returned", res.wallets.length === 3);
  const [sol, evm, bad] = res.wallets;

  check("solana ok", sol.ok === true);
  check("solana native SOL 140.770653101", sol.native.amount === 140.770653101, String(sol.native.amount));
  check("solana native priced from jupiter", sol.native.usdRate === 121.83 && Math.abs(sol.native.usd - 140.770653101 * 121.83) < 0.01, JSON.stringify(sol.native));
  check("solana priced token ranks above unpriced dust", sol.tokens[0].amount === 5 && sol.tokens[0].usd === 12.5, JSON.stringify(sol.tokens[0]));
  check("solana unpriced dust sorted last", sol.tokens[1].mint.startsWith("Dust") && sol.tokens[1].usd === null);
  check("unpriced count disclosed", sol.caps.some((c) => /no Jupiter price/.test(c)), JSON.stringify(sol.caps));
  check("jupiter named in provenance", sol.provenance.some((p) => /Jupiter price\/v3/.test(p)), JSON.stringify(sol.provenance));
  check("solana activity capped at 1000 sigs", sol.activity.count === 1000 && sol.activity.capped === true);
  check("solana cap disclosed", sol.caps.some((c) => /1000 signatures/.test(c)), JSON.stringify(sol.caps));
  check("solana explorer link", sol.explorer.addressUrl.includes(SOL_ADDRESS));

  check("evm ok", evm.ok === true);
  check("evm native ETH 12.418846917142472", Math.abs(evm.native.amount - 12.418846917142472) < 1e-12, String(evm.native.amount));
  check("evm identity name", evm.identity.name === "void.eth" && evm.identity.isContract === true);
  check("evm tokens sorted by usd desc", evm.tokens[0].symbol === "BIG", evm.tokens[0]?.symbol);
  check("evm nft total", evm.nft.total === 2);
  check("evm collections ranked by count", evm.nft.collections[0].contract.toLowerCase().startsWith("0xc3706195"), evm.nft.collections[0]?.contract);
  check("sim held = 2 with opensea url", evm.sim.held === 2 && evm.sim.url.includes("opensea.io"));
  check("evm activity from transactions", evm.activity.count === 1 && evm.activity.capped === true);

  check("junk row is ok:false with reason", bad.ok === false && /not a Solana/.test(bad.reason || ""));
  check("junk row has no numbers", bad.native === null);

  const payload = JSON.stringify(res);
  check("no helius key in payload", !payload.includes(HELIUS));
  check("no key in provenance either", sol.provenance.every((p) => !p.includes(HELIUS)) && sol.provenance.some((p) => p.includes("mainnet.helius-rpc.com")));

  // failure: getBalance down on a wallet we have never read → no fake zero
  const { stub: stub2, state } = makeFetch();
  const mod2 = await loadModule(stub2);
  await mod2.inspectWallets([SOL_ADDRESS], {});
  state.solanaMode = "down";
  const fresh = await mod2.inspectWallets(["9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZ2"], {});
  const downRow = fresh.wallets[0];
  check("failed read ok:false", downRow.ok === false);
  check("failed read native stays null (no zero)", downRow.native.amount === null, JSON.stringify(downRow.native));
  check("failed read carries reason", /getBalance failed/.test(downRow.reason || ""), downRow.reason);

  // failure on a wallet we HAVE read → last good row, flagged stale
  state.solanaMode = "down";
  const again = await mod2.inspectWallets([SOL_ADDRESS], { fresh: true });
  const staleRow = again.wallets[0];
  check("stale served after failure", staleRow.stale === true && staleRow.ok === false);
  check("stale keeps last good number", staleRow.native.amount === 140.770653101, String(staleRow.native.amount));
  check("stale keeps last good fingerprint", typeof staleRow.fingerprint === "string");

  // jupiter down → still serves amounts, discloses missing USD
  state.solanaMode = "ok";
  state.jupiterMode = "down";
  const { stub: stubJ, state: stateJ } = makeFetch();
  const modJ = await loadModule(stubJ);
  stateJ.jupiterMode = "down";
  const noPrice = await modJ.inspectWallets([SOL_ADDRESS], {});
  const noPriceRow = noPrice.wallets[0];
  check("jupiter down still ok", noPriceRow.ok === true);
  check("jupiter down keeps amounts, drops usd", noPriceRow.native.amount === 140.770653101 && noPriceRow.native.usd === null);
  check("jupiter down disclosed as warning", noPriceRow.warnings.some((w) => /Jupiter/i.test(w)), JSON.stringify(noPriceRow.warnings));

  // dedupe + cap
  const { stub: stub3 } = makeFetch();
  const mod3 = await loadModule(stub3);
  const many = await mod3.inspectWallets([EVM_ADDRESS, EVM_ADDRESS, ...Array.from({ length: 12 }, (_, i) => `0x${String(i).padStart(40, "0")}`)], {});
  check("deduped duplicate address", many.wallets.filter((w) => w.address.toLowerCase() === EVM_ADDRESS.toLowerCase()).length === 1);
  check("capped at 8 wallets", many.wallets.length === 8 && many.maxWallets === 8);
  void calls;
}

// ------------------------------------------------------------------- live
if (process.env.LIVE === "1") {
  console.log("\nasset viewer · live (real endpoints)");
  const mod = await import("../server/wallet-assets.js");
  const wallets = [
    "BjLoeUtRq1QBLBWcTWgUFFfj75BsrcESZMu6F1DrMV9C",
    "0xE18D3f89665EbF4EF885389b62a91Ed910572Af4",
    "9GjEVnpWiLe2uknUmtaH6DSfgcBvL66DtSKGREXDctZU",
    "0xc3706195Ff60658585B58716717ee7Acc5ebcA60",
  ];
  const res = await mod.inspectWallets(wallets, { fresh: true });
  for (const w of res.wallets) {
    const line = [
      w.chain === "solana" ? "SOL" : "ETH",
      w.ok ? `${w.native?.amount} ${w.native?.symbol}` : `unread (${w.reason})`,
      `tokens ${w.tokens.length}${w.tokensCapped ? "+" : ""}`,
      `nfts ${w.nft?.total ?? 0}`,
      `sim ${w.sim?.held ?? 0}`,
      w.activity?.lastAt ? `last ${w.activity.lastAt}` : "last ?",
    ].join(" · ");
    console.log(`  ${line}`);
    checks += 1;
    if (!w.ok) failures += 1;
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log("asset viewer: PASS");

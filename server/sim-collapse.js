// Read-only collapse receipts and block-pinned recipe reads. No wallet discovery,
// signatures, persistent personal history, or inference from marketplace prices.
import { AbiCoder, Interface, formatEther, keccak256 } from "ethers";
import { readSupplyPulse, readSalesPulse, readRuleChanges } from "./sim-pulse.js";

export const SIM_CONTRACT = "0xc3706195ff60658585b58716717ee7acc5ebca60";
export const MAX_LOOKUPS = 4;
export const SIM_ABI = new Interface([
  "function formulaCount() view returns (uint256)",
  "function collapseFee() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function renderer() view returns (address)",
  "function getTypeFormula(uint256) view returns (tuple(uint8 mode,uint256 quantity,uint256[] inputTypes,uint256[] counts,uint256[] outputTypes,uint32[] outputWeights,bool active))",
  "function tokenCategory(uint256) view returns (uint256)",
  "function tokenTraits(uint256) view returns (uint256[6])",
  "function tokenSeed(uint256) view returns (bytes32)",
  "function collapse(uint256 formulaId,uint256[] ids) payable returns (uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event Collapsed(uint256 indexed formulaId,uint256 indexed output,uint256[] inputs)",
]);
const RENDERER_ABI = new Interface(["function name(uint256) view returns (string)"]);
const CODER = AbiCoder.defaultAbiCoder();
const ZERO = "0x0000000000000000000000000000000000000000";
const RPCS = ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"];
const BLOCKSCOUT = "https://eth.blockscout.com/api/v2";
const HASH = /^0x[0-9a-f]{64}$/i;
const MAX_INPUTS = 128;
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const itemUrl = (id) => `https://opensea.io/item/ethereum/${SIM_CONTRACT}/${id}`;

async function mapLimit(items, task, limit = 4) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

export function parseLookup(value) {
  const raw = String(value ?? "").trim();
  if (HASH.test(raw)) return { kind: "transaction", value: raw.toLowerCase() };
  if (/^#?[1-9]\d{0,17}$/.test(raw)) return { kind: "token", value: raw.replace(/^#/, "") };
  throw error("Use a full 0x transaction hash or an output token ID. Wallet addresses are not accepted.");
}

export function unpackFormula(raw, id) {
  const f = raw[0];
  const row = {
    id: String(id), mode: Number(f.mode), quantity: Number(f.quantity),
    inputTypes: Array.from(f.inputTypes, String), counts: Array.from(f.counts, Number),
    outputTypes: Array.from(f.outputTypes, String), weights: Array.from(f.outputWeights, Number),
    active: f.active,
  };
  ensure([0, 1, 2].includes(row.mode), "Unknown formula mode");
  ensure(row.outputTypes.length && row.outputTypes.length === row.weights.length, "Invalid output pool");
  ensure(row.mode === 2 ? row.counts.length === row.inputTypes.length : !row.counts.length, "Invalid formula counts");
  return row;
}

function traitObject(values) {
  return { type: String(values[0]), observe: Number(values[1]) === 1, memetic: Number(values[2]),
    consensus: Number(values[3]), intent: Number(values[4]), anomaly: Number(values[5]) === 1 };
}

export function predictTraits(receiver, id, category) {
  const seed = keccak256(CODER.encode(["uint256", "address", "address", "uint256"], [1, SIM_CONTRACT, receiver, id]));
  const draw = (n) => BigInt(keccak256(CODER.encode(["bytes32", "uint256"], [seed, n])));
  let intentDraw = Number(draw(4) % 78n), intent = 0;
  for (let n = 1; n <= 12; n++) { if (intentDraw < n) { intent = n; break; } intentDraw -= n; }
  const values = [category, draw(1) % 2n, [1, 12, 33, 66, 69, 99, 100][Number(draw(2) % 7n)], draw(3) % 6n + 1n, intent, draw(5) % 2n];
  return { seed, traits: traitObject(values) };
}

// IDs and grouping come from the receipt, not an explorer's cached metadata.
export function verifyCollapseReceipt(tx, receipt, expectedHash) {
  ensure(receipt && Number(BigInt(receipt.status)) === 1, "Transaction failed or is not confirmed; no successful collapse to decode.");
  ensure(same(tx.hash, expectedHash) && same(receipt.transactionHash, expectedHash), "Transaction hash mismatch");
  ensure(same(tx.blockHash, receipt.blockHash), "Transaction and receipt disagree on the block");
  ensure(Number.isSafeInteger(Number(BigInt(receipt.blockNumber))), "Invalid receipt block");
  ensure(Array.isArray(receipt.logs) && receipt.logs.length <= 5000, "Receipt log limit exceeded");
  const logs = receipt.logs.filter((l) => same(l.address, SIM_CONTRACT)).map((l) => {
    try { return SIM_ABI.parseLog(l); } catch { return null; }
  }).filter(Boolean);
  const collapsed = logs.filter((l) => l.name === "Collapsed");
  ensure(collapsed.length > 0, "No Simulation Collapsed event in this successful transaction.");
  ensure(collapsed.length <= MAX_LOOKUPS, `At most ${MAX_LOOKUPS} collapses per transaction are supported.`);
  const transfers = logs.filter((l) => l.name === "Transfer").map((l) => l.args);
  const batches = collapsed.map(({ args }) => {
    const inputs = Array.from(args.inputs, String);
    ensure(inputs.length > 0 && inputs.length <= MAX_INPUTS, "Collapse input limit exceeded");
    ensure(inputs.every((id, i) => !i || BigInt(id) > BigInt(inputs[i - 1])), "Collapsed inputs are not sorted and distinct");
    const outputId = String(args.output);
    const mints = transfers.filter((t) => same(t.from, ZERO) && String(t.tokenId) === outputId);
    ensure(mints.length === 1 && !same(mints[0].to, ZERO), "Output mint is missing or ambiguous");
    const receiver = mints[0].to;
    for (const id of inputs) {
      const burns = transfers.filter((t) => same(t.to, ZERO) && String(t.tokenId) === id);
      ensure(burns.length === 1 && same(burns[0].from, receiver), `Burn receipt mismatch for token #${id}`);
    }
    return { formulaId: String(args.formulaId), outputId, inputs, receiver };
  });
  if (same(tx.to, SIM_CONTRACT)) {
    const input = SIM_ABI.parseTransaction({ data: tx.input, value: tx.value });
    ensure(input?.name === "collapse" && batches.length === 1, "Unexpected contract call");
    ensure(String(input.args.formulaId) === batches[0].formulaId && JSON.stringify(Array.from(input.args.ids, String)) === JSON.stringify(batches[0].inputs), "Calldata and emitted burn batch disagree");
    ensure(same(tx.from, batches[0].receiver), "Collapse caller and output recipient disagree");
  }
  return batches;
}

export function createCollapseReader({ fetchImpl = fetch, rpcUrls = RPCS, timeoutMs = 7000, requestBudgetMs = 45000 } = {}) {
  let recipeCache = null;
  let recipePending = null;
  let pulseCache = null;
  let pulsePending = null;

  function session() {
    const deadline = Date.now() + requestBudgetMs;
    const names = new Map();
    async function json(url, init = {}) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Read budget exceeded; retry this lookup.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
      try {
        const res = await fetchImpl(url, { ...init, signal: controller.signal });
        if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
        return await res.json();
      } finally { clearTimeout(timer); }
    }
    async function rpc(method, params) {
      let last;
      for (const url of rpcUrls) {
        try {
          const j = await json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          if (j.error) throw new Error(j.error.message || "RPC error");
          return j.result;
        } catch (e) { last = e; }
      }
      throw new Error(`${method}: ${last?.message || "no RPC answered"}`);
    }
    async function call(method, args, block, to = SIM_CONTRACT, abi = SIM_ABI) {
      const raw = await rpc("eth_call", [{ to, data: abi.encodeFunctionData(method, args) }, block]);
      ensure(typeof raw === "string" && raw !== "0x", `${method}: empty on-chain result`);
      return abi.decodeFunctionResult(method, raw);
    }
    async function typeName(id, renderer, block) {
      const key = `${renderer}:${id}:${block}`;
      if (!names.has(key)) names.set(key, call("name", [id], block, renderer, RENDERER_ABI).then(([name]) => {
        ensure(name.length > 0 && name.length <= 100, `TYPE ${id}: missing name`);
        return name;
      }));
      return names.get(key);
    }
    async function formula(id, block) {
      return unpackFormula(await call("getTypeFormula", [id], block), id);
    }
    async function checkChain() {
      ensure(BigInt(await rpc("eth_chainId", [])) === 1n, "RPC is not Ethereum mainnet");
    }
    return { json, rpc, call, typeName, formula, checkChain };
  }

  async function readRecipes() {
    const s = session();
    await s.checkChain();
    const block = await s.rpc("eth_blockNumber", []);
    const [[count], [fee], [renderer]] = await Promise.all([
      s.call("formulaCount", [], block), s.call("collapseFee", [], block), s.call("renderer", [], block),
    ]);
    ensure(count <= 64n, "More than 64 formulas exist; this reader needs its coverage limit increased.");
    // Formula IDs are one-based, and formulaCount is inclusive.
    const formulas = await mapLimit(Array.from({ length: Number(count) }, (_, i) => i + 1), (id) => s.formula(id, block));
    const ids = [...new Set(formulas.flatMap((f) => [...f.inputTypes, ...f.outputTypes]))];
    const types = Object.fromEntries(await mapLimit(ids, async (id) => [id, await s.typeName(id, renderer, block)]));
    return { contract: SIM_CONTRACT, block: Number(BigInt(block)), checkedAt: new Date().toISOString(), feeWei: String(fee), feeEth: formatEther(fee), types, formulas,
      source: `https://etherscan.io/address/${SIM_CONTRACT}#readContract` };
  }

  async function recipes({ fresh = false } = {}) {
    if (!fresh && recipeCache && Date.now() - recipeCache.at < 60_000) return { ...recipeCache.value, cached: true };
    if (!recipePending) recipePending = readRecipes().then((value) => {
      recipeCache = { at: Date.now(), value };
      return { ...value, cached: false };
    }).finally(() => { recipePending = null; });
    return recipePending;
  }

  async function readPulse() {
    const s = session();
    await s.checkChain();
    const block = await s.rpc("eth_blockNumber", []);
    const [supplyRead, marketRead] = await Promise.allSettled([
      readSupplyPulse(s, block), readSalesPulse(s, { contract: SIM_CONTRACT, block }),
    ]);
    const supply = supplyRead.status === "fulfilled" ? { ok: true, ...supplyRead.value } : { ok: false, error: supplyRead.reason.message };
    const market = marketRead.status === "fulfilled" ? { ok: true, ...marketRead.value } : { ok: false, error: marketRead.reason.message };
    const oldBlock = supply.history?.find((h) => h.label === "24h" && h.ok)?.sample.block;
    const changes = await readRuleChanges(s, { block, oldBlock });
    delete supply.history;
    return { contract: SIM_CONTRACT, block: Number(BigInt(block)), checkedAt: new Date().toISOString(), supply, market, changes,
      source: `https://etherscan.io/address/${SIM_CONTRACT}#readContract` };
  }

  async function pulse({ fresh = false } = {}) {
    if (!fresh && pulseCache && Date.now() - pulseCache.at < 60_000) return { ...pulseCache.value, cached: true };
    if (!pulsePending) pulsePending = readPulse().then((value) => {
      // Never retain a failed supply read as a fresh success.
      if (value.supply.ok) pulseCache = { at: Date.now(), value };
      return { ...value, cached: false };
    }).finally(() => { pulsePending = null; });
    return pulsePending;
  }

  async function decode(value) {
    const lookup = parseLookup(value);
    const s = session();
    await s.checkChain();
    let hash = lookup.value;
    if (lookup.kind === "token") {
      // Resolve only this token's mint, and then verify it against the receipt.
      let url = `${BLOCKSCOUT}/tokens/${SIM_CONTRACT}/instances/${lookup.value}/transfers`;
      hash = null;
      for (let page = 0; page < 4 && url && !hash; page++) {
        const j = await s.json(url);
        ensure(Array.isArray(j.items), "Explorer returned an unreadable token history");
        const mint = j.items.find((t) => same(t.token?.address_hash, SIM_CONTRACT) && same(t.from?.hash, ZERO) && String(t.total?.token_id) === lookup.value);
        if (mint) { hash = mint.transaction_hash; break; }
        url = j.next_page_params ? `${BLOCKSCOUT}/tokens/${SIM_CONTRACT}/instances/${lookup.value}/transfers?${new URLSearchParams(j.next_page_params)}` : null;
      }
      ensure(HASH.test(hash || ""), "Could not find the mint within four history pages. Paste the collapse transaction hash instead.");
    }
    const [tx, receipt] = await Promise.all([
      s.rpc("eth_getTransactionByHash", [hash]), s.rpc("eth_getTransactionReceipt", [hash]),
    ]);
    ensure(tx && receipt, "Transaction not found or still pending.");
    const batches = verifyCollapseReceipt(tx, receipt, hash);
    if (lookup.kind === "token") ensure(batches.some((b) => b.outputId === lookup.value), "This token was not created by a collapse in the resolved transaction.");
    const block = receipt.blockNumber;
    const before = hex(BigInt(block) - 1n);
    const [renderer] = await s.call("renderer", [], block);
    const details = await mapLimit(batches, async (batch) => {
      const warnings = [];
      const f = await s.formula(batch.formulaId, block);
      ensure(f.quantity === batch.inputs.length, "Receipt input count differs from the formula");
      const burns = await mapLimit(batch.inputs, async (id) => {
        try {
          const [category] = await s.call("tokenCategory", [id], before);
          ensure(category > 0n, "No category in the preceding block (possibly minted in the same block)");
          return { id, typeId: String(category), name: await s.typeName(category, renderer, block), evidence: "historical-chain" };
        } catch (e) {
          return { id, typeId: null, name: null, evidence: "unavailable", reason: e.message };
        }
      });
      if (burns.some((b) => !b.name)) warnings.push("Burn IDs are receipt-verified, but some pre-burn TYPEs could not be recovered from historical state.");
      else {
        ensure(burns.every((b) => f.inputTypes.includes(b.typeId)), "Historical input TYPE differs from the formula");
        if (f.mode === 1) ensure(burns.every((b) => b.typeId === burns[0].typeId), "Same-TYPE formula mismatch");
        if (f.mode === 2) ensure(f.inputTypes.every((id, i) => burns.filter((b) => b.typeId === id).length === f.counts[i]), "Exact-TYPE count mismatch");
      }
      let category, traits = null, traitProof = "unavailable";
      try {
        const [values] = await s.call("tokenTraits", [batch.outputId], block);
        category = String(values[0]);
        traits = traitObject(values);
        const prediction = predictTraits(batch.receiver, batch.outputId, category);
        const [seed] = await s.call("tokenSeed", [batch.outputId], block);
        traitProof = same(seed, prediction.seed) && JSON.stringify(traits) === JSON.stringify(prediction.traits) ? "matched" : "mismatch";
        if (traitProof === "mismatch") warnings.push("Output traits did not match the deterministic calculation; do not use that model for prediction.");
      } catch (e) {
        if (f.outputTypes.length === 1) category = f.outputTypes[0];
        warnings.push(`Output traits unavailable: ${e.message}`);
      }
      ensure(!category || f.outputTypes.includes(category), "Output TYPE is not allowed by the formula");
      const name = category ? await s.typeName(category, renderer, block) : null;
      const typeCounts = Object.values(burns.filter((b) => b.typeId).reduce((acc, b) => {
        acc[b.typeId] ||= { typeId: b.typeId, name: b.name, count: 0 };
        acc[b.typeId].count++;
        return acc;
      }, {}));
      return { formulaId: batch.formulaId, quantity: batch.inputs.length, burns, typeCounts,
        output: { id: batch.outputId, typeId: category || null, name, traits, traitProof, url: itemUrl(batch.outputId) }, warnings };
    }, 1);
    const gasPrice = receipt.effectiveGasPrice ?? tx.gasPrice;
    return { lookup: lookup.value, tx: hash, block: Number(BigInt(block)), verified: true,
      source: `https://etherscan.io/tx/${hash}`, historicalBlock: Number(BigInt(before)),
      transactionValueEth: formatEther(tx.value || 0), directCollapse: same(tx.to, SIM_CONTRACT),
      gasEth: gasPrice != null ? formatEther(BigInt(receipt.gasUsed) * BigInt(gasPrice)) : null,
      checkedAt: new Date().toISOString(), batches: details };
  }

  async function decodeMany(values) {
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_LOOKUPS) throw error(`Provide 1–${MAX_LOOKUPS} transaction hashes or output token IDs.`);
    // Validate everything before any outbound read; never interpret a wallet as a token.
    values.forEach(parseLookup);
    const unique = [...new Set(values.map((v) => parseLookup(v).value))];
    const results = await mapLimit(unique, async (value) => {
      try { return { ok: true, ...await decode(value) }; }
      catch (e) { return { ok: false, lookup: value, error: e.message }; }
    }, MAX_LOOKUPS);
    return { contract: SIM_CONTRACT, results, checkedAt: new Date().toISOString() };
  }
  return { recipes, pulse, decode, decodeMany };
}

export const collapseReader = createCollapseReader();

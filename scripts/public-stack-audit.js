// Read-only public audit. No application config, cookies, or credentialed RPCs.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = new URL('../data/public-audit-2026-10-09/', import.meta.url);
await mkdir(dir, { recursive: true });
const endpoints = {
  geoff: 'https://geoff.ai/', geoffVersion: 'https://geoff.ai/api/version',
  docs: 'https://docs.geoff.ai/introduction/models', mcp: 'https://mcp.geoff.ai/mcp',
  stackRoot: 'https://stacknet.magma-rpc.com/', stackHealth: 'https://stacknet.magma-rpc.com/health',
  stackNetwork: 'https://stacknet.magma-rpc.com/network/summary', stackModels: 'https://stacknet.magma-rpc.com/v1/models',
  stackNode: 'https://stacknet.magma-rpc.com/node', stackWidgets: 'https://stacknet.magma-rpc.com/widgets',
  pond: 'https://www.pond0x.com/', pondMining: 'https://www.pond0x.com/mining', pondVersion: 'https://www.pond0x.com/api/version',
  miningSurface: 'https://wpond-mining-dashboard.vercel.app/', miningArchive: 'https://wpond-mining-dashboard.vercel.app/band-claims-archive.json',
  pondRigBundle: 'https://www.pond0x.com/_next/static/chunks/91199.6fb0890139cbf021.js',
  trix: 'https://trix.market/', trixGate: 'https://trix.market/api/mkt/g', trixAlias: 'https://trix.market/api/mkt/preorder',
  trixState: 'https://trix.market/api/mkt/state', trixLeaderboard: 'https://www.trix.market/api/mkt/leaderboard',
  trixEligibility: 'https://trix.market/api/mkt/g/eligibility', boxes: 'https://doswapz.com/api/trix-boxes',
  dibzi: 'https://dibzi.ai/', dibziConfig: 'https://dibzi.ai/api/config', dibziNames: 'https://dibzi.ai/api/names', dibziAbout: 'https://dibzi.ai/about',
  sim: 'https://sim.tech/', simSite: 'https://sim.tech/api/site', azy: 'https://azy.life/',
  simToken: 'https://eth.blockscout.com/api/v2/tokens/0xc3706195ff60658585b58716717ee7acc5ebca60',
  simContract: 'https://eth.blockscout.com/api/v2/smart-contracts/0xc3706195ff60658585b58716717ee7acc5ebca60',
  zen: 'https://opencode.ai/zen/v1/models', go: 'https://opencode.ai/go',
  x402: 'https://registry.npmjs.org/@stacknet/x402payg/latest',
  productionHealth: 'https://g-eight-psi.vercel.app/api/health', productionStatus: 'https://g-eight-psi.vercel.app/api/status',
};
const manifest=[];
async function collect([name,url]) {
  const at=new Date().toISOString();
  try {
    const res=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'PublicStackAudit/1.0'}});
    const raw=await res.text();
    // Redact any accidentally published credential URL parameters before persistence.
    const text=raw.replace(/([?&](?:api[-_]?key|token|secret)=)[^\s"'<>\\&]+/gi,'$1[REDACTED]');
    const ext=res.headers.get('content-type')?.includes('json')?'json':name.endsWith('Bundle')?'js':'html';
    await writeFile(new URL(`${name}.${ext}`,dir),text);
    const row={name,url,finalUrl:res.url,checkedAt:at,status:res.status,serverDate:res.headers.get('date'),cacheAge:res.headers.get('age'),bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),file:`${name}.${ext}`};
    manifest.push(row); console.log(JSON.stringify(row));
  } catch(e){const row={name,url,checkedAt:at,error:e.message};manifest.push(row);console.log(JSON.stringify(row));}
}
const jobs=Object.entries(endpoints);
for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(collect));
await writeFile(new URL('manifest.json',dir),JSON.stringify(manifest,null,2));

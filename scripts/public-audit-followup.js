import { readFile, writeFile } from 'node:fs/promises';
import { Interface } from 'ethers';
const dir=new URL('../data/public-audit-2026-10-09/',import.meta.url);
const read=async n=>JSON.parse(await readFile(new URL(n+'.json',dir),'utf8'));
const out={checkedAt:new Date().toISOString()};
async function rpc(url,method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}
const abi=new Interface((await read('simContract')).abi);
for(const url of ['https://ethereum-rpc.publicnode.com','https://eth.drpc.org']){
 try{const block=await rpc(url,'eth_blockNumber',[]);const b=await rpc(url,'eth_getBlockByNumber',[block,false]);const values={};
 for(const method of ['totalSupply','nextTokenId','collapseFee','formulaCount','owner','renderer']){const v=await rpc(url,'eth_call',[{to:'0xc3706195ff60658585b58716717ee7acc5ebca60',data:abi.encodeFunctionData(method,[])},block]);values[method]=abi.decodeFunctionResult(method,v)[0].toString();}
 const formulas=[];for(let i=1;i<=Math.min(Number(values.formulaCount),30);i++){const v=await rpc(url,'eth_call',[{to:'0xc3706195ff60658585b58716717ee7acc5ebca60',data:abi.encodeFunctionData('getTypeFormula',[i])},block]);const f=abi.decodeFunctionResult('getTypeFormula',v)[0];formulas.push({id:i,mode:Number(f.mode),quantity:Number(f.quantity),inputs:Array.from(f.inputTypes,String),outputs:Array.from(f.outputTypes,String),weights:Array.from(f.outputWeights,Number),active:f.active});}
 out.simChain={url,block:Number(BigInt(block)),blockAt:new Date(Number(BigInt(b.timestamp))*1000).toISOString(),...values,formulas};break;
 }catch(e){(out.simErrors||=[]).push({url,error:e.message});}
}
const sol='https://api.mainnet-beta.solana.com';
const accounts={buyPack:'HTrrq6C6j9NYySUrpSLn9nDjFbKNBD6pS3xBuLppfW4F',packConfig:'AZxmdJhmHLYg3tufFjUq6Ujm41VBFZ2DAjQGb14Qoou'};
for(const [name,address]of Object.entries(accounts))try{const r=await rpc(sol,'getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);out[name]={address,...r};}catch(e){out[name]={address,error:e.message};}
try{const rows=await rpc(sol,'getSignaturesForAddress',['2Ag1QgyyJj2nS6nD6SLbpAUFaWPhaDrmHwrGwWpMqV9K',{limit:10}]);out.payoutSignatures=rows.map(x=>({signature:x.signature,error:x.err,at:x.blockTime?new Date(x.blockTime*1000).toISOString():null}));}catch(e){out.payoutError=e.message;}
const assets={simApp:'https://sim.tech/app.js',simNft:'https://sim.tech/nft.js',simTheme:'https://sim.tech/simulation-theme.js',miningWorker:'https://www.pond0x.com/mining-worker.js'};
const trix=await readFile(new URL('trix.html',dir),'utf8');for(const [i,m]of [...trix.matchAll(/(?:src|href)="([^"]+\.js)"/g)].entries())assets['trixAsset'+i]=new URL(m[1],'https://www.trix.market').href;
out.assets=[];
for(const [name,url]of Object.entries(assets))try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});const t=(await r.text()).replace(/([?&](?:api[-_]?key|token|secret)=)[^\s"'<>\\&]+/gi,'$1[REDACTED]');await writeFile(new URL(name+'.js',dir),t);out.assets.push({name,url,status:r.status,bytes:t.length,hints:[...t.matchAll(/\b(?:4500|4_500|4,500|8000|8_000|8,000)\b/g)].slice(0,15).map(m=>t.slice(Math.max(0,m.index-100),m.index+200)),routes:[...new Set(t.match(/\/api\/[\w\/-]+/g)||[])]});}catch(e){out.assets.push({name,url,error:e.message});}
const prod=await read('productionStatus');
out.telemetry={};for(const key of ['surface.mining','sim.chain','sim.eth','sim.ethm','azy.chain','magma.eth','pond0x.stats','geoff.keys.9g','geoff.subscription','geoff.product.lanes']){const s=prod.latest.sources[key];out.telemetry[key]=Object.fromEntries(Object.entries(s||{}).filter(([k,v])=>!Array.isArray(v)&&(!v||typeof v!=='object')));}
await writeFile(new URL('followup.json',dir),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));

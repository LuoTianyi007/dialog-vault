const http=require('node:http');
const {seal,unseal,merge,uid}=require('./core');
function privateHost(host){return /^(127\.|10\.|192\.168\.)/.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host);}
function body(req){return new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>64*1024*1024){reject(Error('同步数据超过 64 MB'));req.destroy();}else chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error('请求格式错误'));}});req.on('error',reject);});}
function server({key,getState,save,port=47831,handlePair}){
 const seen=new Set();
 const s=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!['/sync/v1','/pair/v2'].includes(req.url)) throw Error('不支持的请求');
   const remote=(req.socket.remoteAddress||'').replace('::ffff:','');if(!privateHost(remote)) throw Error('仅允许局域网地址');
   const packet=await body(req);if(req.url==='/pair/v2'){if(!handlePair)throw Error();const result=await handlePair(packet,remote);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
   const actualKey=typeof key==='function'?key(packet):key;
   const data=unseal(packet,actualKey,'dialog-vault/sync/v1/request');
   if(typeof data.request!=='string'||Math.abs(Date.now()-data.time)>120000||seen.has(data.request)) throw Error('请求已过期或重复');
   seen.add(data.request);if(seen.size>1000)seen.delete(seen.values().next().value);
   const current=getState();if(!current)throw Error('档案已锁定');
   const merged=merge(current,data.ops||[],data.categoryOps||[]); const known=new Set(data.known||[]),knownCategories=new Set(data.knownCategories||[]);
   const missing=merged.state.ops.filter(o=>!known.has(o.id)); await save(merged.state);
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(seal({request:data.request,ops:missing,known:merged.state.ops.map(o=>o.id),received:merged.added,categoryOps:(merged.state.categoryOps||[]).filter(c=>!knownCategories.has(c.id)),knownCategories:(merged.state.categoryOps||[]).map(c=>c.id)},actualKey,'dialog-vault/sync/v1/response')));
  }catch{if(!res.destroyed){res.writeHead(400);res.end('同步被拒绝：请检查配对密钥、时间及数据格式');}}
 });
 s.requestTimeout=30000;s.headersTimeout=10000;
 return new Promise((resolve,reject)=>{s.once('error',reject);s.listen(port,'0.0.0.0',()=>resolve(s));});
}
async function client({host,port=47831,key,state,auth={}}){
 if(!privateHost(host)||!/^\d+\.\d+\.\d+\.\d+$/.test(host))throw Error('请输入局域网 IPv4 地址，例如 192.168.1.20');
 // First exchange IDs, then send only missing immutable records.
 async function exchange(ops,known,categoryOps,knownCategories){
  const packet=JSON.stringify({...auth,...seal({request:uid(),time:Date.now(),ops,known,categoryOps,knownCategories},key,'dialog-vault/sync/v1/request')});
  const expected=unseal(JSON.parse(packet),key,'dialog-vault/sync/v1/request').request;
  const result=await new Promise((resolve,reject)=>{const req=http.request({host,port,path:'/sync/v1',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(packet)},timeout:30000},async res=>{try{if(res.statusCode!==200){res.resume();throw Error('配对失败，请检查密钥、端口及两台设备时间');}resolve(await body(res));}catch(e){reject(e);}});req.on('timeout',()=>req.destroy(Error('连接超时，请检查地址及防火墙')));req.on('error',reject);req.end(packet);});
  const decoded=unseal(result,key,'dialog-vault/sync/v1/response');if(decoded.request!==expected)throw Error('响应不匹配');return decoded;
 }
 const first=await exchange([],state.ops.map(o=>o.id),[],(state.categoryOps||[]).map(c=>c.id));
 const merged=merge(state,first.ops,first.categoryOps||[]), known=new Set(first.known),knownCategories=new Set(first.knownCategories||[]);
 const outgoing=state.ops.filter(o=>!known.has(o.id));
 const second=await exchange(outgoing,merged.state.ops.map(o=>o.id),(state.categoryOps||[]).filter(c=>!knownCategories.has(c.id)),(merged.state.categoryOps||[]).map(c=>c.id));
 const final=merge(merged.state,second.ops,second.categoryOps||[]);
 return {state:final.state,added:merged.added+final.added,sent:outgoing.length};
}
module.exports={server,client,privateHost,body};

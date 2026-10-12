const {test}=require('node:test'),assert=require('node:assert/strict');
const c=require('../core'),n=require('../network'),s=require('../sync');
async function wait(fn){const end=Date.now()+15000;while(Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,200));}throw Error('自动发现设备超时');}
test('multicast/broadcast discovery, approved pairing, repeat one-click sync and unknown-peer rejection',async()=>{
 let a=c.importMarkdown(c.makeVault('passwordA123').state,{markdown:'# A'}).state,b=c.importMarkdown(c.makeVault('passwordB123').state,{markdown:'# B'}).state;
 a=c.changeCategory(a,{name:'开发'});let approvals=0;
 const A=await n.start({getState:()=>a,save:st=>a=st,approve:async()=>true,port:0,discoveryPort:47839});
 const B=await n.start({getState:()=>b,save:st=>b=st,approve:async p=>{assert.match(p.code,/^\d{6}$/);approvals++;return true;},port:0,discoveryPort:47839});
 try{const peer=await wait(()=>A.list().find(p=>p.device===b.device));assert.equal(peer.trusted,false);const result=await A.connect(b.device);assert.equal(result.sent,1);assert.equal(a.ops.length,2);assert.equal(b.ops.length,2);assert.equal(c.listCategories(b)[0].name,'开发');assert.equal(approvals,1);assert(A.list().find(p=>p.device===b.device).trusted);const second=await A.connect(b.device);assert.equal(second.sent,0);assert.equal(second.added,0);assert.equal(approvals,1);
  const unknown=n.identity(),key=n.shared(unknown,b.network.publicKey);await assert.rejects(s.client({host:peer.host,port:peer.port,key,state:c.makeVault('passwordC123').state,auth:{device:'unknown',publicKey:unknown.publicKey}}));assert.equal(b.ops.length,2);
  A.forget(b.device);assert.equal(A.list().find(p=>p.device===b.device).trusted,false);
 }finally{A.close();B.close();}
});

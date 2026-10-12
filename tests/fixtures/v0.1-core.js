const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uid = () => crypto.randomUUID();
function seal(value, key, aad = 'dialog-vault/v1') {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:data.toString('base64')};
}
function unseal(box, key, aad = 'dialog-vault/v1') {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv,'base64'));
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(box.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));
}
function derive(password, salt) { return crypto.scryptSync(password, Buffer.from(salt,'base64'), 32); }
function makeVault(password) {
  if(typeof password !== 'string' || password.length < 8) throw Error('密码至少需要 8 个字符');
  const key = crypto.randomBytes(32), salt = crypto.randomBytes(16).toString('base64'), recovery = crypto.randomBytes(32);
  const header = {format:'dialog-vault', version:1, salt, wrapped:seal(key.toString('hex'),derive(password,salt)), recovery:seal(key.toString('hex'),recovery)};
  return {key,header,recovery:recovery.toString('hex'),state:{device:uid(),ops:[],local:{}}};
}
function unlock(file, secret, recovery=false) {
  if(file.format!=='dialog-vault'||file.version!==1) throw Error('不支持的档案格式');
  try {
    if(recovery&&!/^[a-f0-9]{64}$/i.test(secret)) throw Error();
    const key=Buffer.from(unseal(recovery?file.recovery:file.wrapped,recovery?Buffer.from(secret,'hex'):derive(secret,file.salt)),'hex');
    const state=unseal(file.payload,key); validateOps(state.ops); state.local ||= {};
    const {payload,...header}=file; return {key,state,header};
  } catch {throw Error('密码或恢复密钥不正确，或者档案文件已损坏');}
}
function encode(v) { return JSON.stringify({...v.header,payload:seal(v.state,v.key)}); }
function persist(file,v) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp'; fs.writeFileSync(tmp,encode(v),{mode:0o600});
  const fd=fs.openSync(tmp,'r+'); try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.existsSync(file)) fs.copyFileSync(file,file+'.prev');
  fs.renameSync(tmp,file);
}
function validateOps(ops) {
  if(!Array.isArray(ops)||ops.length>20000) throw Error('记录数量超出首版限制');
  const ids=new Map();
  for(const o of ops){
    if(!o||typeof o.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(o.id)||typeof o.archive!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(o.archive)||typeof o.title!=='string'||o.title.length>500||typeof o.markdown!=='string'||o.markdown.length>10*1024*1024||typeof o.created!=='number'||!Number.isFinite(o.created)||typeof o.note!=='string'||o.note.length>100000||typeof o.source!=='string'||o.source.length>2000||!Array.isArray(o.assets)) throw Error('导入记录格式无效');
    let size=0;
    for(const a of o.assets){
      if(!a||!['image/png','image/jpeg','image/gif','image/webp'].includes(a.mime)||typeof a.ref!=='string'||a.ref.length>4096||typeof a.data!=='string'||a.data.length>8*1024*1024||a.hash!==hash(Buffer.from(a.data,'base64'))) throw Error('附件无效');
      size+=a.data.length;
    }
    if(size>50*1024*1024) throw Error('附件总量超出首版限制');
    if(ids.has(o.id)&&JSON.stringify(ids.get(o.id))!==JSON.stringify(o)) throw Error('记录 ID 冲突');
    ids.set(o.id,o);
  }
}
function merge(local, incoming) {
  validateOps(incoming); const map=new Map(local.ops.map(o=>[o.id,o])); let added=0;
  for(const o of incoming){ if(map.has(o.id)){if(JSON.stringify(map.get(o.id))!==JSON.stringify(o)) throw Error('记录 ID 冲突，合并已取消');} else {map.set(o.id,o); added++;} }
  const ops=[...map.values()]; validateOps(ops); return {state:{...local,ops},added};
}
function importMarkdown(state, input) {
  const markdown=input.markdown;
  if(typeof markdown!=='string'||!markdown.trim()) throw Error('没有可导入的内容');
  if(markdown.length>10*1024*1024) throw Error('单份 Markdown 超过 10 MB');
  const archive=input.archive||uid(), assets=input.assets||[];
  const prior=state.ops.filter(o=>o.archive===archive).sort((a,b)=>b.created-a.created)[0];
  const title=(input.title||markdown.match(/^#\s+(.+)$/m)?.[1]||'未命名对话').slice(0,500);
  const record={id:uid(),archive,title,markdown,created:Date.now(),note:input.note??prior?.note??'',source:input.source??prior?.source??'',assets};
  const duplicate=state.ops.find(o=>o.markdown===markdown&&o.title===title&&o.source===record.source&&o.note===record.note&&JSON.stringify(o.assets)===JSON.stringify(assets)&&(input.archive?o.archive===archive:true));
  if(duplicate) return {state,record:duplicate,duplicate:true};
  validateOps([record]); return {state:{...state,ops:[...state.ops,record]},record,duplicate:false};
}
function listArchives(state) {
  const groups=new Map();
  for(const o of state.ops){ if(!groups.has(o.archive)) groups.set(o.archive,[]);groups.get(o.archive).push(o); }
  return [...groups.values()].map(versions=>{versions.sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id));return {...versions[0],versions:versions.map(({id,created,title})=>({id,created,title})),trash:!!state.local?.[versions[0].archive]?.trash,position:state.local?.[versions[0].archive]?.position||0};}).sort((a,b)=>b.created-a.created);
}
module.exports={hash,uid,seal,unseal,derive,makeVault,unlock,encode,persist,validateOps,merge,importMarkdown,listArchives};

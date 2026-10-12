const {app,BrowserWindow,ipcMain,dialog,clipboard,powerMonitor,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('./core'),sync=require('./sync'),network=require('./network'),zip=require('./zip-export');
if(process.env.DIALOG_VAULT_DATA)app.setPath('userData',process.env.DIALOG_VAULT_DATA);
app.setName('DialogVault');
if(!app.requestSingleInstanceLock()){app.quit();}
app.on('second-instance',()=>{if(win){win.restore();win.focus();}});
let win,vault=null,listener=null,expiry=null,lastActive=Date.now(),syncBusy=false,unlockBusy=false,lan=null,lanStarting=null,exportPassword=null,lanError='';
const file=()=>path.join(app.getPath('userData'),'archive.vault');
function need(){if(!vault)throw Error('请先解锁档案库');return vault;}
function commit(state){const v=need();core.persist(file(),{...v,state});v.state=state;}
function stop(){if(lan){lan.close();lan=null;}if(listener){listener.close();listener.closeAllConnections();listener=null;}if(expiry)clearTimeout(expiry);expiry=null;}
function lock(){stop();exportPassword=null;if(vault){vault.key.fill(0);vault=null;}if(win&&!win.isDestroyed())win.webContents.send('locked');}
async function startLan(){if(lan)return;if(lanStarting)return lanStarting;const v=need();lanStarting=network.start({port:process.env.VAULT_LAN_PORT?Number(process.env.VAULT_LAN_PORT):47831,getState:()=>vault===v?v.state:null,save:state=>{if(vault!==v)throw Error('档案已锁定');commit(state);},approve:async p=>{if(vault!==v)return false;const r=await dialog.showMessageBox(win,{type:'question',title:'允许设备连接？',message:p.name+' 请求连接你的档案库',detail:'请确认是自己的设备，并核对两台设备上的连接码一致：\n\n'+p.code+'\n\n地址：'+p.host+'\n允许后将双向合并对话及分类。',buttons:['拒绝','允许连接'],defaultId:0,cancelId:0});return r.response===1&&vault===v;},onPeers:detail=>{if(win&&!win.isDestroyed())win.webContents.send('devices-changed',detail);},onChange:()=>{if(win&&!win.isDestroyed())win.webContents.send('changed');}}).then(service=>{if(vault!==v){service.close();return;}lan=service;lanError='';}).catch(e=>{lanError=e.code==='EADDRINUSE'?'同步端口被占用，请关闭另一份档案库后重试':e.message;}).finally(()=>{lanStarting=null;});return lanStarting;}
function assetsFor(markdown,base){
 const refs=new Set();for(const m of markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\n)]+))\)/g))refs.add(m[1]||m[2]);
 for(const m of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi))refs.add(m[1]);
 for(const m of markdown.matchAll(/`((?:~\/|[a-zA-Z]:[\\/])[^`\r\n]+\.(?:png|jpe?g|gif|webp))`/gi))refs.add(m[1]);
 const assets=[],missing=[];let total=0;
 for(const ref of refs){
  try{
   let p=ref;if(/^https?:|^data:|^asset:/i.test(p)){missing.push(ref);continue;}
   if(p.startsWith('~/'))p=path.join(os.homedir(),p.slice(2));
   if(!path.isAbsolute(p)){if(!base){missing.push(ref);continue;}p=path.resolve(base,p);}
   const ext=path.extname(p).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[ext];
   if(!mime||!fs.statSync(p).isFile()||fs.statSync(p).size>5*1024*1024){missing.push(ref);continue;}
   const data=fs.readFileSync(p);total+=data.length;if(total>25*1024*1024){missing.push(ref);continue;}
   // Check image signatures before placing untrusted bytes in the renderer.
   const valid=mime==='image/png'?data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?data[0]===255&&data[1]===216:mime==='image/gif'?data.subarray(0,3).toString()==='GIF':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
   if(!valid){missing.push(ref);continue;}assets.push({ref,mime,hash:core.hash(data),data:data.toString('base64')});
  }catch{missing.push(ref);}
 }
 return {assets,missing};
}
function safeName(s){return s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'对话';}
const handlers={
 status:()=>({exists:fs.existsSync(file()),unlocked:!!vault,path:app.getPath('userData'),version:app.getVersion(),defaultZipPassword:!!exportPassword}),
 async setup({password}){if(vault||fs.existsSync(file()))throw Error('档案库已经存在');const v=core.makeVault(password);core.persist(file(),v);vault=v;exportPassword=password;const recovery=v.recovery;delete vault.recovery;return {recovery};},
 async unlock({password,recovery}){if(unlockBusy)throw Error('请稍后再试');unlockBusy=true;try{vault=core.unlock(JSON.parse(fs.readFileSync(file(),'utf8')),password,!!recovery);exportPassword=recovery?null:password;return true;}catch(e){await new Promise(r=>setTimeout(r,1000));throw e;}finally{unlockBusy=false;}},
 list:()=>core.listArchives(need().state),
 record:({id})=>need().state.ops.find(o=>o.id===id),
 clipboard:()=>{need();return clipboard.readText();},
 async pick(){need();const r=await dialog.showOpenDialog(win,{title:'导入 Markdown',properties:['openFile'],filters:[{name:'Markdown 文档',extensions:['md','markdown','txt']}]});if(r.canceled)return null;const p=r.filePaths[0];if(fs.statSync(p).size>10*1024*1024)throw Error('文件超过 10 MB');const markdown=fs.readFileSync(p,'utf8');return {markdown,base:path.dirname(p),title:path.basename(p,path.extname(p))};},
 preview:({markdown,base})=>{need();return assetsFor(markdown,base);},
 import(input){const v=need();const collected=assetsFor(input.markdown,input.base);const previous=v.state.ops.filter(o=>o.archive===input.archive).flatMap(o=>o.assets);for(const a of previous)if(input.markdown.includes(a.ref)&&!collected.assets.some(b=>b.ref===a.ref))collected.assets.push(a);const missing=collected.missing.filter(ref=>!collected.assets.some(a=>a.ref===ref));const result=core.importMarkdown(v.state,{...input,assets:collected.assets});if(!result.duplicate)commit(result.state);return {archive:result.record.archive,duplicate:result.duplicate,missing};},
 update({id,title,note,source,category}){const v=need(),old=v.state.ops.find(o=>o.id===id);if(!old)throw Error('档案不存在');const r=core.importMarkdown(v.state,{...old,title,note,source,category:category??old.category});if(!r.duplicate)commit(r.state);return true;},
 categories:()=>core.listCategories(need().state),
 category(input){commit(core.changeCategory(need().state,input));return core.listCategories(need().state);},
 local({archive,position,trash}){const v=need();if(!v.state.ops.some(o=>o.archive===archive))throw Error('档案不存在');const local={...v.state.local},item={...local[archive]};if(position!==undefined)item.position=Math.max(0,Number(position)||0);if(trash!==undefined)item.trash=!!trash;local[archive]=item;commit({...v.state,local});return true;},
 lock:()=>{lock();return true;},
 activity:()=>true,
 async backup(){need();const r=await dialog.showSaveDialog(win,{title:'导出加密备份',defaultPath:'对话档案-'+new Date().toISOString().slice(0,10)+'.vault',filters:[{name:'加密档案',extensions:['vault']}]});if(r.canceled)return false;fs.copyFileSync(file(),r.filePath);return true;},
 async restore({password,recovery}){const v=need();const r=await dialog.showOpenDialog(win,{title:'合并加密 ZIP / 旧版备份（已有记录保留）',properties:['openFile'],filters:[{name:'加密档案',extensions:['vault','zip']}]});if(r.canceled)return null;const p=r.filePaths[0];if(fs.statSync(p).size>128*1024*1024)throw Error('备份文件过大');if(path.extname(p).toLowerCase()==='.zip'){if(recovery)throw Error('ZIP 需要导出时的密码，不能使用恢复密钥');let other;try{other=await zip.importZip(fs.readFileSync(p),password);}catch{throw Error('ZIP 密码不正确，或不是本软件导出的加密 ZIP');}if(vault!==v)throw Error('档案已锁定');const merged=core.merge(v.state,other.ops,other.categoryOps||[]);commit(merged.state);return merged.added;}const other=core.unlock(JSON.parse(fs.readFileSync(p,'utf8')),password,!!recovery);try{const merged=core.merge(v.state,other.state.ops,other.state.categoryOps||[]);commit(merged.state);return merged.added;}finally{other.key.fill(0);}},
 async password({password}){const v=need();if(password.length<8)throw Error('密码至少 8 个字符');const salt=crypto.randomBytes(16).toString('base64');const header={...v.header,salt,wrapped:core.seal(v.key.toString('hex'),core.derive(password,salt))};core.persist(file(),{...v,header});v.header=header;exportPassword=password;return true;},
 async exportZip({archives,password,useDefault}){const v=need(),secret=useDefault?exportPassword:password;if(!secret)throw Error('本次使用恢复密钥解锁，请指定 ZIP 密码或用打开密码重新解锁');if(secret.length<8)throw Error('ZIP 密码至少需要 8 个字符');const ids=Array.isArray(archives)?new Set(archives):null;const state={...v.state,ops:ids?v.state.ops.filter(o=>ids.has(o.archive)):v.state.ops};if(!state.ops.length)throw Error('没有可导出的对话');const r=await dialog.showSaveDialog(win,{title:'导出 AES-256 加密 ZIP',defaultPath:'对话档案-'+new Date().toISOString().slice(0,10)+'.zip',filters:[{name:'加密 ZIP',extensions:['zip']}]});if(r.canceled)return false;const data=await zip.exportZip(state,secret);if(vault!==v)throw Error('档案已锁定，导出已取消');const temp=r.filePath+'.tmp';fs.writeFileSync(temp,data);fs.renameSync(temp,r.filePath);return true;},
 async devices(){need();await startLan();return {devices:lan?.list()||[],error:lanError,running:!!lan};},
 async discover(){need();await startLan();lan?.refresh();return true;},
 async connect({device}){need();await startLan();if(!lan)throw Error(lanError||'同步服务未启动');if(syncBusy)throw Error('同步正在进行');syncBusy=true;try{return await lan.connect(device);}finally{syncBusy=false;}},
 forget({device}){need();lan?.forget(device);return true;},
 async export({id}){const o=need().state.ops.find(o=>o.id===id);if(!o)throw Error('档案不存在');const r=await dialog.showSaveDialog(win,{title:'导出明文 Markdown（包含本地图片）',defaultPath:safeName(o.title)+'.md',filters:[{name:'Markdown',extensions:['md']}]});if(r.canceled)return false;let md=o.markdown;const dir=r.filePath+'.assets';for(const a of o.assets){fs.mkdirSync(dir,{recursive:true});const ext={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}[a.mime],name=a.hash+ext;fs.writeFileSync(path.join(dir,name),Buffer.from(a.data,'base64'));const rel=path.basename(dir)+'/'+name;md=md.split(a.ref).join(rel);}fs.writeFileSync(r.filePath,md,'utf8');return true;},
 syncInfo:()=>{need();return {running:!!listener,addresses:Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal).map(i=>i.address),port:47831};},
 async syncStart(){need();stop();const key=crypto.randomBytes(32);listener=await sync.server({key,getState:()=>vault?.state,save:state=>{commit(state);win.webContents.send('changed');}});expiry=setTimeout(()=>{stop();win?.webContents.send('sync-stopped');},15*60*1000);return {key:key.toString('hex'),port:47831};},
 syncStop:()=>{stop();return true;},
 async sync({host,key}){const v=need();if(syncBusy)throw Error('同步进行中');if(!/^[a-f0-9]{64}$/i.test(key))throw Error('配对密钥必须是完整的 64 位字符');syncBusy=true;try{const result=await sync.client({host,key:Buffer.from(key,'hex'),state:v.state});if(vault!==v)throw Error('档案已锁定，请解锁后重新同步');const latest=core.merge(v.state,result.state.ops);commit(latest.state);return {added:latest.added,sent:result.sent};}finally{syncBusy=false;}},
};
app.whenReady().then(()=>{
 win=new BrowserWindow({width:1320,height:880,minWidth:980,minHeight:680,title:'对话档案库',backgroundColor:'#f4f3ef',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'dialog-vault-memory'}});
 win.webContents.session.setPermissionRequestHandler((wc,p,cb)=>cb(false));
 win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:|^wss?:|^ftp:/i.test(d.url)}));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e)=>e.preventDefault());
 for(const [name,fn] of Object.entries(handlers))ipcMain.handle('vault:'+name,async(e,arg)=>{if(e.sender!==win.webContents||!e.senderFrame.url.startsWith('file://')||!e.senderFrame.url.endsWith('/index.html'))return {error:'无效的调用来源'};if(!['devices','status'].includes(name))lastActive=Date.now();try{return {value:await fn(arg||{})};}catch(err){return {error:err.message};}});
 win.loadFile('index.html');powerMonitor.on('lock-screen',lock);powerMonitor.on('suspend',lock);
 setInterval(()=>{if(vault&&Date.now()-lastActive>5*60*1000&&!syncBusy)lock();},10000).unref();
 win.on('closed',()=>{lock();win=null;});
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>stop());

const {ZipWriter,ZipReader,Uint8ArrayReader,Uint8ArrayWriter,TextReader,TextWriter,configure}=require('@zip.js/zip.js');
const {validateOps,validateCategories,listArchives}=require('./core');
configure({useWebWorkers:false});
async function exportZip(state,password){
 if(typeof password!=='string'||password.length<8)throw Error('ZIP 密码至少需要 8 个字符');
 validateOps(state.ops);validateCategories(state.categoryOps||[]);
 const writer=new ZipWriter(new Uint8ArrayWriter(),{password,encryptionStrength:3,zipCrypto:false,level:6});
 await writer.add('archives.json',new TextReader(JSON.stringify({format:'dialog-vault-export',version:1,ops:state.ops,categoryOps:state.categoryOps||[]})));
 const list=listArchives(state);for(let i=0;i<list.length;i++){const o=list[i],dir='documents/'+String(i+1).padStart(4,'0');let md=o.markdown;for(let j=0;j<o.assets.length;j++){const a=o.assets[j],ext={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}[a.mime],name='image-'+j+ext;await writer.add(dir+'/'+name,new Uint8ArrayReader(Buffer.from(a.data,'base64')));md=md.split(a.ref).join(name);}await writer.add(dir+'/conversation.md',new TextReader(md));}
 await writer.add('README.txt',new TextReader('Dialog Vault 加密导出。archives.json 包含原文、分类、备注、图片及全部历史版本，可在 App 中合并恢复。documents 提供最新版本的 Markdown 与图片。ZIP 内容采用 AES-256 加密。'));
 return Buffer.from(await writer.close());
}
async function importZip(buffer,password){const reader=new ZipReader(new Uint8ArrayReader(buffer),{password});try{const entries=await reader.getEntries();if(entries.length>30000)throw Error('ZIP 条目过多');const e=entries.find(e=>e.filename==='archives.json');if(!e||!e.encrypted||e.uncompressedSize>128*1024*1024)throw Error('不是受支持的加密对话 ZIP');const content=await e.getData(new TextWriter());const data=JSON.parse(content);if(data.format!=='dialog-vault-export'||data.version!==1)throw Error('不支持的 ZIP 数据版本');validateOps(data.ops);validateCategories(data.categoryOps||[]);return data;}finally{await reader.close();}}
module.exports={exportZip,importZip};

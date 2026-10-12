const fs=require('node:fs'),path=require('node:path');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('This build script currently targets Windows x64.');
require('./vendor');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const executable=require('electron'),runtime=path.dirname(executable),dest=path.join(root,'dist','DialogVault-PC-'+version);
fs.mkdirSync(dest,{recursive:true});fs.cpSync(runtime,dest,{recursive:true});fs.renameSync(path.join(dest,'electron.exe'),path.join(dest,'DialogVault.exe'));
const app=path.join(dest,'resources/app');fs.mkdirSync(app,{recursive:true});
for(const name of ['main.js','preload.js','core.js','sync.js','network.js','zip-export.js','conversation.js','renderer.js','index.html','style.css'])fs.copyFileSync(path.join(root,name),path.join(app,name));
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'dialog-vault',productName:'对话档案库',version,main:'main.js'}));
fs.cpSync(path.join(root,'vendor'),path.join(app,'vendor'),{recursive:true});fs.mkdirSync(path.join(app,'node_modules/@zip.js'),{recursive:true});fs.cpSync(path.join(root,'node_modules/@zip.js/zip.js'),path.join(app,'node_modules/@zip.js/zip.js'),{recursive:true});
const notices=path.join(dest,'第三方许可');fs.mkdirSync(notices,{recursive:true});
for(const [pkg,label] of [['markdown-it','markdown-it'],['dompurify','DOMPurify'],['katex','KaTeX'],['@highlightjs/cdn-assets','HighlightJS'],['@zip.js/zip.js','zip.js']]){const dir=path.join(root,'node_modules',pkg);for(const name of fs.readdirSync(dir).filter(n=>/^license/i.test(n)))fs.copyFileSync(path.join(dir,name),path.join(notices,label+'-'+name));}
fs.copyFileSync(path.join(root,'README.md'),path.join(dest,'README.md'));fs.copyFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(dest,'THIRD_PARTY_NOTICES.md'));console.log(dest);

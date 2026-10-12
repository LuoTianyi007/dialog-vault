const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),modules=path.join(root,'node_modules'),dest=path.join(root,'vendor');
fs.mkdirSync(dest,{recursive:true});
fs.copyFileSync(path.join(modules,'markdown-it/dist/browser/markdown-it.umd.min.js'),path.join(dest,'markdown-it.min.js'));
fs.copyFileSync(path.join(modules,'dompurify/dist/purify.min.js'),path.join(dest,'purify.min.js'));
fs.cpSync(path.join(modules,'katex/dist'),path.join(dest,'katex'),{recursive:true});
fs.cpSync(path.join(modules,'@highlightjs/cdn-assets'),path.join(dest,'highlight'),{recursive:true});
console.log('Offline renderer resources generated in vendor/');

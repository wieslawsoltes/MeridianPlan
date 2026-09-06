/** Dependency-free bundler for this deliberately narrow ES-module source tree.
 * Preserves module scopes, supports named imports/exports and writes a portable
 * one-file HTML build with an inlined module worker. No transpilation or CDN.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
async function bundle(entry){
  const modules=new Map();
  async function visit(file){
    if(modules.has(file))return;modules.set(file,'');
    let code=await readFile(path.join(root,file),'utf8');const dependencies=[];
    code=code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,(_,names,source)=>{const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),source));dependencies.push(resolved);return `const {${names}}=__require(${JSON.stringify(resolved)});`;});
    const exports=[];
    code=code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\s)/g,'__EXPORT__ ');
    code=code.replace(/__EXPORT__\s+((?:async\s+)?(?:function|class|const|let|var))\s+([A-Za-z_$][\w$]*)/g,(_,kind,name)=>{exports.push(name);return `${kind} ${name}`;});
    if(/\b(?:import|export)\s/.test(code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''))){/* Text literals may include these words; module syntax above is exhaustive for this tree. */}
    modules.set(file,code+`\nObject.assign(__exports,{${exports.join(',')}});`);
    for(const dependency of dependencies)await visit(dependency);
  }
  await visit(entry);
  return `const __modules={${[...modules].map(([name,code])=>`${JSON.stringify(name)}:(__require,__exports)=>{\n${code}\n}`).join(',\n')}};\nconst __cache=new Map();function __require(id){if(__cache.has(id))return __cache.get(id);const out={};__cache.set(id,out);if(!__modules[id])throw new Error('Missing module: '+id);__modules[id](__require,out);return out;}\n__require(${JSON.stringify(entry)});`;
}
const worker=await bundle('src/worker.js'),app=await bundle('src/app.js'),css=await readFile(path.join(root,'styles.css'),'utf8'),favicon=await readFile(path.join(root,'favicon.svg'),'utf8');
let html=await readFile(path.join(root,'index.html'),'utf8');
html=html.replace('<link rel="icon" type="image/svg+xml" href="favicon.svg">',`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}">`);
html=html.replace('<link rel="stylesheet" href="styles.css">',`<style>\n${css}\n</style>`);
const boot=`globalThis.__MERIDIAN_WORKER_SOURCE=${JSON.stringify(worker)};globalThis.__MERIDIAN_WORKER_URL=URL.createObjectURL(new Blob([globalThis.__MERIDIAN_WORKER_SOURCE],{type:'text/javascript'}));\n${app}`;
html=html.replace('<script type="module" src="src/app.js"></script>',`<script type="module">\n${boot.replaceAll('</script','<\\/script')}\n</script>`);
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist','meridian-plan.html'),html);
await writeFile(path.join(root,'dist','worker.bundle.js'),worker);
console.log(`Built dist/meridian-plan.html (${Math.round(Buffer.byteLength(html)/1024)} KiB), no runtime dependencies.`);

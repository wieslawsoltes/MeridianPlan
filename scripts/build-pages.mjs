/** Reproducible static publication; generated files stay out of the source tree. */
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createWorkbook} from '../src/core/sample.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, '_site');
await import('../build.mjs');
await rm(site, {recursive:true, force:true});
await mkdir(site, {recursive:true});
for (const name of ['index.html','styles.css','favicon.svg','LICENSE','src','docs','examples']) {
  await cp(path.join(root,name), path.join(site,name), {recursive:true});
}
await cp(path.join(root,'dist/meridian-plan.html'), path.join(site,'meridian-plan.html'));
await writeFile(path.join(site,'.nojekyll'), '');
await writeFile(path.join(site,'examples/demo-workbook.json'), JSON.stringify(createWorkbook(),null,2));
await writeFile(path.join(site,'deployment.json'), JSON.stringify({
  application:'Meridian Plan', version:'1.0.0',
  commit:process.env.GITHUB_SHA || 'local', builtAt:new Date().toISOString()
},null,2));
console.log('Built _site: modular app, portable HTML, documentation, and examples.');

import {validateWorkbook} from './model.js';
export class Repository {
  constructor(){this.db=null;this.backend='IndexedDB';}
  async open() {
    try {
      this.db=await new Promise((resolve,reject)=> {
        const req=indexedDB.open('meridian-plan',1);
        req.onupgradeneeded=()=>req.result.createObjectStore('workbooks');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
    } catch {this.backend='localStorage';}
    return this;
  }
  async load() {
    let data;
    if(this.db)data=await new Promise((resolve,reject)=>{const req=this.db.transaction('workbooks').objectStore('workbooks').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    else {const text=localStorage.getItem('meridian-workbook-v1');data=text?JSON.parse(text):null;}
    return data?validateWorkbook(data):null;
  }
  async save(workbook) {
    if(this.db)await new Promise((resolve,reject)=>{const tx=this.db.transaction('workbooks','readwrite');tx.objectStore('workbooks').put(workbook,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    else localStorage.setItem('meridian-workbook-v1',JSON.stringify(workbook));
  }
}
export function parseCSV(text) {
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('CSV contains an unterminated quoted field.');
  row.push(field);if(row.some(x=>x!==''))rows.push(row);
  return rows;
}
export function toCSV(rows) {
  return rows.map(row=>row.map(value=> {
    let s=String(value??'');
    // Prevent spreadsheet formula injection in user-entered text cells.
    if(typeof value==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createDemoProject} from '../src/core/sample.js';
import {Scheduler} from '../src/core/scheduler.js';
import {analyzeResources} from '../src/core/resources.js';

// Execute the exact browser worker source inside a real isolated Node worker.
// The shim adapts only message delivery; scheduler/resource implementations are unchanged.
const workerURL=new URL('../src/worker.js',import.meta.url).href;
const bundleURL=new URL('../dist/worker.bundle.js',import.meta.url).href;
async function spawn(source) {
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');
    globalThis.self={postMessage:data=>parentPort.postMessage(data)};
    import(${JSON.stringify(source)}).then(()=>{
      parentPort.on('message',data=>self.onmessage({data}));
      parentPort.postMessage({ready:true});
    }).catch(error=>{throw error;});`,{eval:true});
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  let sequence=0;
  return {worker,run:project=>new Promise((resolve,reject)=>{
    const requestId=++sequence;
    const timer=setTimeout(()=>{worker.off('message',listener);reject(new Error('Worker request timed out'));},10000);
    const listener=data=>{if(data.requestId===requestId){clearTimeout(timer);worker.off('message',listener);resolve(data);}};
    worker.on('message',listener);worker.postMessage({requestId,project,options:{}});
  })};
}
test('Isolated worker returns matching dates/resources and reuses incremental state',async()=>{
  const {worker,run}=await spawn(workerURL);
  try {
    const p=createDemoProject(),first=await run(p),local=new Scheduler().schedule(p);
    assert.equal(first.error,undefined);assert.deepEqual(first.schedule.activities,local.activities);
    assert.deepEqual(first.resources,analyzeResources(p,local));
    p.activities.find(a=>a.id==='A6040').remaining+=480;
    const second=await run(p);assert.equal(second.schedule.stats.mode,'incremental');
    assert.equal(second.schedule.stats.forwardRecomputed,2);
    assert.deepEqual(second.schedule.activities,new Scheduler().schedule(p).activities);
  } finally {await worker.terminate();}
});
test('Worker cycle errors are request-correlated and do not terminate the engine',async()=>{
  const {worker,run}=await spawn(workerURL);
  try {
    const p=createDemoProject();p.relationships.push({id:'cycle',from:'A6050',to:'A1000',type:'FS',lag:0});
    const bad=await run(p);assert.equal(bad.requestId,1);assert.match(bad.error,/Dependency cycle/);
    p.relationships.pop();const good=await run(p);assert.equal(good.requestId,2);assert.equal(good.schedule.summary.count,31);
  } finally {await worker.terminate();}
});
test('Portable bundled worker executes the same scheduling kernel',async()=>{
  const {worker,run}=await spawn(bundleURL);
  try {const p=createDemoProject(),answer=await run(p);assert.equal(answer.error,undefined);assert.deepEqual(answer.schedule.activities,new Scheduler().schedule(p).activities);}
  finally {await worker.terminate();}
});

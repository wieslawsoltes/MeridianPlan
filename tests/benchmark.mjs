import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {emptyProject} from '../src/core/sample.js';
import {Scheduler} from '../src/core/scheduler.js';
import {isoDate} from '../src/core/calendar.js';
const rows=[];
for(const size of [1000,10000]){
 const p=emptyProject(`Benchmark ${size}`,'benchmark');
 p.activities=Array.from({length:size},(_,i)=>({id:'a'+i,code:'A'+i,name:'Synthetic task '+i,wbsId:'wbs-1',calendarId:'cal-office',type:'task',duration:480,remaining:480,percent:0,actualStart:null,actualFinish:null,constraint:'none',constraintDate:null,notes:''}));
 // Parallel independent chains of depth 25: avoids fabricating a decades-long chain.
 p.relationships=p.activities.flatMap((a,i)=>i%25?[{id:'e'+i,from:'a'+(i-1),to:a.id,type:'FS',lag:0}]:[]);
 const engine=new Scheduler();engine.schedule(p); // warmup
 const full=[],inc=[];let answer;
 for(let trial=0;trial<5;trial++){
   let start=performance.now();answer=engine.schedule(p,{force:true});full.push(performance.now()-start);
   p.activities[12].duration+=60;p.activities[12].remaining+=60;
   start=performance.now();answer=engine.schedule(p);inc.push(performance.now()-start);
 }
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 rows.push({activities:size,relationships:p.relationships.length,chainDepth:25,fullMedianMs:median(full),incrementalMedianMs:median(inc),forwardRecomputed:answer.stats.forwardRecomputed,backwardVisited:answer.stats.backwardVisited,forecast:isoDate(answer.forecastFinish),fullSamplesMs:full,incrementalSamplesMs:inc});
}
const report={generated:new Date().toISOString(),runtime:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,
 scope:'Warm scheduler calls, including validation/graph/calendar/float/explanations, five samples per workload. Excludes worker cloning, resource analysis, persistence, rendering and DOM. No end-to-end or GPU FPS claim.',results:rows};
console.log(JSON.stringify(report,null,2));
await writeFile(new URL('../docs/benchmark-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');

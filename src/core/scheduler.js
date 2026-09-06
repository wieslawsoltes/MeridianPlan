import {makeCalendars, addLag, inverseLagUpper, displayDate, MAX_RANGE} from './calendar.js';
import {validateProject} from './model.js';

function getLagCalendar(project,edge,graph,calendars) {
  if(project.lagCalendar==='elapsed')return null;
  const id=project.lagCalendar==='successor'?graph.byId.get(edge.to).calendarId:project.lagCalendar==='project'?project.calendarId:graph.byId.get(edge.from).calendarId;
  return calendars.get(id);
}
function descendants(ids,graph) {
  const seen=new Set(ids.filter(id=>graph.byId.has(id))),queue=[...seen];
  for(let i=0;i<queue.length;i++)for(const r of graph.outgoing.get(queue[i]))if(!seen.has(r.to)){seen.add(r.to);queue.push(r.to);}
  return seen;
}
function globalKey(p){return JSON.stringify([p.id,p.start,p.dataDate,p.finishBy,p.calendarId,p.dayMinutes,p.lagCalendar,p.calendars,p.activities.map(a=>a.id),p.relationships]);}
function activityKey(a){return JSON.stringify([a.code,a.calendarId,a.duration,a.remaining,a.type,a.actualStart,a.actualFinish,a.constraint,a.constraintDate]);}

/** Serial deterministic CPM kernel. Forward incremental closure; backward global pass
 * deliberately recomputes all float to propagate a changed project horizon safely.
 */
export class Scheduler {
  constructor(){this.previous=null;this.key=null;this.activityKeys=new Map();}
  schedule(project,{force=false,changedIds=[]}={}) {
    const began=performance.now(), graph=validateProject(project),calendars=makeCalendars(project.calendars);
    const key=globalKey(project),incremental=!force&&this.previous&&key===this.key;
    const changed=new Set(changedIds);
    if(incremental)for(const a of project.activities)if(this.activityKeys.get(a.id)!==activityKey(a))changed.add(a.id);
    const dirty=incremental?descendants([...changed],graph):new Set(graph.order);
    const results=new Map(),diagnostics=[];
    const previousById=new Map((this.previous?.activities||[]).map(a=>[a.id,a]));
    const diagnostic=(code,message,activityId,severity='warning')=>diagnostics.push({code,message,activityId,severity});
    for(const id of graph.order) {
      const a=graph.byId.get(id),cal=calendars.get(a.calendarId);
      // Only scalar result fields are mutated below; the backward pass creates a new trace array.
      // Share immutable forward explanation entries rather than deep-cloning them per activity.
      if(incremental&&!dirty.has(id)) {results.set(id,{...previousById.get(id)});continue;}
      const trace=[];
      if(a.actualFinish!=null) {
        results.set(id,{id,es:a.actualStart,ef:a.actualFinish,remainingStart:a.actualStart,duration:0,complete:true,trace:[{label:'Completed: immutable actual dates',start:a.actualStart,finish:a.actualFinish,driving:true}]});continue;
      }
      const duration=a.remaining;
      let s=duration?cal.startUp(Math.max(project.start,project.dataDate)):cal.pointUp(Math.max(project.start,project.dataDate));
      trace.push({label:'Project start / data date, snapped to activity calendar',candidate:s});
      if(a.actualStart!=null)trace.push({label:'Retained logic: actual start is fixed; only remaining work is rescheduled',candidate:a.actualStart});
      for(const edge of graph.incoming.get(id)) {
        const pred=results.get(edge.from),event=edge.type[0]==='F'?pred.ef:pred.es;
        const required=addLag(event,edge.lag,getLagCalendar(project,edge,graph,calendars));
        const candidate=edge.type[1]==='F'?cal.earliestStartForFinish(required,duration):(duration?cal.startUp(required):cal.pointUp(required));
        trace.push({label:`${graph.byId.get(edge.from).code} ${edge.type} ${edge.lag>=0?'+':''}${edge.lag/60}h`,candidate,required,relationshipId:edge.id});
        s=Math.max(s,candidate);
      }
      const c=a.constraint||'none',at=a.constraintDate;
      if(['SNET','MSO','FNET','MFO'].includes(c)) {
        const candidate=['FNET','MFO'].includes(c)?cal.earliestStartForFinish(at,duration):(duration?cal.startUp(at):cal.pointUp(at));
        trace.push({label:`${c} constraint at ${displayDate(at,true)}`,candidate});s=Math.max(s,candidate);
      }
      const finish=duration?cal.add(s,duration):s;
      if(finish-project.start>MAX_RANGE)throw new Error(`${a.code}: forecast exceeds the 30-year horizon.`);
      for(const item of trace)item.driving=item.candidate===s;
      results.set(id,{id,es:a.actualStart??s,remainingStart:s,ef:finish,duration,complete:false,trace});
    }
    const forecastFinish=[...results.values()].reduce((latest,r)=>Math.max(latest,r.ef),project.start);
    const targetFinish=project.finishBy??forecastFinish;
    // Backward: translate successor event caps through exact inverse calendar-lag functions.
    for(let i=graph.order.length-1;i>=0;i--) {
      const id=graph.order[i],a=graph.byId.get(id),r=results.get(id),cal=calendars.get(a.calendarId);
      r.trace=r.trace.filter(x=>!x.backward); // discard cached pass explanations
      if(r.complete){r.ls=r.es;r.lf=r.ef;r.totalFloat=0;r.freeFloat=0;r.critical=false;continue;}
      let ls=cal.latestStartForFinish(targetFinish,r.duration),lateReason='Project finish / required finish';
      for(const edge of graph.outgoing.get(id)) {
        const successor=results.get(edge.to);if(successor.complete)continue;
        const cap=edge.type[1]==='F'?successor.lf:successor.ls;
        const eventCap=inverseLagUpper(cap,edge.lag,getLagCalendar(project,edge,graph,calendars));
        if(edge.type[0]==='S'&&a.actualStart!=null)continue; // immutable actual start
        const bound=edge.type[0]==='F'?cal.latestStartForFinish(eventCap,r.duration):(r.duration?cal.startDown(eventCap):cal.pointDown(eventCap));
        if(bound<ls){ls=bound;lateReason=`${graph.byId.get(edge.to).code} ${edge.type}: successor late event cap`;}
      }
      const c=a.constraint||'none',at=a.constraintDate;
      if(['SNLT','FNLT','MSO','MFO'].includes(c)) {
        const bound=['FNLT','MFO'].includes(c)?cal.latestStartForFinish(at,r.duration):(r.duration?cal.startDown(at):cal.pointDown(at));
        if(bound<ls){ls=bound;lateReason=`${c} constraint`;}
      }
      r.ls=ls;r.lf=r.duration?cal.add(ls,r.duration):ls;
      r.totalFloat=Math.min(cal.between(r.remainingStart,r.ls),cal.between(r.ef,r.lf));
      r.critical=r.totalFloat<=0;
      r.trace.push({label:`Backward pass: ${lateReason}`,candidate:ls,finish:r.lf,backward:true,driving:true});
      if(r.totalFloat<0)diagnostic('NEGATIVE_FLOAT',`${a.code} has ${(-r.totalFloat/project.dayMinutes).toFixed(2)} workdays of negative float.`,id);
      if(['SNLT','MSO'].includes(c)&&r.remainingStart>at)diagnostic('START_WINDOW',`${a.code}: its start-date window cannot be met without violating logic.`,id);
      if(['FNLT','MFO'].includes(c)&&r.ef>at)diagnostic('FINISH_WINDOW',`${a.code}: its finish-date window cannot be met without violating logic.`,id);
    }
    const relationshipResults=[];
    for(const edge of project.relationships) {
      const pred=results.get(edge.from),succ=results.get(edge.to),calendar=getLagCalendar(project,edge,graph,calendars);
      const required=addLag(edge.type[0]==='F'?pred.ef:pred.es,edge.lag,calendar);
      const actualEvent=edge.type[1]==='F'?succ.ef:succ.remainingStart;
      const driving=succ.trace.some(t=>t.relationshipId===edge.id&&t.driving);
      relationshipResults.push({...edge,required,satisfied:actualEvent>=required,driving});
      if(actualEvent<required)diagnostic('ACTUAL_LOGIC_CONFLICT',`${graph.byId.get(edge.to).code}: fixed actual dates violate ${graph.byId.get(edge.from).code} ${edge.type}.`,edge.to);
    }
    for(const id of graph.order) {
      const a=graph.byId.get(id),r=results.get(id),cal=calendars.get(a.calendarId);
      if(r.complete)continue;
      const edges=graph.outgoing.get(id).filter(e=>!results.get(e.to).complete);
      let limit=edges.length?Infinity:cal.latestStartForFinish(forecastFinish,r.duration);
      for(const edge of edges) {
        if(edge.type[0]==='S'&&a.actualStart!=null)continue;
        const succ=results.get(edge.to),event=edge.type[1]==='F'?succ.ef:succ.remainingStart;
        const cap=inverseLagUpper(event,edge.lag,getLagCalendar(project,edge,graph,calendars));
        const bound=edge.type[0]==='F'?cal.latestStartForFinish(cap,r.duration):(r.duration?cal.startDown(cap):cal.pointDown(cap));
        limit=Math.min(limit,bound);
      }
      if(!Number.isFinite(limit))limit=cal.latestStartForFinish(forecastFinish,r.duration);
      r.freeFloat=cal.between(r.remainingStart,limit);
      if(a.type!=='milestone'&&graph.incoming.get(id).length===0&&a.actualStart==null)diagnostic('OPEN_START',`${a.code}: no predecessor.`,id,'info');
      if(a.type!=='milestone'&&graph.outgoing.get(id).length===0)diagnostic('OPEN_FINISH',`${a.code}: no successor.`,id,'info');
    }
    const activities=graph.order.map(id=>results.get(id));
    const weights=project.activities.reduce((s,a)=>s+a.duration,0);
    const progress=weights?project.activities.reduce((s,a)=>s+a.duration*a.percent,0)/weights:0;
    const answer={projectId:project.id,activities,relationships:relationshipResults,forecastFinish,targetFinish,diagnostics,
      summary:{count:activities.length,critical:activities.filter(x=>x.critical).length,completed:activities.filter(x=>x.complete).length,inProgress:project.activities.filter(a=>a.actualStart!=null&&a.actualFinish==null).length,progress,negative:activities.filter(x=>x.totalFloat<0).length},
      stats:{mode:incremental?'incremental':'full',forwardRecomputed:dirty.size,backwardVisited:graph.order.length,relationships:project.relationships.length,elapsedMs:performance.now()-began}};
    this.previous=answer;this.key=key;this.activityKeys=new Map(project.activities.map(a=>[a.id,activityKey(a)]));
    return answer;
  }
}
export function createBaseline(project,schedule,name) {
  const results=new Map(schedule.activities.map(r=>[r.id,r]));
  return {id:`baseline-${globalThis.crypto?.randomUUID?.() || Date.now()+'-'+Math.random().toString(36).slice(2)}`,name,created:new Date().toISOString(),dataDate:project.dataDate,finish:schedule.forecastFinish,
    activities:project.activities.map(a=>{const r=results.get(a.id);return {id:a.id,code:a.code,name:a.name,duration:a.duration,remaining:a.remaining,percent:a.percent,start:r.es,finish:r.ef};})};
}
export function compareSchedules(project,reference,current) {
  const cal=makeCalendars(project.calendars).get(project.calendarId),now=new Map(current.activities.map(x=>[x.id,x]));
  const before=new Map(reference.activities.map(x=>[x.id,x]));
  const comparisons=project.activities.map(a=> {
    const b=before.get(a.id),r=now.get(a.id);
    return {id:a.id,code:a.code,name:a.name,previousStart:b?.start??b?.es??null,previousFinish:b?.finish??b?.ef??null,start:r.es,finish:r.ef,
      startVariance:b?cal.between(b.start??b.es,r.es):null,finishVariance:b?cal.between(b.finish??b.ef,r.ef):null,added:!b};
  });
  const currentIds=new Set(project.activities.map(a=>a.id));
  for(const b of reference.activities)if(!currentIds.has(b.id))comparisons.push({id:b.id,code:b.code||b.id,name:b.name||'Removed activity',previousStart:b.start??b.es,previousFinish:b.finish??b.ef,start:null,finish:null,startVariance:null,finishVariance:null,added:false,removed:true});
  return comparisons;
}

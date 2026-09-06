import {parseDate, WorkCalendar, MAX_RANGE} from './calendar.js';
export const SCHEMA_VERSION=1;
export const REL_TYPES=['FS','SS','FF','SF'];
export const CONSTRAINTS={none:'None',SNET:'Start on or after',FNET:'Finish on or after',SNLT:'Start on or before',FNLT:'Finish on or before',MSO:'Start on (equality window)',MFO:'Finish on (equality window)'};
export function uid(prefix='id') { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; }
function ensure(v,message) {if(!v)throw new Error(message);}
function modelDate(value,label='Date'){ensure(Number.isInteger(value),`${label} must be integral civil minutes; convert ISO input with parseDate().`);return parseDate(value);}
function unique(items,label) {
  ensure(Array.isArray(items),`${label} must be an array.`);
  const seen=new Set();for(const x of items){ensure(x&&typeof x.id==='string'&&x.id.length>0,`${label}: missing ID.`);ensure(!seen.has(x.id),`${label}: duplicate ID ${x.id}.`);seen.add(x.id);}return seen;
}
export function buildGraph(project) {
  const byId=new Map(project.activities.map(a=>[a.id,a]));
  const incoming=new Map(),outgoing=new Map(),degree=new Map();
  for(const id of byId.keys()){incoming.set(id,[]);outgoing.set(id,[]);degree.set(id,0);}
  const keys=new Set();
  for(const r of project.relationships) {
    ensure(byId.has(r.from)&&byId.has(r.to),`Relationship ${r.id} refers to an unknown activity.`);
    ensure(r.from!==r.to,`Activity ${r.from} cannot depend on itself.`);
    const key=`${r.from}|${r.to}|${r.type}`;ensure(!keys.has(key),'Duplicate dependency.');keys.add(key);
    incoming.get(r.to).push(r);outgoing.get(r.from).push(r);degree.set(r.to,degree.get(r.to)+1);
  }
  const queue=[...byId.keys()].filter(id=>degree.get(id)===0),order=[];
  for(let head=0;head<queue.length;head++) {
    const id=queue[head];order.push(id);
    for(const r of outgoing.get(id)){degree.set(r.to,degree.get(r.to)-1);if(degree.get(r.to)===0)queue.push(r.to);}
  }
  if(order.length!==byId.size) {
    const blocked=new Set([...byId.keys()].filter(id=>degree.get(id)>0));
    let id=blocked.values().next().value;const path=[],at=new Map();
    while(!at.has(id)){at.set(id,path.length);path.push(id);id=incoming.get(id).find(r=>blocked.has(r.from)).from;}
    const cycle=path.slice(at.get(id)).concat(id).reverse();
    throw new Error(`Dependency cycle: ${cycle.map(x=>byId.get(x).code||x).join(' → ')}`);
  }
  return {byId,incoming,outgoing,order};
}
export function validateProject(p) {
  ensure(p&&typeof p==='object','Invalid project.');
  ensure(typeof p.name==='string'&&p.name.trim(),'Project name is required.');
  ensure(Number.isInteger(p.dayMinutes)&&p.dayMinutes>0&&p.dayMinutes<=1440,'Display hours/day must be in (0,24].');
  modelDate(p.start,'Project start');modelDate(p.dataDate,'Data date');
  ensure(typeof p.currency==='string'&&/^[A-Z]{3}$/.test(p.currency),'Currency must be a three-letter uppercase code.');
  ensure(p.dataDate>=p.start,'Data date cannot be before the project start.');
  ensure(p.dataDate-p.start<=MAX_RANGE,'Data date must be within 30 years of project start.');
  if(p.finishBy!=null)modelDate(p.finishBy);
  ensure(['predecessor','successor','project','elapsed'].includes(p.lagCalendar),'Invalid relationship lag calendar policy.');
  const calendars=unique(p.calendars,'Calendars');p.calendars.forEach(c=>new WorkCalendar(c));
  ensure(calendars.has(p.calendarId),'Project calendar does not exist.');
  const wbs=unique(p.wbs,'WBS'),resources=unique(p.resources,'Resources');
  ensure(Array.isArray(p.activities),'Activities must be an array.');
  ensure(p.activities.length<=100000,'Project limit: 100,000 activities.');
  unique(p.activities,'Activities');unique(p.relationships,'Relationships');unique(p.assignments,'Assignments');
  const wbsById=new Map(p.wbs.map(w=>[w.id,w]));
  for(const w of p.wbs) {
    ensure(!w.parentId||wbs.has(w.parentId),'WBS parent does not exist.');
    const visited=new Set([w.id]);let parent=w.parentId;
    while(parent){ensure(!visited.has(parent),'WBS contains a cycle.');visited.add(parent);parent=wbsById.get(parent)?.parentId;}
  }
  const codes=new Set();const activityIds=new Set(p.activities.map(a=>a.id));
  for(const a of p.activities) {
    ensure(typeof a.code==='string'&&a.code.trim()&&!codes.has(a.code),`Activity code must be unique: ${a.code}`);codes.add(a.code);
    ensure(typeof a.name==='string'&&a.name.trim(),'Activity name is required.');
    ensure(calendars.has(a.calendarId),`${a.code}: calendar does not exist.`);
    ensure(wbs.has(a.wbsId),`${a.code}: WBS does not exist.`);
    ensure(Number.isInteger(a.duration)&&a.duration>=0&&a.duration<=MAX_RANGE,`${a.code}: duration must be nonnegative integral work minutes.`);
    ensure(Number.isInteger(a.remaining)&&a.remaining>=0&&a.remaining<=MAX_RANGE,`${a.code}: invalid remaining duration.`);
    ensure(Number.isFinite(a.percent)&&a.percent>=0&&a.percent<=100,`${a.code}: progress must be between 0 and 100%.`);
    ensure(['task','milestone'].includes(a.type),`${a.code}: invalid activity type.`);
    if(a.type==='milestone')ensure(a.duration===0&&a.remaining===0,`${a.code}: milestones have zero duration.`);
    ensure(Object.hasOwn(CONSTRAINTS,a.constraint||'none'),`${a.code}: invalid constraint.`);
    if(a.constraint&&a.constraint!=='none')modelDate(a.constraintDate);
    if(a.actualStart!=null){modelDate(a.actualStart);ensure(a.actualStart<=p.dataDate,`${a.code}: actual start cannot be after the data date.`);}
    if(a.actualFinish!=null){modelDate(a.actualFinish);ensure(a.actualStart!=null&&a.actualFinish>=a.actualStart&&a.actualFinish<=p.dataDate,`${a.code}: actual finish must follow actual start and be no later than the data date.`);ensure(a.remaining===0&&a.percent===100,`${a.code}: a completed activity must have 100% progress and zero remaining duration.`);}
    ensure(!(a.percent>0&&a.actualStart==null),`${a.code}: progress requires an actual start.`);
    ensure(!(a.percent===100&&a.actualFinish==null),`${a.code}: 100% progress requires an actual finish.`);
    ensure(a.actualFinish!=null || a.type==='milestone' || a.remaining>0,`${a.code}: an unfinished task needs a positive remaining duration.`);
  }
  for(const r of p.relationships){ensure(REL_TYPES.includes(r.type),`Invalid relationship type: ${r.type}`);ensure(Number.isInteger(r.lag)&&Math.abs(r.lag)<=MAX_RANGE,'Lag must be integral working minutes within 30 years.');}
  for(const r of p.resources){ensure(calendars.has(r.calendarId),`Resource ${r.name}: calendar missing.`);ensure(Number.isFinite(r.capacity)&&r.capacity>0,'Resource capacity must be positive.');ensure(Number.isFinite(r.rate)&&r.rate>=0,'Resource hourly rate cannot be negative.');}
  const pairs=new Set();
  for(const a of p.assignments){ensure(activityIds.has(a.activityId)&&resources.has(a.resourceId),'Assignment references an unknown activity or resource.');ensure(Number.isFinite(a.units)&&a.units>0&&a.units<=1000,'Assignment units must be in (0,1000].');ensure(Number.isFinite(a.actualHours??0)&&(a.actualHours??0)>=0,'Actual hours cannot be negative.');const k=`${a.activityId}|${a.resourceId}`;ensure(!pairs.has(k),'A resource may only be assigned once to an activity.');pairs.add(k);}
  return buildGraph(p);
}
export function validateWorkbook(w) {
  ensure(w?.schemaVersion===SCHEMA_VERSION,'Unsupported workbook schema version.');
  unique(w.projects,'Projects');ensure(w.projects.length>0,'Workbook must contain a project.');
  for(const p of w.projects){
    validateProject(p);
    unique(p.baselines,'Baselines');unique(p.scenarios,'Scenarios');
    for(const b of p.baselines){
      ensure(typeof b.name==='string'&&b.name.trim(),'Baseline name is required.');
      modelDate(b.dataDate);modelDate(b.finish);unique(b.activities,'Baseline activities');
      for(const a of b.activities){modelDate(a.start);modelDate(a.finish);ensure(a.finish>=a.start,'Baseline finish precedes its start.');ensure(Number.isInteger(a.duration)&&a.duration>=0,'Invalid baseline duration.');}
    }
    ensure(p.activeBaselineId==null||p.baselines.some(b=>b.id===p.activeBaselineId),'Active baseline does not exist.');
    for(const s of p.scenarios){
      ensure(typeof s.name==='string'&&s.name.trim(),'Scenario name is required.');
      validateProject(s.project);
      ensure(Array.isArray(s.project.scenarios)&&s.project.scenarios.length===0,'Scenario snapshots must not recursively contain scenarios.');
      validateWorkbook({schemaVersion:SCHEMA_VERSION,projects:[s.project]});
    }
  }
  return w;
}
export class History {
  constructor(value,limit=60){this.value=structuredClone(value);this.undoStack=[];this.redoStack=[];this.limit=limit;}
  commit(label,mutate,validate=()=>{}) {
    const next=structuredClone(this.value);mutate(next);validate(next);
    this.undoStack.push({label,value:this.value});if(this.undoStack.length>this.limit)this.undoStack.shift();
    this.value=next;this.redoStack.length=0;return next;
  }
  undo(){const entry=this.undoStack.pop();if(!entry)return null;this.redoStack.push({label:entry.label,value:this.value});this.value=entry.value;return entry.label;}
  redo(){const entry=this.redoStack.pop();if(!entry)return null;this.undoStack.push({label:entry.label,value:this.value});this.value=entry.value;return entry.label;}
}

import {parseDate,DAY} from './calendar.js';
import {Scheduler,createBaseline} from './scheduler.js';
export function defaultCalendars() {
  const shift=[[480,720],[780,1020]],five=[[],shift,shift,shift,shift,shift,[]],six=[[],shift,shift,shift,shift,shift,shift];
  return [
    {id:'cal-office',name:'Standard · 5-day / 8-hour',week:structuredClone(five),exceptions:{'2026-08-31':[],'2026-12-25':[]}},
    {id:'cal-site',name:'Construction · 6-day / 8-hour',week:structuredClone(six),exceptions:{'2026-12-25':[]}},
    {id:'cal-continuous',name:'Continuous · 24/7',week:Array.from({length:7},()=>[[0,1440]]),exceptions:{}}
  ];
}
export function emptyProject(name='Untitled project',id='project-'+Date.now()) {
  return {id,code:'NEW-001',name,description:'',portfolio:'Capital delivery',manager:'Project team',currency:'EUR',timezone:'Europe/Warsaw',
    start:parseDate('2026-09-07T08:00'),dataDate:parseDate('2026-09-07T08:00'),finishBy:null,calendarId:'cal-office',dayMinutes:480,lagCalendar:'predecessor',
    calendars:defaultCalendars(),wbs:[{id:'wbs-1',code:'1',name:'Project delivery',parentId:null}],activities:[],relationships:[],resources:[],assignments:[],baselines:[],activeBaselineId:null,scenarios:[]};
}
export function createDemoProject() {
  const p=emptyProject('Northline Transit Hub','northline');
  Object.assign(p,{code:'NL-2026',portfolio:'Infrastructure & mobility',manager:'Alex Morgan',description:'Integrated station upgrade, public realm and multimodal interchange.',start:parseDate('2026-07-06T08:00'),dataDate:parseDate('2026-08-03T08:00')});
  p.wbs=[['01','Initiation & design'],['02','Procurement'],['03','Enabling & substructure'],['04','Superstructure & envelope'],['05','MEP & fit-out'],['06','Testing & handover']].map(([code,name])=>({id:'wbs-'+code,code,name,parentId:null}));
  const specs=[
    ['A1000','Notice to proceed',0,'01'],['A1010','Topographical & site surveys',5,'01'],['A1020','Concept design & stakeholder review',8,'01'],['A1030','Detailed design coordination',15,'01'],['A1040','Authority approvals',10,'01'],['A1050','Design freeze',0,'01'],
    ['A2010','Long-lead equipment procurement',18,'02'],['A2020','Off-site steel fabrication',15,'02'],['A2030','Delivery & incoming inspection',3,'02'],['A2040','MEP equipment procurement',25,'02'],
    ['A3010','Site establishment & logistics',5,'03'],['A3020','Excavation & ground improvement',12,'03'],['A3030','Foundations & substructure',10,'03'],['A3040','Concrete curing & strength testing',15,'03','cal-continuous'],['A3050','Substructure complete',0,'03'],
    ['A4010','Structural steel erection',15,'04','cal-site'],['A4020','Upper floor slabs',10,'04','cal-site'],['A4030','Roof structure & waterproofing',8,'04','cal-site'],['A4040','Facade & glazing installation',12,'04'],['A4050','Building weather-tight',0,'04'],
    ['A5010','Mechanical first fix',12,'05'],['A5020','Electrical containment & cabling',14,'05'],['A5030','Plumbing & drainage first fix',10,'05'],['A5040','Internal partitions & finishes',15,'05'],['A5050','Station systems & equipment',10,'05'],['A5060','External works & public realm',18,'05'],
    ['A6010','Integrated systems testing',8,'06'],['A6020','Safety validation & certification',5,'06'],['A6030','Operator training & trial operations',6,'06'],['A6040','Defects closeout & documentation',5,'06'],['A6050','Practical completion',0,'06']
  ];
  p.activities=specs.map(([code,name,days,wbs,calendar='cal-office'])=>({id:code,code,name,wbsId:'wbs-'+wbs,calendarId:calendar,type:days?'task':'milestone',duration:days*480,remaining:days*480,percent:0,actualStart:null,actualFinish:null,constraint:'none',constraintDate:null,notes:''}));
  const rels=[['A1000','A1010'],['A1000','A1020'],['A1020','A1030'],['A1010','A1030'],['A1030','A1040'],['A1040','A1050'],['A1030','A2010','SS',5],['A2010','A2020'],['A2020','A2030'],['A1050','A2040'],['A1010','A3010'],['A3010','A3020'],['A3020','A3030','FS',1],['A3030','A3040'],['A3040','A3050'],['A3050','A4010'],['A2030','A4010'],['A4010','A4020','SS',5],['A4020','A4030'],['A4010','A4040'],['A4030','A4050'],['A4040','A4050'],['A4020','A5010'],['A5010','A5020','SS',2],['A5010','A5030','SS',1],['A4050','A5040'],['A5030','A5040'],['A2040','A5050'],['A5020','A5050'],['A5040','A5050','FF',0],['A4040','A5060','SS',4],['A5010','A6010'],['A5050','A6010'],['A6010','A6020'],['A6020','A6030'],['A6010','A6040'],['A6030','A6050'],['A6040','A6050'],['A5060','A6050']];
  p.relationships=rels.map(([from,to,type='FS',days=0],i)=>({id:'rel-'+i,from,to,type,lag:days*480}));
  p.resources=[
    {id:'r-design',name:'Design team',role:'Engineering',capacity:2,rate:85,calendarId:'cal-office'},
    {id:'r-civil',name:'Civil works crew',role:'Construction',capacity:1,rate:62,calendarId:'cal-office'},
    {id:'r-steel',name:'Steelwork crew',role:'Specialist contractor',capacity:1,rate:78,calendarId:'cal-site'},
    {id:'r-mep',name:'MEP installation team',role:'Building services',capacity:2,rate:72,calendarId:'cal-office'},
    {id:'r-qa',name:'Commissioning engineers',role:'Quality assurance',capacity:1,rate:90,calendarId:'cal-office'},
    {id:'r-pm',name:'Project controls',role:'Management',capacity:1,rate:95,calendarId:'cal-office'}
  ];
  const assignments=[['A1010','r-design',1],['A1020','r-design',1],['A1030','r-design',2],['A1040','r-design',.5],['A2010','r-pm',.5],['A2020','r-steel',1],['A2030','r-qa',1],['A2040','r-pm',.5],['A3010','r-civil',1],['A3020','r-civil',1],['A3030','r-civil',1],['A4010','r-steel',1],['A4020','r-civil',1],['A4030','r-civil',1],['A4040','r-civil',1],['A5010','r-mep',1],['A5020','r-mep',1],['A5030','r-mep',1],['A5040','r-civil',1],['A5050','r-mep',1],['A5060','r-civil',1],['A6010','r-qa',1],['A6020','r-qa',1],['A6030','r-qa',1],['A6040','r-qa',1]];
  p.assignments=assignments.map(([activityId,resourceId,units],i)=>({id:'assignment-'+i,activityId,resourceId,units,actualHours:0}));
  const initial=structuredClone(p);initial.dataDate=initial.start;
  const baseline=createBaseline(initial,new Scheduler().schedule(initial),'BL-01 · Approved control budget');baseline.created='2026-07-03T10:00:00.000Z';
  p.baselines=[baseline];p.activeBaselineId=baseline.id;
  const actuals={A1000:['2026-07-06T08:00','2026-07-06T08:00'],A1010:['2026-07-06T08:00','2026-07-10T17:00'],A1020:['2026-07-06T08:00','2026-07-15T17:00'],A3010:['2026-07-13T08:00','2026-07-17T17:00']};
  for(const a of p.activities){if(actuals[a.id]){a.actualStart=parseDate(actuals[a.id][0]);a.actualFinish=parseDate(actuals[a.id][1]);a.percent=100;a.remaining=0;}}
  Object.assign(p.activities.find(x=>x.id==='A1030'),{actualStart:parseDate('2026-07-16T08:00'),remaining:5*480,percent:67,notes:'Design coordination underway. Remaining work is retained behind unresolved predecessor logic.'});
  Object.assign(p.activities.find(x=>x.id==='A3020'),{actualStart:parseDate('2026-07-20T08:00'),remaining:5*480,percent:58});
  Object.assign(p.activities.find(x=>x.id==='A2010'),{actualStart:parseDate('2026-07-23T08:00'),remaining:12*480,percent:33});
  for(const as of p.assignments){const a=p.activities.find(x=>x.id===as.activityId);as.actualHours=Math.round(a.duration/60*as.units*a.percent/100);}
  return p;
}
export function createWorkbook() {
  const main=createDemoProject();
  const solar=emptyProject('Riverside Solar Farm','riverside');Object.assign(solar,{code:'RS-2026',portfolio:'Energy transition',description:'Utility-scale solar installation and grid connection.'});
  const mobility=emptyProject('Eastbank Mobility Center','eastbank');Object.assign(mobility,{code:'EM-2026',portfolio:'Infrastructure & mobility',description:'Low-carbon mobility and fleet servicing facility.'});
  for(const [p,names] of [[solar,['Feasibility & grid study','Permitting','Equipment procurement','Site construction','Grid commissioning']],[mobility,['Business case approval','Concept design','Planning submission','Detailed engineering']]]) {
    p.activities=names.map((name,i)=>({id:`${p.id}-a${i}`,code:`${p.code.split('-')[0]}${1000+i*10}`,name,wbsId:'wbs-1',calendarId:'cal-office',type:'task',duration:(10+i*3)*480,remaining:(10+i*3)*480,percent:0,actualStart:null,actualFinish:null,constraint:'none',constraintDate:null,notes:''}));
    p.relationships=p.activities.slice(1).map((a,i)=>({id:`${p.id}-l${i}`,from:p.activities[i].id,to:a.id,type:'FS',lag:0}));
  }
  return {schemaVersion:1,selectedProjectId:main.id,projects:[main,solar,mobility]};
}

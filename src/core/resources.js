import {DAY,dayOf,makeCalendars,isoDate} from './calendar.js';
/** Time-phased remaining demand on activity calendars. Capacity follows resource
 * calendars. Demand is intentionally NOT dropped on resource nonworking days.
 * Assignments are uniform units (1.0 = one full-time resource); no implicit leveling.
 */
export function analyzeResources(project,schedule) {
  const calendars=makeCalendars(project.calendars),results=new Map(schedule.activities.map(x=>[x.id,x]));
  const activities=new Map(project.activities.map(x=>[x.id,x]));
  const from=dayOf(project.dataDate),to=dayOf(Math.max(project.dataDate,schedule.forecastFinish));
  const assignmentsByResource=new Map(project.resources.map(r=>[r.id,[]]));
  for(const a of project.assignments)assignmentsByResource.get(a.resourceId).push(a);
  const days=[];for(let day=from;day<=to;day+=DAY)days.push(day);
  const resources=[];
  for(const resource of project.resources) {
    const capacityCalendar=calendars.get(resource.calendarId),daily=new Float64Array(days.length);
    let budgetHours=0,remainingHours=0,actualHours=0;
    const assigned=assignmentsByResource.get(resource.id);
    for(const assignment of assigned) {
      const a=activities.get(assignment.activityId),r=results.get(a.id),calendar=calendars.get(a.calendarId);
      budgetHours+=a.duration/60*assignment.units;actualHours+=assignment.actualHours||0;
      if(r.complete)continue;
      const begin=Math.max(from,r.remainingStart),end=r.ef;
      remainingHours+=calendar.between(begin,end)/60*assignment.units;
      const first=Math.max(0,Math.floor((dayOf(begin)-from)/DAY)),last=Math.min(days.length-1,Math.floor((dayOf(end)-from)/DAY));
      for(let i=first;i<=last;i++)daily[i]+=calendar.between(Math.max(begin,days[i]),Math.min(end,days[i]+DAY))/60*assignment.units;
    }
    let availableHours=0,overloadedDays=0,peak=0;
    const buckets=days.map((day,i)=> {
      const capacity=capacityCalendar.between(day,day+DAY)/60*resource.capacity,demand=daily[i];availableHours+=capacity;
      const overload=Math.max(0,demand-capacity);if(overload>1e-7)overloadedDays++;
      const utilization=capacity?demand/capacity:(demand?Infinity:0);peak=Math.max(peak,utilization);
      return {date:isoDate(day,false),day,demand,capacity,overload,utilization};
    });
    resources.push({id:resource.id,name:resource.name,role:resource.role,capacity:resource.capacity,rate:resource.rate,budgetHours,remainingHours,actualHours,
      budgetCost:budgetHours*resource.rate,remainingCost:remainingHours*resource.rate,actualCost:actualHours*resource.rate,
      availableHours,utilization:availableHours?remainingHours/availableHours:0,peak,overloadedDays,assignmentCount:assigned.length,buckets});
  }
  return {from,to,resources,totals:resources.reduce((t,r)=>({budgetHours:t.budgetHours+r.budgetHours,remainingHours:t.remainingHours+r.remainingHours,actualHours:t.actualHours+r.actualHours,budgetCost:t.budgetCost+r.budgetCost,remainingCost:t.remainingCost+r.remainingCost,actualCost:t.actualCost+r.actualCost,overloadedDays:t.overloadedDays+r.overloadedDays}),{budgetHours:0,remainingHours:0,actualHours:0,budgetCost:0,remainingCost:0,actualCost:0,overloadedDays:0})};
}

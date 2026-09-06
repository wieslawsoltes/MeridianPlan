/** Civil-minute scheduling. Integers encode project-local wall time, NOT UTC instants.
 * Date.UTC is only an arithmetic carrier; DST never changes contractual work minutes.
 * Working intervals are half-open [start,end); a finish may lie at an interval end.
 */
export const DAY = 1440;
export const HOUR = 60;
export const MAX_RANGE = 366 * 30 * DAY;
export function parseDate(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Date must be an integral civil minute.');
    if(value<Date.UTC(1900,0,1)/60000 || value>=Date.UTC(2201,0,1)/60000)throw new Error('Input dates must be between 1900 and 2200.');
    return value;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value || '');
  if (!m) throw new Error(`Invalid project-local date: ${value}. Use YYYY-MM-DDTHH:mm without a timezone.`);
  const [y, mo, d, h, mi] = m.slice(1).map(v => +(v || 0));
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || h > 23 || mi > 59) throw new Error(`Date out of range: ${value}`);
  const n = Date.UTC(y, mo - 1, d, h, mi) / 60000;
  const dt = new Date(n * 60000);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new Error(`Invalid civil date: ${value}`);
  return n;
}
export function isoDate(t, time = true) {
  if (!Number.isFinite(t)) return '';
  const d = new Date(Math.round(t) * 60000);
  return d.toISOString().slice(0, time ? 16 : 10);
}
export function displayDate(t, withTime = false) {
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t * 60000);
  return new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC', ...(withTime ? {hour: '2-digit', minute: '2-digit', hour12: false} : {})}).format(d);
}
export function dayOf(t) { return Math.floor(t / DAY) * DAY; }
export function weekday(t) { return new Date(dayOf(t) * 60000).getUTCDay(); }
export function validateIntervals(intervals, label = 'Calendar') {
  if (!Array.isArray(intervals)) throw new Error(`${label}: shifts must be an array.`);
  let previousEnd = -1;
  for (const pair of intervals) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`${label}: invalid shift.`);
    const [a, b] = pair;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > DAY || a >= b || a < previousEnd) throw new Error(`${label}: shifts must be sorted, non-overlapping minutes within a day.`);
    previousEnd = b;
  }
}
export class WorkCalendar {
  constructor(definition) {
    this.id = definition.id;
    this.name = definition.name;
    this.week = definition.week;
    this.exceptions = definition.exceptions || {};
    if (!Array.isArray(this.week) || this.week.length !== 7) throw new Error(`${this.name}: exactly seven weekdays are required (Sunday first).`);
    this.week.forEach(x => validateIntervals(x, this.name));
    if (!this.week.some(x => x.length)) throw new Error(`${this.name}: at least one weekly work shift is required.`);
    Object.entries(this.exceptions).forEach(([key, shifts]) => { parseDate(key); validateIntervals(shifts, this.name); });
    this.cache = new Map();
  }
  intervals(t) {
    const d = dayOf(t);
    if (!this.cache.has(d)) {
      const key = isoDate(d, false);
      const local = Object.hasOwn(this.exceptions, key) ? this.exceptions[key] : this.week[weekday(d)];
      this.cache.set(d, local.map(([a,b]) => [d+a,d+b]));
    }
    return this.cache.get(d);
  }
  /** First permissible working start >= t. */
  startUp(t) {
    let d = dayOf(t);
    for (let n = 0; n < 10980; n++, d += DAY) {
      for (const [a,b] of this.intervals(d)) if (t < b) return Math.max(a,t);
      t = d + DAY;
    }
    throw new Error(`${this.name}: no available work within 30 years.`);
  }
  /** Last permissible working start <= t on the one-minute lattice. */
  startDown(t) {
    let d = dayOf(t);
    for (let n = 0; n < 10980; n++, d -= DAY) {
      const intervals = this.intervals(d);
      for (let i=intervals.length-1;i>=0;i--) { const [a,b]=intervals[i]; if(t>=a) return Math.min(t,b-1); }
      t = d - 1;
    }
    throw new Error(`${this.name}: no previous work within 30 years.`);
  }
  /** Milestones may use a shift boundary, including the end of a workday. */
  pointUp(t) {
    for (const [a,b] of this.intervals(t)) if(t>=a && t<=b) return t;
    return this.startUp(t);
  }
  pointDown(t) {
    let d=dayOf(t);
    for(let n=0;n<10980;n++,d-=DAY) {
      const list=this.intervals(d);
      for(let i=list.length-1;i>=0;i--) {const [a,b]=list[i]; if(t>=a) return Math.min(t,b);}
      t=d;
    }
    throw new Error(`${this.name}: no previous work within 30 years.`);
  }
  add(t, minutes) {
    if (!Number.isInteger(minutes)) throw new Error('Work durations and lags must be integral minutes.');
    if (!minutes) return t; // zero-lag relationships preserve exact event instants
    if (Math.abs(minutes) > MAX_RANGE) throw new Error('Work offset exceeds the 30-year bound.');
    let left=Math.abs(minutes), d=dayOf(t), visits=0;
    if (minutes>0) {
      for(;visits<10980;visits++,d+=DAY) {
        for(const [a,b] of this.intervals(d)) {
          const at=Math.max(t,a); if(at>=b) continue;
          if(left<=b-at) return at+left;
          left-=b-at;
        }
        t=d+DAY;
      }
    } else {
      for(;visits<10980;visits++,d-=DAY) {
        const list=this.intervals(d);
        for(let i=list.length-1;i>=0;i--) {
          const [a,b]=list[i], at=Math.min(t,b); if(at<=a) continue;
          if(left<=at-a) return at-left;
          left-=at-a;
        }
        t=d;
      }
    }
    throw new Error(`${this.name}: work offset exceeds the 30-year scheduling horizon.`);
  }
  between(a,b) {
    if(a===b) return 0;
    if(a>b) return -this.between(b,a);
    if(b-a>MAX_RANGE) throw new Error('Calendar span exceeds 30 years.');
    let result=0;
    for(let d=dayOf(a);d<=dayOf(b);d+=DAY) {
      for(const [s,e] of this.intervals(d)) result+=Math.max(0,Math.min(e,b)-Math.max(s,a));
    }
    return result;
  }
  earliestStartForFinish(finish,duration) {
    if(!duration) return this.pointUp(finish);
    let s=this.startUp(this.add(finish,-duration));
    // Calendar gaps create a plateau. +1 is exact for our documented minute lattice.
    if(this.add(s,duration)<finish) s=this.startUp(s+1);
    return s;
  }
  latestStartForFinish(finish,duration) {
    if(!duration) return this.pointDown(finish);
    return this.startDown(this.add(finish,-duration));
  }
}
export function makeCalendars(definitions) { return new Map(definitions.map(d=>[d.id,new WorkCalendar(d)])); }
export function addLag(t,lag,calendar) { return calendar ? calendar.add(t,lag) : t+lag; }
/** Exact monotone inversion, including negative-lag plateaus over nonworking days. */
export function inverseLagUpper(target,lag,calendar) {
  if(!lag || !calendar) return target-lag;
  const f=t=>calendar.add(t,lag);
  let guess=calendar.add(target,-lag), lo,hi,step=1;
  if(f(guess)<=target) {
    lo=guess; hi=guess+step;
    while(f(hi)<=target) {lo=hi;step*=2;hi=guess+step;if(step>MAX_RANGE)throw new Error('Cannot invert relationship lag within 30 years.');}
  } else {
    hi=guess;lo=guess-step;
    while(f(lo)>target) {hi=lo;step*=2;lo=guess-step;if(step>MAX_RANGE)throw new Error('Cannot invert relationship lag within 30 years.');}
  }
  while(hi-lo>1) {const mid=Math.floor((lo+hi)/2);if(f(mid)<=target)lo=mid;else hi=mid;}
  return lo;
}

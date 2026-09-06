import {Scheduler} from './core/scheduler.js';
import {analyzeResources} from './core/resources.js';
const engines=new Map();
self.onmessage=({data})=> {
  const {requestId,project,options}=data;
  try {
    if(!engines.has(project.id))engines.set(project.id,new Scheduler());
    const schedule=engines.get(project.id).schedule(project,options);
    const resources=analyzeResources(project,schedule);
    self.postMessage({requestId,schedule,resources});
  } catch(error) {self.postMessage({requestId,error:error.message,stack:error.stack});}
};

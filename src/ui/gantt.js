import {DAY,dayOf,weekday,displayDate} from '../core/calendar.js';

const PALETTE={critical:[.89,.34,.28,1],normal:[.30,.53,.68,1],progress:[.18,.49,.54,1],complete:[.43,.59,.53,1],baseline:[.76,.78,.81,1],summary:[.35,.41,.48,1],grid:[.91,.93,.95,1],weekend:[.975,.98,.986,1],selected:[.97,.98,.992,1],data:[.90,.40,.22,1]};

const WGSL=`
struct View { size: vec2f, pad: vec2f }
@group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) size: vec2f, @location(2) color: vec4f, @location(3) shape: vec2f }
@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) rect: vec4f, @location(1) color: vec4f, @location(2) params: vec4f) -> Out {
  let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let uv=corners[vertex]; let pos=rect.xy+uv*rect.zw;
  var out:Out; out.position=vec4f(pos.x/view.size.x*2.-1.,1.-pos.y/view.size.y*2.,0.,1.);
  out.local=(uv-vec2f(.5))*rect.zw;out.size=rect.zw;out.color=color;out.shape=params.xy;return out;
}
@fragment fn fs(in:Out)->@location(0) vec4f {
  var distance:f32;
  if(in.shape.y>0.5) { distance=(abs(in.local.x)+abs(in.local.y)-in.size.x*.5)*.7071; }
  else { let r=min(in.shape.x,min(in.size.x,in.size.y)*.5);let q=abs(in.local)-in.size*.5+vec2f(r);distance=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.)-r; }
  let coverage=1.-smoothstep(-.65,.65,distance);return vec4f(in.color.rgb,in.color.a*coverage);
}`;

/** Instanced rectangles/diamonds; one vertex buffer upload and draw call per frame.
 * CPU overlay handles text/orthogonal links. Both layers are viewport-sized.
 */
export class RectRenderer {
  constructor(canvas,onBackend){this.canvas=canvas;this.onBackend=onBackend;this.device=null;this.fallback=null;this.capacity=0;this.disposed=false;}
  async init() {
    try {
      if(!navigator.gpu)throw new Error('WebGPU is unavailable.');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter.');
      this.device=await adapter.requestDevice();if(this.disposed){this.device.destroy();return;}
      const context=this.canvas.getContext('webgpu');if(!context)throw new Error('No WebGPU canvas context.');
      this.context=context;const format=navigator.gpu.getPreferredCanvasFormat();context.configure({device:this.device,format,alphaMode:'premultiplied'});
      this.device.pushErrorScope('validation');
      const module=this.device.createShaderModule({code:WGSL});
      this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:48,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},{shaderLocation:2,offset:32,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
      const error=await this.device.popErrorScope();if(error)throw new Error(error.message);
      this.uniform=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
      this.device.addEventListener('uncapturederror',e=>{console.error(e.error);this.useFallback(e.error.message);});
      this.device.lost.then(info=>{if(!this.disposed)this.useFallback(info.message||'GPU device lost');});
      this.onBackend('WebGPU');
    } catch(error){this.useFallback(error.message);}
  }
  useFallback(reason) {
    if(this.fallback||this.disposed)return;
    if(this.context){this.context.unconfigure();const replacement=this.canvas.cloneNode(false);this.canvas.replaceWith(replacement);this.canvas=replacement;this.context=null;}
    this.buffer?.destroy();this.uniform?.destroy();this.device?.destroy();this.device=null;
    this.fallback=this.canvas.getContext('2d');this.onBackend('Canvas 2D',reason);
  }
  draw(data,width,height,dpr) {
    if(!this.device&&!this.fallback)return;
    const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));
    if(this.canvas.width!==pixelWidth)this.canvas.width=pixelWidth;if(this.canvas.height!==pixelHeight)this.canvas.height=pixelHeight;
    if(this.fallback) {
      const ctx=this.fallback;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
      for(let i=0;i<data.length;i+=12) {
        const [x,y,w,h,r,g,b,a,radius,shape]=data.slice(i,i+10);
        ctx.fillStyle=`rgba(${r*255},${g*255},${b*255},${a})`;ctx.beginPath();
        if(shape){ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h/2);ctx.lineTo(x+w/2,y+h);ctx.lineTo(x,y+h/2);ctx.closePath();}
        else ctx.roundRect(x,y,w,h,Math.min(radius,w/2,h/2));ctx.fill();
      }return;
    }
    if(!this.pipeline)return;
    if(data.byteLength>this.capacity){this.buffer?.destroy();this.capacity=Math.max(4096,2**Math.ceil(Math.log2(data.byteLength)));this.buffer=this.device.createBuffer({size:this.capacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
    this.device.queue.writeBuffer(this.uniform,0,new Float32Array([width,height,0,0]));
    if(data.length)this.device.queue.writeBuffer(this.buffer,0,data);
    const encoder=this.device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:1,g:1,b:1,a:1}}]});
    if(data.length){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.buffer);pass.draw(6,data.length/12);}pass.end();this.device.queue.submit([encoder.finish()]);
  }
  dispose(){this.disposed=true;this.buffer?.destroy();this.uniform?.destroy();this.context?.unconfigure();this.device?.destroy();}
}
export class Gantt {
  constructor(host,{onSelect,onEdit,onMove,onResize,onLink,onBackend,onScroll}) {
    this.host=host;this.callbacks={onSelect,onEdit,onMove,onResize,onLink,onBackend,onScroll};
    host.innerHTML='<canvas class="time-header"></canvas><div class="gantt-viewport"><canvas class="gpu-layer"></canvas><canvas class="annotation-layer"></canvas></div><div class="time-scroll"><div></div></div>';
    this.header=host.querySelector('.time-header');this.viewport=host.querySelector('.gantt-viewport');this.overlay=host.querySelector('.annotation-layer');this.scroll=host.querySelector('.time-scroll');
    this.rowHeight=35;this.scale=9.8;this.scrollTop=0;this.rows=[];this.selectedId=null;this.links=true;this.baselines=true;this.hits=[];
    this.renderer=new RectRenderer(host.querySelector('.gpu-layer'),(backend,reason)=>{onBackend(backend,reason);this.invalidate();});this.renderer.init();
    this.observer=new ResizeObserver(()=>this.invalidate());this.observer.observe(this.host);
    this.scroll.addEventListener('scroll',()=>this.invalidate());
    this.overlay.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){this.zoom(e.deltaY>0?.9:1.1,e.offsetX);}else if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){this.scroll.scrollLeft+=e.deltaX||e.deltaY;}else onScroll(e.deltaY);},{passive:false});
    this.overlay.addEventListener('pointerdown',e=>this.pointerDown(e));
    this.overlay.addEventListener('pointermove',e=>this.pointerMove(e));
    this.overlay.addEventListener('pointerup',e=>this.pointerUp(e));
    this.overlay.addEventListener('pointercancel',()=>{this.drag=null;this.invalidate();});
    this.overlay.addEventListener('dblclick',e=>{const hit=this.hitAt(e.offsetX,e.offsetY);if(hit)onEdit(hit.id);});
    this.overlay.addEventListener('pointerleave',()=>{if(!this.drag)this.hideTooltip();});
  }
  setData(project,schedule,rows,baseline) {
    const changed=this.project?.id!==project.id;this.project=project;this.schedule=schedule;this.rows=rows;this.baseline=baseline;
    this.map=new Map(schedule.activities.map(a=>[a.id,a]));this.activities=new Map(project.activities.map(a=>[a.id,a]));this.baselineMap=new Map((baseline?.activities||[]).map(a=>[a.id,a]));
    this.rowIndices=new Map(rows.map((r,i)=>[r.id,i]));this.edgesByActivity=new Map();
    for(const e of schedule.relationships){for(const id of [e.from,e.to]){if(!this.edgesByActivity.has(id))this.edgesByActivity.set(id,[]);this.edgesByActivity.get(id).push(e);}}
    this.origin=dayOf(project.start)-2*DAY;this.end=schedule.forecastFinish+14*DAY;
    if(changed)this.scroll.scrollLeft=0;
    this.invalidate();
  }
  setScroll(top){this.scrollTop=top;this.invalidate();}
  x(time){return (time-this.origin)/DAY*this.scale-this.scroll.scrollLeft;}
  time(x){return Math.round(this.origin+(x+this.scroll.scrollLeft)/this.scale*DAY);}
  fit(){if(this.project){this.scale=Math.max(.25,Math.min(70,this.host.clientWidth/((this.end-this.origin)/DAY)));this.scroll.scrollLeft=0;this.invalidate();}}
  zoom(factor,anchor=this.host.clientWidth/2){const at=this.time(anchor);this.scale=Math.max(.25,Math.min(150,this.scale*factor));this.scroll.firstElementChild.style.width=`${Math.max(this.host.clientWidth,(this.end-this.origin)/DAY*this.scale)}px`;this.scroll.scrollLeft=(at-this.origin)/DAY*this.scale-anchor;this.invalidate();}
  focus(id){const r=this.map?.get(id);if(r){this.scroll.scrollLeft=Math.max(0,(r.es-this.origin)/DAY*this.scale-this.host.clientWidth*.3);this.invalidate();}}
  invalidate(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});}
  draw() {
    if(!this.project||!this.host.clientWidth)return;
    const width=this.host.clientWidth,height=this.viewport.clientHeight,dpr=Math.min(2,devicePixelRatio||1);if(height<=0)return;
    this.scroll.firstElementChild.style.width=`${Math.max(width,(this.end-this.origin)/DAY*this.scale)}px`;
    const rectangles=[];const rect=(x,y,w,h,color,radius=0,shape=0)=>{if(w>0&&h>0&&x+w>=0&&x<=width&&y+h>=0&&y<=height)rectangles.push(x,y,w,h,...color,radius,shape,0,0);};
    if(this.overlay.width!==Math.round(width*dpr))this.overlay.width=Math.round(width*dpr);if(this.overlay.height!==Math.round(height*dpr))this.overlay.height=Math.round(height*dpr);const ctx=this.overlay.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    this.drawHeader(width,dpr);
    const startDay=dayOf(this.time(0)),endDay=dayOf(this.time(width));
    for(let day=startDay;day<=endDay;day+=DAY) {
      const x=this.x(day),week=weekday(day);
      if(week===0||week===6)rect(x,0,this.scale,height,PALETTE.weekend);
      if(this.scale>24||week===1)rect(Math.floor(x),0,1,height,PALETTE.grid);
    }
    const first=Math.max(0,Math.floor(this.scrollTop/this.rowHeight)),last=Math.min(this.rows.length,Math.ceil((this.scrollTop+height)/this.rowHeight)+1);
    const rowY=id=>this.rowIndices.has(id)?this.rowIndices.get(id)*this.rowHeight-this.scrollTop+this.rowHeight/2:null;this.hits=[];
    const bars=[];
    for(let i=first;i<last;i++) {
      const row=this.rows[i],y=i*this.rowHeight-this.scrollTop;
      if(row.kind==='wbs')rect(0,y,width,this.rowHeight,[.965,.974,.984,1]);
      else if(row.id===this.selectedId)rect(0,y,width,this.rowHeight,PALETTE.selected);
      rect(0,y+this.rowHeight-1,width,1,[.94,.95,.965,1]);
      const r=row.kind==='wbs'?row:this.map.get(row.id);if(!r||!Number.isFinite(r.es))continue;
      const start=this.x(r.es),finish=this.x(r.ef);
      if(row.kind==='wbs') {
        rect(start,y+13,Math.max(2,finish-start),4,PALETTE.summary);rect(start,y+13,3,9,PALETTE.summary);rect(finish-3,y+13,3,9,PALETTE.summary);continue;
      }
      const a=this.activities.get(row.id),baseline=this.baselineMap.get(row.id);
      if(this.baselines&&baseline){const bx=this.x(baseline.start),bw=this.x(baseline.finish)-bx;rect(bx,y+26,Math.max(3,bw),3,PALETTE.baseline,1);}
      const h=a.type==='milestone'?12:15,bx=a.type==='milestone'?start-6:start,bw=a.type==='milestone'?12:Math.max(3,finish-start),by=y+9;
      const color=r.complete?PALETTE.complete:r.critical?PALETTE.critical:a.actualStart!=null?PALETTE.progress:PALETTE.normal;
      rect(bx,by,bw,h,color,a.type==='milestone'?0:2,a.type==='milestone'?1:0);
      if(a.percent>0&&a.percent<100)rect(bx,by,bw*a.percent/100,h,[color[0]*.68,color[1]*.72,color[2]*.75,1],2);
      this.hits.push({id:row.id,x:bx,y:by,w:bw,h});bars.push({a,r,x:bx,w:bw,y});
    }
    this.renderer.draw(new Float32Array(rectangles),width,height,dpr);
    if(this.links) {
      ctx.lineWidth=1;ctx.strokeStyle='#aebbc8';
      // Work is O(incident edges), not O(all edges), when most rows are offscreen.
      const visible=new Set(this.rows.slice(first,last).filter(r=>r.kind==='activity').map(r=>r.id));
      const edges=new Map();for(const id of visible)for(const e of this.edgesByActivity.get(id)||[])edges.set(e.id,e);
      for(const edge of edges.values()) {
        const y1=rowY(edge.from),y2=rowY(edge.to);if(y1==null||y2==null)continue;
        const p=this.map.get(edge.from),s=this.map.get(edge.to),x1=this.x(edge.type[0]==='F'?p.ef:p.es),x2=this.x(edge.type[1]==='F'?s.ef:s.es);
        if((x1<0&&x2<0)||(x1>width&&x2>width))continue;
        ctx.strokeStyle=edge.driving?'#ba8c85':'#aebbc8';ctx.globalAlpha=.8;
        const sign=edge.type[0]==='F'?1:-1,tip=edge.type[1]==='S'?-1:1,exit=x1+sign*7,enter=x2+tip*7;
        ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(exit,y1);
        if(exit<enter&&sign===1){const mid=(exit+enter)/2;ctx.lineTo(mid,y1);ctx.lineTo(mid,y2);}
        else {const midY=y2>y1?y1+17:y1-17;ctx.lineTo(exit,midY);ctx.lineTo(enter,midY);ctx.lineTo(enter,y2);}
        ctx.lineTo(x2+tip*3,y2);ctx.stroke();ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2+tip*4,y2-3);ctx.lineTo(x2+tip*4,y2+3);ctx.closePath();ctx.fillStyle=ctx.strokeStyle;ctx.fill();
      }ctx.globalAlpha=1;
    }
    ctx.font='10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for(const bar of bars) {
      const {a,r,x,w,y}=bar;
      if(a.id===this.selectedId){ctx.strokeStyle='#1d4255';ctx.lineWidth=1.5;ctx.strokeRect(x-2,y+7,w+4,19);ctx.fillStyle='#fff';ctx.fillRect(x+w-2,y+12,3,8);}
      if(w>42&&a.type!=='milestone'){ctx.fillStyle='white';ctx.fillText(a.percent>0?`${a.percent}%`:a.code,Math.max(3,x+6),y+20);}
      if(x+w+6<width&&x+w>-100){ctx.fillStyle='#607083';const text=a.type==='milestone'?a.name:a.name;ctx.fillText(text,Math.max(2,x+w+6),y+20,Math.max(1,width-x-w-12));}
    }
    const dataX=this.x(this.project.dataDate);
    ctx.strokeStyle='#df794d';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(dataX,0);ctx.lineTo(dataX,height);ctx.stroke();ctx.setLineDash([]);
    if(this.drag&&this.drag.moved) {
      ctx.fillStyle='rgba(43,103,127,.18)';const hit=this.drag.hit,dx=this.drag.x-this.drag.startX;
      if(this.drag.mode==='link'){ctx.strokeStyle='#27677f';ctx.beginPath();ctx.moveTo(hit.x+hit.w,hit.y+8);ctx.lineTo(this.drag.x,this.drag.y);ctx.stroke();}
      else ctx.fillRect(this.drag.mode==='move'?hit.x+dx:hit.x,hit.y,this.drag.mode==='resize'?Math.max(3,hit.w+dx):hit.w,hit.h);
    }
  }
  drawHeader(width,dpr) {
    if(this.header.width!==Math.round(width*dpr))this.header.width=Math.round(width*dpr);if(this.header.height!==54*dpr)this.header.height=54*dpr;const ctx=this.header.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,width,54);ctx.strokeStyle='#e4e9ef';ctx.beginPath();ctx.moveTo(0,25);ctx.lineTo(width,25);ctx.moveTo(0,53);ctx.lineTo(width,53);ctx.stroke();
    const first=dayOf(this.time(0)),last=dayOf(this.time(width));let prevMonth='',lastTickLabelRight=-Infinity;
    ctx.textBaseline='middle';ctx.font='600 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for(let day=first;day<=last;day+=DAY) {
      const d=new Date(day*60000),month=d.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}),x=this.x(day);
      if(month!==prevMonth){ctx.fillStyle='#566577';ctx.fillText(month.toUpperCase(),Math.max(8,x+8),13);prevMonth=month;ctx.strokeStyle='#dce3eb';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,25);ctx.stroke();}
      if((this.scale>30)||(weekday(day)===1&&this.scale>=3)||(d.getUTCDate()===1&&this.scale<3)){ctx.fillStyle='#7f8c9d';const label=this.scale>30?`${d.getUTCDate()}`:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'});if(x+6>=lastTickLabelRight){ctx.fillText(label,x+6,39);lastTickLabelRight=x+6+ctx.measureText(label).width+8;}ctx.strokeStyle='#e4e9ef';ctx.beginPath();ctx.moveTo(x,25);ctx.lineTo(x,54);ctx.stroke();}
    }
    const dx=this.x(this.project.dataDate);if(dx>=0&&dx<width){ctx.fillStyle='#e4794b';ctx.beginPath();ctx.moveTo(dx-4,49);ctx.lineTo(dx+4,49);ctx.lineTo(dx,54);ctx.fill();}
  }
  hitAt(x,y){return this.hits.find(h=>x>=h.x-5&&x<=h.x+h.w+5&&y>=h.y-5&&y<=h.y+h.h+7);}
  pointerDown(e) {
    const hit=this.hitAt(e.offsetX,e.offsetY);if(!hit)return;
    this.callbacks.onSelect(hit.id);this.hideTooltip();
    const activity=this.activities.get(hit.id),result=this.map.get(hit.id);
    const mode=e.shiftKey?'link':Math.abs(e.offsetX-hit.x-hit.w)<7&&activity.type!=='milestone'?'resize':'move';
    if(result.complete&&mode!=='link')return;
    this.drag={hit,mode,startX:e.offsetX,x:e.offsetX,y:e.offsetY,moved:false};this.overlay.setPointerCapture(e.pointerId);
  }
  pointerMove(e) {
    if(this.drag){this.drag.x=e.offsetX;this.drag.y=e.offsetY;this.drag.moved ||= Math.abs(e.offsetX-this.drag.startX)>4;this.invalidate();return;}
    const hit=this.hitAt(e.offsetX,e.offsetY);this.overlay.style.cursor=hit?(e.shiftKey?'crosshair':Math.abs(e.offsetX-hit.x-hit.w)<7?'ew-resize':'grab'):'default';
    if(hit) {
      const a=this.activities.get(hit.id),r=this.map.get(hit.id);
      const tooltip=document.getElementById('tooltip');if(tooltip){tooltip.textContent=`${a.code} · ${a.name}\n${displayDate(r.es)} → ${displayDate(r.ef)}\nFloat ${(r.totalFloat/this.project.dayMinutes).toFixed(1)}d · ${a.percent}% complete\nDrag to set earliest start · edge to resize · Shift-drag to link`;tooltip.hidden=false;tooltip.style.left=Math.min(e.clientX+12,innerWidth-340)+'px';tooltip.style.top=Math.min(e.clientY+16,innerHeight-130)+'px';}
    }else this.hideTooltip();
  }
  hideTooltip(){const t=document.getElementById('tooltip');if(t)t.hidden=true;}
  pointerUp(e) {
    const d=this.drag;this.drag=null;this.invalidate();if(!d?.moved)return;
    if(d.mode==='link'){const target=this.hitAt(e.offsetX,e.offsetY);if(target&&target.id!==d.hit.id)this.callbacks.onLink(d.hit.id,target.id);}
    else if(d.mode==='resize'){const r=this.map.get(d.hit.id);this.callbacks.onResize(d.hit.id,Math.round(r.ef+(d.x-d.startX)/this.scale*DAY));}
    else {const r=this.map.get(d.hit.id);this.callbacks.onMove(d.hit.id,Math.round(r.remainingStart+(d.x-d.startX)/this.scale*DAY));}
  }
  dispose(){this.observer.disconnect();cancelAnimationFrame(this.frame);this.renderer.dispose();}
}

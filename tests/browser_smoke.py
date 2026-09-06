"""Offline Chromium UI smoke tests. Requires Python Playwright and Chromium.
Set MERIDIAN_URL=http://localhost:4173 to exercise a normal-origin deployment.
Without a URL, the portable app is injected into about:blank: storage and workers
are origin-restricted, so a clearly identified in-memory test repository is used.
This mode exercises the genuine Canvas 2D and synchronous scheduler fallbacks.
"""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
RESULTS=[]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or p.chromium.executable_path,headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader'])
  page=await browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  if os.getenv('MERIDIAN_URL'):await page.goto(os.environ['MERIDIAN_URL'],wait_until='networkidle')
  else:await page.set_content((ROOT/'dist/meridian-plan.html').read_text(),wait_until='load')
  await page.wait_for_function('window.meridian && meridian.schedule')
  await page.wait_for_function("['WebGPU','Canvas 2D'].includes(meridian.backend)")
  if not os.getenv('MERIDIAN_URL'):
   await page.evaluate("""()=>{meridian.repo={backend:'In-memory test store',save:async w=>{window.__saved=structuredClone(w)},load:async()=>structuredClone(window.__saved)};document.querySelector('#toasts').innerHTML='';meridian.renderExplorer();}""")
  async def settle():
   await page.evaluate('async()=>{await meridian.changeQueue;}')
   await page.wait_for_timeout(60)
  async def check(name,expr):
   assert await page.evaluate(expr),name
   RESULTS.append({'test':name,'passed':True});print('PASS',name)
  async def submit():
   await page.locator('#modal-form button[type=submit]').click();await settle()
  async def close():await page.locator('#modal-form [data-action=close-modal]').first.click()

  if os.getenv('MERIDIAN_URL'):
   await check('Native module worker runs in a secure context',"isSecureContext && !!meridian.service.worker")
  await check('Demo schedule and renderer boot',"meridian.schedule.summary.count===31 && meridian.schedule.summary.critical===12 && ['WebGPU','Canvas 2D'].includes(meridian.backend)")
  await page.fill('#global-search','steel');await check('Search filters real activity rows',"meridian.visibleCount===2")
  await page.fill('#global-search','')
  await page.select_option('#activity-filter','critical');await check('Critical filter uses computed float',"meridian.visibleCount===12")
  await page.select_option('#activity-filter','all')
  await page.select_option('#group-by','none');await check('Flat grouping and DOM virtualization',"meridian.rows.length===31 && document.querySelectorAll('.activity-row').length<31")
  await page.evaluate("document.querySelector('#activity-scroll').scrollTop=10000");await page.wait_for_timeout(80)
  await check('Vertical scrolling virtualizes end-of-project rows',"!!document.querySelector('.activity-row[data-id=\"A6050\"]')")
  await page.evaluate("document.querySelector('#activity-scroll').scrollTop=0");await page.select_option('#group-by','wbs');await settle()
  await page.locator('.activity-row[data-id="A1040"] [data-field="duration"]').dblclick()
  await page.locator('.activity-row[data-id="A1040"] [data-field="duration"] input').fill('11')
  await page.locator('.activity-row[data-id="A1040"] [data-field="duration"] input').press('Enter');await settle()
  await check('Double-click inline duration editing commits calculations',"meridian.project.activities.find(a=>a.id==='A1040').duration===5280")
  await page.keyboard.press('Control+z');await settle()
  await check('Keyboard undo restores duration',"meridian.project.activities.find(a=>a.id==='A1040').duration===4800")
  await page.keyboard.press('Control+Shift+z');await settle()
  await check('Keyboard redo restores edit',"meridian.project.activities.find(a=>a.id==='A1040').duration===5280")
  await page.click('[data-action=new-activity]')
  await page.fill('#modal-form [name=code]','T1000');await page.fill('#modal-form [name=name]','Browser-tested work package');await page.fill('#modal-form [name=duration]','2');await submit()
  await check('Activity dialog adds a real scheduled activity',"meridian.project.activities.length===32 && meridian.selected.code==='T1000'")
  aid=await page.evaluate('meridian.selectedId')
  await page.click('.view-toolbar [data-action=add-relationship]')
  await page.select_option('#modal-form [name=from]','A6050');await page.select_option('#modal-form [name=to]',aid);await page.fill('#modal-form [name=lag]','1');await submit()
  await check('Relationship dialog drives successor date',"meridian.selectedResult.es>meridian.schedule.activities.find(a=>a.id==='A6050').ef")
  before=await page.evaluate('meridian.project.relationships.length')
  await page.click('.view-toolbar [data-action=add-relationship]');await page.select_option('#modal-form [name=from]',aid);await page.select_option('#modal-form [name=to]','A1000');await submit()
  await check('Cycle rejected atomically with a visible diagnostic',f"meridian.project.relationships.length==={before} && document.querySelector('#modal-error').textContent.includes('Dependency cycle')")
  await close()
  # Genuine pointer actions on the viewport-sized Gantt canvas, each undone.
  async def focus_gantt():
   await page.evaluate("()=>{meridian.selectActivity('A1040',true);meridian.gantt.scale=15;meridian.gantt.focus('A1040');meridian.gantt.invalidate();}")
   await page.wait_for_timeout(100)
  async def point(activity,edge=False):
   h=await page.evaluate("id=>meridian.gantt.hits.find(h=>h.id===id)",activity)
   b=await page.locator('.annotation-layer').bounding_box()
   x=h['x']+h['w']-1 if edge else max(6,min(b['width']-6,h['x']+min(25,h['w']/2)))
   return b['x']+x,b['y']+h['y']+h['h']/2
  await focus_gantt();x,y=await point('A1040')
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y,steps=6);await page.mouse.up();await settle()
  await check('Gantt bar drag creates a real start constraint',"meridian.project.activities.find(a=>a.id==='A1040').constraint==='SNET'")
  await page.keyboard.press('Control+z');await settle()
  await focus_gantt();x,y=await point('A1040',True)
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y,steps=6);await page.mouse.up();await settle()
  await check('Gantt right-edge drag edits scheduled duration',"meridian.project.activities.find(a=>a.id==='A1040').remaining>5280")
  await page.keyboard.press('Control+z');await settle()
  await focus_gantt();x,y=await point('A1040');tx,ty=await point('A2010')
  await page.keyboard.down('Shift');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(tx,ty,steps=6);await page.mouse.up();await page.keyboard.up('Shift');await settle()
  await check('Gantt Shift-drag creates an editable FS dependency',"meridian.project.relationships.some(e=>e.from==='A1040'&&e.to==='A2010'&&e.type==='FS')")
  await page.keyboard.press('Control+z');await settle()
  await page.click('.view-tab[data-view=resources]');await page.fill('input[data-resource="r-mep"][data-resource-field="capacity"]','3');await page.locator('input[data-resource="r-mep"][data-resource-field="capacity"]').press('Tab');await settle()
  await check('Editable resource capacity recalculates overload',"meridian.project.resources.find(r=>r.id==='r-mep').capacity===3 && meridian.resources.resources.find(r=>r.id==='r-mep').capacity===3")
  await page.click('.view-tab[data-view=wbs]');await page.click('.view-toolbar [data-action=new-wbs]');await page.fill('#modal-form [name=code]','07');await page.fill('#modal-form [name=name]','Automation package');await page.select_option('#modal-form [name=parentId]','wbs-01');await submit()
  await check('WBS hierarchy editing persists parent identity',"meridian.project.wbs.some(w=>w.code==='07'&&w.parentId==='wbs-01')")
  await page.click('.rail [data-action=calendars]');await page.click('#modal-form [data-action=clone-calendar]');await settle()
  await check('Calendar duplication creates an independent definition',"meridian.project.calendars.length===4")
  await page.fill('#shift-1','08:00-14:00,13:00-17:00');await submit()
  await check('Overlapping calendar shifts are rejected before commit',"document.querySelector('#modal-error').textContent.includes('non-overlapping')")
  await page.fill('#shift-1','08:00-12:00,13:00-17:00');await page.fill('#modal-form [name=exceptions]','2026-12-07 = off');await submit()
  await check('Calendar exception editor saves real nonworking dates',"meridian.project.calendars[3].exceptions['2026-12-07'].length===0")
  await page.click('.view-tab[data-view=baselines]');await page.click('.view-toolbar [data-action=capture-baseline]');await page.fill('#modal-form [name=name]','Browser baseline');await submit()
  await check('Baseline capture creates a dated immutable snapshot',"meridian.project.baselines.length===2 && meridian.baseline.name==='Browser baseline'")
  await page.click('.view-toolbar [data-action=capture-scenario]');await page.fill('#modal-form [name=name]','Browser branch');await submit()
  await check('Scenario capture stores an independent project branch',"meridian.project.scenarios.length===1 && meridian.project.scenarios[0].project.scenarios.length===0")
  await page.evaluate("async()=>{await meridian.change('Test duration change',p=>{const a=p.activities.find(a=>a.code==='T1000');a.duration=1920;a.remaining=1920;});}")
  sid=await page.evaluate('meridian.project.scenarios[0].id')
  await page.select_option('#comparison-reference','s:'+sid);await page.wait_for_timeout(200)
  await check('Scenario comparison uses independently computed schedules',"document.querySelector('#comparison-content').textContent.includes('+2d') && meridian.project.scenarios[0].project.activities.find(a=>a.code==='T1000').duration===960")
  await page.click(f'[data-action=restore-scenario][data-id="{sid}"]');await submit()
  await check('Scenario restoration restores original duration',"meridian.project.activities.find(a=>a.code==='T1000').duration===960")
  await page.keyboard.press('Control+z');await settle()
  await check('Scenario restoration is undoable',"meridian.project.activities.find(a=>a.code==='T1000').duration===1920")
  await page.evaluate("async()=>{await meridian.switchView('activities');meridian.selectActivity(meridian.project.activities.find(a=>a.code==='T1000').id,true);}")
  await page.click('[data-action=detail-tab][data-tab=resources]');await page.click('[data-action=assign-resource]');await page.select_option('#modal-form [name=resourceId]','r-design');await page.fill('#modal-form [name=units]','25');await page.fill('#modal-form [name=actualHours]','2');await submit()
  await check('Resource assignment editor creates demand and actual hours',"meridian.project.assignments.some(a=>a.activityId===meridian.selectedId&&a.units===0.25&&a.actualHours===2)")
  await page.click('[data-action=detail-tab][data-tab=general]');await page.fill('#details-form [name=actualStart]','2026-08-03T08:00');await page.fill('#details-form [name=percent]','25');await page.fill('#details-form [name=remaining]','3');await page.click('#details-form button[type=submit]');await settle()
  await check('Progress update retains actual start while remaining work waits for logic',"meridian.selected.percent===25 && meridian.selected.actualStart===meridian.project.dataDate && meridian.selectedResult.remainingStart>meridian.project.dataDate")
  await page.evaluate("meridian.importCSV('Activity ID,Activity Name,Duration Days,WBS,Predecessors\nU1000,Imported start,1,QA,\nU1010,Imported successor,2,QA,U1000:FS:1d\n')")
  await submit()
  await check('CSV import creates activities, WBS and resolved dependencies',"meridian.project.activities.length===34 && meridian.project.wbs.some(w=>w.code==='QA') && meridian.project.relationships.some(e=>e.lag===480&&e.from===meridian.project.activities.find(a=>a.code==='U1000').id)")
  await check('Exported CSV and printable report contain computed data',"meridian.activityCSV().includes('Total Float Days') && meridian.activityCSV().includes('T1000') && meridian.reportHTML().includes('Browser-tested work package') && meridian.resourceCSV().includes('Demand Hours')")
  await page.click('.project-item[data-id=riverside]');await settle()
  await check('Enterprise project switching opens an independent network',"meridian.project.id==='riverside' && meridian.schedule.activities.length===5")
  await page.click('.project-item[data-id=northline]');await settle()
  await check('Switching back preserves project edits',"meridian.project.id==='northline' && meridian.schedule.activities.length===34")
  await page.keyboard.press('F9');await settle()
  await check('F9 forces a complete scheduling pass',"meridian.schedule.stats.mode==='full'&&meridian.schedule.stats.forwardRecomputed===34")
  if not os.getenv('MERIDIAN_URL'):
   await check('Test repository receives a full versioned workbook',"window.__saved.schemaVersion===1 && window.__saved.projects[0].activities.length===34")
  else:
   await page.evaluate("async()=>{await meridian.persist();window.__reloaded=await meridian.repo.load();}")
   await check('Native repository round-trip preserves versioned workbook',"window.__reloaded.schemaVersion===1 && window.__reloaded.projects[0].activities.length===34")
   await page.reload(wait_until='networkidle')
   await page.wait_for_function('window.meridian && meridian.schedule')
   await check('IndexedDB survives a complete page reload',"meridian.repo.backend==='IndexedDB' && meridian.project.activities.length===34")
  await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(180)
  await check('Mobile layout stays within viewport bounds',"document.body.scrollWidth===390 && document.querySelector('.gantt-viewport').clientWidth>0")
  await page.screenshot(path=str(ROOT/'docs/mobile-preview.png'),full_page=True)
  await page.set_viewport_size({'width':1600,'height':1000});await page.wait_for_timeout(80)
  await check('No uncaught page exceptions',f'{json.dumps(errors)}.length===0')
  metadata=await page.evaluate("({backend:meridian.backend,worker:!!meridian.service.worker,secureContext:isSecureContext,storage:meridian.repo.backend})")
  output={'tests':len(RESULTS),'passed':len(RESULTS),'environment':metadata,'uncaughtErrors':errors,'results':RESULTS}
  (ROOT/'docs/browser-test-results.json').write_text(json.dumps(output,indent=2))
  print(json.dumps(output,indent=2))
  await browser.close()
asyncio.run(main())

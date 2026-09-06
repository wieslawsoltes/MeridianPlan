"""Verify the deployed HTTPS app in an isolated, unmocked browser context."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

async def main():
    url = os.environ['MERIDIAN_URL'].rstrip('/') + '/'
    expected = os.environ.get('EXPECTED_COMMIT')
    assert urlparse(url).scheme == 'https', 'Published URL must use HTTPS'
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('CHROMIUM_PATH') or p.chromium.executable_path,
            headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1600,'height':1000})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            # CDN publication can trail the deployment API's completion briefly.
            for attempt in range(30):
                response = await context.request.get(urljoin(url, 'deployment.json') + '?verify=' + str(attempt))
                if response.ok:
                    metadata = await response.json()
                    if not expected or metadata.get('commit') == expected:
                        break
                await asyncio.sleep(2)
            else:
                raise AssertionError('Live deployment metadata does not match the requested commit')
            results.append('Published commit matches deployment metadata')
            for name in ['styles.css','src/app.js','src/worker.js','src/core/scheduler.js','meridian-plan.html']:
                response = await context.request.get(urljoin(url, name))
                assert response.ok, f'Missing published asset: {name}'
            results.append('Styles, modules, worker, and portable build are served')
            response = await page.goto(url, wait_until='networkidle')
            assert response.ok
            await page.wait_for_function("window.meridian && meridian.schedule && ['WebGPU','Canvas 2D'].includes(meridian.backend)")
            assert await page.evaluate("isSecureContext && !!meridian.service.worker && meridian.schedule.summary.count===31 && meridian.schedule.summary.critical===12")
            results.append('HTTPS application boots and calculates the demo in a native module worker')
            await page.evaluate("async()=>{await meridian.change('Deployment verification',p=>{p.activities.find(a=>a.id==='A1040').remaining+=480;},{changedIds:['A1040']});}")
            assert await page.evaluate("meridian.project.activities.find(a=>a.id==='A1040').remaining===5280 && meridian.schedule.stats.mode==='incremental'")
            results.append('A live edit runs the incremental scheduler')
            await page.evaluate('async()=>{await meridian.undo();await meridian.undo(true);}')
            assert await page.evaluate("meridian.project.activities.find(a=>a.id==='A1040').remaining===5280")
            results.append('Undo and redo preserve the edited schedule')
            assert await page.evaluate("""async()=>{
                const before=meridian.project.relationships.length;
                try {await meridian.change('Reject deployment test cycle',p=>p.relationships.push({id:'verify-cycle',from:'A6050',to:'A1000',type:'FS',lag:0}));}
                catch(error){return error.message.includes('Dependency cycle')&&meridian.project.relationships.length===before;}
                return false;
            }""")
            results.append('Dependency cycles are rejected without committing invalid state')
            await page.evaluate('async()=>{await meridian.changeQueue;await meridian.persist();}')
            assert await page.evaluate("meridian.lastSaveSucceeded && meridian.repo.backend==='IndexedDB'")
            await page.reload(wait_until='networkidle')
            await page.wait_for_function('window.meridian && meridian.schedule')
            assert await page.evaluate("meridian.project.activities.find(a=>a.id==='A1040').remaining===5280 && !!meridian.service.worker")
            results.append('Native IndexedDB preserves the edit across a full reload')
            await page.evaluate("()=>{meridian.gantt.fit();document.querySelector('#toasts').innerHTML='';}")
            await page.wait_for_timeout(200)
            await page.screenshot(path=str(ROOT/'docs/live-preview.png'), full_page=True)
            assert not errors, errors
            results.append('No uncaught browser exceptions')
            environment = await page.evaluate("({backend:meridian.backend,worker:!!meridian.service.worker,storage:meridian.repo.backend,secureContext:isSecureContext})")
            output = {'url':url,'commit':metadata['commit'],'passed':len(results),'results':results,'environment':environment,'uncaughtErrors':errors}
            (ROOT/'docs/live-verification.json').write_text(json.dumps(output,indent=2))
            print(json.dumps(output,indent=2))
        finally:
            await browser.close()

asyncio.run(main())

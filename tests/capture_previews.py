"""Capture genuine application screenshots from the portable build.
Opaque-origin preview: real Canvas fallback; no mocked schedule or geometry.
"""
import asyncio, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or p.chromium.executable_path,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1720,'height':1120},device_scale_factor=1)
  if os.getenv('MERIDIAN_URL'):await page.goto(os.environ['MERIDIAN_URL'],wait_until='networkidle')
  else:await page.set_content((ROOT/'dist/meridian-plan.html').read_text(),wait_until='load')
  await page.wait_for_function('window.meridian && meridian.schedule')
  await page.wait_for_function("['WebGPU','Canvas 2D'].includes(meridian.backend)")
  # Dismiss the expected opaque-origin storage warning for an unobstructed preview.
  # The backend indicator remains the real Canvas 2D renderer; no data are substituted.
  await page.evaluate("()=>{document.querySelector('#toasts').innerHTML='';meridian.gantt.fit();}")
  await page.wait_for_timeout(150)
  await page.screenshot(path=str(ROOT/'docs/activity-preview.png'),full_page=True)
  await page.click('.view-tab[data-view=resources]');await page.wait_for_timeout(150)
  await page.screenshot(path=str(ROOT/'docs/resource-preview.png'),full_page=True)
  await page.click('.view-tab[data-view=baselines]');await page.wait_for_timeout(150)
  await page.screenshot(path=str(ROOT/'docs/baseline-preview.png'),full_page=True)
  await browser.close()
asyncio.run(main())

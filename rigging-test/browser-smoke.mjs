import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
// Run with: npm exec --yes --package=playwright -- node rigging-test/browser-smoke.mjs
const bin=process.env.PATH.split(path.delimiter).find(p=>existsSync(path.join(p,'..','playwright','index.mjs')));
if(!bin)throw Error('Run through npm exec --package=playwright');
const {chromium}=await import(pathToFileURL(path.resolve(bin,'..','playwright','index.mjs')));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8000/Fleet%20Doctrine/rigging-test/',{waitUntil:'networkidle',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('준비 완료'),{timeout:90000});
 const files=await page.locator('#asset-select option').evaluateAll(xs=>xs.map(x=>x.value));
 if(files.length!==10)throw Error('expected 10 assets');
 for(const file of files){
  await page.selectOption('#asset-select',file);
  await page.waitForFunction(f=>document.querySelector('#status').textContent.includes('준비 완료')&&document.querySelector('#status').textContent.includes(f),file,{timeout:90000});
  const names=await page.locator('#turret option').allTextContents();
  if(!names.length)throw Error('no weapons: '+file);
  const analysis=await page.locator('#analysis-status').textContent();
  if(!analysis.startsWith('분석 일치'))throw Error('stale analysis: '+file+' '+analysis);
  await page.locator('#yaw').evaluate(el=>{if(!el.disabled){el.value='20';el.dispatchEvent(new Event('input',{bubbles:true}));}});
  await page.locator('#fire').click();
  await page.locator('#draft-joints').check();
  await page.locator('#yaw').evaluate(el=>{if(!el.disabled){el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));}});
  await page.locator('#draft-joints').uncheck();
  console.log(JSON.stringify({file,weapons:names.length,status:await page.locator('#status').textContent(),analysis:await page.locator('#analysis-status').textContent()}));
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS 10 browser asset loads, movement and fire handlers; no page errors');
}finally{await browser.close();}

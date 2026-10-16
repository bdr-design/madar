'use strict';

// Keep the four-step operating flows readable inside the narrow landscape drawer at the owner's three screen sizes.
// This test measures the rendered cards and their text; it does not add any runtime layout work to the game.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {boot}=require('./helpers/local-dom-app');

const viewports=[{width:956,height:440},{width:844,height:390},{width:667,height:375}];
const flows=[
  ['insurance',{tab:'overview'}],
  ['realestate',{tab:'overview'}],
  ['bank',{tab:'overview'}],
  ['energy',{tab:'overview'}]
];
const screenshotDir=process.env.GH_LAYOUT_SCREENSHOTS_DIR||'';

async function settleNavigation(page){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function measure(page){
  return page.evaluate(()=>{
    const body=document.querySelector('#drawerBody');
    const flow=body?.querySelector('.management-flow');
    if(!body||!flow)return null;
    const box=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,width:r.width,height:r.height};};
    const steps=[...flow.querySelectorAll('.management-flow-step')].map(node=>{
      const title=node.querySelector('b'),copy=node.querySelector('small');
      return{
        box:box(node),
        title:{width:title?.clientWidth||0,scroll:title?.scrollWidth||0},
        copy:{width:copy?.clientWidth||0,scroll:copy?.scrollWidth||0}
      };
    });
    const intersections=[];
    for(let i=0;i<steps.length;i++)for(let j=i+1;j<steps.length;j++){
      const a=steps[i].box,b=steps[j].box;
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top)>1)intersections.push([i,j]);
    }
    return{
      panel:document.querySelector('#drawer')?.dataset.panel||'',
      columns:getComputedStyle(flow).gridTemplateColumns.trim().split(/\s+/).length,
      body:{client:body.clientWidth,scroll:body.scrollWidth},
      flow:{...box(flow),client:flow.clientWidth,scroll:flow.scrollWidth},
      steps,
      intersections
    };
  });
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const results=[];
  try{
    for(const viewport of viewports){
      const errors=[];
      const {page}=await boot({browser,viewport,errors});
      await page.evaluate(async()=>{
        const state=__GH_STATE__;
        state.godMoney=true;
        state.infiniteMoney=true;
        for(const row of GH_COMPANY_PLATFORM.listInstances(state,{includeGroup:false})){
          const definition=row.definition;
          await __AUDIT__.runAuthorizedDomainCommand('corporate','open-company',{
            type:row.id,
            companyId:row.id,
            capital:definition.founding.defaultCapital,
            legalName:`QA ${row.id}`,
            formationContract:`QA-BUILD397-${row.id}`
          },{silent:true});
        }
      });
      const opened=await page.evaluate(()=>__GH_STATE__.openedCompanies.slice());
      for(const id of ['insurance','realestate','bank','power'])assert(opened.includes(id),`${id} company is open at ${viewport.width}x${viewport.height}`);

      for(const [panel,arg] of flows){
        await page.evaluate(([target,payload])=>__AUDIT__.openDrawer(target,payload),[panel,arg]);
        await settleNavigation(page);
        const measured=await measure(page);
        assert(measured,`${panel} renders its operating flow at ${viewport.width}x${viewport.height}`);
        if(screenshotDir&&panel==='insurance'){
          await page.locator('.management-flow').scrollIntoViewIfNeeded();
          fs.mkdirSync(screenshotDir,{recursive:true});
          await page.screenshot({path:path.join(screenshotDir,`insurance-${viewport.width}x${viewport.height}.png`)});
        }
        assert.equal(measured.columns,2,`${panel} uses two readable columns at ${viewport.width}x${viewport.height}: ${JSON.stringify(measured)}`);
        assert.equal(measured.steps.length,4,`${panel} shows all four steps`);
        assert.deepEqual(measured.intersections,[],`${panel} step cards do not intersect: ${JSON.stringify(measured.intersections)}`);
        assert(measured.flow.scroll-measured.flow.client<=1,`${panel} flow has no horizontal overflow: ${JSON.stringify(measured.flow)}`);
        assert(measured.body.scroll-measured.body.client<=1,`${panel} drawer body has no horizontal overflow: ${JSON.stringify(measured.body)}`);
        const rows=new Map();
        for(const [index,step] of measured.steps.entries()){
          assert(step.box.left>=measured.flow.left-1&&step.box.right<=measured.flow.right+1,`${panel} step ${index+1} stays inside its flow`);
          assert(step.box.width>=100,`${panel} step ${index+1} has usable text width: ${JSON.stringify(step)}`);
          assert(step.box.height<=125,`${panel} step ${index+1} avoids tall letter-stacked text: ${JSON.stringify(step)}`);
          assert(step.title.width>=40&&step.title.scroll-step.title.width<=2,`${panel} step ${index+1} title is not clipped: ${JSON.stringify(step.title)}`);
          assert(step.copy.width>=40&&step.copy.scroll-step.copy.width<=2,`${panel} step ${index+1} description is not clipped: ${JSON.stringify(step.copy)}`);
          const key=Math.round(step.box.top);
          if(!rows.has(key))rows.set(key,[]);
          rows.get(key).push(step.box);
        }
        assert.equal(rows.size,2,`${panel} lays four steps in two rows`);
        for(const row of rows.values())assert(Math.max(...row.map(box=>box.height))-Math.min(...row.map(box=>box.height))<=1,`${panel} cards in one row have equal heights`);
        results.push({viewport,panel,columns:measured.columns,stepWidth:Math.round(measured.steps[0].box.width*10)/10,stepHeight:Math.max(...measured.steps.map(step=>Math.round(step.box.height*10)/10)),flowOverflow:measured.flow.scroll-measured.flow.client,drawerOverflow:measured.body.scroll-measured.body.client});
      }
      assert.deepEqual(errors,[],`${viewport.width}x${viewport.height} has no JavaScript errors`);
      await page.close();
    }
  }finally{await browser.close();}
  console.log(JSON.stringify({suite:'build397-management-flow-layout-browser',passed:results.length,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';

// Asset specification values must stay fully visible in the landscape market cards.
// This test measures the existing cards at the owner's three screen sizes without changing game state at runtime.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {boot}=require('./helpers/local-dom-app');

const viewports=[{width:956,height:440},{width:844,height:390},{width:667,height:375}];
const screenshotDir=process.env.GH_LAYOUT_SCREENSHOTS_DIR||'';

async function settleNavigation(page){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function measure(page){
  return page.evaluate(()=>{
    const body=document.querySelector('#drawerBody');
    const grids=[...body.querySelectorAll('.asset-metrics')];
    const box=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,width:r.width,height:r.height};};
    return{
      body:{client:body.clientWidth,scroll:body.scrollWidth},
      grids:grids.map(grid=>({
        box:box(grid),
        columns:getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
        client:grid.clientWidth,
        scroll:grid.scrollWidth,
        cells:[...grid.children].map(cell=>({box:box(cell),values:[...cell.querySelectorAll('b')].map(value=>({text:value.textContent.trim(),width:value.clientWidth,scroll:value.scrollWidth}))}))
      }))
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
            formationContract:`QA-BUILD398-${row.id}`
          },{silent:true});
        }
      });
      await page.evaluate(([panel,arg])=>__AUDIT__.openDrawer(panel,arg),['assetMarket','air']);
      await settleNavigation(page);
      const measured=await measure(page);
      assert(measured.grids.length>0,`aircraft catalog renders asset metrics at ${viewport.width}x${viewport.height}`);
      if(screenshotDir){
        await page.locator('.asset-metrics').first().scrollIntoViewIfNeeded();
        fs.mkdirSync(screenshotDir,{recursive:true});
        await page.screenshot({path:path.join(screenshotDir,`asset-market-${viewport.width}x${viewport.height}.png`)});
      }
      assert(measured.body.scroll-measured.body.client<=1,`market drawer has no horizontal overflow: ${JSON.stringify(measured.body)}`);
      const expectedColumns=viewport.width<=760?2:4;
      for(const [gridIndex,grid] of measured.grids.entries()){
        assert.equal(grid.columns,expectedColumns,`asset metric grid ${gridIndex+1} uses ${expectedColumns} columns at ${viewport.width}x${viewport.height}`);
        assert(grid.scroll-grid.client<=1,`asset metric grid ${gridIndex+1} has no horizontal overflow`);
        const widths=grid.cells.map(cell=>cell.box.width);
        assert(Math.max(...widths)-Math.min(...widths)<=1,`metric cells have equal widths in grid ${gridIndex+1}`);
        for(const [cellIndex,cell] of grid.cells.entries()){
          assert(cell.box.left>=grid.box.left-1&&cell.box.right<=grid.box.right+1,`metric cell ${cellIndex+1} stays inside its grid`);
          for(const value of cell.values){
            assert(value.width>=40,`numeric value ${value.text} has readable width: ${JSON.stringify(value)}`);
            assert(value.scroll-value.width<=1,`numeric value ${value.text} is not clipped: ${JSON.stringify(value)}`);
          }
        }
      }
      assert.deepEqual(errors,[],`${viewport.width}x${viewport.height} has no JavaScript errors`);
      results.push({viewport,grids:measured.grids.length,columns:expectedColumns,minCellWidth:Math.min(...measured.grids.flatMap(grid=>grid.cells.map(cell=>cell.box.width))),clippedValues:0});
      await page.close();
    }
  }finally{await browser.close();}
  console.log(JSON.stringify({suite:'build398-asset-market-metrics-layout-browser',passed:results.length,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';

// Risk limits are four independent figures; keep their labels and values as separate cells at every target landscape size.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {boot}=require('./helpers/local-dom-app');

const viewports=[{width:956,height:440},{width:844,height:390},{width:667,height:375}];
const screenshotDir=process.env.GH_LAYOUT_SCREENSHOTS_DIR||'';

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
            formationContract:`QA-BUILD399-${row.id}`
          },{silent:true});
        }
        __AUDIT__.openDrawer('bank',{tab:'control'});
      });
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const measured=await page.evaluate(()=>{
        const article=[...document.querySelectorAll('#drawerBody article.list-item')].find(node=>[...node.querySelectorAll('h3')].some(heading=>heading.textContent.trim()==='شهية المخاطر'));
        const grid=article?.querySelector('.metric-row');
        const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,width:r.width,height:r.height};};
        const paragraphs=[...(article?.querySelectorAll('p')||[])].filter(node=>/LDR.*LCR.*CET1/.test(node.textContent));
        const cells=[...(grid?.children||[])].map(node=>({box:rect(node),label:node.querySelector('span')?.textContent.trim()||'',value:node.querySelector('b')?.textContent.trim()||''}));
        const policy=__GH_STATE__.bank.riskPolicy;
        return{
          paragraphCount:paragraphs.length,
          paragraph:paragraphs[0]?.textContent.trim()||'',
          columns:grid?getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length:0,
          grid:grid?{...rect(grid),client:grid.clientWidth,scroll:grid.scrollWidth}:null,
          cells,
          expected:[['حد القروض إلى الودائع',`${Number(policy.maxLdr)}%`],['أدنى تغطية سيولة',`${Number(policy.minLcr)}%`],['أدنى رأس مال أساسي',`${Number(policy.minCet1)}%`],['تركيز القطاع',`${Number(policy.sectorConcentration)}%`]]
        };
      });
      assert.equal(measured.paragraphCount,0,`four bank risk values are not packed into one paragraph at ${viewport.width}x${viewport.height}: ${measured.paragraph}`);
      if(screenshotDir){
        await page.locator('#drawerBody .metric-row').last().scrollIntoViewIfNeeded();
        fs.mkdirSync(screenshotDir,{recursive:true});
        await page.screenshot({path:path.join(screenshotDir,`bank-risk-${viewport.width}x${viewport.height}.png`)});
      }
      assert.equal(measured.columns,2,`bank risk summary uses two metric columns`);
      assert.equal(measured.cells.length,4,`four risk metrics remain present`);
      assert.deepEqual(measured.cells.map(cell=>[cell.label,cell.value]),measured.expected,`the rendered policy values are unchanged`);
      assert(measured.grid.scroll-measured.grid.client<=1,`risk metric grid has no horizontal overflow`);
      const intersections=[];
      for(let i=0;i<measured.cells.length;i++)for(let j=i+1;j<measured.cells.length;j++){
        const a=measured.cells[i].box,b=measured.cells[j].box;
        if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top)>1)intersections.push([i,j]);
      }
      assert.deepEqual(intersections,[],`risk metric cells do not intersect`);
      assert.deepEqual(errors,[],`${viewport.width}x${viewport.height} has no JavaScript errors`);
      results.push({viewport,columns:measured.columns,cellWidth:Math.round(measured.cells[0].box.width*10)/10,metrics:measured.cells.map(cell=>cell.label)});
      await page.close();
    }
  }finally{await browser.close();}
  console.log(JSON.stringify({suite:'build399-bank-prudential-summary-layout-browser',passed:results.length,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});

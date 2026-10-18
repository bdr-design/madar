'use strict';const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),ROOT='/workspace/madar',OUT='/workspace/scratch/render-review-20261018';const trials=[
['force-idle-draw','map-vehicle-canvas-core.js','return !destroyed&&dirty?draw():null;','return !destroyed?draw():null;','457-canvas-idle-work'],
['ignore-opacity','map-vehicle-canvas-core.js','opacity!==slot.opacity||','false||','457-canvas-idle-work'],
['omit-image-refresh','map-vehicle-canvas-core.js','entry.load=null;entry.error=null;scheduleDraw();','entry.load=null;entry.error=null;','457-canvas-idle-work'],
['repeat-calendar-label','app.js','if(button.textContent!==label)button.textContent=label;','button.textContent=label;','458-stable-ui-writes'],
['repeat-map-title','app.js','if(status.title!==title)status.title=title;','status.title=title;','458-stable-ui-writes'],
['scroll-hidden-tabs','interface-core.js',"!selected.parentElement?.classList.contains('mc-in-strip')",'true','459-navigation-scroll-work',s=>s.replace("parent&&!parent.classList.contains('mc-in-strip')",'parent')],
['scroll-stale-tabs','interface-core.js','selected.isConnected&&root.contains(selected)&&','true&&','459-navigation-scroll-work'],
['render-full-catalog','app.js','const list = visibleItems.map(a=>','const list = items.map(a=>','461-market-render-work'],
['retain-stale-page','app.js','marketPageKey=pageKey;marketPage=0;','marketPageKey=pageKey;','461-market-render-work'],
['wrong-next-page','app.js','data-market-page="${marketPage+1}"','data-market-page="${marketPage+2}"','461-market-render-work'],
['rebuild-market-on-summary','app.js',"if(activeDrawerPanel==='assetMarket'){refreshAssetMarketSummary();return;}",'','462-market-summary-refresh'],
['reenable-busy-sale','app.js','if(button&&!button.dataset.busy){const disabled','if(button){const disabled','462-market-summary-refresh']
];const results=[];for(const [name,file,from,to,test,extra]of trials){const root=OUT+'/mutants/'+name,web=root+'/WebApp';fs.mkdirSync(web,{recursive:true});let src=fs.readFileSync(ROOT+'/WebApp/'+file,'utf8');if(!src.includes(from))throw Error('mutation location absent '+name);src=src.replace(from,to);if(extra)src=extra(src);fs.writeFileSync(web+'/'+file,src);const f='tests/build'+test+'.cjs',p=spawnSync(process.execPath,[f],{cwd:ROOT,env:{...process.env,GH_TEST_SOURCE_DIR:root},encoding:'utf8',timeout:10000});const output=p.stdout+p.stderr;fs.writeFileSync(root+'/result.log',output);const detected=p.status===1&&output.includes('AssertionError');results.push({name,file,test:f,exitCode:p.status,detected});if(!detected)throw Error('mutation escaped or harness error '+name+'\n'+output);console.log(name,'detected');}fs.writeFileSync(OUT+'/mutation-results.json',JSON.stringify(results,null,2));

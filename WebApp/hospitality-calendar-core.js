(()=>{'use strict';
  // The game's calendar, not wall-clock time. A cycle includes [16th, next 15th].
  const VERSION='1.0.0',DAY=86400,EPOCH=Date.UTC(2026,0,1),MAX_DAY=1000000;
  function checkedDay(value){if(!Number.isSafeInteger(value)||value<0||value>MAX_DAY)throw new Error('hospitality-day-invalid');return value;}
  const index=date=>Math.round((date.getTime()-EPOCH)/(DAY*1000));
  function dateForDay(day){return new Date(EPOCH+checkedDay(day)*DAY*1000);}
  function cycle(day){
    const date=dateForDay(day),year=date.getUTCFullYear(),month=date.getUTCMonth(),end=new Date(Date.UTC(year,month+(date.getUTCDate()>15?1:0),15)),start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-1,16));
    return Object.freeze({id:`${end.getUTCFullYear()}-${String(end.getUTCMonth()+1).padStart(2,'0')}-15`,startDay:index(start),endDay:index(end),closeDayOfMonth:15});
  }
  function month(day){const date=dateForDay(day);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;}
  function isCloseDay(day){return dateForDay(day).getUTCDate()===15;}
  const API=Object.freeze({VERSION,DAY,EPOCH,MAX_DAY,checkedDay,dateForDay,cycle,month,isCloseDay});
  globalThis.GH_HOSPITALITY_CALENDAR=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();

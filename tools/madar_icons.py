#!/usr/bin/env python3
"""Build 373 MADAR icon family (the owner-approved direction C: realistic colour, a soft glass tile behind options).

The single source of every icon in the game. Run from the repo root:
    python3 tools/madar_icons.py
It writes WebApp/madar-icons.css (every icon as a small self-contained SVG image, plus the glass tile) and
WebApp/madar-icons.js (the registry). Glyphs use a 24px grid in three layers: p main body, a accent,
k detail; ps/as/ks are their stroked forms. Each icon paints its layers with the colours of the real object (PALETTE):
gradients for the filled shapes, the gradient's middle tone for strokes (a gradient on a straight line has no box)."""
import math
def gear(cx,cy,ro,ri,n=8,tooth=.42):
    pts=[]
    for i in range(n):
        base=2*math.pi*i/n+math.pi/n; half=math.pi/n*tooth
        for ang,r in ((base-half*1.6,ri),(base-half,ro),(base+half,ro),(base+half*1.6,ri)):
            pts.append((cx+r*math.cos(ang),cy+r*math.sin(ang)))
    return 'M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in pts)+'Z'
def g(markup,s=1,tx=0,ty=0):return f'<g transform="translate({tx} {ty}) scale({s})">{markup}</g>'
def P(d):return f'<path class="p" d="{d}"/>'
def A(d):return f'<path class="a" d="{d}"/>'
def K(d,op=None):return f'<path class="k" d="{d}"'+(f' opacity="{op}"' if op else '')+'/>'
def PS(d,w=2,extra=''):return f'<path class="ps" d="{d}" style="stroke-width:{w}{extra}"/>'
def AS(d,w=2,extra=''):return f'<path class="as" d="{d}" style="stroke-width:{w}{extra}"/>'
def KS(d,w=2,extra=''):return f'<path class="ks" d="{d}" style="stroke-width:{w}{extra}"/>'
def circ(cls,cx,cy,r,w=None):
    st=f' style="stroke-width:{w}"' if w else ''
    return f'<circle class="{cls}" cx="{cx}" cy="{cy}" r="{r}"{st}/>'
def rect(cls,x,y,w,h,rx=0):return f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
def badge(cx,cy,inner,r=4.5):
    """Accent disc cut out of the glyph by a knockout ring, with an inner knockout mark."""
    return circ('ks',cx,cy,r+.9,1.8)+circ('a',cx,cy,r)+inner
def plus(cx,cy,s=2.1):return KS(f'M{cx} {cy-s}v{2*s}M{cx-s} {cy}h{2*s}',1.7)
def dollar(cx,cy):return KS(f'M{cx} {cy-2.3}v4.6M{cx+1.3} {cy-1.2}c-.3-.5-.8-.7-1.3-.7-.8 0-1.3.4-1.3 1s.6.9 1.3 1.1c.8.2 1.3.5 1.3 1.1s-.6 1-1.3 1c-.6 0-1.1-.3-1.4-.8',1.1)
def clock(cx,cy):return KS(f'M{cx} {cy-2.3}v2.5l1.8 1.1',1.6)

PLANE='M12 1.8c.9 0 1.5 1 1.5 2.2v5l7.3 4.2c.4.2.6.6.6 1v1.3l-7.9-2.3v4.6l2.3 1.7v1.5L12 20.2 8.2 21v-1.5l2.3-1.7v-4.6L2.6 15.5v-1.3c0-.4.2-.8.6-1L10.5 9V4c0-1.2.6-2.2 1.5-2.2z'
plane=P(PLANE)+A('M5.6 13.1l2.2-1.3v2.4l-2.2.6zM18.4 13.1l-2.2-1.3v2.4l2.2.6z')+rect('k',11.3,4.2,1.4,2.4,.7)
ship=(P('M1.8 13.6h20.4l-2.4 5.6c-.3.7-1 1.2-1.8 1.2H6c-.8 0-1.5-.5-1.8-1.2z')+rect('p',4.4,8.2,5.4,5.4,.8)+rect('a',5.5,4.8,2.3,3.4,.5)
      +rect('k',5.3,9.5,3.6,1.4,.4)+rect('a',10.6,10.2,3.4,3.4,.4)+rect('a',14.5,10.2,3.4,3.4,.4)+rect('a',18.4,10.2,2.6,3.4,.4)+rect('a',12.6,6.8,3.4,3.4,.4)+rect('a',16.5,6.8,3.4,3.4,.4)
      +KS('M5.2 16.6h13.8',1.1,';opacity:.55'))
truck=(rect('p',1.8,5.2,12.8,11,1.3)+rect('a',1.8,12.4,12.8,1.7,0)+P('M15.6 8.2h3.3c.5 0 1 .3 1.3.7l1.8 2.7c.2.3.3.6.3 1v3.8h-6.7z')+K('M17 9.6h1.9l1.3 2H17z')
       +rect('p',1.8,16.4,20.4,1.4,.5)+circ('ks',6.2,18.6,3.1,1.6)+circ('p',6.2,18.6,2.4)+circ('k',6.2,18.6,.95)+circ('ks',17.8,18.6,3.1,1.6)+circ('p',17.8,18.6,2.4)+circ('k',17.8,18.6,.95))
car=(P('M2.4 13.4c0-.9.6-1.7 1.4-1.9l2.3-.7 2.4-3.4c.4-.6 1.1-1 1.8-1h4.9c.7 0 1.3.3 1.7.9l2.6 3.5 2.3.6c.8.2 1.4 1 1.4 1.8v2.6c0 .6-.4 1-1 1H3.4c-.6 0-1-.4-1-1z')
     +K('M9.4 8h2.4v3H7.2z')+K('M13.2 8h1.9c.3 0 .6.1.8.4l1.9 2.6h-4.6z')+rect('a',19.6,12.7,1.6,1.3,.5)
     +circ('ks',7.2,16.9,3,1.6)+circ('p',7.2,16.9,2.3)+circ('k',7.2,16.9,.9)+circ('ks',16.8,16.9,3,1.6)+circ('p',16.8,16.9,2.3)+circ('k',16.8,16.9,.9))
def buy(base,s,tx,ty):return g(base,s,tx,ty)+badge(6.2,17.6,plus(6.2,17.6))
DOC='M5.6 2.2h8.2l4.6 4.6v14c0 .6-.4 1-1 1H5.6c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1z'
def doc(inner,seal=True,mark=None):
    out=P(DOC)+K('M13.8 2.2v3.6c0 .6.4 1 1 1h3.6z','.5')+inner
    if seal:out+=badge(16.6,17.8,mark if mark is not None else K('M16.6 15.9l.6 1.2 1.3.2-.95.9.22 1.3-1.17-.62-1.17.62.22-1.3-.95-.9 1.3-.2z'),3.3)
    return out
LINES=rect('k',7.2,9.4,7.6,1.5,.75)+rect('k',7.2,12.4,5.2,1.5,.75)
def mini(markup,s=.36,tx=6.6,ty=6.6):return g(markup.replace('class="p"','class="k"').replace('class="a"','class="k"'),s,tx,ty)
PIN='M18.7 1.8a4.1 4.1 0 0 1 4.1 4.1c0 3.1-4.1 7.2-4.1 7.2s-4.1-4.1-4.1-7.2a4.1 4.1 0 0 1 4.1-4.1z'
def route(extra=''):return PS('M5.4 18.2C6.6 12.2 10.4 8.8 15.6 7.8',2.3,';stroke-dasharray:.1 3.1')+circ('a',5,19,2.9)+circ('k',5,19,1.1)+P(PIN)+circ('k',18.7,5.9,1.55)+extra
def person(cx=12,head=3.4,top=4.2):return circ('p',cx,top+head,head)+P(f'M{cx-8.4} 21.2c0-4.1 3.7-6.9 8.4-6.9s8.4 2.8 8.4 6.9z')
BANKB=(P('M12 2.4L21.6 7.6v1.8H2.4V7.6z')+circ('a',12,6.4,1.3)+''.join(rect('p',x,10.6,2.4,7,.4) for x in (4.1,8.4,13.2,17.5))+rect('a',2.4,18.4,19.2,1.4,.5)+rect('p',1.8,20,20.4,1.8,.6))
OFFICE=(P('M5 21.4V4.2c0-.7.5-1.2 1.2-1.2h11.6c.7 0 1.2.5 1.2 1.2v17.2z')+''.join(rect('k',x,y,1.9,1.9,.45) for x in (7.4,11.05,14.7) for y in (5.6,8.9,12.2))+rect('a',10,16,4,5.4,.6))
COINS=''.join(rect('a',2.6,y,10.2,2.5,1.25)+rect('k',2.6,y+2.5,10.2,.5,0) for y in (17.9,14.9,11.9))
G={}
def add(key,label,family,markup):G[key]=(label,family,markup)

# ── Sections and the frame
add('map','الخريطة','teal',circ('p',12,12,9.6)+A('M7.1 5.5c1.7-1 3.9-1.3 5.7-.7.5.9-.1 1.9-1 2.2-.9.3-1.3 1.2-.8 2 .6 1 .2 2.1-.8 2.5-1 .4-1.3 1.5-1 2.5.3.9-.2 1.8-1.1 1.9-1.6-1.4-2.6-3.5-2.6-5.8 0-1.8.6-3.4 1.6-4.6z')+A('M14.6 12.5c1-.6 2.4-.3 3 .7.4.7.3 1.6-.3 2.2l-1.6 1.6c-.7.7-1.8.3-1.9-.6l-.2-1.6c-.1-.9.3-1.8 1-2.3z')+A('M16.3 5.4c1 .4 1.9 1.1 2.6 1.9-.6.7-1.7.8-2.4.2-.5-.4-.6-1.4-.2-2.1z'))
GROUP=(P('M3.6 20.6V5.3c0-.5.3-.9.8-1.1l6.4-2c.6-.2 1.3.3 1.3.9v17.5z')+A('M13.2 20.6V8.7c0-.6.6-1 1.2-.8l5.3 1.8c.5.2.8.6.8 1.1v9.8z')
  +''.join(rect('k',x,y,1.9,1.9,.45) for x,y in ((5.8,6.4),(8.7,5.6),(5.8,9.8),(8.7,9.8),(5.8,13.2),(8.7,13.2)))+''.join(rect('k',x,y,1.8,1.8,.45) for x,y in ((15.3,11.6),(17.9,12.4),(15.3,15),(17.9,15.4)))
  +rect('k',6.9,17,2.6,3.6,.6)+rect('p',2,20,20,2,1))
add('group','المجموعة','navy',GROUP)
add('finance','المال','emerald',''.join(rect('p',x,y,3.8,21-y,1.1) for x,y in ((3.2,13.2),(8.9,9.4),(14.6,12.6)))+circ('a',18.4,5.9,3.9)+circ('ks',18.4,5.9,2.2,1.2))
add('people','الأفراد','blue',circ('a',16.6,7.4,2.9)+A('M14.4 13.3c.7-.3 1.5-.4 2.3-.4 3 0 5.1 2.2 5.1 5.4v1.9h-5.3c0-2.7-.8-5.2-2.1-6.9z')+circ('p',9,7.9,3.6)+P('M2.4 20.2c0-4 2.9-6.6 6.6-6.6s6.6 2.6 6.6 6.6c0 .5-.4.8-.8.8H3.2c-.4 0-.8-.3-.8-.8z'))
add('leadership','الإدارة','purple',P('M3.3 8.9l4.5 3.5L12 5.9l4.2 6.5 4.5-3.5-1.6 9.6H4.9z')+circ('a',3.3,8.3,1.8)+circ('a',12,4.6,1.9)+circ('a',20.7,8.3,1.8)+K('M12 11.4l1.7 2.2-1.7 2.2-1.7-2.2z')+rect('a',4.6,19.2,14.8,2.2,1.1))
add('settings','الحفظ والإعدادات','slate',P(gear(12,12,10.2,7.7,8,.5))+circ('a',12,12,4.9)+circ('k',12,12,2.2))
# ── Company panel (shared by every company)
add('dashboard','لوحة الشركة','navy',P('M2.6 16.2a9.4 9.4 0 0 1 18.8 0v2.2c0 .9-.7 1.6-1.6 1.6H4.2c-.9 0-1.6-.7-1.6-1.6z')+KS('M5.4 13.2l1.3.7M8.2 9.3l.8 1.2M12 7.9v1.5M15.8 9.3l-.8 1.2M18.6 13.2l-1.3.7',1.4)+AS('M12 16.4l4.6-5.4',2.4)+circ('a',12,16.4,2.2)+circ('k',12,16.4,.9))
add('manage','الإدارة والهوية','navy',P('M12 2.2l7.6 3v6.2c0 4.6-3.2 8.6-7.6 10.4-4.4-1.8-7.6-5.8-7.6-10.4V5.2z')+A('M12 7.2l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z'))
add('company-finance','مالية الشركة','emerald',P('M3 7.6c0-1.2 1-2.2 2.2-2.2h12.4l.3-1.4c.2-.7.9-1.1 1.6-.9l.4.1L19.4 5.4h.4c.7 0 1.2.5 1.2 1.2v12.2c0 1.2-1 2.2-2.2 2.2H5.2C4 21 3 20 3 18.8z')+P('M14.6 10.6h7.2v5.4h-7.2a2.7 2.7 0 0 1 0-5.4z').replace('class="p"','class="a"')+circ('k',15.4,13.3,1.1)+KS('M3.6 7.8h13.6',1.2,';opacity:.5'))
add('budget','الميزانية','emerald',P('M11 3.1v9.9h9.9A9.9 9.9 0 1 1 11 3.1z')+A('M13.2 1.6a9.4 9.4 0 0 1 9.2 9.2h-9.2z'))
add('deliveries','قيد التسليم','teal',P('M10.6 2.4l7.6 3.8v8.7l-7.6 3.8L3 14.9V6.2z')+KS('M3.3 6.4l7.3 3.7 7.3-3.7M10.6 10.1v8.3',1.3,';opacity:.6')+badge(17.6,17.6,clock(17.6,17.6),4.6))
add('maintenance','الصيانة والتأمين','orange',P('M20.7 6.2l-3 3-2.6-.4-.4-2.6 3-3a5.3 5.3 0 0 0-6.7 6.6L3.6 17.2a2.2 2.2 0 1 0 3.1 3.1l7.4-7.4a5.3 5.3 0 0 0 6.6-6.7z')+circ('k',5.1,18.8,.95)+circ('ks',17.9,18.3,5.4,1.6)+A(gear(17.9,18.3,4.6,3.45))+circ('k',17.9,18.3,1.45))
# ── Air
add('fleet-air','الأسطول الجوي','sky',plane)
add('buy-air','شراء طائرات','green',buy(P(PLANE),.84,3.4,-.6))
add('route-air','الخطوط الجوية','blue',route())
add('tower','المطارات والقواعد','indigo',rect('a',11.2,1.2,1.6,3,.8)+P('M6.3 4.4h11.4l-1.1 1.8H7.4z')+A('M7.1 6.7h9.8l-1.5 4.3H8.6z')+KS('M10.4 7.2l-.5 3.4M13.6 7.2l.5 3.4',.9,';opacity:.8')+rect('p',8,11,8,1.6,.5)+P('M9.6 12.6h4.8l1.2 8H8.4z')+rect('k',11.2,14.6,1.6,3.4,.6)+rect('p',3.6,20,16.8,2,1))
add('contract-air','عقود الشحن الجوي','amber',doc(mini(P(PLANE),.4,7.2,6.6)))
add('pilot','الطواقم والأجور','purple',P('M3.4 21.2c0-4.1 3.7-6.9 8.6-6.9s8.6 2.8 8.6 6.9z')+K('M10.1 14.5L12 17.6l1.9-3.1z')+A('M4.9 17.4l3.3-1.6v1.7L5.2 19zM19.1 17.4l-3.3-1.6v1.7l3 1.5z')+circ('p',12,10.4,3.3)+P('M6.9 7.7c1-2.6 2.9-4.1 5.1-4.1s4.1 1.5 5.1 4.1z')+KS('M6.8 7.9h10.4',1.3)+A('M12 4.6l.7 1.1h-1.4z')+rect('a',10.8,5.5,2.4,1,.5))
# ── Sea
add('fleet-sea','الأسطول البحري','sky',ship)
add('buy-sea','شراء سفن','green',buy(ship,.78,5.2,-2.6))
add('route-sea','الخطوط البحرية','blue',route(PS('M2 22.2c1.3 0 1.3-1 2.6-1s1.3 1 2.6 1 1.3-1 2.6-1',1.4)))
add('port','الموانئ والقواعد','indigo',rect('p',2.4,4.6,19.6,2.4,.6)+rect('p',4.2,7,2.3,13.4,.4)+rect('p',12.2,7,2.3,13.4,.4)+KS('M5.4 8.6l7.9 7.9M13.3 8.6l-7.9 7.9',1.1,';opacity:.55')+rect('a',16.4,7,3.4,2.2,.5)+AS('M18.1 9.2v3.6',1.3)+rect('a',15.6,12.8,5,3.2,.6)+rect('p',2,20.2,20,1.8,.6)+rect('a',2.4,3.2,2.2,1.4,.4))
add('contract-sea','عقود الشحن البحري','amber',doc(mini(ship,.42,6.4,5.6)))
add('carbon','تصنيف الكربون CII','leaf',P('M6.8 13.6a4.6 4.6 0 0 1 .3-9.2 5.6 5.6 0 0 1 10.6 1.8 3.7 3.7 0 0 1-.5 7.4z')+rect('a',4,16.2,4.6,5.4,1)+rect('a',9.7,17.6,4.6,4,1)+rect('a',15.4,19,4.6,2.6,1)+KS('M9.4 9h3.6',1.4))
add('captain','الطواقم والأجور','purple',P('M3.4 21.2c0-4.1 3.7-6.9 8.6-6.9s8.6 2.8 8.6 6.9z')+K('M10.1 14.5L12 17.6l1.9-3.1z')+rect('a',5,17.2,3.2,1.4,.5)+rect('a',15.8,17.2,3.2,1.4,.5)+circ('p',12,10.6,3.2)+P('M5.6 7.4c.4-2.8 3-4.4 6.4-4.4s6 1.6 6.4 4.4z')+rect('a',5.6,7.2,12.8,1.5,.6)+circ('k',12,5.2,1.1))
# ── Road
add('fleet-road','الأسطول البري','sky',truck)
add('buy-road','شراء شاحنات','green',buy(truck,.8,4.6,-2.4))
add('route-road','المسارات البرية','blue',P('M9.4 3h5.2l5.8 18.4H3.6z')+rect('k',11.4,5.4,1.2,2.4,.6)+rect('k',11.3,9.6,1.4,3,.7)+rect('k',11.2,14.6,1.6,3.8,.8)+P(PIN).replace('class="p"','class="a"').replace('M18.7 1.8','M19.2 1.6')+'')
add('warehouse','المستودعات والمراكز','indigo',P('M1.8 9.4L12 3.2l10.2 6.2v1.8H1.8z')+rect('p',3.4,11,17.2,10.4,.6)+rect('a',7.6,13.2,8.8,8.2,.6)+KS('M7.8 15.6h8.4M7.8 18.2h8.4',1.1))
add('contract-road','عقود التوزيع','amber',doc(mini(truck,.42,6.2,5.8)))
add('driver','السائقون والأجور','purple',circ('ps',12,12,8.6,2.8)+P('M3.6 11.4h5.6l1.6 1.8v7.6c-3.4-.6-6.4-3.6-7.2-7.2zM20.4 11.4h-5.6l-1.6 1.8v7.6c3.4-.6 6.4-3.6 7.2-7.2z')+circ('a',12,12.6,2.4)+circ('k',12,12.6,.9))
# ── Mobility
add('fleet-car','سيارات التنقل','sky',car)
add('buy-car','شراء سيارات','green',buy(car,.8,4.8,-1.8))
add('route-city','خطوط المدن','blue',rect('p',2.6,2.6,7.8,7.8,1.6)+rect('p',13.6,2.6,7.8,7.8,1.6)+rect('p',2.6,13.6,7.8,7.8,1.6)+rect('p',13.6,13.6,7.8,7.8,1.6)+AS('M2.4 12h9.6V21.6',2.4)+circ('a',12,12,2.2)+circ('k',12,12,.9))
add('city-branch','فروع المدن','indigo',A('M3.4 3.4h17.2l1.6 5.4H1.8z')+KS('M7.6 3.6l-.8 5M12 3.6v5M16.4 3.6l.8 5',1.2,';opacity:.6')+rect('p',3.4,10.2,17.2,11.2,.6)+rect('k',5.6,12.4,6.2,5,.8)+rect('k',14,12.4,4.4,9,.6)+circ('p',15.2,16.8,.6))
# ── Power
add('solar','المحطات والمشاريع','gold',circ('a',18.6,4.6,3.1)+P('M4.6 8.6h12.8l3 8.8H1.6z')+KS('M8.9 8.8l-1.2 8.4M13.1 8.8l1.2 8.4M3.2 13h17.6',1.1)+rect('p',10.9,17.4,2.2,3,.4)+rect('p',6.8,20.2,10.4,1.8,.9))
add('energy-dash','لوحة الطاقة','navy',P('M2.6 16.2a9.4 9.4 0 0 1 18.8 0v2.2c0 .9-.7 1.6-1.6 1.6H4.2c-.9 0-1.6-.7-1.6-1.6z')+KS('M5.4 13.2l1.3.7M8.2 9.3l.8 1.2M15.8 9.3l-.8 1.2M18.6 13.2l-1.3.7',1.4)+A('M12.9 8.6l-4 5.9h2.6l-.8 4.3 4.2-6.2h-2.7z'))
add('grid','التشغيل والتوزيع','gold',PS('M12 2.6L7.4 21.4M12 2.6l4.6 18.8M9.6 12h4.8M8.6 16.4h6.8M10.4 8.2l3.6 3.6M13.6 8.2L10 11.8',1.8)+rect('p',4.4,5.6,15.2,1.8,.6)+rect('p',5.8,10,12.4,1.6,.6)+circ('a',4.8,8.6,1.2)+circ('a',19.2,8.6,1.2)+circ('a',6.2,12.8,1.1)+circ('a',17.8,12.8,1.1)+rect('p',4.6,20.6,14.8,1.6,.8))
add('contract-power','العقود والتمويل','amber',doc(K('M11.6 6.6l-3.4 5h2.3l-.7 3.8 3.6-5.3h-2.3z')))
add('revenue','الإيرادات','emerald',COINS+PS('M18 21V8.6',2.6)+PS('M14.4 11.8L18 8l3.6 3.8',2.6))
add('power-site','مواقع المحطات','indigo',P('M12 1.8a7.6 7.6 0 0 1 7.6 7.6c0 5.4-7.6 12.8-7.6 12.8S4.4 14.8 4.4 9.4A7.6 7.6 0 0 1 12 1.8z')+A('M13.1 4.8l-4 5.8h2.6l-.8 4.2 4.2-6.1h-2.6z'))
add('tender','المناقصات والعقود','amber',P('M9.6 5.4l4.1-4.1 6 6-4.1 4.1z')+P('M12 9.3l1.8 1.8-7.9 7.9a1.3 1.3 0 0 1-1.8-1.8z')+rect('a',12.4,19.6,9.4,2.2,.6)+rect('a',14,17.2,6.2,2.4,.6)+KS('M11.2 4l6 6',1.1,';opacity:.55'))
# ── Bank
add('credit','الائتمان والقروض','emerald',rect('p',2,5,20,14,2.4)+rect('k',2,8.4,20,2.6,0)+rect('a',4.6,13.2,4.6,3.4,.8)+rect('k',13.2,14.2,6,1.4,.7))
add('bank','لوحة البنك','navy',BANKB)
add('atm','الفروع والخدمات','indigo',rect('p',4.4,2.2,15.2,19.6,2.2)+rect('k',6.6,4.6,10.8,6.4,1)+A('M8.6 8.6l2-2 1.6 1.4 2.6-2.4')+''.join(circ('a',x,y,.9) for x in (8.6,12,15.4) for y in (14,16.8))+rect('k',8,19.2,8,1.2,.6))
add('liquidity','السيولة والمخاطر','red',P('M12 2.2s7.2 7.6 7.2 12.4a7.2 7.2 0 0 1-14.4 0C4.8 9.8 12 2.2 12 2.2z')+A('M5.1 14.5c2.3-1.4 4.6-1.4 6.9 0s4.6 1.4 6.9 0a6.9 6.9 0 0 1-13.8 0z')+KS('M8.6 12.4a3.6 3.6 0 0 1 1.6-3',1.2,';opacity:.6'))
# ── Insurance
add('umbrella','لوحة التأمين','navy',P('M12 3a9.6 9.6 0 0 1 9.6 9.4c-.9-.9-2.1-1.4-3.4-1.4-1.3 0-2.4.5-3.1 1.4-.7-.9-1.8-1.4-3.1-1.4s-2.4.5-3.1 1.4c-.7-.9-1.8-1.4-3.1-1.4-1.3 0-2.5.5-3.4 1.4A9.6 9.6 0 0 1 12 3z')+A('M12 3c-2.4 2.3-3.4 5.3-3.1 8.4-.7-.9-1.8-1.4-3.1-1.4-.6 0-1.2.1-1.7.3C5.4 6.4 8.5 3.4 12 3z')+rect('a',11.3,1.2,1.4,1.9,.7)+AS('M12 12.4v6.3a2.3 2.3 0 0 1-4.6 0',2.1))
add('pricing','المنتجات والتسعير','emerald',P('M2.8 12.4V4.2c0-.8.6-1.4 1.4-1.4h8.2c.4 0 .7.1 1 .4l8.1 8.1c.5.5.5 1.4 0 2l-8.2 8.2c-.5.5-1.4.5-2 0L3.2 13.4c-.3-.3-.4-.6-.4-1z')+circ('k',7.4,7.4,1.8)+AS('M10.6 15.4l5-5',1.8)+circ('a',11.4,11.4,1.1)+circ('a',14.8,14.6,1.1))
add('office','المكاتب','indigo',OFFICE)
add('claims','المطالبات','red',doc(LINES+rect('k',7.2,15.4,4,1.5,.75),True,KS('M16.6 15.9v2.2',1.6)+circ('k',16.6,19.7,.85)))
# ── Real estate
add('house','لوحة العقار','navy',P('M2.6 11.2L12 3.4l9.4 7.8v9.4c0 .6-.4 1-1 1H3.6c-.6 0-1-.4-1-1z')+rect('a',16.2,4.4,2.4,4.4,.5)+rect('k',9.8,14.2,4.4,7.4,.8)+rect('k',5.4,12.4,3,3,.6)+rect('k',15.6,12.4,3,3,.6)+circ('a',13.2,18,.6))
add('construction','المشاريع','gold',PS('M6.4 21.4V4.6',2.2)+rect('p',2.4,3.4,19.2,2.2,.6)+rect('a',2.4,5.6,3.2,2.6,.5)+AS('M16.6 5.6v4.8',1.3)+A('M15.2 10.4h2.8l-1.4 1.8z')+rect('a',11.2,13.6,9.6,7.8,.6)+KS('M11.2 16.2h9.6M11.2 18.8h9.6M14.4 13.6v7.8M17.6 13.6v7.8',1,';opacity:.7')+rect('p',2,20.6,20,1.6,.8))
add('develop','تطوير مشروع','gold',rect('p',2.6,3,15.6,15.6,1.6)+KS('M5.4 12.2l5-4.2 5 4.2V16h-10z',1.4)+KS('M5.4 6.2h3M2.6 8.6h1.6',1,';opacity:.5')+badge(18,18,plus(18,18),4.4))
# ── Telecom
add('sim','الاشتراكات والشرائح','sky',P('M6 2.4h8.6l4.6 4.6v14c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1V3.4c0-.6.4-1 1-1z')+rect('a',7.8,9.6,8.4,9,1.4)+KS('M12 9.8v8.6M7.9 14h8.2M10 9.8v2.4M14 16.2v2.2',1.1))
add('antenna','الشبكة والفروع','indigo',PS('M12 9.4v12M8 21.4L12 9.4l4 12M9.4 17.2h5.2',1.8)+circ('a',12,7.4,2.3)+PS('M7.2 3.4a6.4 6.4 0 0 0 0 8M16.8 3.4a6.4 6.4 0 0 1 0 8',1.8)+AS('M4.2 1.6a10 10 0 0 0 0 11.6M19.8 1.6a10 10 0 0 1 0 11.6',1.6))
add('datacenter','نظرة الشركة','slate',''.join(rect('p',3,y,18,5.4,1.4)+rect('k',5.4,y+2,6,1.4,.7)+circ('a',17.4,y+2.7,1.1)+circ('k',14.6,y+2.7,.8) for y in (2.4,9.3,16.2)))
# ── Dealership
add('car-sales','المخزون والمبيعات','green',g(car,.82,4.2,-1.6)+badge(6.2,17.6,KS('M4.1 16.1v2l2.6 2.6 2.4-2.4-2.6-2.6h-2z',1.2)+circ('k',5.3,17.2,.55),4.6))
add('car-service','خطط الخدمة والتمويل','orange',g(car,.82,4.2,-1.6)+badge(6.2,17.6,KS('M4.2 17.7l1.4 1.4 2.6-2.8',1.6),4.6))
add('showroom','المعارض والفروع','indigo',P('M2 9.2L12 3l10 6.2V21.4H2z')+rect('k',4.4,10.6,15.2,8.6,.8)+g(car,.56,5.3,8.4).replace('class="p"','class="a"')+rect('p',2,19.8,20,1.8,.6))
# ── Group section
add('performance','أداء الشركات','navy',rect('p',2.4,3,19.2,18,2)+KS('M5.4 16.6l4-4.6 3.4 2.6 5.8-6.4',1.8)+circ('a',9.4,12,1.4)+circ('a',12.8,14.6,1.4)+circ('a',18.6,8.2,1.6))
add('fleet-all','أسطول المجموعة','sky',g(ship,.86,1.7,4.6)+g(P(PLANE),.44,12.6,-.4).replace('class="p"','class="a"'))
add('directory','الدليل العالمي','teal',circ('p',10.2,10.2,8.2)+A('M6.4 5.6c1.4-.9 3.2-1.1 4.8-.5.4.8-.1 1.6-.8 1.9-.8.3-1.1 1-.7 1.7.5.8.2 1.8-.7 2.1-.8.3-1.1 1.3-.8 2.1-1.5-1-2.4-2.8-2.4-4.8 0-1 .3-1.8.6-2.5z')+circ('ks',10.2,10.2,8.2,0.01)+circ('ks',17,17,4.6,1.6)+circ('a',17,17,3.8)+circ('k',17,17,2.1)+AS('M19.8 19.8l2.4 2.4',2.4))
add('facilities','كل المنشآت','indigo',g(OFFICE,.86,-1,3.2)+P(PIN).replace('class="p"','class="a"')+circ('k',18.7,5.9,1.55))
add('charter','عقد التأسيس','amber',P(DOC)+K('M13.8 2.2v3.6c0 .6.4 1 1 1h3.6z','.5')+LINES+A('M14.2 19.4l-1.4 3.2 1.9-.7 1.1 1.6.9-3.6zM19 19.4l1.4 3.2-1.9-.7-1.1 1.6-.9-3.6z')+badge(16.6,17,K('M14.7 16.1l1 .8.9-1.5.9 1.5 1-.8-.4 2.1h-3z'),3.6))
# ── Finance section
add('treasury','الخزينة','emerald',rect('p',2.6,3.2,18.8,15.4,2.6)+circ('a',10.8,10.9,4.7)+KS('M10.8 7.4v7M7.3 10.9h7',1.4)+circ('p',10.8,10.9,1.5)+rect('a',17,7.6,1.9,6.6,.95)+rect('a',4.6,18.4,3.2,2.6,.8)+rect('a',16.2,18.4,3.2,2.6,.8))
add('monthly-income','الدخل الشهري','emerald',rect('p',2.4,4.2,17.2,16.4,2)+rect('k',2.4,8.4,17.2,1.2,0)+rect('a',6,2.2,1.9,4,.9)+rect('a',14.1,2.2,1.9,4,.9)+''.join(rect('k',x,y,2.2,2,.5) for x,y in ((5,11.6),(8.6,11.6),(12.2,11.6),(5,15),(8.6,15)))+badge(17.8,17.8,dollar(17.8,17.8),4.4))
add('documents','المستندات','amber',P('M8.6 1.8h7.8l4.2 4.2v11.6c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1z').replace('class="p"','class="a"')+P('M4.4 5.4h8l4.2 4.2v11.6c0 .6-.4 1-1 1H4.4c-.6 0-1-.4-1-1V6.4c0-.6.4-1 1-1z')+rect('k',5.8,12.4,7.6,1.5,.75)+rect('k',5.8,15.6,5.6,1.5,.75)+rect('k',5.8,18.6,7.6,1.5,.75))
add('markets','الأسواق والتحوط','emerald',PS('M6 2.4v19.2M12 4v16M18 2v12.4',1.4)+rect('p',3.8,6,4.4,9.4,1)+rect('a',9.8,9.4,4.4,7.6,1)+rect('p',15.8,4.4,4.4,6.6,1))
add('acquisitions','الاستحواذات','navy',g(GROUP,.82,-.6,2.6)+badge(18.2,6.4,plus(18.2,6.4),4.4))
add('stocks','الأسهم والطرح','emerald',''.join(rect('a',x,21-h,2.6,h,.6) for x,h in ((3,4),(7.2,6),(11.4,5),(15.6,8)))+PS('M2.8 13.6l5.6-5 4 3.2 7.8-8',2.6)+PS('M15.4 3.6h4.8v4.8',2.6))
# ── People section
add('people-dash','لوحة الأفراد','blue',rect('p',3,4.6,18,16.6,2.2)+rect('a',9.2,2,5.6,4.2,1.2)+circ('k',8.6,12,2.6)+KS('M4.8 18.6c.6-2 2-3 3.8-3s3.2 1 3.8 3',1.6)+rect('k',13.4,10.4,5.4,1.5,.75)+rect('k',13.4,13.6,3.8,1.5,.75))
add('executive','المديرون التنفيذيون','purple',person()+K('M10.6 14.3L12 15.8l1.4-1.5z')+A('M12 15.6l1.2 1.3-1.2 4.3-1.2-4.3z')+A('M18.4 2.2l.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.8-1.6.8.3-1.8-1.3-1.2 1.8-.3z'))
add('jobs','الوظائف','blue',P('M8.6 6V4.6c0-1 .8-1.8 1.8-1.8h3.2c1 0 1.8.8 1.8 1.8V6h-1.8V4.8h-3.2V6z')+rect('p',2.4,6.4,19.2,14,2.2)+rect('k',2.4,11.6,19.2,1.2,0)+rect('a',10.2,10.4,3.6,3.6,.8))
add('employment','عقود العمل','blue',doc(circ('k',10.4,9.2,2)+KS('M7 15.2c.5-1.8 1.8-2.8 3.4-2.8s2.9 1 3.4 2.8',1.5)))
add('crews','الأجور والطواقم','purple',person(10.6)+badge(18,17.6,dollar(18,17.6),4.4))
add('payroll','الرواتب','blue',A('M6.2 2.6h11.6c.6 0 1 .4 1 1v6.2L12 14.6 5.2 9.8V3.6c0-.6.4-1 1-1z')+circ('k',12,5.9,1.6)+P('M2.4 8.6c0-.9.7-1.6 1.6-1.6h.4l7.6 5.4 7.6-5.4h.4c.9 0 1.6.7 1.6 1.6v10.2c0 .9-.7 1.6-1.6 1.6H4c-.9 0-1.6-.7-1.6-1.6z')+KS('M3 19.6l6.3-5.3M21 19.6l-6.3-5.3',1.2,';opacity:.5'))
# ── Leadership section
add('tasks','المهام الآن','red',rect('p',3.6,3.6,16.8,18,2)+rect('a',8.2,1.8,7.6,3.6,1.2)+KS('M6.6 10.2l1.4 1.4 2.4-2.6M6.6 15.6l1.4 1.4 2.4-2.6',1.5)+rect('k',12.2,9.8,5.4,1.5,.75)+rect('k',12.2,15.2,5.4,1.5,.75))
add('safety','السلامة والأمن','purple',P('M12 2.1l8.1 3.1v6.4c0 4.9-3.4 8.9-8.1 10.4-4.7-1.5-8.1-5.5-8.1-10.4V5.2z')+A('M12 2.1l8.1 3.1v6.4c0 4.9-3.4 8.9-8.1 10.4z')+KS('M8.2 12.1l2.7 2.7 5.1-5.4',2.3))
add('conference','المؤتمر السنوي','purple',P('M6.4 11.2h11.2l-1.6 10.2H8z')+rect('a',4.6,9.4,14.8,2.4,.8)+AS('M12 9.4V5.6',1.6)+circ('a',12,4,2)+KS('M9.6 15h4.8',1.4)+rect('p',5.4,20.4,13.2,1.6,.8))
add('research','البحث والتطوير','teal',P('M9 2.4h6v1.8h-.8v5l5.4 9.2c.7 1.2-.2 2.8-1.6 2.8H6c-1.4 0-2.3-1.6-1.6-2.8l5.4-9.2v-5H9z')+A('M7.3 14h9.4l2.1 3.6c.4.7-.1 1.6-.9 1.6H6.1c-.8 0-1.3-.9-.9-1.6z')+circ('k',10.6,16.4,.9)+circ('k',13.6,17.4,.7)+circ('a',16.8,4.8,1.2)+circ('a',18.8,8,.8))
add('esg','الاستدامة','leaf',PS('M12 21.6V11',2)+P('M12 12.4C12 7.6 8.8 4.4 3.4 4.2c-.2 5.4 3 8.2 8.6 8.2z')+A('M12 15.2c0-4.8 3.2-8 8.6-8.2.2 5.4-3 8.2-8.6 8.2z')+KS('M5.8 6.6l5.4 5.2',1.1,';opacity:.55'))
add('relations','العلاقات التجارية','navy',PS('M12 12L5 5.2M12 12l7-6.8M12 12l-7 6.8M12 12l7 6.8',2.2)+circ('p',4.6,4.8,2.7)+circ('p',19.4,4.8,2.7)+circ('p',4.6,19.2,2.7)+circ('p',19.4,19.2,2.7)+circ('ks',12,12,5.2,1.6)+circ('a',12,12,4.4)+K('M9.8 14.6V10l2.2-1.4 2.2 1.4v4.6zM11.3 12.4h1.4v2.2h-1.4z'))
add('economy','السوق والاقتصاد','gold',rect('p',4.4,3,15.2,18.4,3.4)+rect('k',4.4,8,15.2,1.3,0)+rect('k',4.4,15,15.2,1.3,0)+A('M12 9.8s2.6 2.8 2.6 4.5a2.6 2.6 0 0 1-5.2 0c0-1.7 2.6-4.5 2.6-4.5z')+rect('a',9.6,1.6,4.8,1.8,.6))
add('news','الأخبار','slate',P('M3.4 3.4h14.2c.6 0 1 .4 1 1v15.2c0 1.1.9 2 2 2H5.4c-1.1 0-2-.9-2-2z')+A('M18.6 8.2h2.2c.5 0 .8.4.8.8v10.6c0 1.1-.9 2-2 2s-1-.9-1-2z')+rect('k',5.6,5.8,10.6,4.4,.8)+rect('k',5.6,12.2,10.6,1.4,.7)+rect('k',5.6,15.2,7.4,1.4,.7))
# ── System section
add('updates','التحديثات','slate',P('M6.6 17.6a4.6 4.6 0 0 1-.3-9.2 6 6 0 0 1 11.5 1.6 3.8 3.8 0 0 1-.3 7.6z')+AS('M12 10.2v10.6',2.4)+AS('M8.6 17.6L12 21l3.4-3.4',2.4))
add('diagnostics','صحة اللعبة','red',P('M12 21.2l-1.3-1.2C5.4 15.2 2 12.2 2 8.4 2 5.3 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3c3 0 5.4 2.3 5.4 5.4 0 3.8-3.4 6.8-8.7 11.6z')+KS('M3.6 11.4h4l1.6-3 2.4 6 2-4.2 1.2 1.2h5.6',1.6))
add('control-plane','مركز التحكم','slate',rect('p',2.4,3.4,19.2,17.2,2.4)+KS('M7 6.8v10.4M12 6.8v10.4M17 6.8v10.4',1.5,';opacity:.55')+rect('a',5.2,12.4,3.6,2.6,1)+rect('a',10.2,8,3.6,2.6,1)+rect('a',15.2,13.6,3.6,2.6,1))
# ── Generic operations pages (any company)
add('routes','الخطوط والمسارات','blue',route())
add('market','سوق الأصول','green',P('M3 8.6h18l-1.4 11.2c-.1.9-.9 1.6-1.8 1.6H6.2c-.9 0-1.7-.7-1.8-1.6z')+PS('M8 8.6V6.4a4 4 0 0 1 8 0v2.2',1.8)+badge(17.6,17.4,plus(17.6,17.4),4.2))
add('contracts','العقود','amber',doc(LINES))
add('asset','بطاقة الأصل','sky',rect('p',2.4,4,19.2,16,2.4)+g(P(PLANE),.42,3.4,6.8).replace('class="p"','class="a"')+rect('k',12.4,8.6,6.6,1.5,.75)+rect('k',12.4,11.8,4.6,1.5,.75)+rect('k',12.4,15,6.6,1.5,.75))
# ── Frame controls (drawn without a tile)
add('bell','التنبيهات','ctrl',P('M12 2.4a1.4 1.4 0 0 1 1.4 1.4v.5a6.4 6.4 0 0 1 5 6.3v4.2l1.8 2.6c.4.6 0 1.4-.8 1.4H4.6c-.8 0-1.2-.8-.8-1.4l1.8-2.6v-4.2a6.4 6.4 0 0 1 5-6.3v-.5A1.4 1.4 0 0 1 12 2.4z')+A('M9.4 19.6h5.2a2.6 2.6 0 0 1-5.2 0z'))
add('layers','طبقات الخريطة','ctrl',A('M12 11.6l9.4 4.6L12 20.8l-9.4-4.6z')+KS('M2.6 12.6l9.4 4.6 9.4-4.6',2.4)+P('M12 3.2l9.4 4.6L12 12.4 2.6 7.8z'))
add('ticker','شريط الأخبار','ctrl',P('M3.4 4.6h13.8c.6 0 1 .4 1 1v13c0 .9.7 1.6 1.6 1.6H5.2c-1 0-1.8-.8-1.8-1.8z')+A('M18.2 9h2.2c.5 0 .8.4.8.8v8.8c0 .9-.7 1.6-1.6 1.6s-1.4-.7-1.4-1.6z')+rect('k',5.6,7,9.8,3.8,.6)+rect('k',5.6,13,9.8,1.4,.7)+rect('k',5.6,15.8,6.6,1.4,.7))
add('close','إغلاق','ctrl',PS('M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6',2.6))
add('expand','فتح القسم بالكامل','ctrl',PS('M14.2 3.4h6.4v6.4M9.8 20.6H3.4v-6.4M20.4 3.6l-6.6 6.6M3.6 20.4l6.6-6.6',2.3))
add('collapse','تصغير القسم','ctrl',PS('M20.4 9.6H14.4V3.6M3.6 14.4h6v6M14.6 9.4l6-6M9.4 14.6l-6 6',2.3))
add('back','رجوع','ctrl',PS('M14.6 5l7 7-7 7M21.4 12H2.6',2.4))
add('add','إضافة','ctrl',PS('M12 4.6v14.8M4.6 12h14.8',2.6))
add('bolt','الطاقة','gold',P('M13.8 1.8L4.6 13.6h6.1l-1.5 8.6 10.2-12.4h-6.3z'))

# Real-object colours: (light top, dark bottom, middle tone for strokes).
GRAD={'navy':('#3A7FA8','#0D3B57','#1E5A80'),'gold':('#FFE59A','#D0951F','#E5B04A'),'ocean':('#6CC8F4','#1D6DB3','#3A95D3'),
'land':('#9BDB7E','#3A9550','#62B763'),'glass':('#9EDBFF','#2E7BC4','#5AA6E0'),'emerald':('#5EDDA6','#11845B','#2FAE7C'),
'ruby':('#FF8A80','#C0332A','#E05A50'),'steel':('#C9D5DF','#5E758A','#8FA2B3'),'steeldark':('#A9B8C5','#4E6273','#76899A'),
'paper':('#EEF3F7','#AEBDCA','#C9D4DD'),'cardboard':('#F6CF8E','#C4842F','#DEA65C'),'orange':('#FFB36B','#D9661F','#EE8A42'),
'leaf':('#A8E27A','#4C9A2A','#78BE4E'),'wood':('#D9A170','#7A4A26','#A86E42')}
# key: (p, a, k[, stroke colour for ps])
PALETTE={'map':('ocean','land','#fff'),'group':('navy','glass','#DDF3FF'),'finance':('emerald','gold','#fff'),'people':('navy','glass','#fff'),
'leadership':('gold','ruby','#fff'),'settings':('steeldark','gold','#fff'),'dashboard':('navy','gold','#fff'),'manage':('navy','gold','#fff'),
'company-finance':('emerald','gold','#fff'),'budget':('emerald','gold','#fff'),'deliveries':('cardboard','glass','#fff'),'maintenance':('steeldark','gold','#fff'),
'fleet-air':('steel','glass','#2E7BC4'),'buy-air':('steel','emerald','#fff'),'route-air':('ruby','gold','#fff','#3A95D3'),'tower':('steeldark','glass','#fff'),
'contract-air':('paper','ruby','#5B6E7C'),'pilot':('navy','gold','#fff'),'fleet-sea':('navy','orange','#fff'),'buy-sea':('navy','emerald','#fff'),
'route-sea':('ruby','gold','#fff','#3A95D3'),'port':('orange','glass','#fff'),'contract-sea':('paper','ruby','#5B6E7C'),'carbon':('steel','leaf','#fff'),
'captain':('navy','gold','#fff'),'fleet-road':('steel','ruby','#1E3242'),'buy-road':('steel','emerald','#1E3242'),'route-road':('steeldark','gold','#fff'),
'warehouse':('steeldark','gold','#fff'),'contract-road':('paper','ruby','#5B6E7C'),'driver':('navy','gold','#fff'),'fleet-car':('ruby','gold','#1E3242'),
'buy-car':('ruby','emerald','#1E3242'),'route-city':('steel','gold','#fff'),'city-branch':('steel','ruby','#2E7BC4'),'solar':('navy','gold','#9EDBFF'),
'energy-dash':('navy','gold','#fff'),'grid':('steeldark','gold','#fff'),'contract-power':('paper','ruby','#C48A1C'),'revenue':('emerald','gold','#B07A12'),
'power-site':('ruby','gold','#fff'),'tender':('wood','gold','#fff'),'credit':('glass','gold','#0D3B57'),'bank':('steel','gold','#fff'),
'atm':('steeldark','emerald','#9EDBFF'),'liquidity':('ocean','glass','#fff'),'umbrella':('ruby','gold','#fff'),'pricing':('emerald','gold','#fff'),
'office':('glass','gold','#EAF7FF'),'claims':('paper','ruby','#5B6E7C'),'house':('cardboard','ruby','#2E7BC4'),'construction':('steeldark','gold','#fff'),
'develop':('glass','gold','#fff'),'sim':('navy','gold','#8A6410'),'antenna':('steeldark','ruby','#fff'),'datacenter':('navy','emerald','#9EDBFF'),
'car-sales':('ruby','gold','#1E3242'),'car-service':('ruby','orange','#1E3242'),'showroom':('steel','ruby','#9EDBFF'),'performance':('navy','gold','#fff'),
'fleet-all':('navy','orange','#fff'),'directory':('ocean','gold','#fff'),'facilities':('glass','ruby','#fff'),'charter':('paper','gold','#5B6E7C'),
'treasury':('steeldark','gold','#fff'),'monthly-income':('paper','emerald','#5B6E7C'),'documents':('paper','gold','#5B6E7C'),'markets':('emerald','ruby','#fff'),
'acquisitions':('navy','glass','#fff'),'stocks':('emerald','gold','#fff'),'people-dash':('glass','gold','#fff'),'executive':('navy','gold','#fff'),
'jobs':('wood','gold','#5A3410'),'employment':('paper','glass','#5B6E7C'),'crews':('navy','gold','#fff'),'payroll':('paper','emerald','#5B6E7C'),
'tasks':('wood','steel','#fff'),'safety':('navy','glass','#fff'),'conference':('wood','steeldark','#fff'),'research':('glass','emerald','#fff'),
'esg':('leaf','emerald','#fff'),'relations':('navy','gold','#fff'),'economy':('navy','gold','#fff'),'news':('paper','steel','#5B6E7C'),
'updates':('glass','emerald','#fff'),'diagnostics':('ruby','gold','#fff'),'control-plane':('navy','gold','#9EDBFF'),'routes':('ruby','gold','#fff','#3A95D3'),
'market':('emerald','gold','#fff'),'contracts':('paper','ruby','#5B6E7C'),'asset':('glass','gold','#fff'),'bolt':('gold','gold','#fff')}

# ── Generation ─────────────────────────────────────────────────────────────
import re,json
from pathlib import Path
CAP=';stroke-linecap:round;stroke-linejoin:round'
CONTROL={'p':'#0D3B57','a':'#E7B556','k':'#FFFFFF'}
def styles_for(key):
    """Every icon carries its own colours: frame controls in MADAR navy and gold, options in their real colours."""
    if G[key][1]=='ctrl':
        p,a,k=CONTROL['p'],CONTROL['a'],CONTROL['k']
        return {'p':f'fill:{p}','a':f'fill:{a}','k':f'fill:{k}','ps':f'fill:none;stroke:{p};stroke-width:2'+CAP,'as':f'fill:none;stroke:{a};stroke-width:2'+CAP,'ks':f'fill:none;stroke:{k};stroke-width:2'+CAP}
    p,a,k,*rest=PALETTE[key];ps=rest[0] if rest else GRAD[p][2]
    return {'p':f'fill:url(#g{p})','a':f'fill:url(#g{a})','k':f'fill:{k}',
            'ps':f'fill:none;stroke:{ps};stroke-width:2'+CAP,'as':f'fill:none;stroke:{GRAD[a][2]};stroke-width:2'+CAP,'ks':f'fill:none;stroke:{k};stroke-width:2'+CAP}
TAG=re.compile(r'<(path|circle|rect)\b([^>]*?)/>')
def inline_styles(markup,style):
    def one(m):
        attrs=m.group(2);cls=re.search(r'\sclass="(\w+)"',attrs);style_attr=re.search(r'\sstyle="([^"]*)"',attrs)
        if not cls:raise ValueError(f'glyph element without a layer class: {m.group(0)[:80]}')
        attrs=re.sub(r'\s(class|style)="[^"]*"','',attrs)
        css=style[cls.group(1)]+(';'+style_attr.group(1).lstrip(';') if style_attr else '')
        return f'<{m.group(1)}{attrs} style="{css}"/>'
    out=TAG.sub(one,markup)
    if 'class="' in out:raise ValueError('unconverted class in glyph')
    return out
def num(markup):return re.sub(r'(\d+\.\d{3,})',lambda m:f'{float(m.group(1)):.2f}'.rstrip('0').rstrip('.'),markup)
def svg_for(key):
    """One self-contained SVG per icon (its gradients inside it)."""
    body=num(inline_styles(G[key][2],styles_for(key)))
    used=sorted(set(re.findall(r'url\(#g([a-z]+)\)',body)))
    defs=''.join(f'<linearGradient id="g{name}" x2="0" y2="1"><stop stop-color="{GRAD[name][0]}"/><stop offset="1" stop-color="{GRAD[name][1]}"/></linearGradient>' for name in used)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{"<defs>"+defs+"</defs>" if defs else ""}{body}</svg>'
def data_uri(svg):
    text=svg.replace('"',"'")
    for a,b in (('%','%25'),('#','%23'),('<','%3C'),('>','%3E'),('{','%7B'),('}','%7D')):text=text.replace(a,b)
    return 'data:image/svg+xml,'+text
def registry():
    labels={key:label for key,(label,_f,_m) in G.items()}
    return f'''/* Build 373 MADAR icon registry. Generated by tools/madar_icons.py: edit the tool, not this file.
   Each icon is a small self-contained SVG image in madar-icons.css (class ic-<key>): the browser rasterises it once
   and reuses it, and an icon is one empty element in the page, never a cloned drawing. tile(key) seats an option's
   icon on a soft glass tile (page cards, image badges, decisions); glyph(key) draws it bare (the rail, the page strip,
   list rows, frame controls). The catalogue and saves still carry emoji in their data; forAsset() maps them to icons
   for display only. */
(()=>{{'use strict';
const LABEL=Object.freeze({json.dumps(labels,ensure_ascii=False,separators=(',',':'))});
const EMOJI=Object.freeze({json.dumps(EMOJI,ensure_ascii=False,separators=(',',':'))});
const TYPE=Object.freeze({{air:'fleet-air',sea:'fleet-sea',road:'fleet-road',mobility:'fleet-car'}});
const known=key=>Object.prototype.hasOwnProperty.call(LABEL,key);
const pick=key=>known(key)?key:'group';
const classes=extra=>String(extra||'').replace(/[^a-z0-9 -]/gi,'').trim();
const mark=(base,key,extra)=>{{const id=pick(key),more=classes(extra);return `<span class="${{base}} ic-${{id}}${{more?` ${{more}}`:''}}" data-icon="${{id}}" aria-hidden="true"></span>`;}};
const glyph=(key,extra='')=>mark('mg',key,extra);
const tile=(key,extra='')=>mark('mi',key,extra);
function forAsset(icon,type){{return EMOJI[String(icon||'')]||TYPE[String(type||'')]||null;}}
function inline(icon,type,fallback='facilities'){{return glyph(forAsset(icon,type)||fallback,'mg-inline');}}
globalThis.GH_ICONS=Object.freeze({{VERSION:'373.3',LABEL,has:known,glyph,tile,forAsset,inline}});
}})();
'''
def stylesheet():
    rows='\n'.join(f'.ic-{key}{{--ic:url("{data_uri(svg_for(key))}")}}' for key in G)
    return f'''/* Build 373 MADAR icons. Generated by tools/madar_icons.py: edit the tool, not this file.
   Every icon is a cached SVG image (no DOM, no filters); the glass tile is one static gradient and one small shadow. */
.mi{{--mi-size:30px;position:relative;display:inline-block;flex:0 0 var(--mi-size);width:var(--mi-size);height:var(--mi-size);border-radius:calc(var(--mi-size) * .3);background:var(--ic) center/72% 72% no-repeat,linear-gradient(180deg,#FFFFFF,#E9EFF4);box-shadow:inset 0 0 0 1px rgba(16,35,49,.08),inset 0 1px 0 #FFFFFF,0 2px 5px rgba(16,35,49,.14);vertical-align:middle}}
.mg{{display:block;flex:0 0 auto;width:18px;height:18px;background:var(--ic) center/contain no-repeat}}
.mg-inline{{display:inline-block;width:18px;height:18px;margin-inline-end:6px;vertical-align:-4px}}
{rows}
'''
EMOJI={'✈️':'fleet-air','✈':'fleet-air','🚢':'fleet-sea','🛳️':'fleet-sea','🚛':'fleet-road','🚚':'fleet-road','🚙':'fleet-car','🚗':'fleet-car','🚕':'fleet-car',
'🚘':'fleet-car','🚖':'fleet-car','🚐':'fleet-car',
'⚡':'bolt','🏦':'bank','🏢':'office','🏛️':'group','⚓':'port','🛫':'tower','🛠️':'maintenance','🛠':'maintenance','🔧':'maintenance','🔩':'maintenance','👨‍✈️':'pilot','👩‍✈️':'pilot','🧑‍✈️':'captain'}
def main():
    root=Path(__file__).resolve().parent.parent;web=root/'WebApp'
    missing=[key for key,(_l,fam,_m) in G.items() if fam!='ctrl' and key not in PALETTE]
    if missing:raise SystemExit(f'icons without colours: {missing}')
    css=stylesheet();(web/'madar-icons.css').write_text(css,encoding='utf-8')
    (web/'madar-icons.js').write_text(registry(),encoding='utf-8')
    print(json.dumps({'icons':len(G),'css_bytes':len(css.encode())}))
if __name__=='__main__':main()

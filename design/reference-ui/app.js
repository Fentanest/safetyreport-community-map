/* Interactive layout reference only. All displayed data is synthetic. No credentials or raw plates. */
const paths={
 map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
 pin:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>',
 chevron:'<path d="m7 10 5 5 5-5"/>', filter:'<path d="M4 6h16M7 12h10m-7 6h4"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/>',
 reset:'<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>',share:'<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/>',
 document:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',pie:'<path d="M12 3v9h9M9 3.5a9 9 0 1 0 11.5 11.5"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
 building:'<path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-4 6v-3h2v3"/>',
 chart:'<path d="M3 3v18h18M7 16l4-5 4 2 5-7"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
 arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>'};
function icon(name){return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.info}</svg>`;}
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
const $=s=>document.querySelector(s);
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3300);}
let lastFocus=null;
function openDrawer(){lastFocus=document.activeElement;$('#drawer').hidden=false;$('#drawer-backdrop').hidden=false;$('#close-drawer').focus();}
function closeDrawer(){ $('#drawer').hidden=true;$('#drawer-backdrop').hidden=true;if(lastFocus)lastFocus.focus(); }
$('#theme').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;$('#theme').setAttribute('aria-label',next==='dark'?'라이트 모드로 전환':'다크 모드로 전환');try{localStorage.setItem('cm-reference-theme',next);}catch{};});
try {const stored=localStorage.getItem('cm-reference-theme');if(['dark','light'].includes(stored))document.documentElement.dataset.theme=stored;}catch{}
$('#filters').addEventListener('click',openDrawer);$('#period').addEventListener('click',openDrawer);$('#close-drawer').addEventListener('click',closeDrawer);$('#drawer-backdrop').addEventListener('click',closeDrawer);
$('#apply-filter').addEventListener('click',()=>{if($('#start').value>$('#end').value){toast('시작일은 종료일보다 늦을 수 없습니다.');return;}$('#scope-text').textContent=$('#region-select').value;closeDrawer();toast('UI 기준판: 조건 상태만 시연하며 통계는 합성 예시로 고정됩니다.');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeDrawer();document.body.classList.remove('briefing');}if(event.key==='Tab'&&!$('#drawer').hidden){const nodes=[...$('#drawer').querySelectorAll('button,input,select')];if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}});
$('#briefing').addEventListener('click',()=>{document.body.classList.toggle('briefing');window.dispatchEvent(new Event('resize'));});
$('#reset').addEventListener('click',()=>{document.querySelectorAll('[data-category]').forEach(e=>e.classList.toggle('selected',e.dataset.category==='전체'));$('#map-category').textContent='전체 분류';$('#scope-text').textContent='대한민국 전국';$('#detail-title').textContent='대한민국 전국';$('#detail-count').textContent='4,826';document.querySelectorAll('.map-point').forEach(e=>e.classList.remove('is-selected'));toast('전국 · 전체 분류로 되돌렸습니다.');});
document.querySelectorAll('[data-category]').forEach(e=>e.addEventListener('click',()=>{document.querySelectorAll('[data-category]').forEach(x=>x.classList.remove('selected'));e.classList.add('selected');$('#map-category').textContent=e.dataset.category;toast('선택 상태 시연입니다. 실제 통계 필터는 제품 구현에서 연결합니다.');}));
document.querySelectorAll('[data-map-metric]').forEach(e=>e.addEventListener('click',()=>{document.querySelectorAll('[data-map-metric]').forEach(x=>x.classList.remove('selected'));e.classList.add('selected');$('#legend').textContent=e.dataset.mapMetric;toast('지도 지표 선택 상태를 시연합니다.');}));
document.querySelectorAll('[data-section]').forEach(e=>e.addEventListener('click',()=>{document.querySelectorAll('[data-section]').forEach(x=>x.classList.remove('active'));e.classList.add('active');document.getElementById(e.dataset.section).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
$('#about').addEventListener('click',()=>toast('실데이터가 아닌 디자인 기준판입니다. 상세 데이터 기준은 docs/metrics-catalog.md를 읽어 주세요.'));
$('#share').addEventListener('click',()=>toast('제품에서는 기간·지역 필터만 URL에 보존합니다. 차량·계정정보는 포함하지 않습니다.'));
$('#apply-view').addEventListener('click',()=>{$('#scope-text').textContent='현재 지도 화면';toast('화면 범위 적용 상태 시연 · 실제 분석 범위 계산은 제품에서 연결합니다.');});
$('#fit').addEventListener('click',()=>$('#reset').click());$('#zoom-in').addEventListener('click',()=>toast('실제 확대/축소는 Kakao SDK 연결 후 동작합니다.'));$('#zoom-out').addEventListener('click',()=>toast('이 지도는 디자인 모형입니다.'));$('#detail-open').addEventListener('click',()=>{$('#entities').scrollIntoView();toast('선택 위치의 데이터는 실연동 시 재조회합니다.');});
const plotPoints=[['서울',37.5665,126.978,1500],['인천',37.4563,126.7052,480],['수원',37.2636,127.0286,690],['춘천',37.8813,127.7298,172],['대전',36.3504,127.3845,324],['청주',36.6424,127.489,232],['대구',35.8714,128.6014,398],['광주',35.1595,126.8526,274],['부산',35.1796,129.0756,402],['창원',35.2279,128.6811,186],['제주',33.4996,126.5312,156],['울릉',37.4845,130.9057,10],['독도',37.2411,131.864,2]];
// Label adjustments for this schematic only. Real product markers MUST retain exact projected lat/lng.
const offsets={서울:[-2,-4],인천:[-8,0],수원:[1,7],춘천:[3,-7],대전:[-2,5],청주:[3,-5],부산:[4,4],창원:[-2,6]};
for(const [name,lat,lng,count] of plotPoints){const el=document.createElement('button');el.className='map-point';el.setAttribute('aria-label',`${name} 합성 신고 ${count}건 선택`);const dx=offsets[name]?.[0]||0,dy=offsets[name]?.[1]||0;el.style.left=((lng-124.6)/(132.6-124.6)*100+dx)+'%';el.style.top=((39.2-lat)/(39.2-32.8)*100+dy)+'%';const size=25+Math.log10(count)*9;el.innerHTML=`<b style="width:${size}px;height:${size}px">${count.toLocaleString('ko-KR')}</b><small>${name}</small>`;el.addEventListener('click',()=>{document.querySelectorAll('.map-point').forEach(p=>p.classList.remove('is-selected'));el.classList.add('is-selected');$('#detail-title').textContent=name+' · 선택 미리보기';$('#detail-count').textContent=count.toLocaleString('ko-KR');toast(`${name} 지점 선택 상태를 시연합니다. 우측 비율은 레이아웃 예시입니다.`);});$('#plot').appendChild(el);}
const months=['1월','2월','3월','4월','5월','6월','7월','8월'],reports=[320,398,416,560,630,780,794,928],completed=[160,200,250,330,400,470,570,740];
// Use the rendered container width so SVG labels remain 12px on a 390px phone.
let graph='';
function drawTrend(){
 const host=$('#trend');if(host.dataset.table==='true')return;
 const W=Math.max(280,host.clientWidth-14),H=190,L=46,R=16,T=15,B=31;
 const innerW=W-L-R,baseline=H-B;
 const coords=a=>a.map((v,i)=>[L+i*(innerW/7),baseline-v/1000*(baseline-T)]);
 const path=a=>coords(a).map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ');
 graph=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1월부터 8월까지 신고 접수 320,398,416,560,630,780,794,928건; 처리완료 160,200,250,330,400,470,570,740건"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0D6EFD" stop-opacity=".22"/><stop offset="1" stop-color="#0D6EFD" stop-opacity="0"/></linearGradient></defs>`;
 const ticks=W<400?[0,500,1000]:[0,250,500,750,1000];
 ticks.forEach(v=>{const y=baseline-v/1000*(baseline-T);graph+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-dasharray="3 4"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="var(--muted)" font-size="12">${v.toLocaleString()}</text>`;});
 graph+=`<path d="${path(reports)} L${W-R} ${baseline} L${L} ${baseline} Z" fill="url(#area)"/><path d="${path(reports)}" fill="none" stroke="var(--brand)" stroke-width="2.5"/><path d="${path(completed)}" fill="none" stroke="var(--cyan)" stroke-width="2"/>`;
 for(let i=0;i<8;i++){const [x,y]=coords(reports)[i];graph+=`<circle cx="${x}" cy="${y}" r="3" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"/><text x="${x}" y="${H-8}" fill="var(--muted)" font-size="12" text-anchor="middle">${months[i]}</text>`;}
 graph+='</svg>';host.innerHTML=graph;
}
drawTrend();
new ResizeObserver(()=>drawTrend()).observe($('#trend'));
$('#chart-table').addEventListener('click',()=>{if($('#trend').dataset.table==='true'){$('#trend').dataset.table='false';drawTrend();}else{$('#trend').innerHTML='<div style="height:100%;overflow:auto"><table><thead><tr><th>월</th><th>신고 접수</th><th>처리완료</th></tr></thead><tbody>'+months.map((m,i)=>`<tr><td>${m}</td><td>${reports[i]}</td><td>${completed[i]}</td></tr>`).join('')+'</tbody></table></div>';$('#trend').dataset.table='true';}});
const vehicles=[['1*가*4*6',72],['1*3*4*67',56],['8*나*2*4',49],['1*가*4*6',28],['7*다*1*8',1]];
$('#vehicles').innerHTML=vehicles.map(([p,n],i)=>`<li><span class="rank">0${i+1}</span><code>${p}</code><b>${n}<small>건</small></b></li>`).join('');
const agencies=[['예시 중앙경찰서','기관별 관측 결과',980,620,120,180],['예시 한강경찰서','기관별 관측 결과',760,460,130,130],['예시 시청 교통과','기관별 관측 결과',730,350,80,140],['예시 동부경찰서','기관별 관측 결과',650,430,90,110]];
const managers=[['예시담당 가','예시 중앙경찰서',540,330,80,100],['예시담당 나','예시 한강경찰서',420,250,60,90],['예시담당 다','예시 동부경찰서',130,72,20,22],['예시담당 라','예시 시청 교통과',1,1,0,0]];
function renderEntities(mode){$('#entity-heading').textContent=mode==='agency'?'처리기관':'담당자 · 소속기관';const data=mode==='agency'?agencies:managers;$('#entity-body').innerHTML=data.map(([n,s,c,a,p,j])=>{const d=a+p+j;return `<tr><td><span class="table-name">${n}</span><small>${s}</small></td><td>${c.toLocaleString()}</td><td>${a.toLocaleString()}<small>${(a/d*100).toFixed(1)}%</small></td><td>${p}<small>${(p/d*100).toFixed(1)}%</small></td><td>${j}<small>${(j/d*100).toFixed(1)}%</small></td><td><div class="stack mini-stack"><i style="width:${a/d*100}%;background:var(--accepted)"></i><i style="width:${p/d*100}%;background:var(--partial)"></i><i style="width:${j/d*100}%;background:var(--rejected)"></i></div></td><td>${d===1?'<span class="sample-one">표본 1건</span>':d.toLocaleString()+'건'}</td></tr>`;}).join('');}
renderEntities('agency');document.querySelectorAll('[data-entity]').forEach(e=>e.addEventListener('click',()=>{document.querySelectorAll('[data-entity]').forEach(x=>x.classList.remove('selected'));e.classList.add('selected');renderEntities(e.dataset.entity);}));

import {AutoCommit} from './form-autosave.js?v=20261106-sheets2';
import {syncSheetInputs} from './sheet-sync.js?v=20261111-usage1';
import {installScrollBoundary} from './scroll-boundary.js?v=20261104-pullrefresh1';
import {htmlBuild,freshAppUrl,latestBuild} from './app-update.js?v=20261104-slide1';
import {installMenuSwipe} from './menu-swipe.js?v=20261104-swipeflow1';
import {weeklyClosureAtDate,closureReason} from './closure-history.js?v=20261104-closure1';
import {needsCompletion} from './booking-completion.js?v=20261104-start1';
import {nextDate,scheduleAtDate} from './schedule-history.js?v=20261104-history1';
import {tablesToData} from './domain.js?v=20261104-closure1';
import {studentCreditState,isLastLesson,creditTone} from './student-alerts.js?v=20261104-colors1';
import {GoogleStore} from './google-store.js?v=20261111-usage1';
import {orderedStudentGroups} from './student-order.js';
Academy.closed=closureReason;
installScrollBoundary(document,{
 canRefresh:()=>!!state.data&&!state.pending&&!menuAnimating&&!appReloading&&!dirtySettings.size&&navigator.onLine&&!document.querySelector('dialog[open]')&&!['shareEmail','joinLink'].some(id=>document.getElementById(id)?.value.trim()),
 onRefresh:()=>document.getElementById('refresh')?.click(),
 onRefreshHint:(ready,visible)=>{const hint=document.getElementById('pullRefreshNotice');if(hint){hint.hidden=!visible;hint.textContent=ready?'↻ 놓으면 새로고침':'↓ 아래로 더 당겨 새로고침';hint.classList.toggle('ready',ready);}},
 onPull:(offset,active)=>{
 const shell=document.getElementById('shell');if(!shell)return;
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 shell.style.transition=active||reduced?'none':'translate 190ms cubic-bezier(.2,.8,.2,1)';
 shell.style.translate=offset&&!reduced?'0 '+offset.toFixed(2)+'px':'';
}});
const backend=new GoogleStore();
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('ko-KR')+'원',today=()=>Academy.date(),uuid=()=>crypto.randomUUID();
const INVITE_WORKSPACE=new URL(location.href).searchParams.get("workspace")||"";
const APP_URL=location.origin+location.pathname;
const ACCOUNT_CHOOSER="https:"+"/"+"/accounts.google.com/AccountChooser?continue=";
const demo=['localhost','127.0.0.1'].includes(location.hostname)&&new URL(location.href).searchParams.has('preview');
const state={data:null,view:'calendar',month:today().slice(0,7),selected:today(),pending:0,editing:null,detailId:null,txStudent:null,txId:null,bookingId:null,closureDraft:null,scheduleDraft:null,timetableOnly:false};
let confirmedWrites=0;
let autoForms,sheetSyncRunning=false,sheetSyncTimer;
let toastTimer,preparedFileUrl=null,menuTransition=null,menuAnimation=null,menuGeneration=0,menuAnimating=false;
const dirtySettings=new Set(),runningBuild=htmlBuild(document.documentElement.outerHTML);
let updateAvailable=false,updateCheckPromise=null,lastUpdateCheck=0,appReloading=false;
let usageFetching=false;
function usageTime(seconds){return seconds?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(seconds*1000)):'아직 기록 없음';}
async function refreshUsageStatus(){
 if(demo||!backend.user||!backend.serverAuth.enabled||usageFetching)return;
 const epoch=backend.epoch,sub=backend.user.sub;usageFetching=true;$('refreshUsage').disabled=true;
 try{const result=await backend.usage.status();if(backend.epoch!==epoch||backend.user?.sub!==sub)return;
  $('usageAdminCard').hidden=!result.admin;if(!result.admin){$('usageAccounts').replaceChildren();return;}
  $('usageRecordingSince').textContent='기록 시작: '+usageTime(result.recordingSince)+' · 한국시간';
  $('usageAccounts').innerHTML=table(['계정','최근 접속','최근 저장 완료'],result.accounts.map(a=>[esc(a.email),esc(usageTime(a.lastVisit)),esc(usageTime(a.lastSaved))]));
  $('usageStatus').textContent='최근 확인: '+usageTime(Math.floor(Date.now()/1000));
 }catch(e){if(backend.epoch===epoch&&backend.user?.sub===sub)$('usageStatus').textContent='이용 기록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 finally{usageFetching=false;$('refreshUsage').disabled=false;}
}
$('refreshUsage').onclick=refreshUsageStatus;
window.addEventListener('online',()=>{if(backend.user&&!backend.authPreview)void backend.usage.flush();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&backend.user&&!demo&&!backend.authPreview)backend.usage.visit(backend.user.sub);});
function toast(msg,error=false){$('toast').textContent=msg;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?12000:4500);}
function setLoginLoading(loading,message='저장된 연결을 확인하고 있습니다.'){const panel=$('login');panel.classList.toggle('is-loading',loading);panel.setAttribute('aria-busy',String(loading));$('loginLoading').hidden=!loading;$('loginLoadingMessage').textContent=message;}
function clearPrivateView(){setLoginLoading(false);$('usageAdminCard').hidden=true;$('usageAccounts').replaceChildren();$('usageStatus').textContent='';menuGeneration++;menuTransition?.skipTransition();menuAnimation?.cancel();menuTransition=null;menuAnimation=null;menuAnimating=false;if(history.state?.subongQuick||history.state?.subongDetail){const restored={...history.state};delete restored.subongQuick;delete restored.subongDetail;history.replaceState(restored,'',location.href);}if(preparedFileUrl){URL.revokeObjectURL(preparedFileUrl);preparedFileUrl=null;}$('preparedDownload').removeAttribute('href');$('downloadInfo').textContent='';document.querySelectorAll('dialog').forEach(d=>d.close());state.data=null;state.detailId=null;state.closureDraft=null;state.scheduleDraft=null;$('shell').hidden=true;$('login').hidden=false;['calendarGrid','dayPanel','studentTable','studentDetail','studentQuickContent','stats','sharesTable'].forEach(id=>$(id).replaceChildren());document.querySelectorAll('form').forEach(f=>f.reset());}
async function request(action,data={},forcedWorkspaceId){if(demo)throw new Error('화면 미리보기입니다. 실제 저장은 구글 로그인 후 사용하세요.');const id=forcedWorkspaceId!==undefined?forcedWorkspaceId:state.data?.workspace?.id||backend.selected;try{const operation=backend.request(action,data,id);updateSyncNotice();const result=await operation;if(['saveStudent','addTransaction','book','changeBooking','saveClosures','saveSchedule','registerAndBook'].includes(action)){confirmedWrites++;const form={saveStudent:'studentForm',book:'bookingForm',saveClosures:'closureForm',saveSchedule:'scheduleForm',registerAndBook:data.student?'studentForm':'transactionForm'}[action];if(form)autoForms?.reset(form);}return result;}finally{if(['saveStudent','addTransaction','book','changeBooking','saveClosures','saveSchedule','registerAndBook'].includes(action)&&backend.latestTables&&backend.latestWorkspace===id&&state.data?.workspace?.id===id&&state.data.user.email===backend.user?.email){Object.assign(state.data,tablesToData(backend.latestTables));renderAllData();}}}
async function task(button,fn){if(button?.disabled)return;if(state.pending){toast('현재 작업이 끝난 뒤 다시 시도하세요.');return;}const form=button?.closest('form'),controls=form?[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]):[];controls.forEach(([el])=>el.disabled=true);if(button)button.disabled=true;state.pending++;$('saveState').textContent=' · 처리 중…';const began=performance.now(),writesBefore=confirmedWrites;try{await fn();$('saveState').textContent=` · ${confirmedWrites>writesBefore?'구글 저장 확인':'완료'} (${((performance.now()-began)/1000).toFixed(1)}초)`;}catch(e){$('saveState').textContent=' · 완료 여부 확인 필요';if(form)autoForms?.fail(form.id,e.message);toast(e.message,true);}finally{controls.forEach(([el,disabled])=>el.disabled=disabled);if(button)button.disabled=false;state.pending--;updateSyncNotice();maybeApplyUpdate();}}
function hasUnsent(){try{return !demo&&backend.unsent().length>0;}catch{return true;}}
function updateSyncNotice(){
 let rows;try{rows=demo?[]:backend.unsent();}catch(e){$('syncNotice').hidden=false;$('syncNoticeText').textContent=e.message;return;}$('syncNotice').hidden=!rows.length;
 if(rows.length){$('syncNoticeText').textContent=`구글 저장 미확인 ${rows.length}건 · 이 기기에 임시 보관 중입니다. 저장을 완료할 때까지 기기 저장소를 지우지 마세요.`;$('saveState').textContent=state.pending?' · 구글 저장 확인 중…':' · 구글 저장 대기';}
 $('retrySync').disabled=!!state.pending;
}
async function resumeUnsent(){
 if(backend.authPreview||demo||state.pending||!backend.user||!navigator.onLine||document.hidden||!hasUnsent())return;
 task($('retrySync'),async()=>{await load();if(!hasUnsent()){for(const id of ['studentDialog','transactionDialog','bookingDialog'])$(id).close();toast('중단됐던 내용을 구글 시트에 저장하고 확인했습니다.');}});
}
$('retrySync').onclick=resumeUnsent;
window.addEventListener('online',resumeUnsent);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumeUnsent();});
setInterval(resumeUnsent,30000);
async function load(workspaceId){if(!$('login').hidden)setLoginLoading(true,'내 학원 기록을 불러오고 있습니다.');try{const data=await request('load',{},workspaceId);state.data=data;state.scheduleDraft=null;state.closureDraft=null;$('grantFilePermission').hidden=true;render();$('login').hidden=true;$('shell').hidden=false;scheduleSheetSync();void refreshUsageStatus();}finally{setLoginLoading(false);checkAppUpdate({force:true});}}
function table(headers,rows){return rows.length?`<div class="tablewrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">아직 기록이 없습니다.</div>';}
function summary(s){return Academy.summary(s,state.data);}
function creditBadge(id){return studentCreditState(id,state.data).exhausted?'<span class="creditnotice">소진 · 재등록</span>':'';}
function lastBadge(b){return isLastLesson(b,state.data)?'<span class="lastlesson">마지막 수업</span>':'';}
function toneClass(id,booking){return creditTone(id,state.data,booking);}
function studentName(id){return state.data.students.find(s=>s.id===id)?.name||'보관된 수강생';}
function bookingsOn(date){return state.data.bookings.filter(b=>b.date===date).sort((a,b)=>a.time.localeCompare(b.time)||a.studentName.localeCompare(b.studentName));}
function renderStats(){const d=state.data,bs=d.bookings.filter(b=>b.date.startsWith(state.month)&&b.status!=='취소');$('stats').innerHTML=[['이번 달 예약',bs.length,'건'],['이번 달 수강완료',bs.filter(b=>b.status==='수강완료').length,'회']].map(([label,n,unit])=>`<div class="stat"><span>${label}</span><strong>${n}<small>${unit}</small></strong></div>`).join('');}
function renderCalendar(){
  const [y,m]=state.month.split('-').map(Number),first=new Date(y,m-1,1),start=new Date(y,m-1,1-first.getDay()),last=new Date(y,m,0),days=Math.ceil((first.getDay()+last.getDate())/7)*7;
  $('monthTitle').textContent=`${y}년 ${m}월`;const cells=[];
  for(let i=0;i<days;i++){const dt=new Date(start);dt.setDate(start.getDate()+i);const date=Academy.date(dt),closed=Academy.closed(date,state.data.closures),bs=bookingsOn(date).filter(b=>b.status!=='취소');const label=`${date}${closed?' '+closed+' 신규 예약 불가':''}, 예약 ${bs.length}건`;
    cells.push(`<button class="day${date.slice(0,7)!==state.month?' outside':''}${date===today()?' today':''}${date===state.selected?' selected':''}${closed?' closed':''}" data-day="${date}" aria-label="${esc(label)}" aria-pressed="${date===state.selected}"><span class="daytop"><span class="daynum">${dt.getDate()}</span>${closed?`<span class="closedlabel" title="${esc(closed)}">휴무</span>`:''}</span>${calendarDayContents(date,bs)}</button>`);
  }
  $('calendarGrid').style.setProperty('--calendar-rows',days/7);$('calendarGrid').innerHTML=cells.join('');$('calendarGrid').querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{if(state.pending){toast('처리가 끝난 뒤 날짜를 선택하세요.');return;}state.selected=b.dataset.day;if(state.selected.slice(0,7)!==state.month)state.month=state.selected.slice(0,7);renderCalendar();renderStats();updatePrint();showDaySchedule();});renderDay();requestAnimationFrame(fitCalendar);
}
function showDaySchedule(){if(state.pending)return;renderDay();$('dayDialogBody').append($('dayPanel'));document.body.classList.add('day-modal-open');if(!$('dayDialog').open)$('dayDialog').showModal();}
$('dayDialog').addEventListener('close',()=>{$('dayPanelHome').append($('dayPanel'));document.body.classList.remove('day-modal-open');});
function wireDetails(root){root.querySelectorAll('[data-detail]').forEach(b=>b.onclick=e=>{e.stopPropagation();openStudentQuick(b.dataset.detail,b.dataset.quickBooking);});}
function wireStatus(root){root.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{const booking=state.data.bookings.find(x=>x.id===b.dataset.booking);if(b.dataset.status==='취소'&&!confirm('예약·완료를 취소하고 1회를 복구할까요? 수강완료 집계에서도 제외하며 취소 기록은 보관됩니다.'))return;task(b,async()=>{const saved=await request('changeBooking',{id:booking.id,version:booking.version,status:b.dataset.status});state.data.bookings=state.data.bookings.filter(x=>x.id!==saved.id).concat(saved);renderAllData();toast('예약 상태를 저장했습니다.');});});}
function renderStudents(){
 $('activeStudentCount').textContent='재원 수강생 '+state.data.students.filter(s=>s.active).length+'명';
 const q=$('studentSearch').value.trim().toLowerCase(),groups=orderedStudentGroups(state.data.students,state.data.bookings,today(),q,$('showInactive').checked);
 $('studentCount').textContent=groups.reduce((n,g)=>n+g.students.length,0)+'명 표시';
 $('studentTable').innerHTML=groups.map(g=>`<section class="studentgroup"><div class="studentgrouphead"><h3>${g.title}</h3><span>${g.students.length}명</span></div><div class="studentrows">${g.students.map(s=>{const a=summary(s);return `<button type="button" class="studentrow" data-detail="${esc(s.id)}"><span class="studentrow-main"><span class="student-name">${esc(s.name)}</span><span class="studentrow-balance ${toneClass(s.id)}">잔여 <b>${a.remaining}회</b> ${creditBadge(s.id)}</span></span><span class="studentrow-meta">${s.phone?`<span>${esc(s.phone)}</span>`:''}<span>등록 ${esc(Academy.tenure(s.since,today()))}</span><span>누적 ${a.completed}회 · 납부 ${money(a.paid)}</span></span></button>`;}).join('')}</div></section>`).join('')||'<div class="empty">표시할 수강생이 없습니다.</div>';
 wireDetails($('studentTable'));
}
let viewedDay=today();
function refreshDayBoundary(){
 if(backend.authPreview)return;
 const next=today();if(next!==viewedDay){viewedDay=next;if(state.data)renderAllData();}
 if(!state.data||state.pending||document.hidden||!navigator.onLine||!state.data.bookings.some(b=>needsCompletion(b)))return;
 if(demo){state.data.bookings.forEach(b=>{if(needsCompletion(b))b.status='수강완료';});renderAllData();return;}
 if(backend.expires<=Date.now()||document.querySelector('dialog[open] form'))return;
 task(null,async()=>{Object.assign(state.data,await request('autoComplete'));renderAllData();});
}
setInterval(refreshDayBoundary,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDayBoundary();});window.addEventListener('online',refreshDayBoundary);
function renderSharing(){const w=state.data.workspace,owner=!!w?.ownedByMe;$('sharingOwnerInfo').textContent=!w?'먼저 내 구글 시트를 만들거나 공유 자료를 연결하세요.':owner?'기본 비공개입니다. 소유자인 본인만 공유 권한을 추가·해제할 수 있습니다.':`소유자: ${w.ownerEmail}. 공유받은 자료는 조회·관리·수정할 수 있으며 다시 공유할 수 없습니다.`;$('ownerShareControls').hidden=!owner;$('shareUrl').value=w?.shareUrl||'';if(INVITE_WORKSPACE&&INVITE_WORKSPACE!=='__ACADEMY_INVITE__'&&!$('joinLink').value)$('joinLink').value=APP_URL+'?workspace='+INVITE_WORKSPACE;renderShares();}
function renderShares(){const list=state.data.workspace?.permissions||[];$('sharesTable').innerHTML=table(['공유 계정','권한','관리'],list.map(p=>[esc(p.email||p.name||p.type),p.role==='writer'?'조회·수정':esc(p.role),p.type==='user'?`<button class="danger" data-unshare="${esc(p.id)}">공유 해제</button>`:'구글 시트에서 관리']));$('sharesTable').querySelectorAll('[data-unshare]').forEach(b=>b.onclick=()=>{if(!confirm('이 계정의 공유 권한을 해제할까요? 상대방이 이미 내려받은 복사본은 지워지지 않습니다.'))return;task(b,async()=>{const r=await request('revokeShare',{permissionId:b.dataset.unshare});state.data.workspace.permissions=r.permissions;renderShares();toast('공유 권한을 해제했습니다.');});});}
function renderWorkspace(){const d=state.data;$('workspaceSelect').innerHTML=d.workspaces.length?d.workspaces.map(w=>{const group=d.workspaces.filter(x=>x.own===w.own),label=(w.own?'내 학원':'공유 학원')+(group.length>1?' '+(group.findIndex(x=>x.id===w.id)+1):'');return `<option value="${esc(w.id)}" title="${esc(w.name)}">${label}</option>`;}).join(''):'<option value="">연결 중</option>';$('workspaceSelect').value=d.workspace?.id||'';$('createOwn').hidden=true;document.querySelector('.workspacebar').hidden=d.workspaces.length<=1;$('setupNotice').hidden=!d.needsSetup;$('workspaceSummary').textContent=d.workspace?`${d.workspace.name} · ${d.workspace.ownedByMe?'내 계정 소유':'소유자 '+d.workspace.ownerEmail}`:'로그인한 구글 계정의 저장 공간을 연결하고 있습니다.';$('switchAccountLink').onclick=()=>logout();}
function renderAllData(){renderStats();renderCalendar();renderStudents();const selectedPrintStudent=$('printStudent').value;$('printStudent').innerHTML=state.data.students.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');if(state.data.students.some(s=>s.id===selectedPrintStudent))$('printStudent').value=selectedPrintStudent;if(state.detailId&&$('detailDialog').open)renderDetail();if(state.quickId&&$('studentQuickDialog').open)renderStudentQuick();}
function render(){const d=state.data,admin=d.user.role==='admin';$('userName').textContent=d.user.email||d.user.name;document.querySelectorAll('.admin').forEach(el=>el.hidden=!admin);$('connection').textContent=demo?'화면 미리보기':`최근 불러옴 ${d.savedAt}`;if(d.databaseUrl){$('sheetLink').href=d.databaseUrl;$('xlsxLink').href=d.databaseUrl.replace(/\/edit.*$/,'/export?format=xlsx');}$('sheetLink').hidden=!d.databaseUrl;$('xlsxLink').hidden=!d.databaseUrl;renderAllData();renderWorkspace();renderSharing();if(!state.closureDraft)renderClosures();if(!state.scheduleDraft)renderSchedule();switchView(state.view);}
const pages={calendar:['예약 달력','예약과 남은 수업을 한눈에 확인해요.'],students:['수강생','납부부터 누적 수강까지, 한 사람의 기록을 이어가요.'],closures:['수업 · 휴무 설정','요일별 수업 타임과 쉬는 날을 정해요.'],backup:['데이터 보관','앱을 떠나도 기록은 내 손에 남도록.'],users:['공유 설정','내 자료는 비공개로, 선택한 계정하고만 함께 관리해요.']};
installMenuSwipe($('shell'),{
 canNavigate:()=>!!state.data&&!state.pending&&!(window.visualViewport?.scale>1.01)&&!document.querySelector('dialog[open]'),
 onNavigate:step=>{const menus=[...document.querySelectorAll('[data-view]')].filter(b=>!b.hidden&&!b.disabled),index=menus.findIndex(b=>b.dataset.view===state.view),next=menus[index+step];if(next){document.activeElement?.blur();next.click();}}
});
// Let a zoomed page pan freely; navigation gestures stay disabled while zoomed.
function syncSwipeTouchAction(){$('shell').style.touchAction=window.visualViewport?.scale>1.01?'auto':'';}
window.visualViewport?.addEventListener('resize',syncSwipeTouchAction);syncSwipeTouchAction();
function applyView(view){document.body.classList.toggle('calendar-mode',view==='calendar');if(['closures','backup','users'].includes(view)&&state.data.user.role!=='admin')view='calendar';state.view=view;if(view==='closures')void refreshUsageStatus();Object.keys(pages).forEach(v=>$(v+'View').hidden=v!==view);document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});$('pageTitle').textContent=pages[view][0];$('pageDesc').textContent=pages[view][1];requestAnimationFrame(fitCalendar);$('stats').hidden=view!=='calendar';$('topBook').hidden=view!=='calendar';updatePrint();}
function switchView(view){
 if(state.pending&&view!==state.view){toast('저장 완료 후 메뉴를 이동하세요.');return;}
 if(['closures','backup','users'].includes(view)&&state.data?.user.role!=='admin')view='calendar';
 if(view===state.view||!state.data||state.printReturn||matchMedia('(prefers-reduced-motion: reduce)').matches){applyView(view);return;}
 const previous=state.view,data=state.data,generation=++menuGeneration,forward=Object.keys(pages).indexOf(view)>Object.keys(pages).indexOf(previous),stage=$('pageStage');
 menuTransition?.skipTransition();menuAnimation?.cancel();menuAnimating=true;document.documentElement.dataset.menuDirection=forward?'forward':'back';
 const run=()=>{if(generation!==menuGeneration||state.data!==data)return;applyView(view);window.scrollTo(0,0);fitCalendar();};
 const done=()=>{if(generation!==menuGeneration)return;menuAnimating=false;menuTransition=null;menuAnimation=null;requestAnimationFrame(fitCalendar);};
 // Keep the actual page interactive throughout the animation. Native View
 // Transition snapshots can intercept a second touch before this page gets it.
 run();
 if(stage.animate){
  menuAnimation=stage.animate([{transform:`translateX(${forward?'+':'-'}18%)`,opacity:0.75},{transform:'translateX(0)',opacity:1}],{duration:220,easing:'cubic-bezier(.22,.7,.25,1)'});
  menuAnimation.finished.then(done,done);
 }else done();
}
function canReloadApp(){return !hasUnsent()&&!appReloading&&!state.pending&&!menuAnimating&&!document.querySelector('dialog[open]')&&!dirtySettings.size&&!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]),textarea,select');}
function reloadLatestApp({confirmed=false,allowPending=false}={}){
 if(!navigator.onLine){toast('인터넷 연결 후 업데이트하세요.',true);return false;}
 if(appReloading)return true;
 if(hasUnsent()||(state.pending&&!allowPending)){toast('저장 완료 후 업데이트하세요.');return false;}
 if(!confirmed&&(dirtySettings.size||document.querySelector('dialog[open] form'))&&!confirm('입력 중인 내용은 저장되지 않습니다. 앱을 업데이트할까요?'))return false;
 appReloading=true;location.replace(freshAppUrl(location.href));return true;
}
function maybeApplyUpdate(){
 if(!updateAvailable||!canReloadApp())return;
 const key='subong-update-attempt';try{const prior=JSON.parse(sessionStorage.getItem(key)||'null');if(prior?.build===updateAvailable&&Date.now()-prior.at<120000)return;sessionStorage.setItem(key,JSON.stringify({build:updateAvailable,at:Date.now()}));}catch{}
 reloadLatestApp();
}
async function checkAppUpdate({force=false,auto=true}={}){
 while(updateCheckPromise){if(!force)return false;await updateCheckPromise;}
 if(!navigator.onLine||(!force&&Date.now()-lastUpdateCheck<60000))return false;
 lastUpdateCheck=Date.now();
 const check=(async()=>{
  try{
   const latest=await latestBuild(location.href);if(!latest)return false;
   updateAvailable=latest!==runningBuild?latest:false;$('appUpdateNotice').hidden=!updateAvailable;requestAnimationFrame(fitCalendar);
   if(auto)maybeApplyUpdate();return !!updateAvailable;
  }catch{return false;}
 })();
 updateCheckPromise=check;try{return await check;}finally{if(updateCheckPromise===check)updateCheckPromise=null;}
}
for(const id of ['scheduleForm','closureForm'])for(const event of ['input','change'])$(id).addEventListener(event,()=>dirtySettings.add(id));
$('appVersionLabel').textContent=new URL(document.querySelector('script[type=module][src*="app.js"]').src).searchParams.get('v')||'현재 버전';
$('applyAppUpdate').onclick=()=>reloadLatestApp();$('reloadApplication').onclick=()=>reloadLatestApp();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAppUpdate();});window.addEventListener('online',()=>checkAppUpdate());setInterval(()=>checkAppUpdate(),300000);
function updatePrint(){$('printCaption').textContent=`${pages[state.view][0]} · ${state.month} · 조회 ${today()} · 잔여 횟수는 전체 확정 예약 차감 기준`;}
function openStudent(id){if(state.data.needsSetup){toast('내 자료를 먼저 만드세요.',true);return;}if(state.pending){toast('현재 작업이 끝난 뒤 등록하세요.');return;}const s=state.data.students.find(s=>s.id===id);state.editing={id:s?.id||uuid(),version:s?.version||0};$('studentFormTitle').textContent=s?'수강생 정보 수정':'수강생 등록';$('sName').value=s?.name||'';$('sPhone').value=s?.phone||'';$('sSince').value=s?.since||today();$('sActive').value=String(s?.active??true);$('sNote').value=s?.note||'';$('sPriorCount').value=s?.priorCount||0;$('sPriorPaid').value=s?.priorPaid||0;setupStudentEnrollment(!!s);autoForms?.reset('studentForm');$('studentDialog').showModal();}
function openTransaction(id){if(state.pending){toast('현재 작업이 끝난 뒤 등록하세요.');return;}state.txStudent=id;state.txId=uuid();$('txStudentName').textContent=studentName(id);$('transactionForm').reset();$('txDate').value=today();syncTxKind();setupBookingEnrollment('tJoin','transactionEnrollment');autoForms?.reset('transactionForm');$('transactionDialog').showModal();}
function syncTxKind(){const k=$('txKind').value;$('txCredits').disabled=k!=='정규권';$('txCredits').min=k==='추가납부'?'0':'1';$('txCredits').value=k==='1일클래스'?1:k==='추가납부'?0:10;}
function setupStudentEnrollment(editing){
 const root=$('studentEnrollment');root.hidden=editing;root.replaceChildren();$('studentForm').querySelector('button[type=submit]').textContent=editing?'저장':'등록하기';if(editing)return;
 state.enrollmentTxId=uuid();
 root.innerHTML='<section class="enrollment"><label class="enrollmentcheck"><input type="checkbox" id="sIncludePass" checked>수강권 · 납부 함께 등록</label><div id="sPayFields"><div class="formgrid"><label>수강권 종류<select id="sPayKind"><option>정규권</option><option>1일클래스</option></select></label><label>납부일<input id="sPayDate" type="date" required></label><label>충전 횟수<input id="sPayCredits" type="number" min="1" max="10000" step="1" value="10" required></label><label>납부금액 (원)<input id="sPayAmount" type="number" min="0" max="1000000000000" step="1" value="0" required></label><label class="wide">납부 메모<input id="sPayNote" maxlength="1000"></label></div><div id="sJoinRoot"></div></div><p class="muted">학생 정보만 등록하려면 체크를 해제하세요. 예약을 함께 확정하면 충전 횟수에서 1회 사용합니다.</p></section>';
 $('sPayDate').value=today();setupBookingEnrollment('sJoin','sJoinRoot');
 $('sIncludePass').onchange=()=>{const enabled=$('sIncludePass').checked;$('sPayFields').hidden=!enabled;$('sPayFields').querySelectorAll('input,select').forEach(e=>e.disabled=!enabled);if(enabled)syncStudentPass();};
 $('sPayKind').onchange=syncStudentPass;
 $('studentForm').querySelector('button[type=submit]').textContent='등록하기';
}
function syncStudentPass(){const one=$('sPayKind').value==='1일클래스';$('sPayCredits').disabled=one;$('sPayCredits').value=one?1:10;syncEnrollmentSlots('sJoin');}
function setupBookingEnrollment(prefix,rootId){
 state[prefix+'BookingId']=uuid();
 $(rootId).innerHTML=`<section class="enrollment"><label class="enrollmentcheck"><input type="checkbox" id="${prefix}Enabled">첫 예약도 함께 등록</label><div id="${prefix}Fields" hidden><div class="formgrid"><label>예약일<input id="${prefix}Date" type="date"></label><label class="wide">수업 타임<select id="${prefix}Slot"></select></label><label>시작 시간<select id="${prefix}Start"></select></label><label>종료 시간<select id="${prefix}End"></select></label><label class="wide">예약 메모<input id="${prefix}Note" maxlength="1000"></label></div><p class="muted" id="${prefix}Help"></p></div></section>`;
 $(prefix+'Date').value=state.selected;
 $(prefix+'Enabled').onchange=()=>syncEnrollmentSlots(prefix);
 $(prefix+'Date').onchange=()=>syncEnrollmentSlots(prefix);
 $(prefix+'Slot').onchange=()=>syncEnrollmentTimes(prefix);
 $(prefix+'Start').onchange=()=>syncEnrollmentEnds(prefix);
 syncEnrollmentSlots(prefix);
}
function enrollmentKind(prefix){return $(prefix==='sJoin'?'sPayKind':'txKind').value;}
function syncEnrollmentSlots(prefix){
 if(!$(prefix+'Enabled'))return;
 const extra=enrollmentKind(prefix)==='추가납부';$(prefix+'Enabled').disabled=extra;if(extra)$(prefix+'Enabled').checked=false;
 const enabled=$(prefix+'Enabled').checked&&!extra;$(prefix+'Fields').hidden=!enabled;
 $(prefix+'Fields').querySelectorAll('input,select').forEach(e=>{e.disabled=!enabled;});
 $(prefix+'Date').required=enabled;$(prefix+'Slot').required=enabled;
 const date=$(prefix+'Date').value,closed=date&&Academy.closed(date,state.data.closures),slots=date&&!closed?daySlots(date):[],previous=$(prefix+'Slot').value;
 $(prefix+'Slot').innerHTML=slots.map(s=>`<option value="${esc(s.id)}">${s.start}–${s.end}</option>`).join('')||'<option value="">예약 가능한 타임 없음</option>';
 if(slots.some(s=>s.id===previous))$(prefix+'Slot').value=previous;
 $(prefix+'Help').textContent=closed?'휴무일입니다. 다른 날짜를 선택하세요.':!slots.length?'해당 날짜의 수업시간이 없습니다. 설정에서 시간표를 확인하세요.':'등록과 예약이 함께 저장되며 예약 1회가 차감됩니다.';
 syncEnrollmentTimes(prefix);
}
function enrollmentSlot(prefix){return daySlots($(prefix+'Date').value).find(s=>s.id===$(prefix+'Slot').value);}
function syncEnrollmentTimes(prefix){
 const slot=enrollmentSlot(prefix),one=enrollmentKind(prefix)==='1일클래스',enabled=$(prefix+'Enabled').checked;
 $(prefix+'Start').innerHTML=slot?timeOptions(minutes(slot.start),minutes(slot.end)-30):'';$(prefix+'Start').value=slot?.start||'';
 $(prefix+'Start').disabled=!enabled||!one;
 syncEnrollmentEnds(prefix);
}
function syncEnrollmentEnds(prefix){
 const slot=enrollmentSlot(prefix),one=enrollmentKind(prefix)==='1일클래스';
 $(prefix+'End').innerHTML=slot?timeOptions(minutes($(prefix+'Start').value)+30,minutes(slot.end)):'';
 $(prefix+'End').value=slot?(one?clock(Math.min(minutes(slot.end),minutes($(prefix+'Start').value)+60)):slot.end):'';
 $(prefix+'End').disabled=!$(prefix+'Enabled').checked||!one;
}
function enrollmentBooking(prefix,transaction){
 if(!$(prefix+'Enabled').checked)return null;
 return {id:state[prefix+'BookingId'],studentId:transaction.studentId,passId:transaction.id,date:$(prefix+'Date').value,time:$(prefix+'Start').value,endTime:$(prefix+'End').value,note:$(prefix+'Note').value};
}
function confirmEnrollment(){return true;}
function finishEnrollment(studentId,booking){if(booking){state.selected=booking.date;state.month=booking.date.slice(0,7);}renderAllData();updatePrint();openStudentQuick(studentId,booking?.id);toast(booking?'수강 등록과 예약을 함께 저장했습니다.':'수강 등록을 저장했습니다.');}
function openDetail(id,fromQuick=false){state.detailId=id;renderDetail();if(!$('detailDialog').open){if(fromQuick)history.pushState({...history.state,subongDetail:quickHistoryKey},'',location.href);$('detailDialog').showModal();}}
const quickHistoryKey=uuid();
function openStudentQuick(id,bookingId){state.quickId=id;state.quickBookingId=bookingId||null;renderStudentQuick();if(!$('studentQuickDialog').open){history.pushState({...history.state,subongQuick:quickHistoryKey},'',location.href);$('studentQuickDialog').showModal();}}
window.addEventListener('popstate',()=>{if(state.pending){toast('저장 완료 후 닫으세요.');return;}if($('detailDialog').open&&history.state?.subongDetail!==quickHistoryKey)$('detailDialog').close();if($('studentQuickDialog').open&&history.state?.subongQuick!==quickHistoryKey)$('studentQuickDialog').close();});
for(const id of ['studentQuickDialog','detailDialog'])$(id).addEventListener('click',e=>{const d=$(id),r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)&&!state.pending)d.close();});
function renderStudentQuick(){
 const s=state.data.students.find(x=>x.id===state.quickId);if(!s)return;
 const a=summary(s),b=state.data.bookings.find(x=>x.id===state.quickBookingId&&x.studentId===s.id),tx=state.data.transactions.filter(x=>x.studentId===s.id).sort((x,y)=>y.date.localeCompare(x.date)||y.at.localeCompare(x.at))[0];
 $('studentQuickContent').innerHTML=`<div class="quickidentity"><h3 class="student-name">${esc(s.name)}</h3><span class="badge">${s.active?'재원':'기록 보관'}</span></div><div class="quickbalance ${toneClass(s.id,b)}">잔여 <strong>${a.remaining}</strong>회 ${creditBadge(s.id)} ${b?lastBadge(b):''}</div>${b?`<div class="quickbooking"><b>${esc(b.date)} · ${b.time}–${bookingEnd(b)}</b><div>${esc(b.kind)} · ${esc(b.status)}</div>${b.note?`<p>${esc(b.note)}</p>`:''}</div>`:''}<dl class="quickfacts"><div><dt>연락처</dt><dd>${esc(s.phone||'미등록')}</dd></div><div><dt>등록 기간</dt><dd>${esc(Academy.tenure(s.since,today()))}</dd></div><div><dt>최근 납부</dt><dd>${tx?esc(tx.date)+' · '+money(tx.amount):'납부 내역 없음'}</dd></div><div><dt>누적 수강</dt><dd>${a.completed}회</dd></div></dl>${s.note?`<p class="quicknote">${esc(s.note)}</p>`:''}<div class="quickactions">${s.active?'<button id="quickBook" class="primary">다음 예약</button>':''}<button id="quickPass">수강권 · 납부 / 예약</button>${b&&b.status!=='취소'?`<button class="danger" data-status="취소" data-booking="${esc(b.id)}">취소 · 1회 복구</button>`:''}</div><button id="quickFull" class="quickfull">자세히 보기</button>`;
 const id=s.id;if($('quickBook'))$('quickBook').onclick=()=>{if(state.pending)return;$('studentQuickDialog').close();openBooking(state.selected,id);};
 $('quickPass').onclick=()=>{if(state.pending)return;$('studentQuickDialog').close();openTransaction(id);};
 $('quickFull').onclick=()=>{if(state.pending)return;openDetail(id,true);};wireStatus($('studentQuickContent'));
}
function renderDetail(){const s=state.data.students.find(s=>s.id===state.detailId);if(!s)return;const a=summary(s),tx=state.data.transactions.filter(t=>t.studentId===s.id).slice().sort((x,y)=>y.date.localeCompare(x.date)||y.at.localeCompare(x.at)),bs=state.data.bookings.filter(b=>b.studentId===s.id).slice().sort((x,y)=>y.date.localeCompare(x.date)||y.time.localeCompare(x.time));const admin=state.data.user.role==='admin';$('studentDetail').innerHTML=`<h1 style="margin:22px 0 9px">${esc(s.name)} <span class="badge">${s.active?'재원':'퇴원'}</span></h1><div class="muted">${esc(s.phone||'연락처 미등록')} · 최초 등록 ${s.since} · ${esc(Academy.tenure(s.since,today()))}</div>${s.note?`<p class="muted wrap" style="max-width:none;margin-top:12px">${esc(s.note)}</p>`:''}<div class="detailstats">${[['현재 잔여','<span class="'+toneClass(s.id)+'">'+a.remaining+'회 '+creditBadge(s.id)+'</span>'],['누적 수강완료',a.completed+'회'],['누적 납부',money(a.paid)],['전체 차감',a.used+'회']].map(([l,v])=>`<div class="detailstat"><span>${l}</span><strong>${v}</strong></div>`).join('')}</div><p class="footnote">전체 차감 = 예약 + 수강완료. 누적 수강완료는 도입 전 이관값을 포함합니다. 누적 납부는 실제 납부액 합계입니다.</p><div class="tools noprint" style="margin-top:17px">${admin?'<button id="detailEdit">정보 수정</button><button id="detailTx" class="primary">+ 수강권 · 납부 / 예약</button>':''}${s.active?'<button id="detailBook">예약하기</button>':''}</div><section class="detailsection"><h3>수강권 · 납부 내역</h3>${table(['거래일','종류','충전','현재 잔여','납부금액','메모'],tx.map(t=>[t.date,esc(t.kind),t.credits+'회',t.credits?Academy.passRemaining(t.id,state.data)+'회':'—',money(t.amount),`<span class="wrap">${esc(t.note)}</span>`]))}</section><section class="detailsection"><h3>전체 예약 · 수강 기록</h3>${table(['날짜','시간','종류','상태','메모'],bs.map(b=>[b.date,b.time+'–'+bookingEnd(b),esc(b.kind),esc(b.status),`<span class="wrap">${esc(b.note)}</span>`]))}</section><p class="muted">도입 전 누적 수강 ${s.priorCount}회 / 도입 전 누적 납부 ${money(s.priorPaid)}</p>`;if(admin){$('detailEdit').onclick=()=>openStudent(s.id);$('detailTx').onclick=()=>openTransaction(s.id);}if(s.active)$('detailBook').onclick=()=>openBooking(state.selected,s.id);}
function renderClosures(preferredDate){dirtySettings.delete('closureForm');
 const c=state.data.closures,date=preferredDate||nextDate(today());state.closureDraft={...structuredClone(c),effectiveFrom:date};
 $('closureEffectiveFrom').min=today();$('closureEffectiveFrom').value=date;
 $('closureEffectiveFrom').onchange=()=>{state.closureDraft.effectiveFrom=$('closureEffectiveFrom').value;renderClosureWeekdays();};
 renderClosureWeekdays();renderRanges();
 const names=['일','월','화','수','목','금','토'];
 $('closureHistory').innerHTML=(c.history||[]).slice().sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||b.version-a.version).map(h=>`<div class="scheduleday"><b>${h.effectiveFrom==='0001-01-01'?'기존 설정':esc(h.effectiveFrom)+'부터'}</b><span>${h.weekdays.length?h.weekdays.map(d=>names[d]+'요일').join(' · '):'정기 휴무 없음'}</span></div>`).join('')||'<p class="muted">첫 변경 시 기존 정기 휴무도 이력으로 보관합니다.</p>';
}
function renderClosureWeekdays(){
 const days=weeklyClosureAtDate(state.data.closures,$('closureEffectiveFrom').value).weekdays;
 $('weekdayChecks').innerHTML=['일','월','화','수','목','금','토'].map((v,i)=>`<label title="${v}요일"><input type="checkbox" value="${i}" aria-label="${v}요일" ${days.includes(i)?'checked':''}>${v}</label>`).join('');
}
function renderRanges(){$('closureRanges').innerHTML=state.closureDraft.ranges.map(r=>`<div class="rangeline" data-range="${esc(r.id)}"><input type="date" aria-label="휴무 시작일" data-field="start" value="${r.start}" required><input type="date" aria-label="휴무 종료일" data-field="end" value="${r.end}" required><input aria-label="휴무 사유" data-field="reason" placeholder="예: 여름휴가" maxlength="80" value="${esc(r.reason)}"><button type="button" data-remove="${esc(r.id)}">삭제</button></div>`).join('');$('closureRanges').querySelectorAll('[data-field]').forEach(el=>el.oninput=()=>{const r=state.closureDraft.ranges.find(r=>r.id===el.closest('[data-range]').dataset.range);r[el.dataset.field]=el.value;});$('closureRanges').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{dirtySettings.add('closureForm');state.closureDraft.ranges=state.closureDraft.ranges.filter(r=>r.id!==b.dataset.remove);renderRanges();});}
function csvText(rows){const safe=v=>/^\s*[=+\-@]/.test(String(v))?"'"+v:String(v);return '\ufeff'+rows.map(row=>row.map(v=>'"'+safe(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');}
function download(name,text,type){if(preparedFileUrl)URL.revokeObjectURL(preparedFileUrl);const blob=new Blob([text],{type});preparedFileUrl=URL.createObjectURL(blob);$('preparedDownload').href=preparedFileUrl;$('preparedDownload').download=name;$('downloadInfo').textContent=name+' · '+Math.ceil(blob.size/1024).toLocaleString('ko-KR')+' KB';$('downloadDialog').showModal();}
function offlineHtml(x){const t=x.tables,d={students:t['수강생'].slice(1).filter(r=>r[0]).map(r=>({id:r[0],name:r[1],phone:r[2],since:r[3],active:r[5]==='재원',priorCount:Number(r[6]),priorPaid:Number(r[7])})),transactions:t['수강권납부'].slice(1).filter(r=>r[0]).map(r=>({id:r[0],studentId:r[1],credits:Number(r[5]),amount:Number(r[6])})),bookings:t['예약'].slice(1).filter(r=>r[0]).map(r=>({studentId:r[3],passId:r[5],status:r[7]}))};const plain=(heads,rows)=>table(heads,rows.map(r=>r.map(esc)));return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>수봉화실 · 오프라인 열람본</title><style>body{font:14px/1.7 sans-serif;padding:30px;color:#183c30}h1{margin-bottom:6px}h2{margin-top:35px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:9px;border:1px solid #ccd5c5;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#edf2e7}.tablewrap{overflow:auto}button{padding:12px;margin:15px 0}section{margin-bottom:30px}@media print{button{display:none}body{padding:0}thead{display:table-header-group}tr{break-inside:avoid}.tablewrap{overflow:visible}section{break-before:page}}@page{size:A4 landscape;margin:12mm}</style><h1>수봉화실 · 오프라인 열람본</h1><p>백업 시각: '+esc(x.exportedAt)+' (한국시간)<br>이 파일은 인터넷 없이 조회·인쇄할 수 있습니다. 백업 이후의 변경은 반영되지 않습니다.<br>브라우저 메뉴 → 인쇄 또는 Ctrl+P / ⌘P로 출력하세요. 연락처·납부 내역이 포함되므로 안전하게 보관하세요.</p><h2>전체 수강생 요약</h2>'+plain(['이름','연락처','최초등록일','등록기간(백업일 기준)','현재잔여','누적수강완료','누적납부','재원'],d.students.map(s=>{const a=Academy.summary(s,d);return [s.name,s.phone,s.since,Academy.tenure(s.since,x.exportedAt.slice(0,10)),a.remaining+'회',a.completed+'회',money(a.paid),s.active?'재원':'퇴원'];}))+Object.entries(t).map(([name,rows])=>'<section><h2>'+esc(name)+' · 전체 원본</h2>'+plain(rows[0],rows.slice(1).filter(r=>r[0]))+'</section>').join('')+'</html>';}
function clock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function minutes(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function bookingEnd(b){return b.endTime||clock(Math.min(1440,minutes(b.time)+(b.kind==='1일클래스'?60:120)));}
function daySlots(date){const day=new Date(date+'T00:00:00Z').getUTCDay();return scheduleAtDate(state.data.schedule,date).slots.filter(s=>s.day===day).sort((a,b)=>a.start.localeCompare(b.start));}
function inSlot(b,s){return b.time>=s.start&&bookingEnd(b)<=s.end;}
function calendarDayContents(date,bs){
  const slots=Academy.closed(date,state.data.closures)?[]:daySlots(date);
  if(slots.length){const extra=bs.filter(b=>!slots.some(s=>inSlot(b,s)));return `<span class="monthslots" style="--slot-count:${slots.length+(extra.length?1:0)}" aria-label="수업 ${slots.length}타임">`+slots.map((s,i)=>{const list=bs.filter(b=>inSlot(b,s)),names=list.length?list.map(b=>studentName(b.studentId)+' '+(state.data.students.find(x=>x.id===b.studentId)?summary(state.data.students.find(x=>x.id===b.studentId)).remaining:0)+'회'+(isLastLesson(b,state.data)?' · 마지막':'')).join(' · '):'예약 없음';return `<span class="slotchip ${list.length?'occupied':''}" title="${esc((i+1)+'타임 '+s.start+'–'+s.end+' · '+names)}"><span class="slottime">${s.start}<span class="slotend">–${s.end}</span></span><span class="slotnames">${list.length?list.map(b=>`<span><span class="student-name">${esc(studentName(b.studentId))}</span> <span class="${toneClass(b.studentId,b)}">${state.data.students.find(x=>x.id===b.studentId)?summary(state.data.students.find(x=>x.id===b.studentId)).remaining:0}회${isLastLesson(b,state.data)?' · 마지막':''}</span></span>`).join(' · '):esc(names)}</span></span>`;}).join('')+(extra.length?`<span class="more">별도 예약 ${extra.length}건</span>`:'')+`</span>`;}
  return bs.slice(0,2).map(b=>{const s=state.data.students.find(s=>s.id===b.studentId),r=s?summary(s).remaining:0;return `<span class="bookingchip${b.kind==='1일클래스'?' oneday':''}${b.status==='수강완료'?' done':''}"><span class="chipname student-name"><b>${esc(studentName(b.studentId))}</b></span><span class="chipbalance ${toneClass(b.studentId,b)}">${b.time} · 잔여 ${r}회 ${lastBadge(b)}</span></span>`;}).join('')+(bs.length>2?`<span class="more">+${bs.length-2}건</span>`:'');
}
function appointmentHtml(b){const s=state.data.students.find(s=>s.id===b.studentId),r=s?summary(s).remaining:0;return `<article class="appointment"><div class="appthead"><span>${b.time}–${bookingEnd(b)}${b.legacyTime?' · 기존 예약(종료 추정)':''}</span><span class="badge ${b.status==='취소'?'cancel':b.kind==='1일클래스'?'gold':''}">${esc(b.status==='예약'?b.kind:b.status)}</span>${lastBadge(b)}</div><div class="apptidentity"><button class="namebutton student-name" data-detail="${esc(b.studentId)}" data-quick-booking="${esc(b.id)}">${esc(studentName(b.studentId))}</button><span class="balance ${toneClass(b.studentId,b)}">잔여 <b>${r}</b>회 ${creditBadge(b.studentId)} ${lastBadge(b)}</span></div>${b.note?`<p class="muted wrap">${esc(b.note)}</p>`:''}${b.status!=='취소'?`<div class="apptactions noprint"><button class="danger" data-status="취소" data-booking="${esc(b.id)}">취소 · 1회 복구</button></div>`:'<div class="muted">취소됨 · 횟수 복구 완료</div>'}</article>`;}
function renderDay(){
 const date=state.selected,dt=new Date(date+'T12:00:00'),closed=Academy.closed(date,state.data.closures),all=bookingsOn(date),bs=all.filter(b=>b.status!=='취소'),slots=closed?[]:daySlots(date),extra=bs.filter(b=>!slots.some(s=>inSlot(b,s))),cancelled=all.filter(b=>b.status==='취소');
 $('dayDialogTitle').textContent=date+' 예약 현황';document.body.classList.toggle('timetable-mode',state.timetableOnly);$('calendarView').classList.toggle('timetable-only',state.timetableOnly);$('toggleTimetable').textContent=state.timetableOnly?'월 달력':'시간표';$('toggleTimetable').setAttribute('aria-pressed',String(state.timetableOnly));$('prevMonth').setAttribute('aria-label',state.timetableOnly?'이전 날':'이전 달');$('nextMonth').setAttribute('aria-label',state.timetableOnly?'다음 날':'다음 달');
 $('dayPanel').innerHTML=`<div class="daytitle"><div><p class="eyebrow">DAILY TIMETABLE</p><h2>${dt.getMonth()+1}월 ${dt.getDate()}일 <span class="muted">${['일','월','화','수','목','금','토'][dt.getDay()]}요일</span></h2><div class="muted">${closed?'휴무 · '+esc(closed):slots.length+'타임 · 예약 '+bs.length+'명'}</div></div><button id="dayBook" class="primary noprint" ${closed||state.data.needsSetup?'disabled':''}>+ 예약</button></div>${closed?'<div class="empty">휴무일 · 신규 예약 불가</div>':''}${slots.map((s,i)=>{const list=bs.filter(b=>inSlot(b,s));return `<section class="timeslot"><div class="timeslothead"><span><b>${i+1}타임</b> ${s.start}–${s.end}</span><button class="slotadd noprint" data-slot-book="${esc(s.id)}" aria-label="${s.start} 타임 예약 추가">+</button></div><div class="slotpeople">${list.length?list.map(b=>`<button type="button" class="slotperson" data-detail="${esc(b.studentId)}" data-quick-booking="${esc(b.id)}"><span class="student-name">${esc(studentName(b.studentId))}</span><small class="${toneClass(b.studentId,b)}">${b.time}–${bookingEnd(b)} ${isLastLesson(b,state.data)?'· 마지막 수업':''} · 잔여 ${state.data.students.find(s=>s.id===b.studentId)?summary(state.data.students.find(s=>s.id===b.studentId)).remaining:0}회</small></button>`).join(''):'<span class="muted">예약 없음</span>'}</div></section>`;}).join('')}${extra.length?`<section class="timeslot"><h3>${slots.length?'별도 시간 · 기존 예약':'예약 목록'}</h3>${extra.map(appointmentHtml).join('')}</section>`:''}${!slots.length&&!bs.length&&!closed?'<div class="empty">설정에서 요일별 수업 시간을 추가하세요.<br>기존 예약은 계속 확인할 수 있습니다.</div>':''}${cancelled.length?`<details class="cancelled"><summary>취소된 예약 ${cancelled.length}건</summary>${cancelled.map(appointmentHtml).join('')}</details>`:''}`;
 $('dayBook').onclick=()=>openBooking(date);$('dayPanel').querySelectorAll('[data-slot-book]').forEach(b=>b.onclick=()=>openBooking(date,undefined,b.dataset.slotBook));wireDetails($('dayPanel'));wireStatus($('dayPanel'));$('topBook').disabled=!!closed||!!state.data.needsSetup;
}
function timeOptions(start=0,end=1440){let out='';for(let n=start;n<=end;n+=30)out+=`<option value="${clock(n)}">${clock(n)}</option>`;return out;}
function renderSchedule(){dirtySettings.delete('scheduleForm');const d=state.data.schedule||{version:1,slots:[]},start=nextDate(today());$('scheduleEffectiveFrom').min=start;$('scheduleEffectiveFrom').value=start;state.scheduleDraft={version:d.version,effectiveFrom:start,slots:structuredClone(scheduleAtDate(d,start).slots)};$('scheduleEffectiveFrom').onchange=()=>{const date=$('scheduleEffectiveFrom').value;if(!date)return;state.scheduleDraft.effectiveFrom=date;state.scheduleDraft.slots=structuredClone(scheduleAtDate(d,date).slots);renderScheduleList();};$('scheduleHistory').innerHTML=(d.history||[]).filter(h=>h.effectiveFrom!=='0001-01-01').slice().reverse().map(h=>'<div class=scheduleday><b>'+esc(h.effectiveFrom)+'</b><span>'+h.slots.length+'타임 · 이 날짜부터 적용</span></div>').join('')||'<p class=muted>아직 변경 이력이 없습니다. 첫 변경 시 현재 시간표도 보존됩니다.</p>';$('scheduleDays').innerHTML=['일','월','화','수','목','금','토'].map((name,i)=>`<label><input type="checkbox" value="${i}">${name}</label>`).join('');$('allScheduleDays').checked=false;$('allScheduleDays').indeterminate=false;$('scheduleDays').querySelectorAll('input').forEach(el=>el.onchange=()=>{const n=$('scheduleDays').querySelectorAll('input:checked').length;$('allScheduleDays').checked=n===7;$('allScheduleDays').indeterminate=n>0&&n<7;});$('slotStart').innerHTML=timeOptions(0,1410);$('slotEnd').innerHTML=timeOptions(30,1440);$('slotStart').value='11:00';$('slotEnd').value='13:00';$('scheduleFeedback').textContent='';renderScheduleList();}
function renderScheduleList(){const slots=state.scheduleDraft.slots;$('scheduleList').innerHTML=['일','월','화','수','목','금','토'].map((name,day)=>{const list=slots.filter(s=>s.day===day).sort((a,b)=>a.start.localeCompare(b.start));return `<div class="scheduleday"><b>${name}요일</b><div style="--time-count:${Math.max(1,list.length)}">${list.length?list.map(s=>`<span class="schedulepill">${s.start}–${s.end}<button type="button" data-delete-slot="${esc(s.id)}" aria-label="${name}요일 ${s.start} 타임 삭제">×</button></span>`).join(''):'<span class="muted">수업 시간 없음</span>'}</div></div>`;}).join('');$('scheduleList').querySelectorAll('[data-delete-slot]').forEach(b=>b.onclick=()=>{dirtySettings.add('scheduleForm');state.scheduleDraft.slots=slots.filter(s=>s.id!==b.dataset.deleteSlot);renderScheduleList();$('scheduleFeedback').textContent='변경 후 수업 시간 저장을 눌러주세요.';});}
function addScheduleSlot(){const days=[...$('scheduleDays').querySelectorAll('input:checked')].map(el=>Number(el.value)),start=$('slotStart').value,end=$('slotEnd').value;if(!days.length){toast('적용할 요일을 선택하세요.',true);return;}if(start>=end){toast('종료 시간을 시작 시간 이후로 선택하세요.',true);return;}const slots=state.scheduleDraft.slots;if(days.some(day=>slots.some(s=>s.day===day&&s.start<end&&s.end>start))){toast('선택한 요일의 기존 타임과 시간이 겹칩니다.',true);return;}if(slots.length+days.length>168){toast('수업 시간은 전체 168개까지 등록할 수 있습니다.',true);return;}days.forEach(day=>slots.push({id:uuid(),day,start,end}));dirtySettings.add('scheduleForm');renderScheduleList();$('scheduleFeedback').textContent=days.length+'개 요일에 '+start+'–'+end+' 추가됨 · 저장 버튼을 눌러주세요.';}
function openBooking(date,id,slotId){if(state.pending)return;if(Academy.closed(date,state.data.closures)){toast('휴무일은 예약할 수 없습니다.',true);return;}state.bookingId=uuid();state.preferredSlot=slotId;$('bookingForm').reset();$('bDate').value=date;$('bStudent').innerHTML='<option value="">수강생을 선택하세요</option>'+state.data.students.filter(s=>s.active).map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · 잔여 ${summary(s).remaining}회</option>`).join('');if(id)$('bStudent').value=id;syncPasses();autoForms?.reset('bookingForm');$('bookingDialog').showModal();}
function syncPasses(){const id=$('bStudent').value,date=$('bDate').value,passes=state.data.transactions.filter(t=>t.studentId===id&&t.credits>0&&t.date<=date&&Academy.passRemaining(t.id,state.data)>0);$('bPass').innerHTML=passes.length?passes.map(t=>`<option value="${esc(t.id)}">${esc(t.kind)} · ${t.date} · 잔여 ${Academy.passRemaining(t.id,state.data)}회</option>`).join(''):'<option value="">사용 가능한 수강권 없음</option>';syncBookingTimes();}
function syncBookingTimes(){const slots=daySlots($('bDate').value),selected=$('bSlot').value;state.bookingSlots=slots;$('bSlot').innerHTML=slots.length?slots.map((s,i)=>`<option value="${esc(s.id)}">${i+1}타임 · ${s.start}–${s.end}</option>`).join(''):'<option value="">'+(scheduleAtDate(state.data.schedule,$('bDate').value).slots.length?'이 요일은 수업 시간이 없습니다':'시간표 미설정 · 직접 시간 선택')+'</option>';if(slots.some(s=>s.id===(state.preferredSlot||selected)))$('bSlot').value=state.preferredSlot||selected;state.preferredSlot=null;applyBookingSlot();}
function applyBookingSlot(){const s=state.bookingSlots.find(s=>s.id===$('bSlot').value),p=state.data.transactions.find(t=>t.id===$('bPass').value),oneday=p?.kind==='1일클래스';$('bTime').innerHTML=timeOptions(s?minutes(s.start):0,s?minutes(s.end)-30:1410);$('bTime').value=s?.start||'10:00';$('bTime').disabled=!!s&&!oneday;$('bEnd').innerHTML='';limitBookingEnds();$('bEnd').disabled=!!s&&!oneday;if(s&&!oneday)$('bEnd').value=s.end;validateBookingTime();}
function limitBookingEnds(){const s=state.bookingSlots.find(s=>s.id===$('bSlot').value),p=state.data.transactions.find(t=>t.id===$('bPass').value),start=minutes($('bTime').value||'10:00'),old=$('bEnd').value,max=s?minutes(s.end):1440;$('bEnd').innerHTML=timeOptions(start+30,max);const desired=clock(Math.min(max,start+(p?.kind==='1일클래스'?60:120)));$('bEnd').value=old>clock(start)&&old<=clock(max)?old:desired;}
function validateBookingTime(){const closed=Academy.closed($('bDate').value,state.data.closures),hasPass=!!$('bPass').value,noSlots=scheduleAtDate(state.data.schedule,$('bDate').value).slots.length&&!state.bookingSlots.length;const p=state.data.transactions.find(t=>t.id===$('bPass').value);$('bookingHelp').textContent=closed?'휴무일: '+closed:!$('bStudent').value?'수강생을 먼저 선택하세요.':!hasPass?'사용 가능한 수강권이 없습니다. 수강권을 먼저 등록하세요.':noSlots?'설정에서 이 요일의 수업 시간을 추가하세요.':p?.kind==='1일클래스'?'1일 클래스 · 타임 안에서 30분 단위로 시작·종료를 선택하세요. 예약 1건은 1회 차감됩니다.':'정규권 · 선택한 타임 전체 수강, 예약 1건은 1회 차감됩니다.';$('submitBooking').disabled=!!closed||!hasPass||!!noSlots||!$('bTime').value||!$('bEnd').value;}
function fitCalendar(){
 if(state.view!=='calendar'||state.timetableOnly||document.querySelector('dialog[open]'))return;
 const grid=$('calendarGrid'),top=grid.getBoundingClientRect().top+window.scrollY,foot=document.querySelector('.calendarfoot').getBoundingClientRect().height;
 const height=window.visualViewport?.height||window.innerHeight,bottom=parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom)||0;
 grid.style.height=Math.max(140,Math.floor(height-top-foot-bottom-3))+'px';
}
// 화면 이벤트
window.addEventListener('resize',()=>requestAnimationFrame(fitCalendar));
const calendarResize=new ResizeObserver(()=>requestAnimationFrame(fitCalendar));for(const e of document.querySelectorAll('.rail,.heading,#stats,.workspacebar,#appUpdateNotice'))calendarResize.observe(e);window.visualViewport?.addEventListener('resize',()=>requestAnimationFrame(fitCalendar));
$('toggleTimetable').onclick=()=>{state.timetableOnly=!state.timetableOnly;renderDay();};
$('allScheduleDays').onchange=()=>$('scheduleDays').querySelectorAll('input').forEach(el=>el.checked=$('allScheduleDays').checked);
$('addScheduleSlot').onclick=addScheduleSlot;
$('scheduleForm').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{state.data.schedule=await request('saveSchedule',state.scheduleDraft);state.scheduleDraft=null;renderSchedule();renderCalendar();toast('적용 시작일부터 새 시간표를 사용합니다. 이전 시간표와 등록된 예약은 보존됩니다.');});};
$('retryLoad').onclick=()=>task($('retryLoad'),async()=>{const button=$('retryLoad');button.textContent='구글 연결 중…';$('loginMessage').textContent='구글 계정 선택 후 기존 기록을 연결합니다. 처음 사용하는 계정은 저장 공간을 자동으로 준비합니다. 로그인 창이 보이지 않으면 팝업 차단 표시를 확인해 주세요.';try{await backend.signIn();$('loginMessage').textContent='내 학원 기록을 불러오고 있습니다…';await load();}catch(e){$('loginMessage').textContent=e.message;throw e;}finally{setLoginLoading(false);button.textContent='구글 로그인';}});$('returnOwn').onclick=()=>task($('returnOwn'),async()=>{const r=await request('selectOwnWorkspace');state.closureDraft=null;await load(r.id);});document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{switchView(b.dataset.view);if(b.dataset.view==='users'&&state.data.workspace?.ownedByMe)refreshShares();});
$('refresh').onclick=()=>{if(state.pending){toast('저장 완료 후 새로고침하세요.');return;}if(dirtySettings.size&&!confirm('저장하지 않은 설정을 버리고 다시 불러올까요?'))return;task($('refresh'),async()=>{if(await checkAppUpdate({force:true,auto:false})){reloadLatestApp({confirmed:true,allowPending:true});return;}await load();state.closureDraft=null;state.scheduleDraft=null;renderClosures();renderSchedule();toast('최신 기록을 불러왔습니다.');});};
function shiftMonth(delta){if(state.pending){toast('저장 완료 후 이동하세요.');return;}const [y,m]=state.month.split('-').map(Number);state.month=Academy.date(new Date(y,m-1+delta,1)).slice(0,7);state.selected=state.month+'-01';renderCalendar();renderStats();updatePrint();}
function moveCalendar(delta){if(!state.timetableOnly){shiftMonth(delta);return;}if(state.pending)return;const date=new Date(state.selected+'T12:00:00');date.setDate(date.getDate()+delta);state.selected=Academy.date(date);state.month=state.selected.slice(0,7);renderAllData();updatePrint();}$('prevMonth').onclick=()=>moveCalendar(-1);$('nextMonth').onclick=()=>moveCalendar(1);$('goToday').onclick=()=>{if(state.pending)return;state.selected=today();state.month=today().slice(0,7);renderAllData();updatePrint();};$('topBook').onclick=()=>openBooking(state.selected);
$('studentSearch').oninput=renderStudents;$('showInactive').onchange=renderStudents;$('addStudent').onclick=()=>openStudent();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(state.pending){toast('저장 완료 후 닫으세요.');return;}$(b.dataset.close).close();});document.querySelectorAll('dialog').forEach(d=>d.addEventListener('cancel',e=>{if(state.pending){e.preventDefault();toast('저장 완료 후 닫으세요.');}}));$('detailDialog').addEventListener('close',()=>{state.detailId=null;if(history.state?.subongDetail===quickHistoryKey)history.back();});$('studentQuickDialog').addEventListener('close',()=>{state.quickId=null;state.quickBookingId=null;if(history.state?.subongQuick===quickHistoryKey)history.back();});
$('studentForm').onsubmit=e=>{e.preventDefault();
 const student={...state.editing,name:$('sName').value,phone:$('sPhone').value,since:$('sSince').value,active:$('sActive').value==='true',note:$('sNote').value,priorCount:Number($('sPriorCount').value),priorPaid:Number($('sPriorPaid').value)};
 if(state.editing.version>0){task(e.submitter,async()=>{const saved=await request('saveStudent',student);state.data.students=state.data.students.filter(x=>x.id!==saved.id).concat(saved);$('studentDialog').close();renderAllData();toast('수강생 정보를 저장했습니다.');});return;}
 const transaction=$('sIncludePass').checked?{id:state.enrollmentTxId,studentId:student.id,date:$('sPayDate').value,kind:$('sPayKind').value,credits:Number($('sPayCredits').value),amount:Number($('sPayAmount').value),note:$('sPayNote').value}:null;
 const booking=transaction?enrollmentBooking('sJoin',transaction):null;
 if(!confirmEnrollment(transaction,booking))return;
 task(e.submitter,async()=>{await request('registerAndBook',{student,transaction,booking});$('studentDialog').close();finishEnrollment(student.id,booking);});
};
$('txKind').onchange=()=>{syncTxKind();syncEnrollmentSlots('tJoin');};
$('transactionForm').onsubmit=e=>{e.preventDefault();
 const transaction={id:state.txId,studentId:state.txStudent,date:$('txDate').value,kind:$('txKind').value,credits:Number($('txCredits').value),amount:Number($('txAmount').value),note:$('txNote').value};
 const booking=enrollmentBooking('tJoin',transaction);if(!confirmEnrollment(transaction,booking))return;
 task(e.submitter,async()=>{await request('registerAndBook',{transaction,booking});$('transactionDialog').close();finishEnrollment(transaction.studentId,booking);});
};
$('bStudent').onchange=syncPasses;$('bDate').onchange=syncPasses;$('bPass').onchange=syncBookingTimes;$('bSlot').onchange=applyBookingSlot;$('bTime').onchange=()=>{limitBookingEnds();validateBookingTime();};$('bEnd').onchange=validateBookingTime;$('bookingForm').addEventListener('input',()=>{state.bookingId=uuid();});$('bookingForm').addEventListener('change',()=>{state.bookingId=uuid();});
$('bookingForm').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{const b=await request('book',{id:state.bookingId,studentId:$('bStudent').value,passId:$('bPass').value,date:$('bDate').value,time:$('bTime').value,endTime:$('bEnd').value,note:$('bNote').value});state.data.bookings=state.data.bookings.filter(x=>x.id!==b.id).concat(b);state.selected=b.date;state.month=b.date.slice(0,7);$('bookingDialog').close();renderAllData();updatePrint();toast('예약을 저장하고 1회를 차감했습니다.');});};
$('addRange').onclick=()=>{if(state.closureDraft.ranges.length>=100){toast('기간 휴무는 100개까지 설정할 수 있습니다.',true);return;}dirtySettings.add('closureForm');state.closureDraft.ranges.push({id:uuid(),start:state.selected,end:state.selected,reason:''});renderRanges();};
$('closureForm').onsubmit=e=>{e.preventDefault();const d={version:state.closureDraft.version,effectiveFrom:$('closureEffectiveFrom').value,weekdays:[...$('weekdayChecks').querySelectorAll('input:checked')].map(x=>Number(x.value)),ranges:state.closureDraft.ranges};task(e.submitter,async()=>{state.data.closures=await request('saveClosures',d);state.closureDraft=null;renderClosures(d.effectiveFrom);renderCalendar();toast('휴무 설정을 저장했습니다.');});};
$('createOwn').onclick=()=>task($('createOwn'),async()=>{const r=await request('initialize');state.closureDraft=null;await load(r.id);toast('본인 계정 소유의 구글 시트를 만들었습니다.');});
$('workspaceSelect').onchange=()=>task($('workspaceSelect'),async()=>{const id=$('workspaceSelect').value;const r=await request('selectWorkspace',{id});state.closureDraft=null;state.detailId=null;await load(r.id);toast('자료를 전환했습니다.');});
$('joinForm').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{const r=await request('joinWorkspace',{link:$('joinLink').value});state.closureDraft=null;await load(r.id);toast('공유받은 자료를 연결했습니다.');});};
$('shareForm').onsubmit=e=>{e.preventDefault();const email=$('shareEmail').value.trim();if(!confirm(email+' 계정에 이 자료 전체의 조회·수정 권한을 허용할까요?'))return;task(e.submitter,async()=>{const r=await request('shareWorkspace',{email,confirm:$('shareConfirm').checked});state.data.workspace.permissions=r.permissions;$('shareEmail').value='';$('shareConfirm').checked=false;renderShares();toast('지정한 구글 계정에 공유했습니다. 공유 주소를 직접 전달하세요.');});};
async function refreshShares(){if(!state.data.workspace?.ownedByMe)return;const id=state.data.workspace.id;try{const r=await request('listShares');if(state.data?.workspace?.id!==id)return;state.data.workspace.permissions=r.permissions;renderShares();}catch(e){toast(e.message,true);}}
$('refreshShares').onclick=refreshShares;
document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>task(b,async()=>{const x=await request('export');download(b.dataset.export+'_'+today()+'.csv',csvText(x.tables[b.dataset.export]),'text/csv;charset=utf-8');toast('전체 기간 CSV가 준비됐습니다. 파일 저장을 눌러주세요.');}));
$('xlsxLink').onclick=e=>{e.preventDefault();task($('xlsxLink'),async()=>{const bytes=await request('exportXlsx');download('수봉화실_전체기록_'+today()+'.xlsx',bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');toast('전체 기록을 확인한 엑셀입니다. 파일 저장을 눌러주세요.');});};
$('exportJson').onclick=()=>task($('exportJson'),async()=>{const x=await request('export');download('수봉화실_전체_'+today()+'.json',JSON.stringify(x,null,2),'application/json;charset=utf-8');toast('전체 JSON 백업이 준비됐습니다. 파일 저장을 눌러주세요.');});
$('exportHtml').onclick=()=>task($('exportHtml'),async()=>{const x=await request('export');download('수봉화실_오프라인_'+today()+'.html',offlineHtml(x),'text/html;charset=utf-8');toast('오프라인 열람본이 준비됐습니다. 파일 저장 후 PC에서도 열 수 있어요.');});
$('printScope').onchange=()=>{const detail=$('printScope').value==='student';$('printStudent').hidden=!detail;$('printStudentLabel').hidden=!detail;};
$('print').onclick=()=>{if(state.pending){toast('저장 완료 후 인쇄하세요.');return;}const scope=$('printScope').value;if(scope==='student'&&!$('printStudent').value){toast('등록된 수강생이 없습니다.',true);return;}state.printReturn={view:state.view,timetableOnly:state.timetableOnly};if(scope==='student'){openDetail($('printStudent').value);document.body.classList.add('printingdetail');$('detailDialog').classList.add('printdetail');}else{state.timetableOnly=scope==='timetable';switchView(scope==='students'?'students':'calendar');renderDay();}requestAnimationFrame(()=>window.print());};
window.addEventListener('afterprint',()=>{document.body.classList.remove('printingdetail');$('detailDialog').classList.remove('printdetail');if(state.printReturn){$('detailDialog').close();state.timetableOnly=state.printReturn.timetableOnly;switchView(state.printReturn.view);renderDay();state.printReturn=null;}});
function logout(){if(state.pending||hasUnsent()){toast('저장 완료 후 계정을 전환하세요.');return;}$('currentAccountText').textContent='현재 로그인 · '+(state.data?.user.email||'로그인하지 않음');$('copyAppUrl').value=APP_URL;$('accountDialog').showModal();}
backend.onSignOut=()=>{if(state.data)clearPrivateView();};
$('chooseGoogleAccount').onclick=()=>task($('chooseGoogleAccount'),async()=>{if(hasUnsent())throw new Error('구글 저장을 먼저 완료한 뒤 계정을 전환하세요.');await backend.signIn();$('accountDialog').close();await load();});
$('disconnectGoogle').onclick=()=>{if(state.pending||hasUnsent()){toast('구글 저장을 마친 후 로그아웃하세요.',true);return;}backend.disconnect();clearPrivateView();$('accountDialog').close();$('loginMessage').textContent='이 기기에서 로그아웃했습니다. 다시 로그인해 자료를 연결하세요.';};
$('connectExisting').onclick=()=>task($('connectExisting'),async()=>{const r=await backend.connectFile();if(r){await load(r.id);toast('본인 계정에 자료를 연결했습니다.');}});
$('logout').onclick=logout;$('railLogout').onclick=logout;window.addEventListener('beforeunload',e=>{if(state.pending||hasUnsent()||dirtySettings.size){e.preventDefault();e.returnValue='';}});window.addEventListener('offline',()=>{$('connection').textContent='연결 끊김 · 저장에는 인터넷이 필요합니다';toast('인터넷 연결이 끊겼습니다. 저장 완료 메시지를 꼭 확인하세요.',true);});
// 로컬 파일로 열 때만 읽기 전용 예시를 표시합니다. 실제 저장소와 연결하지 않습니다.

function scheduleSheetSync(){clearTimeout(sheetSyncTimer);if(demo||backend.authPreview)return;sheetSyncTimer=setTimeout(checkSheetInputs,500);}
async function checkSheetInputs(){
 if(demo||backend.authPreview||!state.data?.workspace||!backend.user||document.hidden||!navigator.onLine)return;
 if(state.pending||sheetSyncRunning||document.querySelector('dialog[open]')||dirtySettings.size){sheetSyncTimer=setTimeout(checkSheetInputs,3000);return;}
 const id=state.data.workspace.id,epoch=backend.epoch;sheetSyncRunning=true;
 try{const result=await syncSheetInputs(backend,id);if(backend.epoch!==epoch||state.data?.workspace?.id!==id)return;
  $('sheetInputStatus').textContent=result.errors?`시트 입력 ${result.errors}행 확인 필요 · 원본 시트의 반영메시지를 확인하세요.`:'시트 직접 입력도 연결되어 있습니다. 앱을 열거나 새로고침하면 반영합니다.';
  if(result.changed){if(!state.pending&&!document.querySelector('dialog[open]')&&!dirtySettings.size){state.data=await backend.load(id);render();toast('구글 시트에서 작성한 내용을 반영했습니다.');}else toast('시트 입력을 저장했습니다. 현재 입력이 끝나면 새로고침해 주세요.');}
 }catch(e){$('sheetInputStatus').textContent='시트 입력 연결 확인 필요 · '+e.message;}finally{sheetSyncRunning=false;}
}
const autoFormIds=['studentForm','transactionForm','bookingForm','scheduleForm','closureForm'];
function autoReady(id,touched){
 const f=$(id);if(demo||backend.authPreview||!backend.user||!state.data||f.closest('dialog')&&!f.closest('dialog').open||!f.checkValidity())return false;
 if(id==='studentForm'&&!state.editing?.version&&$('sIncludePass')?.checked&&!touched.has('sPayAmount'))return false;
 if(id==='transactionForm'&&!touched.has('txAmount'))return false;
 if(id==='scheduleForm'){const d=state.scheduleDraft;if(!d||JSON.stringify(d.slots)===JSON.stringify(scheduleAtDate(state.data.schedule,d.effectiveFrom).slots))return false;}
 if(id==='closureForm'&&!state.closureDraft)return false;
 return true;
}
autoForms=new AutoCommit({ready:autoReady,busy:()=>!!state.pending||sheetSyncRunning,submit:id=>{const f=$(id),button=f.querySelector('button.primary');if(button&&!button.disabled)f.requestSubmit(button);},onState:(id,message)=>{const notice=$(id).querySelector('[data-auto-save]');if(notice)notice.textContent=message||'입력을 마친 뒤 4초 후 자동 확정 · 홈 이동 시 전송 · 미완료는 재연결 시 재시도';}});
for(const id of autoFormIds){const form=$(id),note=document.createElement('p');note.className='muted';note.dataset.autoSave='';note.setAttribute('role','status');note.textContent='입력을 마친 뒤 4초 후 자동 확정 · 홈 이동 시 전송 · 미완료는 재연결 시 재시도';form.insertBefore(note,form.querySelector('.actions'));
 const changed=e=>{if(e.isTrusted&&['input','select','textarea'].includes(e.target.tagName?.toLowerCase()))autoForms.change(id,e.target.id||e.target.dataset.field);};
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 form.addEventListener('compositionstart',()=>autoForms.composition(id,true));form.addEventListener('compositionend',()=>autoForms.composition(id,false));
 form.addEventListener('focusout',e=>{if(['sPayAmount','txAmount'].includes(e.target.id))autoForms.change(id,e.target.id);});
 form.addEventListener('submit',()=>autoForms.stop(id),true);
 form.addEventListener('click',e=>{if(e.target.closest('[data-delete-slot],[data-remove],#addScheduleSlot,#addRange'))queueMicrotask(()=>autoForms.change(id));});
 form.closest('dialog')?.addEventListener('close',()=>autoForms.reset(id));
}
function finishBeforeBackground(){if(backend.authPreview||demo)return;autoForms.flush();try{backend.backgroundFlush();}catch(e){$('syncNoticeText').textContent=e.message;$('syncNotice').hidden=false;}updateSyncNotice();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)finishBeforeBackground();else scheduleSheetSync();});
window.addEventListener('pagehide',finishBeforeBackground);

if(demo){const t=today(),month=t.slice(0,7),day=Number(t.slice(-2)),names=['김하늘','이서연','박지민','최윤서','정다은','한지우'];const dateAt=n=>Academy.date(new Date(Number(month.slice(0,4)),Number(month.slice(5))-1,n));const students=names.map((name,i)=>({id:'demo-s'+i,name,phone:'010-0000-00'+String(i+1).padStart(2,'0'),since:i%2?'2024-03-04':'2022-09-01',note:i===0?'기존 수강생 · 오후 수업 선호':'',active:true,priorCount:24+i*6,priorPaid:300000+i*10000,version:1}));const transactions=students.map((s,i)=>({id:'demo-p'+i,studentId:s.id,studentName:s.name,date:month+'-01',kind:i===4?'1일클래스':'정규권',credits:i===4?1:10,amount:i===4?40000:300000,note:'예시 거래',at:t+' 10:00:00',author:'원장'}));transactions[0].credits=4;students.push({...students[5],id:'demo-former',name:'강이전',active:false});transactions.push({...transactions[4],id:'demo-oneday-extra'});const bookings=[];for(let i=0;i<21;i++){const s=i%6,date=dateAt(Math.max(1,day-4)+Math.floor(i/3)*2);if(i===4)continue;bookings.push({id:'demo-b'+i,date,time:['10:00','13:00','15:30'][i%3],studentId:students[s].id,studentName:students[s].name,passId:transactions[s].id,kind:transactions[s].kind,status:date<t?'수강완료':'예약',note:'',version:1,at:t+' 09:00:00',author:'원장'});}const ready={...students[1],id:'demo-ready',name:'김오늘'};students.push(ready);transactions.push({...transactions[1],id:'demo-ready-pass',studentId:ready.id,studentName:ready.name,credits:1});bookings.push({id:'demo-ready-booking',date:t,time:'13:00',endTime:'15:00',studentId:ready.id,studentName:ready.name,passId:'demo-ready-pass',kind:'정규권',status:'예약',note:'',version:1});state.data={schedule:{version:1,slots:Array.from({length:7},(_,day)=>[{id:'demo-'+day+'a',day,start:'10:00',end:'12:00'},{id:'demo-'+day+'b',day,start:'13:00',end:'15:00'},{id:'demo-'+day+'c',day,start:'15:30',end:'17:30'},{id:'demo-'+day+'d',day,start:'18:00',end:'19:00'},{id:'demo-'+day+'e',day,start:'19:30',end:'20:30'}]).flat()},user:{name:'원장',email:'sample@example.com',role:'admin'},needsSetup:false,hasOwnWorkspace:true,workspaces:[{id:'demo-workspace',name:'수봉화실 예시',own:true}],workspace:{id:'demo-workspace',name:'수봉화실 예시',ownedByMe:true,ownerEmail:'sample@example.com',shareUrl:'',permissions:[]},students,transactions,bookings:bookings.filter((b,i,arr)=>b.kind!=='1일클래스'||arr.findIndex(x=>x.passId===b.passId)===i),closures:{version:1,weekdays:[0],ranges:[{id:'demo-range',start:month+'-24',end:month+'-26',reason:'워크숍 휴무'}]},databaseUrl:'',users:[{id:'demo-owner',name:'원장',role:'admin'}],savedAt:t};if(new URL(location.href).searchParams.get('slots')==='3')state.data.schedule.slots=state.data.schedule.slots.filter(s=>!s.id.endsWith('d')&&!s.id.endsWith('e'));if(new URL(location.href).searchParams.has('crowded')){state.data.bookings=state.data.bookings.filter(b=>b.date!==t);state.data.students.filter(s=>s.active).forEach((s,i)=>{const pass=state.data.transactions.find(p=>p.studentId===s.id);const used=state.data.bookings.filter(b=>b.passId===pass.id&&b.status!=='취소').length;pass.credits=Math.max(pass.credits,used+2);state.data.bookings.push({id:'demo-crowded-'+i,studentId:s.id,studentName:s.name,passId:pass.id,kind:pass.kind,date:t,time:'13:00',endTime:'15:00',status:'예약',version:1,note:''});});}$('demoNotice').hidden=false;$('login').hidden=true;$('shell').hidden=false;render();}else{$('switchAccountLink').onclick=()=>logout();$('loginMessage').textContent=backend.configured?'구글 계정으로 로그인하면 본인 소유의 시트에 연결합니다.':'구글 로그인 연결 설정을 준비 중입니다. 준비되면 이 주소에서 사용할 수 있습니다.';}

if(backend.authPreview){document.documentElement.classList.add('auth-preview');$('demoNotice').textContent='로그인 유지 연결 확인 · 기존 자료 읽기 전용 · 저장하지 않습니다.';$('demoNotice').hidden=false;}
if(!demo){task($('retryLoad'),async()=>{const button=$('retryLoad');button.textContent='연결 확인 중…';setLoginLoading(true);try{if(await backend.restoreSession())await load();else $('loginMessage').textContent='구글 계정으로 로그인하면 저장 공간이 자동으로 연결됩니다.';}catch(e){$('loginMessage').textContent=e.message+' 새로고침하거나 구글 로그인으로 다시 연결해 주세요.';throw e;}finally{setLoginLoading(false);button.textContent='구글 로그인';}});}

checkAppUpdate();

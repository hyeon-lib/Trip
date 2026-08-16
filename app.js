import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, updateProfile } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc, query, where, onSnapshot, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app);
let db;
try{
  db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
}catch(e){
  console.warn('영구 Firestore 캐시를 사용할 수 없어 기본 캐시로 전환합니다.',e);
  db=getFirestore(app);
}
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let user=null,currentTrip=null,tripUnsub=null,subUnsubs=[],cache={};
let placeViewMode='category';
const tabs=[['overview','홈'],['itinerary','일정'],['places','추천 장소'],['weather','날씨'],['flights','항공'],['stays','숙소'],['money','지출·정산'],['exchange','환전'],['packing','준비물'],['memos','메모'],['members','동행자']];
const curNames={KRW:'₩',JPY:'¥',USD:'$',EUR:'€',GBP:'£',CNY:'¥',TWD:'NT$',THB:'฿',VND:'₫',SGD:'S$',AUD:'A$',CHF:'CHF'};
const fallbackCurrencies=['KRW','USD','JPY','EUR','CNY','HKD','TWD','THB','VND','PHP','SGD','MYR','IDR','AUD','NZD','CAD','GBP','CHF','AED','SAR','TRY','INR','MXN','BRL','ZAR'];
const currencyCodes=(()=>{try{return Intl.supportedValuesOf('currency')}catch{return fallbackCurrencies}})();
const currencyDisplay=(()=>{try{return new Intl.DisplayNames(['ko'],{type:'currency'})}catch{return null}})();
const currencyOptions=(selected)=>currencyCodes.map(c=>`<option value="${c}" ${c===selected?'selected':''}>${c} · ${currencyDisplay?.of(c)||c}</option>`).join('');
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:2}); const money=(n,c='KRW')=>`${curNames[c]||c} ${fmt(n)}`;
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const modal=(html)=>{$('#modalBody').innerHTML=html;$('#modal').classList.remove('hidden')}; const closeModal=()=>$('#modal').classList.add('hidden');
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal'||e.target.dataset.close)closeModal()});

function authError(e){$('#authMsg').textContent=e.message?.replace('Firebase:','')||String(e)}
$('#signupBtn').onclick=async()=>{try{const email=$('#email').value.trim(),pw=$('#password').value,nick=$('#nickname').value.trim()||email.split('@')[0];const cred=await createUserWithEmailAndPassword(auth,email,pw);await updateProfile(cred.user,{displayName:nick});await setDoc(doc(db,'users',cred.user.uid),{nickname:nick,email,createdAt:serverTimestamp()});}catch(e){authError(e)}};
$('#loginBtn').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('#email').value.trim(),$('#password').value)}catch(e){authError(e)}};
$('#googleBtn').onclick=async()=>{try{const cred=await signInWithPopup(auth,new GoogleAuthProvider());await setDoc(doc(db,'users',cred.user.uid),{nickname:cred.user.displayName||cred.user.email,email:cred.user.email,updatedAt:serverTimestamp()},{merge:true})}catch(e){authError(e)}};
$('#logoutBtn').onclick=()=>signOut(auth); $('#backBtn').onclick=()=>showHome();

onAuthStateChanged(auth,u=>{user=u;$('#authView').classList.toggle('hidden',!!u);$('#homeView').classList.toggle('hidden',!u);$('#logoutBtn').classList.toggle('hidden',!u);$('#userLabel').textContent=u?(u.displayName||u.email):'';if(u)listenTrips();else cleanup()});
function cleanup(){if(tripUnsub)tripUnsub();subUnsubs.forEach(f=>f());subUnsubs=[];currentTrip=null}
const tripBackupKey=uid=>`together-trip:last-trips:${firebaseConfig.projectId}:${uid}`;
function readTripBackup(){
  try{return JSON.parse(localStorage.getItem(tripBackupKey(user.uid))||'[]')}catch{return[]}
}
function writeTripBackup(trips){
  try{
    const safe=trips.map(t=>({id:t.id,name:t.name||'여행',destination:t.destination||'',startDate:t.startDate||'',endDate:t.endDate||'',memberIds:Array.isArray(t.memberIds)?t.memberIds:[]}));
    localStorage.setItem(tripBackupKey(user.uid),JSON.stringify(safe));
  }catch(e){console.warn('여행 목록 백업 실패',e)}
}
function renderTripGrid(trips,status=''){
  $('#tripGrid').innerHTML=`${status?`<div class="data-status">${esc(status)}</div>`:''}${trips.length?trips.map(t=>`<article class="card trip-card"><div><span class="pill">${esc(t.destination||'여행')}</span></div><h3>${esc(t.name)}</h3><div class="meta">${esc(t.startDate||'')} ~ ${esc(t.endDate||'')} · ${t.memberIds?.length||1}명</div><button class="btn primary" data-open-trip="${t.id}">여행방 열기</button></article>`).join(''):'<div class="empty">아직 여행이 없어요. 새 여행을 만들어보세요.</div>'}`;
  $$('[data-open-trip]').forEach(b=>b.onclick=()=>openTrip(b.dataset.openTrip));
}
function listenTrips(){
  const q=query(collection(db,'trips'),where('memberIds','array-contains',user.uid));
  if(tripUnsub)tripUnsub();
  const backup=readTripBackup();
  if(backup.length)renderTripGrid(backup,'마지막으로 저장된 여행 목록을 불러왔습니다. Firebase와 동기화 중입니다.');
  tripUnsub=onSnapshot(q,{includeMetadataChanges:true},snapshot=>{
    const trips=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    if(trips.length||!snapshot.metadata.fromCache){
      writeTripBackup(trips);
      renderTripGrid(trips,snapshot.metadata.fromCache?'오프라인 캐시의 여행 목록입니다. 연결되면 자동 동기화됩니다.':'');
    }else if(backup.length){
      renderTripGrid(backup,'네트워크 또는 권한 확인 중입니다. 기존 여행 기록은 삭제되지 않았습니다.');
    }else{
      renderTripGrid([]);
    }
  },error=>{
    console.error('여행 목록 구독 실패',error);
    const saved=readTripBackup();
    renderTripGrid(saved,`Firebase에서 여행을 불러오지 못했습니다. 기록은 삭제되지 않았습니다: ${error.message||error}`);
  });
}

$('#newTripBtn').onclick=()=>{
  modal(`<h3>새 여행 만들기</h3><div class="field"><label>여행 이름</label><input id="mName" placeholder="2026 도쿄 여행"></div><div class="row"><div class="field"><label>출발일</label><input id="mStart" type="date"></div><div class="field"><label>종료일</label><input id="mEnd" type="date"></div></div><div class="field"><label>대표 여행지</label><input id="mDest" placeholder="Tokyo, Japan"></div><div class="row"><div class="field"><label>기준 통화</label><select id="mBase">${currencyOptions('KRW')}</select></div><div class="field"><label>현지 통화</label><select id="mForeign">${currencyOptions('JPY')}</select></div></div><div class="field"><label>총 여행 예산(기준 통화)</label><input id="mBudget" type="number" value="0"></div><div class="row"><button class="btn" data-close="1">취소</button><button id="createTrip" class="btn primary">만들기</button></div><p id="createTripMsg" class="note"></p>`);
  setTimeout(()=>$('#createTrip').onclick=createTrip,0);
};
async function createTrip(){
  const button=$('#createTrip'),message=$('#createTripMsg');
  try{
    if(!user)throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    const name=$('#mName').value.trim(),startDate=$('#mStart').value,endDate=$('#mEnd').value;
    if(!name)throw new Error('여행 이름을 입력해 주세요.');
    if(!startDate||!endDate)throw new Error('여행 기간을 입력해 주세요.');
    if(endDate<startDate)throw new Error('종료일은 출발일보다 빠를 수 없습니다.');
    button.disabled=true;button.textContent='저장 중…';
    const nick=user.displayName||user.email,ref=doc(collection(db,'trips')),roomCode=code();
    const batch=writeBatch(db);
    batch.set(ref,{name,startDate,endDate,destination:$('#mDest').value.trim(),baseCurrency:$('#mBase').value,foreignCurrencies:[$('#mForeign').value],budget:Number($('#mBudget').value||0),ownerId:user.uid,memberIds:[user.uid],bannedMemberIds:[],members:{[user.uid]:{nickname:nick,email:user.email,role:'owner'}},inviteCode:roomCode,createdAt:serverTimestamp()});
    batch.set(doc(db,'invites',roomCode),{tripId:ref.id,ownerId:user.uid,createdAt:serverTimestamp(),permanent:true});
    await batch.commit();
    closeModal();await openTrip(ref.id);
  }catch(e){
    console.error('여행 생성 실패',e);
    if(message)message.textContent=`여행을 만들지 못했습니다: ${e.message||e}`;
    if(button){button.disabled=false;button.textContent='만들기';}
  }
}

$('#joinTripBtn').onclick=()=>modal(`<h3>초대코드로 참가</h3><div class="field"><label>6자리 초대코드</label><input id="joinCode" maxlength="6" style="text-transform:uppercase"></div><div class="row"><button class="btn" data-close="1">취소</button><button id="joinGo" class="btn primary">참가하기</button></div><p id="joinMsg" class="note"></p>`);document.addEventListener('click',e=>{if(e.target.id==='joinGo')joinTrip()});
async function joinTrip(){
  const message=$('#joinMsg'),button=$('#joinGo');
  try{
    const c=$('#joinCode').value.trim().toUpperCase();
    if(c.length!==6)throw new Error('6자리 방 코드를 입력해 주세요.');
    button.disabled=true;button.textContent='입장 중…';
    const inv=await getDoc(doc(db,'invites',c));
    if(!inv.exists())throw new Error('방 코드를 찾을 수 없습니다.');
    const tripId=inv.data().tripId,tr=doc(db,'trips',tripId);
    await updateDoc(tr,{memberIds:arrayUnion(user.uid),[`members.${user.uid}`]:{nickname:user.displayName||user.email,email:user.email,role:'member'},updatedAt:serverTimestamp(),updatedBy:user.uid});
    closeModal();await openTrip(tripId);
  }catch(e){
    console.error('방 입장 실패',e);
    message.textContent=e.code==='permission-denied'?'이 방에 입장할 권한이 없습니다. 방장에게 강퇴 여부를 확인해 주세요.':e.message;
    if(button){button.disabled=false;button.textContent='참가하기';}
  }
}

async function openTrip(id){cleanupSub();const snap=await getDoc(doc(db,'trips',id));if(!snap.exists())return;currentTrip={id,...snap.data()};$('#homeView').classList.add('hidden');$('#tripView').classList.remove('hidden');renderHeader();renderTabs();listenTripDoc();listenSubs()}
function showHome(){cleanupSub();$('#tripView').classList.add('hidden');$('#homeView').classList.remove('hidden');currentTrip=null}
function cleanupSub(){subUnsubs.forEach(f=>f());subUnsubs=[]}
function listenTripDoc(){subUnsubs.push(onSnapshot(doc(db,'trips',currentTrip.id),s=>{if(s.exists()){currentTrip={id:s.id,...s.data()};renderHeader();renderAll()}}))}
function listenSubs(){['itinerary','flights','stays','expenses','exchanges','packing','memos','places'].forEach(name=>{subUnsubs.push(onSnapshot(collection(db,'trips',currentTrip.id,name),s=>{cache[name]=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()}))})}
function renderHeader(){const owner=currentTrip.ownerId===user.uid;$('#tripTitle').textContent=currentTrip.name;$('#tripMeta').textContent=`${currentTrip.startDate||''} ~ ${currentTrip.endDate||''} · ${currentTrip.destination||''}`;$('#inviteCode').textContent=owner?(currentTrip.inviteCode?`초대 ${currentTrip.inviteCode}`:'초대코드 미발급'):'';$('#inviteCode').classList.toggle('hidden',!owner);$('#copyInviteBtn').classList.toggle('hidden',!owner||!currentTrip.inviteCode)}
$('#copyInviteBtn').onclick=async()=>{if(currentTrip?.inviteCode){await navigator.clipboard.writeText(currentTrip.inviteCode);alert('초대코드를 복사했습니다.')}};
function renderTabs(){$('#tabs').innerHTML=tabs.map(([k,l],i)=>`<button class="tab ${i===0?'active':''}" data-tab="${k}">${l}</button>`).join('');$$('[data-tab]').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${b.dataset.tab}`));if(b.dataset.tab==='weather')loadWeather();if(b.dataset.tab==='places')renderPlaces()})}
function renderAll(){if(!currentTrip)return;renderOverview();renderItinerary();renderFlights();renderStays();renderMoney();renderExchange();renderPacking();renderMemos();renderMembers();renderPlaces()}
function memberOptions(sel=''){return Object.entries(currentTrip.members||{}).map(([uid,m])=>`<option value="${uid}" ${uid===sel?'selected':''}>${esc(m.nickname||m.email)}</option>`).join('')}

function renderOverview(){const ex=cache.expenses||[], shared=ex.filter(x=>x.type==='shared').reduce((a,b)=>a+Number(b.baseAmount||0),0),personal=ex.filter(x=>x.type==='personal').reduce((a,b)=>a+Number(b.baseAmount||0),0),budget=Number(currentTrip.budget||0);$('#panel-overview').innerHTML=`<div class="kpis"><div class="kpi"><div class="l">총 예산</div><div class="n">${money(budget,currentTrip.baseCurrency)}</div></div><div class="kpi"><div class="l">공동 지출</div><div class="n">${money(shared,currentTrip.baseCurrency)}</div></div><div class="kpi"><div class="l">개인 지출</div><div class="n">${money(personal,currentTrip.baseCurrency)}</div></div><div class="kpi"><div class="l">남은 예산</div><div class="n ${budget-shared-personal<0?'danger':'good'}">${money(budget-shared-personal,currentTrip.baseCurrency)}</div></div></div><div class="section-title"><h2>여행 한눈에 보기</h2><button id="editTrip" class="btn">여행 정보 수정</button></div><div class="grid"><div class="card"><b>일정</b><p class="big">${(cache.itinerary||[]).length}개</p><span class="muted">등록된 코스</span></div><div class="card"><b>숙소</b><p class="big">${(cache.stays||[]).length}곳</p><span class="muted">예약/예정</span></div><div class="card"><b>동행자</b><p class="big">${currentTrip.memberIds?.length||1}명</p><span class="muted">같이 편집 중</span></div></div>`;$('#editTrip').onclick=tripEditForm}

function days(){if(!currentTrip.startDate||!currentTrip.endDate)return[];let d=new Date(currentTrip.startDate+'T00:00:00'),e=new Date(currentTrip.endDate+'T00:00:00'),out=[];while(d<=e&&out.length<40){out.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1)}return out}
function renderItinerary(){
  const list=cache.itinerary||[],validDays=days(),changed=list.filter(x=>!validDays.includes(x.date)).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const currentDays=validDays.map((d,i)=>{const its=list.filter(x=>x.date===d).sort((a,b)=>(a.time||'').localeCompare(b.time||''));return `<div class="day"><h3>DAY ${i+1} · ${d}</h3><div class="timeline">${its.length?its.map(x=>`<div class="slot"><b>${esc(x.time||'--:--')}</b><div><b>${esc(x.title)}</b><div class="sub">${esc(x.place||'')} ${x.note?'· '+esc(x.note):''}</div></div><div class="actions"><button class="btn small" data-edit="itinerary:${x.id}">수정</button><button class="btn small" data-del="itinerary:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">아직 일정이 없습니다.</div>'}</div></div>`}).join('');
  const changedSection=changed.length?`<div class="section-title changed-title"><div><h2>변경된 일정</h2><p class="note">현재 여행 기간에 포함되지 않는 기존 일정입니다. 삭제하지 않고 보관했으니 수정에서 새 날짜를 지정해 다시 사용할 수 있습니다.</p></div></div><div class="day changed-plans"><div class="timeline">${changed.map(x=>`<div class="slot"><b>${esc(x.date||'날짜 없음')}<br>${esc(x.time||'')}</b><div><b>${esc(x.title)}</b><div class="sub">${esc(x.place||'')} ${x.note?'· '+esc(x.note):''}</div></div><div class="actions"><button class="btn small primary" data-edit="itinerary:${x.id}">날짜 변경</button><button class="btn small" data-del="itinerary:${x.id}">삭제</button></div></div>`).join('')}</div></div>`:'';
  $('#panel-itinerary').innerHTML=`<div class="section-title"><h2>일자별 여행 코스</h2><button id="addIt" class="btn primary">+ 일정 추가</button></div>${currentDays}${changedSection}`;
  $('#addIt').onclick=()=>formIt();bindDeletes();
}
function formIt(place=''){modal(`<h3>일정 추가</h3><div class="row"><div class="field"><label>날짜</label><select id="fDate">${days().map(d=>`<option>${d}</option>`).join('')}</select></div><div class="field"><label>시간</label><input id="fTime" type="time"></div></div><div class="field"><label>일정명</label><input id="fTitle" placeholder="아사쿠사 산책"></div><div class="field"><label>장소</label><input id="fPlace" value="${esc(place)}"></div><div class="field"><label>메모</label><textarea id="fNote"></textarea></div><div class="row"><button class="btn" data-close="1">취소</button><button id="saveIt" class="btn primary">저장</button></div>`);setTimeout(()=>$('#saveIt').onclick=async()=>{await addDoc(collection(db,'trips',currentTrip.id,'itinerary'),{date:$('#fDate').value,time:$('#fTime').value,title:$('#fTitle').value.trim(),place:$('#fPlace').value.trim(),note:$('#fNote').value.trim(),createdBy:user.uid,createdAt:serverTimestamp()});closeModal()},0)}

function parseGoogleMapsLink(value){
  const raw=String(value||'').trim();
  if(!raw)return {url:'',name:'',lat:null,lng:null,short:false};
  try{
    const url=new URL(raw),host=url.hostname.toLowerCase();
    if(!['google.com','www.google.com','maps.google.com','maps.app.goo.gl'].some(x=>host===x||host.endsWith('.'+x)))throw Error('Google Maps 링크만 사용할 수 있습니다.');
    const result={url:url.href,name:'',lat:null,lng:null,short:host==='maps.app.goo.gl'};
    const nameMatch=decodeURIComponent(url.pathname).match(/\/place\/([^/]+)/);
    if(nameMatch)result.name=nameMatch[1].replace(/\+/g,' ').trim();
    const atMatch=url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const dataMatch=url.href.match(/!3d(-?\d+(?:\.\d+)?).*?!4d(-?\d+(?:\.\d+)?)/);
    if(atMatch){result.lat=Number(atMatch[1]);result.lng=Number(atMatch[2]);}
    else if(dataMatch){result.lat=Number(dataMatch[1]);result.lng=Number(dataMatch[2]);}
    const query=url.searchParams.get('query')||url.searchParams.get('q');
    if(!result.name&&query&&!/^-?\d+(\.\d+)?\s*,/.test(query))result.name=query;
    return result;
  }catch(e){return {url:raw,name:'',lat:null,lng:null,short:false,error:e.message||'올바른 링크가 아닙니다.'};}
}
function bindPlaceLinkInput(prefix){
  const urlInput=$('#'+prefix+'Url'),nameInput=$('#'+prefix+'Name'),latInput=$('#'+prefix+'Lat'),lngInput=$('#'+prefix+'Lng'),message=$('#'+prefix+'LinkMsg');
  if(!urlInput)return;
  const parse=()=>{
    const parsed=parseGoogleMapsLink(urlInput.value);
    if(parsed.error){message.textContent=parsed.error;return;}
    if(parsed.name&&!nameInput.value.trim())nameInput.value=parsed.name;
    if(parsed.lat!=null){latInput.value=parsed.lat;lngInput.value=parsed.lng;}
    message.textContent=parsed.short?'단축 링크는 장소 정보를 읽을 수 없어 장소명을 직접 입력해야 합니다. 링크는 정상적으로 저장됩니다.':parsed.name||parsed.lat!=null?'링크에서 장소 정보를 자동으로 채웠습니다.':'장소명을 확인해 주세요. 링크는 그대로 저장됩니다.';
  };
  urlInput.addEventListener('input',()=>setTimeout(parse,0));parse();
}
function placeDistanceKm(a,b){
  const rad=n=>n*Math.PI/180,dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng)),lat1=rad(Number(a.lat)),lat2=rad(Number(b.lat));
  return 6371*2*Math.asin(Math.sqrt(Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2));
}
function placeGroups(items,mode){
  if(mode==='category'){
    const map=new Map();items.forEach(p=>{const key=p.category||'기타';if(!map.has(key))map.set(key,[]);map.get(key).push(p)});
    return [...map].map(([label,places])=>({label,places}));
  }
  const groups=[],unknown=[];
  items.forEach(place=>{
    if(!Number.isFinite(Number(place.lat))||!Number.isFinite(Number(place.lng))){unknown.push(place);return;}
    let group=groups.find(g=>g.places.some(existing=>placeDistanceKm(existing,place)<=2.5));
    if(!group){group={label:(place.name||'장소')+' 주변',places:[]};groups.push(group);}
    group.places.push(place);
  });
  if(unknown.length)groups.push({label:'위치 미확인',places:unknown});
  return groups;
}
function placeCard(p){
  const safeUrl=/^https:\/\/(www\.)?google\.com\/maps|^https:\/\/maps\.app\.goo\.gl\//i.test(p.mapsUrl||'')?p.mapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.name||'')+' '+(currentTrip.destination||''))}`;
  return `<div class="item"><div><h4>${esc(p.name)}</h4><div class="sub">${esc(p.category||'기타')} ${p.note?'· '+esc(p.note):''}</div>${p.lat!=null?`<div class="sub">위치 ${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}</div>`:''}</div><div class="actions"><a class="btn small" target="_blank" rel="noopener" href="${esc(safeUrl)}">Google Maps</a><button class="btn small" data-to-it="${esc(p.name)}">일정에 추가</button><button class="btn small" data-edit="places:${p.id}">수정</button><button class="btn small" data-del="places:${p.id}">삭제</button></div></div>`;
}
function renderPlaces(){
  if(!currentTrip)return;
  const saved=cache.places||[],groups=placeGroups(saved,placeViewMode);
  const groupedHtml=groups.map(group=>`<section class="place-group"><div class="section-title"><h3>${esc(group.label)}</h3><span class="pill">${group.places.length}곳</span></div><div class="list">${group.places.map(placeCard).join('')}</div></section>`).join('');
  $('#panel-places').innerHTML=`<div class="section-title"><h2>추천 장소</h2><button id="addPlaceManual" class="btn primary">+ 장소 등록</button></div>
    <div class="card"><p class="note">Google Maps에서 장소의 공유 링크를 복사해 등록하세요. 전체 주소 링크에는 장소명과 좌표가 자동 입력되고, 단축 링크는 장소명을 직접 입력하면 됩니다.</p><div class="actions"><button class="btn ${placeViewMode==='category'?'primary':''}" data-place-mode="category">분야별 보기</button><button class="btn ${placeViewMode==='location'?'primary':''}" data-place-mode="location">위치별 보기</button></div></div>
    ${saved.length?groupedHtml:'<div class="empty">Google Maps 링크로 동행자와 후보 장소를 공유해보세요.</div>'}`;
  $('#addPlaceManual').onclick=placeForm;
  $$('[data-place-mode]').forEach(b=>b.onclick=()=>{placeViewMode=b.dataset.placeMode;renderPlaces()});
  $$('[data-to-it]').forEach(b=>b.onclick=()=>formIt(b.dataset.toIt));
  bindDeletes();
}
function placeForm(){
  modal(`<h3>Google Maps 장소 등록</h3>
    <div class="field"><label>Google Maps 공유 링크</label><input id="pUrl" type="url" placeholder="https://www.google.com/maps/place/... 또는 https://maps.app.goo.gl/..."><p id="pLinkMsg" class="note">링크를 붙여 넣으면 가능한 정보를 자동으로 채웁니다.</p></div>
    <input id="pLat" type="hidden"><input id="pLng" type="hidden">
    <div class="field"><label>장소명</label><input id="pName" placeholder="링크에서 자동 입력 또는 직접 입력"></div>
    <div class="field"><label>분류</label><select id="pCat"><option>관광</option><option>맛집</option><option>카페</option><option>쇼핑</option><option>야경</option><option>숙소</option><option>기타</option></select></div>
    <div class="field"><label>메모</label><textarea id="pNote"></textarea></div>
    <div class="row"><button class="btn" data-close="1">취소</button><button id="pSave" class="btn primary">저장</button></div>`);
  bindPlaceLinkInput('p');
  $('#pSave').onclick=async()=>{
    const name=$('#pName').value.trim(),mapsUrl=$('#pUrl').value.trim();
    if(!name)return alert('장소명을 입력해 주세요.');
    if(!mapsUrl)return alert('Google Maps 링크를 입력해 주세요.');
    const lat=$('#pLat').value,lng=$('#pLng').value;
    await addDoc(collection(db,'trips',currentTrip.id,'places'),{name,category:$('#pCat').value,note:$('#pNote').value.trim(),mapsUrl,lat:lat===''?null:Number(lat),lng:lng===''?null:Number(lng),createdBy:user.uid,createdAt:serverTimestamp()});
    closeModal();
  };
}

async function loadWeather(){
  const box=$('#panel-weather');
  box.innerHTML='<div class="section-title"><h2>여행 일정 날씨</h2></div><div class="card">날씨를 불러오는 중…</div>';
  try{
    if(!currentTrip.startDate||!currentTrip.endDate)throw Error('여행 시작일과 종료일을 먼저 설정하세요.');
    const city=currentTrip.destination;
    if(!city)throw Error('대표 여행지를 먼저 입력하세요.');
    const geocode=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko&format=json`).then(r=>{if(!r.ok)throw Error('여행지 검색에 실패했습니다.');return r.json()});
    const loc=geocode.results?.[0];
    if(!loc)throw Error('여행지 좌표를 찾지 못했습니다.');
    const forecast=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16&past_days=3`).then(r=>{if(!r.ok)throw Error('날씨 API 오류가 발생했습니다.');return r.json()});
    const byDate=new Map((forecast.daily?.time||[]).map((date,index)=>[date,{max:forecast.daily.temperature_2m_max?.[index],min:forecast.daily.temperature_2m_min?.[index],rain:forecast.daily.precipitation_probability_max?.[index]}]));
    const addDays=(iso,amount)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+amount);return d.toISOString().slice(0,10)};
    const rangeStart=addDays(currentTrip.startDate,-3),rangeEnd=addDays(currentTrip.endDate,3),targetDates=[];
    for(let date=rangeStart;date<=rangeEnd&&targetDates.length<50;date=addDays(date,1))targetDates.push(date);
    const cards=targetDates.map(date=>{
      const item=byDate.get(date),during=date>=currentTrip.startDate&&date<=currentTrip.endDate,label=during?'여행 기간':'여행 전·후';
      if(!item)return `<div class="weather-card unavailable"><b>${date}</b><span class="pill">${label}</span><div class="weather-unavailable">아직 예보가<br>공개되지 않았어요</div></div>`;
      return `<div class="weather-card ${during?'trip-weather':''}"><b>${date}</b><span class="pill">${label}</span><div class="big">${Math.round(item.max)}°</div><div>${Math.round(item.min)}° ~ ${Math.round(item.max)}°</div><div class="muted">강수 ${item.rain??'-'}%</div></div>`;
    }).join('');
    box.innerHTML=`<div class="section-title"><div><h2>여행 일정 날씨</h2><p class="note">${currentTrip.startDate}부터 ${currentTrip.endDate}까지의 여행 기간과 앞뒤 3일을 표시합니다.</p></div><span class="pill">${esc(loc.name)}, ${esc(loc.country||'')}</span></div><div class="weather-grid">${cards}</div>`;
  }catch(e){
    box.innerHTML=`<div class="section-title"><h2>여행 일정 날씨</h2></div><div class="card danger">${esc(e.message)}</div>`;
  }
}

function renderFlights(){const a=cache.flights||[];$('#panel-flights').innerHTML=`<div class="section-title"><h2>항공편</h2><button id="addFlight" class="btn primary">+ 항공 추가</button></div><div class="list">${a.length?a.map(x=>`<div class="item"><div><h4>${esc(x.airline||'')} ${esc(x.flightNo||'')}</h4><div class="sub">${esc(x.date||'')} · ${esc(x.from||'')} ${esc(x.depart||'')} → ${esc(x.to||'')} ${esc(x.arrive||'')}</div><div class="sub">예약번호 ${esc(x.booking||'-')}</div></div><div class="actions"><button class="btn small" data-edit="flights:${x.id}">수정</button><button class="btn small" data-del="flights:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">항공권 정보를 한곳에 모아두세요.</div>'}</div>`;$('#addFlight').onclick=flightForm;bindDeletes()}
function flightForm(){modal(`<h3>항공편 추가</h3><div class="row"><div class="field"><label>항공사</label><input id="flAir"></div><div class="field"><label>편명</label><input id="flNo"></div></div><div class="field"><label>날짜</label><input id="flDate" type="date"></div><div class="row"><div class="field"><label>출발지</label><input id="flFrom"></div><div class="field"><label>출발시간</label><input id="flDepart" type="time"></div></div><div class="row"><div class="field"><label>도착지</label><input id="flTo"></div><div class="field"><label>도착시간</label><input id="flArrive" type="time"></div></div><div class="field"><label>예약번호</label><input id="flBook"></div><div class="row"><button class="btn" data-close="1">취소</button><button id="flSave" class="btn primary">저장</button></div>`);setTimeout(()=>$('#flSave').onclick=async()=>{await addDoc(collection(db,'trips',currentTrip.id,'flights'),{airline:$('#flAir').value,flightNo:$('#flNo').value,date:$('#flDate').value,from:$('#flFrom').value,to:$('#flTo').value,depart:$('#flDepart').value,arrive:$('#flArrive').value,booking:$('#flBook').value,createdAt:serverTimestamp()});closeModal()},0)}

function renderStays(){const a=cache.stays||[];$('#panel-stays').innerHTML=`<div class="section-title"><h2>숙소</h2><button id="addStay" class="btn primary">+ 숙소 추가</button></div><div class="list">${a.length?a.map(x=>`<div class="item"><div><h4>${esc(x.name)}</h4><div class="sub">${esc(x.checkin||'')} → ${esc(x.checkout||'')} · ${esc(x.address||'')}</div><div class="sub">예약번호 ${esc(x.booking||'-')}</div></div><div class="actions"><button class="btn small" data-edit="stays:${x.id}">수정</button><button class="btn small" data-del="stays:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">숙소 예약 정보를 저장하세요.</div>'}</div>`;$('#addStay').onclick=stayForm;bindDeletes()}
function stayForm(){modal(`<h3>숙소 추가</h3><div class="field"><label>숙소명</label><input id="stName"></div><div class="row"><div class="field"><label>체크인</label><input id="stIn" type="date"></div><div class="field"><label>체크아웃</label><input id="stOut" type="date"></div></div><div class="field"><label>주소</label><input id="stAddr"></div><div class="field"><label>예약번호</label><input id="stBook"></div><div class="row"><button class="btn" data-close="1">취소</button><button id="stSave" class="btn primary">저장</button></div>`);setTimeout(()=>$('#stSave').onclick=async()=>{await addDoc(collection(db,'trips',currentTrip.id,'stays'),{name:$('#stName').value,checkin:$('#stIn').value,checkout:$('#stOut').value,address:$('#stAddr').value,booking:$('#stBook').value,createdAt:serverTimestamp()});closeModal()},0)}

function settlements(){const ms=Object.keys(currentTrip.members||{}), bal=Object.fromEntries(ms.map(x=>[x,0]));for(const e of cache.expenses||[]){const amt=Number(e.baseAmount||0),payer=e.payerUid;if(!bal.hasOwnProperty(payer))continue;if(e.type==='shared'){const participants=e.participantUids?.length?e.participantUids:ms;const share=amt/participants.length;bal[payer]+=amt;participants.forEach(u=>{if(bal.hasOwnProperty(u))bal[u]-=share})}else{const owner=e.personalUid||payer;bal[payer]+=amt;if(bal.hasOwnProperty(owner))bal[owner]-=amt}}const debt=Object.entries(bal).filter(([,v])=>v<-.01).map(([u,v])=>[u,-v]),cred=Object.entries(bal).filter(([,v])=>v>.01).map(([u,v])=>[u,v]),out=[];let i=0,j=0;while(i<debt.length&&j<cred.length){const a=Math.min(debt[i][1],cred[j][1]);out.push({from:debt[i][0],to:cred[j][0],amount:a});debt[i][1]-=a;cred[j][1]-=a;if(debt[i][1]<.01)i++;if(cred[j][1]<.01)j++}return out}
function renderMoney(){const a=cache.expenses||[],sett=settlements();$('#panel-money').innerHTML=`<div class="section-title"><h2>예산·지출 관리</h2><button id="addExpense" class="btn primary">+ 지출 추가</button></div><div class="list">${a.length?a.map(e=>`<div class="item"><div><h4>${esc(e.title)}</h4><div class="sub">${e.type==='shared'?'공동비용':'개인비용'} · 결제 ${esc(currentTrip.members?.[e.payerUid]?.nickname||'')}</div><div class="sub">${money(e.originalAmount,e.currency)} → ${money(e.baseAmount,currentTrip.baseCurrency)} ${e.fxRate?`· 적용환율 ${fmt(e.fxRate)}`:''}</div></div><div class="right"><div class="money">${money(e.baseAmount,currentTrip.baseCurrency)}</div><div class="actions"><button class="btn small" data-edit="expenses:${e.id}">수정</button><button class="btn small" data-del="expenses:${e.id}">삭제</button></div></div></div>`).join(''):'<div class="empty">공동비와 개인비를 기록하면 자동 정산됩니다.</div>'}</div><div class="section-title"><h2>최종 정산</h2></div><div class="card">${sett.length?sett.map(s=>`<div class="item"><b>${esc(currentTrip.members[s.from]?.nickname)} → ${esc(currentTrip.members[s.to]?.nickname)}</b><span class="money">${money(s.amount,currentTrip.baseCurrency)}</span></div>`).join(''):'현재 서로 보낼 돈이 없습니다.'}</div>`;$('#addExpense').onclick=expenseForm;bindDeletes()}
async function fxToBase(currency,amount,manualRate=0){
  const numericAmount=Number(amount),numericRate=Number(manualRate||0),foreign=currentTrip.foreignCurrencies?.[0]||'JPY';
  if(currency===currentTrip.baseCurrency)return {rate:1,base:numericAmount,source:'base'};
  if(numericRate>0)return {rate:numericRate,base:numericAmount*numericRate,source:'manual'};
  if(currency===foreign){
    const averageRate=exchangeStats().avg;
    if(averageRate>0)return {rate:averageRate,base:numericAmount*averageRate,source:'exchange-average'};
    throw Error(`환전 탭에 ${foreign} 환전 기록이 없습니다. 먼저 환전 내역을 기록하거나 수동 환율을 입력해 주세요.`);
  }
  throw Error(`${currency} 환전 기록이 없습니다. 수동 환율(1 ${currency} = 몇 ${currentTrip.baseCurrency}인지)을 입력해 주세요.`);
}
function expenseForm(){
  const foreign=currentTrip.foreignCurrencies?.[0]||'JPY';
  modal(`<h3>지출 추가</h3>
    <div class="field"><label>내용</label><input id="exTitle" placeholder="저녁 식사"></div>
    <div class="row"><div class="field"><label>금액</label><input id="exAmt" type="number" min="0" step="any"></div><div class="field"><label>통화</label><select id="exCur">${currencyOptions(foreign)}</select></div></div>
    <div id="manualRateWrap" class="field"><label>수동 환율 (선택)</label><input id="exManualRate" type="number" min="0" step="any" placeholder="1 ${foreign} = 몇 ${currentTrip.baseCurrency}"><p class="note">비워두면 환전 탭의 실제 평균 환율을 사용합니다. 해당 통화의 환전 기록이 없을 때만 입력하세요.</p></div>
    <div class="row"><div class="field"><label>비용 유형</label><select id="exType"><option value="shared">공동비용</option><option value="personal">개인비용</option></select></div><div class="field"><label>실제 결제자</label><select id="exPayer">${memberOptions(user.uid)}</select></div></div>
    <div id="personalWrap" class="field hidden"><label>개인비용 사용자</label><select id="exPersonal">${memberOptions()}</select></div>
    <div class="field"><label>결제수단</label><select id="exMethod"><option>공동 현금</option><option>개인 현금</option><option>개인 카드</option><option>공동 카드</option></select></div>
    <div class="row"><button class="btn" data-close="1">취소</button><button id="exSave" class="btn primary">저장</button></div><p id="exMsg" class="note"></p>`);
  const updateRateHint=()=>{const cur=$('#exCur').value;$('#exManualRate').placeholder=`1 ${cur} = 몇 ${currentTrip.baseCurrency}`;$('#manualRateWrap').classList.toggle('hidden',cur===currentTrip.baseCurrency)};
  updateRateHint();$('#exCur').onchange=updateRateHint;
  $('#exType').onchange=()=>$('#personalWrap').classList.toggle('hidden',$('#exType').value!=='personal');
  $('#exSave').onclick=async()=>{
    const button=$('#exSave'),message=$('#exMsg');
    try{
      const title=$('#exTitle').value.trim(),amount=Number($('#exAmt').value),cur=$('#exCur').value,manualRate=Number($('#exManualRate').value||0);
      if(!title)throw Error('지출 내용을 입력해 주세요.');
      if(!(amount>0))throw Error('0보다 큰 금액을 입력해 주세요.');
      button.disabled=true;button.textContent='저장 중…';message.textContent='';
      const res=await fxToBase(cur,amount,manualRate);
      await addDoc(collection(db,'trips',currentTrip.id,'expenses'),{title,originalAmount:amount,currency:cur,baseAmount:res.base,fxRate:res.rate,fxSource:res.source,type:$('#exType').value,payerUid:$('#exPayer').value,personalUid:$('#exType').value==='personal'?$('#exPersonal').value:null,participantUids:Object.keys(currentTrip.members||{}),method:$('#exMethod').value,createdBy:user.uid,createdAt:serverTimestamp()});
      closeModal();
    }catch(e){message.textContent=e.message||'지출을 저장하지 못했습니다.';button.disabled=false;button.textContent='저장';}
  };
}

function exchangeStats(){const a=cache.exchanges||[],base=a.reduce((s,x)=>s+Number(x.baseSpent||0),0),foreign=a.reduce((s,x)=>s+Number(x.foreignReceived||0),0);return {base,foreign,avg:foreign?base/foreign:0}}
async function renderExchange(){const a=cache.exchanges||[],s=exchangeStats(),foreign=currentTrip.foreignCurrencies?.[0]||'JPY',plan=Number(currentTrip.exchangePlan||0);$('#panel-exchange').innerHTML=`<div class="section-title"><h2>환율·분할 환전</h2><button id="addExchange" class="btn primary">+ 환전 기록</button></div><div class="kpis"><div class="kpi"><div class="l">실제 평균 환율</div><div class="n" style="font-size:18px">${s.avg?(foreign==='JPY'?fmt(s.avg*100)+' /100 JPY':fmt(s.avg)+' /'+foreign):'환전 기록 없음'}</div></div><div class="kpi"><div class="l">환전 계획</div><div class="n">${money(plan,currentTrip.baseCurrency)}</div></div><div class="kpi"><div class="l">환전 완료</div><div class="n">${money(s.base,currentTrip.baseCurrency)}</div></div><div class="kpi"><div class="l">내 평균 환전가</div><div class="n" style="font-size:18px">${s.avg?(foreign==='JPY'?fmt(s.avg*100)+' /100 JPY':fmt(s.avg)+' /'+foreign):'-'}</div></div></div><div class="card" style="margin-top:12px"><div class="field"><label>총 환전 계획 금액</label><div class="row"><input id="planAmt" type="number" value="${plan}"><button id="savePlan" class="btn">계획 저장</button></div></div><div class="meta">진행률 ${plan?Math.min(100,s.base/plan*100).toFixed(1):0}% · 남은 계획 ${money(Math.max(0,plan-s.base),currentTrip.baseCurrency)} · 보유 외화 ${money(s.foreign,foreign)}</div></div><div class="section-title"><h2>환전 내역</h2></div><div class="list">${a.length?a.map(x=>`<div class="item"><div><h4>${esc(x.date)} · ${esc(currentTrip.members[x.memberUid]?.nickname||'')}</h4><div class="sub">${money(x.baseSpent,currentTrip.baseCurrency)} → ${money(x.foreignReceived,foreign)}</div><div class="sub">실제 환율 ${foreign==='JPY'?fmt(Number(x.rate)*100)+' /100 JPY':fmt(x.rate)+' /'+foreign}</div></div><div class="actions"><button class="btn small" data-edit="exchanges:${x.id}">수정</button><button class="btn small" data-del="exchanges:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">환율이 좋을 때 나눠 환전한 기록을 남겨보세요.</div>'}</div>`;$('#addExchange').onclick=exchangeForm;$('#savePlan').onclick=()=>updateDoc(doc(db,'trips',currentTrip.id),{exchangePlan:Number($('#planAmt').value||0)});bindDeletes()}
function exchangeForm(){const foreign=currentTrip.foreignCurrencies?.[0]||'JPY';modal(`<h3>환전 기록</h3><div class="field"><label>환전자</label><select id="fxMember">${memberOptions(user.uid)}</select></div><div class="field"><label>환전일</label><input id="fxDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="row"><div class="field"><label>사용한 ${currentTrip.baseCurrency}</label><input id="fxBase" type="number"></div><div class="field"><label>받은 ${foreign}</label><input id="fxForeign" type="number"></div></div><p class="note">은행/환전소에서 실제 받은 금액을 입력하면 실제 체감 환율을 계산합니다.</p><div class="row"><button class="btn" data-close="1">취소</button><button id="fxSave" class="btn primary">저장</button></div>`);setTimeout(()=>$('#fxSave').onclick=async()=>{const b=Number($('#fxBase').value),f=Number($('#fxForeign').value);await addDoc(collection(db,'trips',currentTrip.id,'exchanges'),{memberUid:$('#fxMember').value,date:$('#fxDate').value,baseSpent:b,foreignReceived:f,rate:f?b/f:0,createdAt:serverTimestamp()});closeModal()},0)}

function renderPacking(){const a=cache.packing||[];$('#panel-packing').innerHTML=`<div class="section-title"><h2>준비물 체크리스트</h2><button id="addPack" class="btn primary">+ 준비물</button></div><div class="list">${a.length?a.map(x=>`<div class="item"><label class="check"><input type="checkbox" data-check="${x.id}" ${x.done?'checked':''}><span style="${x.done?'text-decoration:line-through;color:#999':''}">${esc(x.text)}</span></label><div class="actions"><button class="btn small" data-edit="packing:${x.id}">수정</button><button class="btn small" data-del="packing:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">여권, eSIM, 상비약 등 함께 체크하세요.</div>'}</div>`;$('#addPack').onclick=()=>simpleAdd('packing','준비물 추가','준비물','text');$$('[data-check]').forEach(c=>c.onchange=()=>updateDoc(doc(db,'trips',currentTrip.id,'packing',c.dataset.check),{done:c.checked,doneBy:c.checked?user.uid:null}));bindDeletes()}
function renderMemos(){const a=cache.memos||[];$('#panel-memos').innerHTML=`<div class="section-title"><h2>공동 메모</h2><button id="addMemo" class="btn primary">+ 메모</button></div><div class="list">${a.length?a.map(x=>`<div class="item"><div><h4>${esc(x.title||'메모')}</h4><div>${esc(x.text)}</div></div><div class="actions"><button class="btn small" data-edit="memos:${x.id}">수정</button><button class="btn small" data-del="memos:${x.id}">삭제</button></div></div>`).join(''):'<div class="empty">예약 주의사항, 쇼핑 목록, 꼭 할 일 등을 적어두세요.</div>'}</div>`;$('#addMemo').onclick=()=>modal(`<h3>메모 추가</h3><div class="field"><label>제목</label><input id="meTitle"></div><div class="field"><label>내용</label><textarea id="meText"></textarea></div><div class="row"><button class="btn" data-close="1">취소</button><button id="meSave" class="btn primary">저장</button></div>`);document.addEventListener('click',async e=>{if(e.target.id==='meSave'){await addDoc(collection(db,'trips',currentTrip.id,'memos'),{title:$('#meTitle').value,text:$('#meText').value,createdBy:user.uid,createdAt:serverTimestamp()});closeModal()}});bindDeletes()}
function simpleAdd(sub,title,label,key){modal(`<h3>${title}</h3><div class="field"><label>${label}</label><input id="simpleVal"></div><div class="row"><button class="btn" data-close="1">취소</button><button id="simpleSave" class="btn primary">저장</button></div>`);setTimeout(()=>$('#simpleSave').onclick=async()=>{await addDoc(collection(db,'trips',currentTrip.id,sub),{[key]:$('#simpleVal').value.trim(),done:false,createdBy:user.uid,createdAt:serverTimestamp()});closeModal()},0)}
async function issueInviteCode(){
  if(!currentTrip||currentTrip.ownerId!==user.uid)return;
  if(currentTrip.inviteCode){
    await navigator.clipboard?.writeText(currentTrip.inviteCode).catch(()=>{});
    return alert(`이 방의 고정 코드는 ${currentTrip.inviteCode}입니다.`);
  }
  const roomCode=code(),batch=writeBatch(db);
  batch.set(doc(db,'invites',roomCode),{tripId:currentTrip.id,ownerId:user.uid,createdAt:serverTimestamp(),permanent:true});
  batch.update(doc(db,'trips',currentTrip.id),{inviteCode:roomCode,bannedMemberIds:currentTrip.bannedMemberIds||[]});
  await batch.commit();
  await navigator.clipboard?.writeText(roomCode).catch(()=>{});
  alert(`이 방의 고정 코드 ${roomCode}가 발급되었습니다. 코드는 변경되지 않습니다.`);
}
async function removeMember(uid){
  if(!currentTrip||currentTrip.ownerId!==user.uid||uid===user.uid)return;
  const member=currentTrip.members?.[uid];
  if(!member)return;
  if(!confirm(`${member.nickname||member.email}님을 이 여행에서 내보낼까요? 해당 사용자는 즉시 여행 데이터에 접근할 수 없게 됩니다.`))return;
  try{
    await updateDoc(doc(db,'trips',currentTrip.id),{memberIds:arrayRemove(uid),bannedMemberIds:arrayUnion(uid),[`members.${uid}`]:deleteField(),updatedAt:serverTimestamp(),updatedBy:user.uid});
  }catch(e){alert(`내보내지 못했습니다: ${e.message||e}`);}
}
async function leaveTrip(){
  if(!currentTrip||currentTrip.ownerId===user.uid)return alert('방장은 바로 탈퇴할 수 없습니다. 먼저 방장 권한을 이전해야 합니다.');
  if(!confirm('이 여행에서 탈퇴할까요? 탈퇴 즉시 여행 데이터에 접근할 수 없게 됩니다.'))return;
  const tripId=currentTrip.id;
  try{
    cleanupSub();
    await updateDoc(doc(db,'trips',tripId),{memberIds:arrayRemove(user.uid),[`members.${user.uid}`]:deleteField(),updatedAt:serverTimestamp(),updatedBy:user.uid});
    $('#tripView').classList.add('hidden');$('#homeView').classList.remove('hidden');currentTrip=null;
  }catch(e){
    alert(`탈퇴하지 못했습니다: ${e.message||e}`);
    await openTrip(tripId).catch(()=>showHome());
  }
}
function renderMembers(){
  const owner=currentTrip.ownerId===user.uid;
  const inviteCard=owner?`<div class="card"><b>여행 고정 입장 코드</b><p class="big">${currentTrip.inviteCode?esc(currentTrip.inviteCode):'아직 발급하지 않음'}</p><p class="note">이 코드는 해당 여행방에서 계속 유지됩니다. 로그인한 동행자가 홈의 “초대코드 참가”에 입력하면 언제든 이 방에 들어올 수 있습니다.</p><div class="actions">${currentTrip.inviteCode?'<button id="memberCopyInvite" class="btn primary">고정 코드 복사</button>':'<button id="issueInviteBtn" class="btn primary">고정 코드 발급</button>'}</div></div>`:`<div class="card"><b>초대는 방장이 관리합니다</b><p class="note">현재 여행에 이미 참여 중입니다. 새로운 동행자에게 입장 코드를 전달해야 한다면 방장에게 요청하세요.</p></div>`;
  const members=Object.entries(currentTrip.members||{}).map(([uid,m])=>`<div class="item"><div><h4>${esc(m.nickname||m.email)}</h4><div class="sub">${esc(m.email||'')} · ${m.role==='owner'?'방장':'동행자'}</div></div><div class="actions">${uid===user.uid?'<span class="pill">나</span>':''}${owner&&uid!==user.uid?`<button class="btn small danger-btn" data-remove-member="${uid}">내보내기</button>`:''}</div></div>`).join('');
  const leaveCard=!owner?`<div class="card leave-card"><b>여행에서 나가기</b><p class="note">탈퇴하면 이 여행의 일정과 지출을 더 이상 볼 수 없습니다. 자발적으로 나간 뒤에는 기존 고정 코드로 다시 참여할 수 있습니다.</p><button id="leaveTripBtn" class="btn danger-btn">여행 탈퇴</button></div>`:`<div class="card"><b>방장은 탈퇴할 수 없습니다</b><p class="note">여행을 떠나려면 먼저 다른 동행자에게 방장 권한을 이전해야 합니다.</p></div>`;
  $('#panel-members').innerHTML=`<div class="section-title"><h2>동행자</h2></div>${inviteCard}<div class="section-title"><h2>${currentTrip.memberIds?.length||1}명 참여 중</h2></div><div class="list">${members}</div><div class="section-title"><h2>참여 관리</h2></div>${leaveCard}`;
  if(owner){
    const issue=$('#issueInviteBtn');if(issue)issue.onclick=issueInviteCode;
    const copy=$('#memberCopyInvite');if(copy)copy.onclick=async()=>{await navigator.clipboard.writeText(currentTrip.inviteCode);alert('초대코드를 복사했습니다.')};
    $$('[data-remove-member]').forEach(b=>b.onclick=()=>removeMember(b.dataset.removeMember));
  }else{
    const leave=$('#leaveTripBtn');if(leave)leave.onclick=leaveTrip;
  }
}

function selected(value,current){return value===current?'selected':''}
function tripEditForm(){
  const foreign=currentTrip.foreignCurrencies?.[0]||'JPY';
  modal(`<h3>여행 정보 수정</h3>
    <div class="field"><label>여행 이름</label><input id="teName" value="${esc(currentTrip.name||'')}"></div>
    <div class="row"><div class="field"><label>출발일</label><input id="teStart" type="date" value="${esc(currentTrip.startDate||'')}"></div><div class="field"><label>종료일</label><input id="teEnd" type="date" value="${esc(currentTrip.endDate||'')}"></div></div>
    <div class="field"><label>대표 여행지</label><input id="teDest" value="${esc(currentTrip.destination||'')}"></div>
    <div class="row"><div class="field"><label>기준 통화</label><select id="teBase">${currencyOptions(currentTrip.baseCurrency)}</select></div><div class="field"><label>현지 통화</label><select id="teForeign">${currencyOptions(foreign)}</select></div></div>
    <div class="field"><label>총 여행 예산</label><input id="teBudget" type="number" min="0" value="${Number(currentTrip.budget||0)}"></div>
    <p id="teMsg" class="note">기존 지출이 없는 경우에만 기준 통화를 변경할 수 있습니다.</p>
    <div class="row"><button class="btn" data-close="1">취소</button><button id="teSave" class="btn primary">수정 저장</button></div>`);
  $('#teSave').onclick=async()=>{
    const button=$('#teSave'),message=$('#teMsg');
    try{
      const name=$('#teName').value.trim(),startDate=$('#teStart').value,endDate=$('#teEnd').value,newBase=$('#teBase').value;
      if(!name)throw Error('여행 이름을 입력해 주세요.');
      if(!startDate||!endDate||endDate<startDate)throw Error('여행 기간을 올바르게 입력해 주세요.');
      if(newBase!==currentTrip.baseCurrency&&(cache.expenses||[]).length)throw Error('기존 지출이 있는 여행은 기준 통화를 변경할 수 없습니다. 지출 통화 표시가 잘못되는 것을 방지하기 위한 제한입니다.');
      button.disabled=true;button.textContent='저장 중…';
      const updates={name,startDate,endDate,destination:$('#teDest').value.trim(),baseCurrency:newBase,foreignCurrencies:[$('#teForeign').value],budget:Number($('#teBudget').value||0),updatedAt:serverTimestamp(),updatedBy:user.uid};
      const batch=writeBatch(db);
      batch.update(doc(db,'trips',currentTrip.id),updates);
      await batch.commit();closeModal();
    }catch(e){message.textContent=e.message||String(e);button.disabled=false;button.textContent='수정 저장';}
  };
}
function editRecord(sub,id){
  const item=(cache[sub]||[]).find(x=>x.id===id);
  if(!item)return alert('수정할 항목을 찾지 못했습니다.');
  let body='';
  if(sub==='itinerary')body=`<div class="row"><div class="field"><label>날짜</label><select id="edDate">${days().map(d=>`<option ${selected(d,item.date)}>${d}</option>`).join('')}</select></div><div class="field"><label>시간</label><input id="edTime" type="time" value="${esc(item.time||'')}"></div></div><div class="field"><label>일정명</label><input id="edTitle" value="${esc(item.title||'')}"></div><div class="field"><label>장소</label><input id="edPlace" value="${esc(item.place||'')}"></div><div class="field"><label>메모</label><textarea id="edNote">${esc(item.note||'')}</textarea></div>`;
  if(sub==='places')body=`<div class="field"><label>Google Maps 공유 링크</label><input id="edUrl" value="${esc(item.mapsUrl||'')}"><p id="edLinkMsg" class="note"></p></div><input id="edLat" type="hidden" value="${item.lat??''}"><input id="edLng" type="hidden" value="${item.lng??''}"><div class="field"><label>장소명</label><input id="edName" value="${esc(item.name||'')}"></div><div class="field"><label>분류</label><select id="edCategory">${['관광','맛집','카페','쇼핑','야경','숙소','기타'].map(v=>`<option ${selected(v,item.category)}>${v}</option>`).join('')}</select></div><div class="field"><label>메모</label><textarea id="edNote">${esc(item.note||'')}</textarea></div>`;
  if(sub==='flights')body=`<div class="row"><div class="field"><label>항공사</label><input id="edAirline" value="${esc(item.airline||'')}"></div><div class="field"><label>편명</label><input id="edFlightNo" value="${esc(item.flightNo||'')}"></div></div><div class="field"><label>날짜</label><input id="edDate" type="date" value="${esc(item.date||'')}"></div><div class="row"><div class="field"><label>출발지</label><input id="edFrom" value="${esc(item.from||'')}"></div><div class="field"><label>출발시간</label><input id="edDepart" type="time" value="${esc(item.depart||'')}"></div></div><div class="row"><div class="field"><label>도착지</label><input id="edTo" value="${esc(item.to||'')}"></div><div class="field"><label>도착시간</label><input id="edArrive" type="time" value="${esc(item.arrive||'')}"></div></div><div class="field"><label>예약번호</label><input id="edBooking" value="${esc(item.booking||'')}"></div>`;
  if(sub==='stays')body=`<div class="field"><label>숙소명</label><input id="edName" value="${esc(item.name||'')}"></div><div class="row"><div class="field"><label>체크인</label><input id="edCheckin" type="date" value="${esc(item.checkin||'')}"></div><div class="field"><label>체크아웃</label><input id="edCheckout" type="date" value="${esc(item.checkout||'')}"></div></div><div class="field"><label>주소</label><input id="edAddress" value="${esc(item.address||'')}"></div><div class="field"><label>예약번호</label><input id="edBooking" value="${esc(item.booking||'')}"></div>`;
  if(sub==='expenses')body=`<div class="field"><label>내용</label><input id="edTitle" value="${esc(item.title||'')}"></div><div class="row"><div class="field"><label>금액</label><input id="edAmount" type="number" value="${Number(item.originalAmount||0)}"></div><div class="field"><label>통화</label><select id="edCurrency">${currencyOptions(item.currency)}</select></div></div><div class="field"><label>수동 환율 (선택)</label><input id="edManualRate" type="number" min="0" step="any" value="${item.fxSource==='manual'?Number(item.fxRate||0):''}" placeholder="환전 기록이 없을 때 입력"></div><div class="row"><div class="field"><label>비용 유형</label><select id="edType"><option value="shared" ${selected('shared',item.type)}>공동비용</option><option value="personal" ${selected('personal',item.type)}>개인비용</option></select></div><div class="field"><label>실제 결제자</label><select id="edPayer">${memberOptions(item.payerUid)}</select></div></div><div class="field"><label>개인비용 사용자</label><select id="edPersonal">${memberOptions(item.personalUid)}</select></div><p id="editMsg" class="note"></p>`;
  if(sub==='exchanges')body=`<div class="field"><label>환전자</label><select id="edMember">${memberOptions(item.memberUid)}</select></div><div class="field"><label>환전일</label><input id="edDate" type="date" value="${esc(item.date||'')}"></div><div class="row"><div class="field"><label>사용한 기준 통화</label><input id="edBase" type="number" value="${Number(item.baseSpent||0)}"></div><div class="field"><label>받은 외화</label><input id="edForeign" type="number" value="${Number(item.foreignReceived||0)}"></div></div>`;
  if(sub==='packing')body=`<div class="field"><label>준비물</label><input id="edText" value="${esc(item.text||'')}"></div>`;
  if(sub==='memos')body=`<div class="field"><label>제목</label><input id="edTitle" value="${esc(item.title||'')}"></div><div class="field"><label>내용</label><textarea id="edText">${esc(item.text||'')}</textarea></div>`;
  modal(`<h3>항목 수정</h3>${body}<div class="row"><button class="btn" data-close="1">취소</button><button id="editSave" class="btn primary">수정 저장</button></div>`);
  if(sub==='places')bindPlaceLinkInput('ed');
  $('#editSave').onclick=async()=>{
    const button=$('#editSave');button.disabled=true;
    try{
      let data={updatedAt:serverTimestamp(),updatedBy:user.uid};
      if(sub==='itinerary')Object.assign(data,{date:$('#edDate').value,time:$('#edTime').value,title:$('#edTitle').value.trim(),place:$('#edPlace').value.trim(),note:$('#edNote').value.trim()});
      if(sub==='places')Object.assign(data,{name:$('#edName').value.trim(),category:$('#edCategory').value,note:$('#edNote').value.trim(),mapsUrl:$('#edUrl').value.trim(),lat:$('#edLat').value===''?null:Number($('#edLat').value),lng:$('#edLng').value===''?null:Number($('#edLng').value)});
      if(sub==='flights')Object.assign(data,{airline:$('#edAirline').value.trim(),flightNo:$('#edFlightNo').value.trim(),date:$('#edDate').value,from:$('#edFrom').value.trim(),depart:$('#edDepart').value,to:$('#edTo').value.trim(),arrive:$('#edArrive').value,booking:$('#edBooking').value.trim()});
      if(sub==='stays')Object.assign(data,{name:$('#edName').value.trim(),checkin:$('#edCheckin').value,checkout:$('#edCheckout').value,address:$('#edAddress').value.trim(),booking:$('#edBooking').value.trim()});
      if(sub==='expenses'){const amount=Number($('#edAmount').value),currency=$('#edCurrency').value,converted=await fxToBase(currency,amount,Number($('#edManualRate').value||0));Object.assign(data,{title:$('#edTitle').value.trim(),originalAmount:amount,currency,baseAmount:converted.base,fxRate:converted.rate,fxSource:converted.source,type:$('#edType').value,payerUid:$('#edPayer').value,personalUid:$('#edType').value==='personal'?$('#edPersonal').value:null});}
      if(sub==='exchanges'){const baseSpent=Number($('#edBase').value),foreignReceived=Number($('#edForeign').value);Object.assign(data,{memberUid:$('#edMember').value,date:$('#edDate').value,baseSpent,foreignReceived,rate:foreignReceived?baseSpent/foreignReceived:0});}
      if(sub==='packing')Object.assign(data,{text:$('#edText').value.trim()});
      if(sub==='memos')Object.assign(data,{title:$('#edTitle').value.trim(),text:$('#edText').value});
      await updateDoc(doc(db,'trips',currentTrip.id,sub,id),data);closeModal();
    }catch(e){alert(e.message||String(e));button.disabled=false;}
  };
}
function bindDeletes(){
  $$('[data-edit]').forEach(b=>b.onclick=()=>{const [sub,id]=b.dataset.edit.split(':');editRecord(sub,id)});
  $$('[data-del]').forEach(b=>b.onclick=async()=>{const [sub,id]=b.dataset.del.split(':');if(confirm('삭제할까요?'))await deleteDoc(doc(db,'trips',currentTrip.id,sub,id))});
}

window.addEventListener('offline',()=>{if(user){const saved=readTripBackup();if(saved.length)renderTripGrid(saved,'오프라인입니다. 마지막 여행 목록을 표시합니다.')}});

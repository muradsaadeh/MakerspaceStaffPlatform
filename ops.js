// ═══════════════════════════════════════════════════════════════════════════
// ops.js — Calendar, Machines, Preventive checks, Issues, Sign-off, Logs
// Used by staff.html (juniors + seniors) and admin.html.
// ═══════════════════════════════════════════════════════════════════════════
import { db, ref, set, update, push, remove, onValue, esc, LOCS, LOC_STYLE, SITES, SITE_STYLE, locToSite,
         todayStr, addDays, weekStart, parseDate, fmtDate, niceDate, niceTs, FREQ, periodKey, periodLabel,
         MONTHS, DAY_ABBR, empName, empEmail, asArray, modal, closeModal, toast, sendEmail, emailReady,
         EMAILJS_CONFIG, ROLES } from './common.js';

// ── Live data store ────────────────────────────────────────────────────────
export const S = { me:null, rotation:null, machines:{}, pm:{}, pmSignoff:{}, issues:{}, issueFix:{}, events:{}, roles:{}, ready:false };
let onChange = ()=>{};
let _raf = 0;
function changed(){ cancelAnimationFrame(_raf); _raf = requestAnimationFrame(()=>onChange()); }

export function startOps(me, cb){
  S.me = me; onChange = cb || (()=>{});
  const nodes = ['rotation','machines','pm','pmSignoff','issues','issueFix','events','roles'];
  let pending = new Set(nodes);
  nodes.forEach(k=>onValue(ref(db,k), snap=>{
    S[k] = snap.val() || (k==='rotation' ? null : {});
    pending.delete(k); if(!pending.size) S.ready = true;
    changed();
  }, err=>{ console.error(k, err); pending.delete(k); if(!pending.size) S.ready=true; changed(); }));
}

// ── Shortcuts ──────────────────────────────────────────────────────────────
const isSenior = ()=> S.me && (S.me.role==='senior' || S.me.role==='admin');
const isAdmin  = ()=> S.me && S.me.role==='admin';
const emps = ()=> asArray(S.rotation?.employees);
const assign = (d,ei)=> S.rotation?.schedule?.[`${d}:${ei}`] || 'Day Off';
const pmKey = (mid,clid,pk)=> `${mid}__${clid}__${pk}`;
const daysBetween = (a,b)=> Math.round((parseDate(b)-parseDate(a))/864e5);
const lastOfMonth = d => { const x=parseDate(d); return fmtDate(new Date(x.getFullYear(), x.getMonth()+1, 0)); };
const siteChip = s => s ? `<span class="oc" style="background:${(SITE_STYLE[s]||{}).bg||'#eee'};color:${(SITE_STYLE[s]||{}).fg||'#333'}">${esc(s)}</span>` : '';
const locChip = l => { const s=LOC_STYLE[l]||LOC_STYLE['Day Off']; return `<span class="oc" style="background:${s.bg};color:${s.fg}">${esc(l)}</span>`; };
const go = tab => window.opsGo && window.opsGo(tab);

export const SEV = {low:'Low', medium:'Medium', high:'High', down:'Machine down'};
const SEV_CLS = {low:'oc-info', medium:'oc-warn', high:'oc-bad', down:'oc-bad'};
export const STATES = {open:'Open', in_progress:'In progress', waiting_parts:'Waiting for parts', resolved:'Resolved'};
const STATE_CLS = {open:'oc-bad', in_progress:'oc-warn', waiting_parts:'oc-warn', resolved:'oc-ok'};
const AFTER = ['Good','Working with limitations','Out of service'];

function machList(includeRetired=false){
  const order = s => { const i=SITES.indexOf(s); return i<0?99:i; };
  return Object.entries(S.machines||{}).map(([id,m])=>({id,...m}))
    .filter(m=>includeRetired || !m.retired)
    .sort((a,b)=> order(a.site)-order(b.site) || String(a.area).localeCompare(b.area) || String(a.name).localeCompare(b.name));
}
const machine = id => S.machines?.[id] ? {id, ...S.machines[id]} : null;
const checklists = m => asArray(m?.checklists).map((c,i)=>({id:c.id||('c'+i), freq:c.freq||'monthly', name:c.name||'', items:asArray(c.items)}));
const clName = cl => cl.name || (FREQ[cl.freq]+' check');
const fixState = id => S.issueFix?.[id]?.state || 'open';
const issueList = () => Object.entries(S.issues||{}).map(([id,x])=>({id,...x, fix:S.issueFix?.[id]||null, state:fixState(id)})).sort((a,b)=>(b.at||0)-(a.at||0));
const openIssuesFor = mid => issueList().filter(i=>i.machineId===mid && i.state!=='resolved');

function checkStatus(m, cl, date=todayStr()){
  const pk = periodKey(cl.freq, date), key = pmKey(m.id, cl.id, pk);
  const rec = S.pm?.[key], sign = S.pmSignoff?.[key];
  return {pk, key, rec, sign, state: rec ? (sign ? 'signed' : 'done') : 'due'};
}
function dueChip(cl, st, date=todayStr()){
  if(st.state==='signed') return `<span class="oc oc-ok">&#10003; Signed off</span>`;
  if(st.state==='done') {
    const fix = asArray(st.rec.items).some(i=>i.s==='fix') || st.rec.overall?.s==='fix';
    return `<span class="oc ${fix?'oc-bad':'oc-info'}">&#10003; Done${fix?' · needs fixing':''}</span>`;
  }
  if(cl.freq==='daily') return `<span class="oc oc-warn">Due today</span>`;
  const end = cl.freq==='weekly' ? addDays(weekStart(date),6) : lastOfMonth(date);
  const left = daysBetween(date, end);
  if(left<=(cl.freq==='weekly'?1:5)) return `<span class="oc oc-bad">Due ${left===0?'today':'in '+left+'d'}</span>`;
  return `<span class="oc oc-warn">Due this ${cl.freq==='weekly'?'week':'month'}</span>`;
}
function hasFix(rec){ return rec && (asArray(rec.items).some(i=>i.s==='fix') || rec.overall?.s==='fix'); }
function cellTxt(it){
  if(!it || !it.s) return '';
  if(it.s==='ok') return it.c ? `ok — ${it.c}` : 'ok';
  if(it.s==='fix') return it.c || 'Needs fixing';
  return 'N/A';
}
function machineOptions(selected='', withOther=false){
  const groups = {};
  machList().forEach(m=>{ const g=`${m.site||'—'} · ${m.area||'Other'}`; (groups[g]=groups[g]||[]).push(m); });
  return `<option value="">— choose machine —</option>` +
    Object.entries(groups).map(([g,ms])=>`<optgroup label="${esc(g)}">${ms.map(m=>`<option value="${esc(m.id)}"${m.id===selected?' selected':''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('') +
    (withOther?`<option value="__other"${selected==='__other'?' selected':''}>Other / not in list…</option>`:'');
}
function namesDatalist(){ return `<datalist id="dl-names">${emps().map(e=>`<option value="${esc(empName(e))}">`).join('')}</datalist>`; }
function siteSelect(id, val, allLabel='All sites'){
  return `<select class="f-sel" id="${id}" style="width:auto">${[['all',allLabel],...SITES.map(s=>[s,s])].map(([v,l])=>`<option value="${esc(v)}"${v===val?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
}
function loading(el){ el.innerHTML = `<div class="ops-empty">Loading…</div>`; }

// ═══════════════════════════════════════════════════════════════════════════
// MY DAY
// ═══════════════════════════════════════════════════════════════════════════
let mdSite = null;
export function renderMyDay(el){
  if(!S.ready) return loading(el);
  const me=S.me, t=todayStr();
  const myLoc = me.empIdx>=0 ? assign(t, me.empIdx) : null;
  const note = me.empIdx>=0 ? (S.rotation?.notes?.[`${t}:${me.empIdx}`]||'') : '';
  const autoSite = locToSite(myLoc);
  const site = mdSite || autoSite || 'all';

  // checks at site
  const rows=[]; let due=0, done=0;
  machList().filter(m=>site==='all'||m.site===site).forEach(m=>checklists(m).forEach(cl=>{
    const st=checkStatus(m,cl,t);
    if(st.state==='due') due++; else done++;
    if(st.state!=='signed') rows.push({m,cl,st});
  }));
  rows.sort((a,b)=>(a.st.state==='due'?0:1)-(b.st.state==='due'?0:1));
  const siteIssues = issueList().filter(i=>i.state!=='resolved' && (site==='all'||i.site===site));
  const todayEv = Object.entries(S.events||{}).map(([id,e])=>({id,...e})).filter(e=>e.date===t).sort((a,b)=>String(a.start).localeCompare(b.start));
  const upcomingMine = Object.entries(S.events||{}).map(([id,e])=>({id,...e}))
    .filter(e=>e.date>t && e.date<=addDays(t,7) && asArray(e.staff).includes(me.name)).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  const waiting = Object.keys(S.pm||{}).filter(k=>!S.pmSignoff?.[k]).length;

  let week='';
  if(me.empIdx>=0){
    week = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">` + [0,1,2,3,4,5,6].map(n=>{
      const d=addDays(t,n), a=assign(d,me.empIdx), s=LOC_STYLE[a]||LOC_STYLE['Day Off'];
      return `<div style="background:${s.bg};color:${s.fg};border-radius:6px;padding:3px 7px;font-size:.7rem;font-weight:600;text-align:center">${DAY_ABBR[parseDate(d).getDay()]} ${parseDate(d).getDate()}<br>${esc(a==='Day Off'?'Off':a)}</div>`;
    }).join('') + `</div>`;
  }

  el.innerHTML = `
  <div class="today-hero">
    <div style="flex:1;min-width:200px">
      <div class="sm">${parseDate(t).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})} · ${esc(ROLES[me.role])}</div>
      <div class="big">Hi ${esc(me.name.split(' ')[0])} &#128075;</div>
      <div class="sm" style="margin-top:4px">${me.empIdx>=0 ? `Today you're at ${locChip(myLoc)}${note?` · &#128204; ${esc(note)}`:''}` : `Your email isn't linked to the staff list yet — ask the admin to add it in Names.`}</div>
      ${week}
    </div>
    <button class="ob" onclick="ops.openReport()">&#9888;&#65039; Report a problem</button>
  </div>
  <div class="kpis">
    <div class="kpi"><b style="color:${due?'#B45309':'#16A34A'}">${due}</b><span>Checks due${site!=='all'?' at '+esc(site):''}</span></div>
    <div class="kpi"><b>${done}</b><span>Checks done this period</span></div>
    <div class="kpi"><b style="color:${siteIssues.length?'#DC2626':'#16A34A'}">${siteIssues.length}</b><span>Open issues</span></div>
    <div class="kpi"><b>${todayEv.length}</b><span>Events today</span></div>
    ${isSenior()?`<div class="kpi" style="cursor:pointer" onclick="opsGo('signoff')"><b style="color:${waiting?'#4338CA':'#16A34A'}">${waiting}</b><span>Waiting for sign-off &#8594;</span></div>`:''}
  </div>
  <div class="ops-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="ops-card">
      <div class="ops-card-h"><h3>&#128295; Maintenance to do</h3>${siteSelect('md-site', site)}</div>
      <div class="ops-card-b">${rows.length ? rows.map(({m,cl,st})=>`
        <div class="chk-row"><div class="nm"><b>${esc(m.name)}</b><span>${esc(clName(cl))} · ${esc(m.area||'')}${site==='all'?' · '+esc(m.site):''}</span></div>
          ${dueChip(cl,st,t)} <button class="ob ob-sm ${st.state==='due'?'ob-p':''}" onclick="ops.openCheck('${esc(m.id)}','${esc(cl.id)}')">${st.state==='due'?'Do check':'View'}</button></div>`).join('')
        : `<div class="ops-empty">All checks done for this period &#127881;</div>`}</div>
    </div>
    <div>
      <div class="ops-card">
        <div class="ops-card-h"><h3>&#128197; Today</h3><button class="ob ob-sm" onclick="opsGo('calendar')">Calendar</button></div>
        <div class="ops-card-b ev-list">${todayEv.length ? todayEv.map(evRow).join('') : `<div class="ops-empty" style="padding:1rem">No events today</div>`}
        ${upcomingMine.length?`<div class="small muted" style="margin:10px 0 4px;font-weight:600">Coming up for you</div>${upcomingMine.map(evRow).join('')}`:''}</div>
      </div>
      <div class="ops-card">
        <div class="ops-card-h"><h3>&#9888;&#65039; Open issues</h3><button class="ob ob-sm" onclick="opsGo('issues')">All issues</button></div>
        <div class="ops-card-b">${siteIssues.slice(0,6).map(i=>`<div class="chk-row"><div class="nm"><b>${esc(i.machineName)}</b><span>${esc(i.issue).slice(0,90)}</span></div><span class="oc ${SEV_CLS[i.severity]||''}">${esc(SEV[i.severity]||'')}</span><span class="oc ${STATE_CLS[i.state]}">${STATES[i.state]}</span></div>`).join('') || `<div class="ops-empty" style="padding:1rem">No open issues</div>`}</div>
      </div>
    </div>
  </div>`;
  el.querySelector('#md-site').onchange = e=>{ mdSite=e.target.value; renderMyDay(el); };
}
function evRow(e){
  const s=LOC_STYLE[e.loc]||LOC_STYLE['All'];
  const d=parseDate(e.date);
  return `<div class="ev-item" onclick="ops.viewEvent('${esc(e.id)}')">
    <div class="ev-date" style="background:${s.bg};color:${s.fg}">${d.getDate()}<small>${DAY_ABBR[d.getDay()]}</small></div>
    <div style="min-width:0"><div style="font-weight:600;font-size:.86rem">${esc(e.title)}</div>
    <div class="small muted">${esc(e.start||'')}${e.end?'–'+esc(e.end):''} · ${esc(e.loc||'')}${asArray(e.staff).length?' · '+esc(asArray(e.staff).join(', ')):''}</div></div></div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE BOARD
// ═══════════════════════════════════════════════════════════════════════════
let bSite = null, bFreq='all';
export function renderBoard(el){
  if(!S.ready) return loading(el);
  if(bSite===null){ const l = S.me.empIdx>=0 ? assign(todayStr(), S.me.empIdx) : null; bSite = locToSite(l) || 'all'; }
  const t=todayStr();
  const ms = machList().filter(m=>bSite==='all'||m.site===bSite);
  const areas = {};
  ms.forEach(m=>{ const k = bSite==='all' ? `${m.site} · ${m.area||'Other'}` : (m.area||'Other'); (areas[k]=areas[k]||[]).push(m); });
  el.innerHTML = `
  <div class="ops-bar"><h2>Preventive maintenance</h2>
    ${siteSelect('b-site', bSite)}
    <div class="seg" id="b-freq">${['all','daily','weekly','monthly'].map(f=>`<button data-f="${f}" class="${bFreq===f?'on':''}">${f==='all'?'All':FREQ[f]}</button>`).join('')}</div>
    <button class="ob" onclick="ops.openReport()">&#9888;&#65039; Report problem</button>
  </div>
  ${ms.length ? `<div class="board">${Object.entries(areas).map(([a,list])=>{
      let doneN=0,totN=0;
      const cards = list.map(m=>{
        const cls = checklists(m).filter(cl=>bFreq==='all'||cl.freq===bFreq);
        if(!cls.length) return '';
        const oi = openIssuesFor(m.id);
        const down = oi.some(i=>i.severity==='down');
        return `<div class="mcard">
          <div class="mcard-h"><b>${esc(m.name)}</b>${down?`<span class="oc oc-bad">Out of service</span>`:oi.length?`<span class="oc oc-warn">${oi.length} issue${oi.length>1?'s':''}</span>`:''}</div>
          ${cls.map(cl=>{ const st=checkStatus(m,cl,t); totN++; if(st.state!=='due') doneN++;
            return `<div class="chk-row"><div class="nm"><b style="font-weight:500">${esc(clName(cl))}</b><span>${cl.items.length} items · ${esc(periodLabel(st.pk))}${st.rec?' · '+esc(st.rec.by):''}</span></div>${dueChip(cl,st,t)}
              <button class="ob ob-sm ${st.state==='due'?'ob-p':''}" onclick="ops.openCheck('${esc(m.id)}','${esc(cl.id)}')">${st.state==='due'?'Check':'View'}</button></div>`; }).join('')}
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="ob ob-sm" onclick="ops.openReport('${esc(m.id)}')">Report issue</button>
            ${isSenior()?`<button class="ob ob-sm" onclick="ops.openLog('${esc(m.id)}')">Log</button>`:''}
          </div></div>`;
      }).join('');
      if(!cards) return '';
      return `<div class="board-col"><h4><span>${esc(a)}</span><span class="muted small">${doneN}/${totN}</span></h4>${cards}</div>`;
    }).join('')}</div>`
  : `<div class="ops-empty">No machines ${bSite==='all'?'':'at '+esc(bSite)+' '}yet.${isSenior()?' Add them in the Machines tab.':''}</div>`}`;
  el.querySelector('#b-site').onchange=e=>{ bSite=e.target.value; renderBoard(el); };
  el.querySelectorAll('#b-freq button').forEach(b=>b.onclick=()=>{ bFreq=b.dataset.f; renderBoard(el); });
}

// ── Check form ────────────────────────────────────────────────────────────
export function openCheck(mid, clid, date=todayStr()){
  const m = machine(mid); if(!m) return;
  const cl = checklists(m).find(c=>c.id===clid); if(!cl) return;
  const st = checkStatus(m, cl, date);
  const locked = !!st.sign && !isSenior();
  const prev = {}; asArray(st.rec?.items).forEach(i=>prev[i.label]=i);
  const labels = [...cl.items]; asArray(st.rec?.items).forEach(i=>{ if(!labels.includes(i.label)) labels.push(i.label); });
  const tri = (name, val, opts) => `<div class="tri">${opts.map(([v,l,c])=>`<label class="${c}"><input type="radio" name="${name}" value="${v}"${val===v?' checked':''}${locked?' disabled':''}><span>${l}</span></label>`).join('')}</div>`;
  const box = modal(`
    <h3>${esc(m.name)}</h3>
    <div class="om-sub">${esc(clName(cl))} · ${esc(periodLabel(st.pk))} · ${esc(m.site||'')}${st.rec?` · last saved by <b>${esc(st.rec.by)}</b> ${esc(niceTs(st.rec.at))}`:''}
      ${st.sign?`<br><span class="oc oc-ok">&#10003; Signed off by ${esc(st.sign.by)} ${esc(niceTs(st.sign.at))}</span>`:''}</div>
    ${isSenior()?`<div class="f-row" style="margin-bottom:8px"><div><label class="f-lbl" style="margin-top:0">Check date (back-fill an older period)</label><input type="date" class="f-in" id="ck-date" value="${date}" max="${todayStr()}"></div></div>`:''}
    <div id="ck-items">${labels.map((lb,i)=>`<div class="ci"><div class="ci-top"><span class="lbl">${esc(lb)}${!cl.items.includes(lb)?' <span class="small muted">(old item)</span>':''}</span>
        ${tri('ci'+i, prev[lb]?.s||'', [['ok','OK','s-ok'],['fix','Needs fixing','s-fix'],['na','N/A','s-na']])}</div>
        <input class="ci-cmt" id="cc${i}" placeholder="Comment (optional) e.g. Need alignment" value="${esc(prev[lb]?.c||'')}"${locked?' disabled':''}></div>`).join('')}</div>
    <div class="ci" style="background:#F8FAFC"><div class="ci-top"><span class="lbl">Overall status</span>${tri('ov', st.rec?.overall?.s||'', [['ok','OK','s-ok'],['fix','Needs fixing','s-fix']])}</div>
      <input class="ci-cmt" id="ov-c" placeholder="e.g. The head stuck, need fixing" value="${esc(st.rec?.overall?.c||'')}"${locked?' disabled':''}></div>
    <label class="f-lbl">Notes</label><textarea class="f-ta" id="ck-notes"${locked?' disabled':''}>${esc(st.rec?.notes||'')}</textarea>
    <div id="ck-raise" style="display:none;margin-top:10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:8px 10px">
      <label style="font-size:.84rem;display:flex;gap:6px;align-items:center;font-weight:600;color:#991B1B"><input type="checkbox" id="ck-raise-on" checked> Report this to the seniors as a corrective issue</label>
      <div class="f-row" style="margin-top:6px"><select class="f-sel" id="ck-sev">${Object.entries(SEV).map(([k,v])=>`<option value="${k}"${k==='medium'?' selected':''}>${v}</option>`).join('')}</select></div>
    </div>
    <div class="ck-err small" style="color:#DC2626;margin-top:6px"></div>
    <div class="om-actions"><button class="ob" onclick="ops.closeModal()">${locked?'Close':'Cancel'}</button>${locked?'':`<button class="ob ob-p" id="ck-save">Save check</button>`}</div>`, {wide:true});
  const dateIn = box.querySelector('#ck-date');
  if(dateIn) dateIn.onchange = ()=>{ if(dateIn.value) openCheck(mid, clid, dateIn.value); };
  const raise = box.querySelector('#ck-raise');
  const refresh = ()=>{ const anyFix = !!box.querySelector('input[value="fix"]:checked'); raise.style.display = (anyFix && !st.rec) ? 'block' : 'none'; };
  box.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener('change',refresh)); refresh();
  const save = box.querySelector('#ck-save');
  if(save) save.onclick = async ()=>{
    const items = labels.map((lb,i)=>({label:lb, s: box.querySelector(`input[name="ci${i}"]:checked`)?.value||'', c: box.querySelector('#cc'+i).value.trim()}));
    const ov = box.querySelector('input[name="ov"]:checked')?.value||'';
    const missing = items.filter((it,i)=>!it.s && i<cl.items.length).length;
    if(missing || !ov){ box.querySelector('.ck-err').textContent = `Please mark every item${!ov?' and the overall status':''} (${missing} left).`; return; }
    const rec = {machineId:m.id, machineName:m.name, site:m.site||'', area:m.area||'', checklistId:cl.id, checklistName:clName(cl), freq:cl.freq,
      period:st.pk, date, items: items.filter(it=>it.s), overall:{s:ov, c:box.querySelector('#ov-c').value.trim()},
      notes: box.querySelector('#ck-notes').value.trim(), by:S.me.name, uid:S.me.uid, at:Date.now()};
    save.disabled = true;
    try{
      await set(ref(db,'pm/'+st.key), rec);
      if(raise.style.display!=='none' && box.querySelector('#ck-raise-on').checked){
        const fixes = rec.items.filter(i=>i.s==='fix').map(i=>i.label+(i.c?` (${i.c})`:''));
        if(rec.overall.s==='fix' && rec.overall.c) fixes.push(rec.overall.c);
        await createIssue({m, issue:`Found during ${clName(cl).toLowerCase()} (${periodLabel(st.pk)}): ${fixes.join('; ')||'needs fixing'}${rec.notes?'. '+rec.notes:''}`,
          severity: box.querySelector('#ck-sev').value, source:'pm', pmKey:st.key});
      }
      closeModal(); toast('Check saved ✓');
    }catch(e){ save.disabled=false; box.querySelector('.ck-err').textContent='Could not save: '+(e.code||e.message); }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ISSUES (corrective maintenance)
// ═══════════════════════════════════════════════════════════════════════════
async function createIssue({m, otherName='', otherSite='', issue, severity='medium', source='manual', pmKey:pk='', date=todayStr()}){
  const rec = {machineId: m?m.id:'', machineName: m?m.name:(otherName||'Other'), site: m?(m.site||''):otherSite, area: m?(m.area||''):'',
    issue, severity, source, pmKey:pk, date, by:S.me.name, uid:S.me.uid, at:Date.now()};
  const r = push(ref(db,'issues'));
  await set(r, rec);
  notifySeniors(rec).catch(e=>console.warn('issue email failed', e));
  return r.key;
}
async function notifySeniors(rec){
  if(!emailReady()) return;
  const roles = S.roles||{};
  const seniors = emps().filter(e=>e && e.uid && ['senior','admin'].includes(roles[e.uid]) && empEmail(e) && e.uid!==S.me.uid);
  for(const s of seniors){
    await sendEmail(EMAILJS_CONFIG.issueTemplateId, {
      to_name: empName(s), to_email: empEmail(s),
      month_label: `New ${SEV[rec.severity]||''} issue — ${rec.machineName} (${rec.site||'—'})`,
      schedule_link: EMAILJS_CONFIG.siteUrl + 'staff.html',
      admin_message: `${rec.by} reported on ${niceDate(rec.date)}: ${rec.issue}`
    });
  }
}

export function openReport(mid=''){
  const box = modal(`
    <h3>Report a problem</h3><div class="om-sub">Goes straight to the senior team${emailReady()?' (they get an email too)':''}.</div>
    <label class="f-lbl">Machine / area</label><select class="f-sel" id="rp-m">${machineOptions(mid, true)}</select>
    <div id="rp-other" style="display:none" class="f-row"><div><label class="f-lbl">What / where</label><input class="f-in" id="rp-on" placeholder="e.g. Workshop door lock"></div>
      <div><label class="f-lbl">Site</label><select class="f-sel" id="rp-os">${SITES.map(s=>`<option>${s}</option>`).join('')}</select></div></div>
    <label class="f-lbl">What's wrong?</label><textarea class="f-ta" id="rp-i" placeholder="e.g. Almost out of lens tissue / The head is stuck and the limit switch isn't triggering"></textarea>
    <label class="f-lbl">How urgent?</label>
    <div class="seg" id="rp-sev">${Object.entries(SEV).map(([k,v])=>`<button data-v="${k}" class="${k==='medium'?'on':''}">${v}</button>`).join('')}</div>
    <div class="rp-err small" style="color:#DC2626;margin-top:6px"></div>
    <div class="om-actions"><button class="ob" onclick="ops.closeModal()">Cancel</button><button class="ob ob-p" id="rp-go">Send report</button></div>`);
  let sev='medium';
  box.querySelectorAll('#rp-sev button').forEach(b=>b.onclick=()=>{ sev=b.dataset.v; box.querySelectorAll('#rp-sev button').forEach(x=>x.classList.toggle('on',x===b)); });
  const sel = box.querySelector('#rp-m');
  sel.onchange = ()=> box.querySelector('#rp-other').style.display = sel.value==='__other' ? 'flex' : 'none';
  box.querySelector('#rp-go').onclick = async ()=>{
    const issue = box.querySelector('#rp-i').value.trim();
    const v = sel.value;
    if(!v || !issue){ box.querySelector('.rp-err').textContent='Pick a machine and describe the problem.'; return; }
    box.querySelector('#rp-go').disabled=true;
    try{
      await createIssue(v==='__other' ? {otherName: box.querySelector('#rp-on').value.trim()||'Other', otherSite: box.querySelector('#rp-os').value, issue, severity:sev}
                                       : {m:machine(v), issue, severity:sev});
      closeModal(); toast('Reported — the seniors can see it now');
    }catch(e){ box.querySelector('#rp-go').disabled=false; box.querySelector('.rp-err').textContent='Could not send: '+(e.code||e.message); }
  };
}

let iState='active', iSite='all', iMine=false;
export function renderIssues(el){
  if(!S.ready) return loading(el);
  let list = issueList();
  const counts = {active:list.filter(i=>i.state!=='resolved').length, resolved:list.filter(i=>i.state==='resolved').length, all:list.length};
  if(iState==='active') list=list.filter(i=>i.state!=='resolved'); else if(iState==='resolved') list=list.filter(i=>i.state==='resolved');
  if(iSite!=='all') list=list.filter(i=>i.site===iSite);
  if(iMine) list=list.filter(i=>i.uid===S.me.uid);
  el.innerHTML = `
  <div class="ops-bar"><h2>Corrective maintenance</h2>
    <div class="seg" id="i-st">${[['active','Open'],['resolved','Resolved'],['all','All']].map(([k,l])=>`<button data-v="${k}" class="${iState===k?'on':''}">${l} (${counts[k]})</button>`).join('')}</div>
    ${siteSelect('i-site', iSite)}
    <label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="i-mine"${iMine?' checked':''}> Reported by me</label>
    <button class="ob ob-p" onclick="ops.openReport()">+ Report problem</button>
    ${isSenior()?`<button class="ob" onclick="ops.openFix(null)">+ Log a repair</button>`:''}
  </div>
  ${list.length ? list.map(i=>`
    <div class="ops-card iss sev-${esc(i.severity)}">
      <div class="ops-card-h"><h3>${esc(i.machineName)}</h3>${siteChip(i.site)}<span class="oc ${SEV_CLS[i.severity]||''}">${esc(SEV[i.severity]||'')}</span><span class="oc ${STATE_CLS[i.state]}">${STATES[i.state]}</span>
        ${isSenior()?`<button class="ob ob-sm ob-p" onclick="ops.openFix('${esc(i.id)}')">Update</button>`:''}
        ${isAdmin()?`<button class="ob ob-sm ob-d" onclick="ops.delIssue('${esc(i.id)}')">&#128465;</button>`:''}</div>
      <div class="ops-card-b">
        <div style="font-size:.9rem;white-space:pre-wrap">${esc(i.issue)}</div>
        <div class="small muted" style="margin-top:4px">Reported by ${esc(i.by)} · ${esc(niceDate(i.date||fmtDate(new Date(i.at))))}${i.source==='pm'?' · from a preventive check':''}</div>
        ${i.fix?`<div style="margin-top:8px;background:#F8FAFC;border-radius:6px;padding:8px;font-size:.82rem">
          ${i.fix.action?`<div><b>Action:</b> ${esc(i.fix.action)}${i.fix.quantity?` · <b>Qty:</b> ${esc(i.fix.quantity)}`:''}</div>`:''}
          ${i.fix.statusAfter?`<div><b>Status after:</b> ${esc(i.fix.statusAfter)}</div>`:''}
          ${i.fix.performedBy?`<div><b>Performed by:</b> ${esc(i.fix.performedBy)}${i.fix.date?' · '+esc(niceDate(i.fix.date)):''}</div>`:''}
          ${i.fix.notes?`<div><b>Notes:</b> ${esc(i.fix.notes)}</div>`:''}
          <div class="small muted">Updated by ${esc(i.fix.by)} ${esc(niceTs(i.fix.at))}</div></div>`:''}
      </div></div>`).join('') : `<div class="ops-empty">Nothing here.</div>`}`;
  el.querySelectorAll('#i-st button').forEach(b=>b.onclick=()=>{ iState=b.dataset.v; renderIssues(el); });
  el.querySelector('#i-site').onchange=e=>{ iSite=e.target.value; renderIssues(el); };
  el.querySelector('#i-mine').onchange=e=>{ iMine=e.target.checked; renderIssues(el); };
}

export function openFix(id){
  const iss = id ? {id, ...S.issues[id]} : null;
  const f = id ? (S.issueFix?.[id]||{}) : {state:'resolved'};
  const box = modal(`
    <h3>${iss?esc(iss.machineName):'Log a repair'}</h3>
    <div class="om-sub">${iss?esc(iss.issue):'Record corrective maintenance directly (also for past repairs).'}</div>
    ${namesDatalist()}
    ${iss?'':`<label class="f-lbl">Machine</label><select class="f-sel" id="fx-m">${machineOptions('')}</select>
      <label class="f-lbl">Issue</label><input class="f-in" id="fx-i" placeholder="e.g. Changed the lens">`}
    <div class="f-row"><div><label class="f-lbl">Status</label><select class="f-sel" id="fx-st">${Object.entries(STATES).map(([k,v])=>`<option value="${k}"${(f.state||'open')===k?' selected':''}>${v}</option>`).join('')}</select></div>
      <div><label class="f-lbl">Date</label><input type="date" class="f-in" id="fx-d" value="${esc(f.date||todayStr())}"></div></div>
    <label class="f-lbl">Action taken</label><input class="f-in" id="fx-a" value="${esc(f.action||'')}" placeholder="e.g. 2 inch lens – Trotec / Item needs to be ordered">
    <div class="f-row"><div><label class="f-lbl">Quantity</label><input class="f-in" id="fx-q" value="${esc(f.quantity||'')}"></div>
      <div><label class="f-lbl">Overall status after</label><select class="f-sel" id="fx-af"><option value="">—</option>${AFTER.map(a=>`<option${f.statusAfter===a?' selected':''}>${a}</option>`).join('')}</select></div></div>
    <label class="f-lbl">Performed by</label><input class="f-in" id="fx-p" list="dl-names" value="${esc(f.performedBy||S.me.name)}">
    <label class="f-lbl">Notes</label><input class="f-in" id="fx-n" value="${esc(f.notes||'')}" placeholder="e.g. Need to call the maintenance company">
    <div class="fx-err small" style="color:#DC2626;margin-top:6px"></div>
    <div class="om-actions"><button class="ob" onclick="ops.closeModal()">Cancel</button><button class="ob ob-p" id="fx-go">Save</button></div>`);
  box.querySelector('#fx-go').onclick = async ()=>{
    const v = k=>box.querySelector(k).value.trim();
    const fix = {state:v('#fx-st'), date:v('#fx-d'), action:v('#fx-a'), quantity:v('#fx-q'), statusAfter:v('#fx-af'), performedBy:v('#fx-p'), notes:v('#fx-n'), by:S.me.name, uid:S.me.uid, at:Date.now()};
    let iid = id;
    try{
      if(!iid){
        const m = machine(v('#fx-m'));
        if(!m || !v('#fx-i')){ box.querySelector('.fx-err').textContent='Pick a machine and describe the issue.'; return; }
        const r = push(ref(db,'issues'));
        await set(r, {machineId:m.id, machineName:m.name, site:m.site||'', area:m.area||'', issue:v('#fx-i'), severity:'medium', source:'senior', date:fix.date, by:S.me.name, uid:S.me.uid, at:Date.now()});
        iid = r.key;
      }
      await set(ref(db,'issueFix/'+iid), fix);
      closeModal(); toast('Saved ✓');
    }catch(e){ box.querySelector('.fx-err').textContent='Could not save: '+(e.code||e.message); }
  };
}
export async function delIssue(id){
  if(!confirm('Delete this issue permanently? It will also disappear from the maintenance log.')) return;
  await remove(ref(db,'issueFix/'+id)); await remove(ref(db,'issues/'+id)); toast('Deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
// SENIOR SIGN-OFF
// ═══════════════════════════════════════════════════════════════════════════
let sSite='all';
export function renderSignoff(el){
  if(!S.ready) return loading(el);
  const t = todayStr();
  const pending = Object.entries(S.pm||{}).filter(([k])=>!S.pmSignoff?.[k]).map(([k,r])=>({key:k,...r}))
    .filter(r=>sSite==='all'||r.site===sSite).sort((a,b)=>(b.at||0)-(a.at||0));
  const clean = pending.filter(r=>!hasFix(r));
  const notDone=[], missed=[];
  const prevMonth = (()=>{ const d=parseDate(t); return fmtDate(new Date(d.getFullYear(), d.getMonth()-1, 1)); })();
  machList().filter(m=>sSite==='all'||m.site===sSite).forEach(m=>checklists(m).forEach(cl=>{
    if(cl.freq==='daily') return;
    const st=checkStatus(m,cl,t); if(st.state==='due') notDone.push({m,cl,st});
    if(cl.freq==='monthly' && !(m.createdAt && m.createdAt > parseDate(t).setDate(1))){ const p=checkStatus(m,cl,prevMonth); if(p.state==='due') missed.push({m,cl,st:p}); }
  }));
  el.innerHTML = `
  <div class="ops-bar"><h2>Senior supervisor check</h2>${siteSelect('s-site', sSite)}
    ${clean.length?`<button class="ob ob-g" id="s-bulk">&#10003; Sign off ${clean.length} check${clean.length>1?'s':''} with no problems</button>`:''}</div>
  <div class="ops-card"><div class="ops-card-h"><h3>Waiting for sign-off (${pending.length})</h3></div><div class="ops-card-b">
    ${pending.length ? pending.map(r=>`<div class="chk-row"><div class="nm"><b>${esc(r.machineName)} — ${esc(r.checklistName||FREQ[r.freq])}</b>
      <span>${esc(periodLabel(r.period))} · ${esc(r.site)} · by ${esc(r.by)} ${esc(niceTs(r.at))}</span></div>
      ${hasFix(r)?`<span class="oc oc-bad">Needs fixing</span>`:`<span class="oc oc-ok">All OK</span>`}
      <button class="ob ob-sm ob-p" onclick="ops.reviewCheck('${esc(r.key)}')">Review</button></div>`).join('') : `<div class="ops-empty">Nothing waiting &#127881;</div>`}
  </div></div>
  <div class="ops-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="ops-card"><div class="ops-card-h"><h3>Not done yet this period (${notDone.length})</h3></div><div class="ops-card-b">
      ${notDone.map(({m,cl,st})=>`<div class="chk-row"><div class="nm"><b>${esc(m.name)}</b><span>${esc(clName(cl))} · ${esc(m.site)} · ${esc(m.area||'')}</span></div>${dueChip(cl,st,t)}</div>`).join('')||`<div class="ops-empty" style="padding:1rem">All done</div>`}
    </div></div>
    <div class="ops-card"><div class="ops-card-h"><h3>Missed last month (${missed.length})</h3></div><div class="ops-card-b">
      ${missed.map(({m,cl,st})=>`<div class="chk-row"><div class="nm"><b>${esc(m.name)}</b><span>${esc(clName(cl))} · ${esc(periodLabel(st.pk))} · ${esc(m.site)}</span></div><span class="oc oc-bad">Missed</span>
        <button class="ob ob-sm" onclick="ops.openCheck('${esc(m.id)}','${esc(cl.id)}','${prevMonth}')">Back-fill</button></div>`).join('')||`<div class="ops-empty" style="padding:1rem">None missed</div>`}
    </div></div>
  </div>`;
  el.querySelector('#s-site').onchange=e=>{ sSite=e.target.value; renderSignoff(el); };
  const bulk = el.querySelector('#s-bulk');
  if(bulk) bulk.onclick = async ()=>{
    if(!confirm(`Sign off ${clean.length} check(s) that have no problems reported?`)) return;
    const upd={}; clean.forEach(r=>upd[r.key]={by:S.me.name, uid:S.me.uid, at:Date.now(), comment:''});
    await update(ref(db,'pmSignoff'), upd); toast(`Signed off ${clean.length} ✓`);
  };
}
export function reviewCheck(key){
  const r = S.pm?.[key]; if(!r) return;
  const sign = S.pmSignoff?.[key];
  const linked = issueList().filter(i=>i.pmKey===key);
  const box = modal(`
    <h3>${esc(r.machineName)} — ${esc(r.checklistName||'')}</h3>
    <div class="om-sub">${esc(periodLabel(r.period))} · ${esc(r.site)} · done by <b>${esc(r.by)}</b> ${esc(niceTs(r.at))}</div>
    <table style="width:100%;border-collapse:collapse;font-size:.84rem">${asArray(r.items).map(i=>`<tr><td style="padding:5px;border-bottom:1px solid #eee">${esc(i.label)}</td>
      <td style="padding:5px;border-bottom:1px solid #eee;text-align:right"><span class="oc ${i.s==='ok'?'oc-ok':i.s==='fix'?'oc-bad':'oc-mute'}">${esc(cellTxt(i))}</span></td></tr>`).join('')}
      <tr><td style="padding:5px;font-weight:700">Overall status</td><td style="padding:5px;text-align:right"><span class="oc ${r.overall?.s==='ok'?'oc-ok':'oc-bad'}">${esc(cellTxt(r.overall))}</span></td></tr></table>
    ${r.notes?`<div style="margin-top:8px;font-size:.84rem"><b>Notes:</b> ${esc(r.notes)}</div>`:''}
    ${linked.length?`<div style="margin-top:8px;font-size:.82rem"><b>Issue raised:</b> ${linked.map(i=>`${esc(i.issue)} <span class="oc ${STATE_CLS[i.state]}">${STATES[i.state]}</span>`).join('<br>')}</div>`:''}
    ${sign?`<div style="margin-top:10px"><span class="oc oc-ok">&#10003; Signed off by ${esc(sign.by)} ${esc(niceTs(sign.at))}</span>${sign.comment?` — ${esc(sign.comment)}`:''}</div>`
      :`<label class="f-lbl">Supervisor comment (optional)</label><input class="f-in" id="so-c">`}
    <div class="om-actions">
      <button class="ob" onclick="ops.closeModal()">Close</button>
      <button class="ob" onclick="ops.openCheck('${esc(r.machineId)}','${esc(r.checklistId)}','${esc(r.date)}')">Edit check</button>
      ${!hasFix(r)||linked.length||sign?'':`<button class="ob ob-d" id="so-raise">Raise issue</button>`}
      ${sign?`<button class="ob ob-d" id="so-undo">Undo sign-off</button>`:`<button class="ob ob-g" id="so-go">&#10003; Sign off</button>`}
    </div>`, {wide:true});
  const go_=box.querySelector('#so-go');
  if(go_) go_.onclick = async ()=>{ await set(ref(db,'pmSignoff/'+key), {by:S.me.name, uid:S.me.uid, at:Date.now(), comment:box.querySelector('#so-c').value.trim()}); closeModal(); toast('Signed off ✓'); };
  const undo=box.querySelector('#so-undo');
  if(undo) undo.onclick = async ()=>{ await remove(ref(db,'pmSignoff/'+key)); closeModal(); toast('Sign-off removed'); };
  const rs=box.querySelector('#so-raise');
  if(rs) rs.onclick = async ()=>{
    const fixes = asArray(r.items).filter(i=>i.s==='fix').map(i=>i.label+(i.c?` (${i.c})`:''));
    await createIssue({m:machine(r.machineId)||{id:r.machineId,name:r.machineName,site:r.site,area:r.area}, issue:`Found during ${String(r.checklistName||'check').toLowerCase()} (${periodLabel(r.period)}): ${fixes.join('; ')||r.overall?.c||'needs fixing'}`, source:'pm', pmKey:key});
    reviewCheck(key); toast('Issue raised');
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE LOGS
// ═══════════════════════════════════════════════════════════════════════════
let logMid=null, logYear=new Date().getFullYear(), logMonth=todayStr().slice(0,7), logSite='all';
export function openLog(mid){ logMid=mid; go('logs'); }

function buildLog(m, year){
  // returns {sections:[{title, head:[], rows:[[...], ...], fixCols:Set}] , corrective:{head, rows}}
  const recs = Object.entries(S.pm||{}).map(([k,r])=>({key:k,...r})).filter(r=>r.machineId===m.id && String(r.period).slice(1,5)===String(year));
  const sections = checklists(m).map(cl=>{
    const mine = recs.filter(r=>r.checklistId===cl.id);
    const labels=[...cl.items]; mine.forEach(r=>asArray(r.items).forEach(i=>{ if(!labels.includes(i.label)) labels.push(i.label); }));
    const head = [cl.freq==='monthly'?'':'Date', ...labels, 'Overall status', 'Performed by', 'Signed off by', 'Notes'];
    const rowOf = (first, r) => {
      if(!r) return [first, ...labels.map(()=>''), '', '', '', ''];
      const byL={}; asArray(r.items).forEach(i=>byL[i.label]=i);
      const sg = S.pmSignoff?.[r.key];
      return [first, ...labels.map(l=>cellTxt(byL[l])), cellTxt(r.overall), r.by||'', sg?sg.by:'', r.notes||''];
    };
    let rows;
    if(cl.freq==='monthly') rows = MONTHS.map((mn,i)=>rowOf(mn, mine.find(r=>r.period===`M${year}-${String(i+1).padStart(2,'0')}`)));
    else rows = mine.sort((a,b)=>a.period.localeCompare(b.period)).map(r=>rowOf(periodLabel(r.period), r));
    return {title: checklists(m).length>1 ? `Preventive Maintenance — ${clName(cl)}` : `Preventive Maintenance${cl.freq!=='monthly'?' — '+FREQ[cl.freq]:''}`, head, rows};
  });
  const iss = issueList().filter(i=>i.machineId===m.id && String(i.date||'').slice(0,4)===String(year)).sort((a,b)=>String(a.date).localeCompare(b.date));
  const corrective = {head:['Date','Issue','Action Taken','Quantity','Overall status after corrective maintenance','Performed by','Notes','Status'],
    rows: iss.map(i=>[niceDate(i.date), i.issue, i.fix?.action||'', i.fix?.quantity||'', i.fix?.statusAfter||'', i.fix?.performedBy||'', i.fix?.notes||'', STATES[i.state]])};
  return {sections, corrective};
}
function logHtml(m, year){
  const L = buildLog(m, year);
  const isFix = v => /need|fix|stuck|broken|missing/i.test(v) && !/^ok/i.test(v);
  const tbl = (head, rows, firstBold, hl=true) => `<table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.length ? rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${i===0&&firstBold?'rowh':''} ${hl&&i>0&&isFix(String(c))?'fix':''}">${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${head.length}" class="muted" style="text-align:center">No records in ${year}</td></tr>`}</tbody></table>`;
  return `<div class="log-sheet" id="print-area">
    <div class="log-title">Machine maintenance — ${year}</div>
    <table class="log-info" style="width:auto;min-width:320px;margin-top:8px">
      <tr><td>Machine</td><td>${esc(m.name)}</td></tr><tr><td>Serial Number</td><td>${esc(m.serial||'')}</td></tr>
      <tr><td>Purchase date</td><td>${esc(m.purchased||'')}</td></tr><tr><td>Location</td><td>${esc(m.site||'')} · ${esc(m.area||'')}</td></tr></table>
    ${L.sections.map(s=>`<div class="log-band">${esc(s.title)}</div>${tbl(s.head, s.rows, true)}`).join('')}
    <div class="log-band">Corrective Maintenance</div>${tbl(L.corrective.head, L.corrective.rows, false, false)}
  </div>`;
}
function logAoa(m, year){
  const L = buildLog(m, year);
  const aoa = [['Machine maintenance — '+year],[],['Machine', m.name],['Serial Number', m.serial||''],['Purchase date', m.purchased||''],['Location', `${m.site||''} · ${m.area||''}`],[]];
  L.sections.forEach(s=>{ aoa.push([s.title]); aoa.push(s.head); s.rows.forEach(r=>aoa.push(r)); aoa.push([]); });
  aoa.push(['Corrective Maintenance']); aoa.push(L.corrective.head); L.corrective.rows.forEach(r=>aoa.push(r));
  return aoa;
}
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=()=>res(window.XLSX); s.onerror=rej; document.head.appendChild(s); });
}
async function exportXlsx(ms, year, fname){
  const X = await loadXLSX();
  const wb = X.utils.book_new(); const used=new Set();
  ms.forEach(m=>{
    let n = String(m.name).replace(/[\[\]:*?\/\\]/g,' ').slice(0,28)||'Machine'; let k=n, i=2; while(used.has(k)) k=n.slice(0,26)+' '+(i++); used.add(k);
    const ws = X.utils.aoa_to_sheet(logAoa(m, year));
    ws['!cols'] = [{wch:16},{wch:22},{wch:22},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:24}];
    X.utils.book_append_sheet(wb, ws, k);
  });
  X.writeFile(wb, fname);
}

export function renderLogs(el){
  if(!S.ready) return loading(el);
  const thisYear = new Date().getFullYear();
  const years = [thisYear+1, thisYear, thisYear-1, thisYear-2, thisYear-3];
  if(logMid){
    const m = machine(logMid);
    if(!m){ logMid=null; return renderLogs(el); }
    el.innerHTML = `<div class="ops-bar no-print"><button class="ob" id="lg-back">&#8592; All machines</button><h2>${esc(m.name)}</h2>
      <select class="f-sel" id="lg-y" style="width:auto">${years.map(y=>`<option${y===logYear?' selected':''}>${y}</option>`).join('')}</select>
      <button class="ob" id="lg-x">&#11015; Excel</button><button class="ob" onclick="window.print()">&#128424; Print / PDF</button>
      ${isSenior()?`<button class="ob" onclick="ops.openFix(null)">+ Log a repair</button>`:''}</div>
      ${logHtml(m, logYear)}
      <p class="small muted no-print">Senior tip: open a check from the Maintenance tab and change its date to back-fill earlier months from your paper/Excel log.</p>`;
    el.querySelector('#lg-back').onclick=()=>{ logMid=null; renderLogs(el); };
    el.querySelector('#lg-y').onchange=e=>{ logYear=+e.target.value; renderLogs(el); };
    el.querySelector('#lg-x').onclick=()=>exportXlsx([m], logYear, `${m.name} maintenance log ${logYear}.xlsx`).catch(()=>toast('Could not load Excel export',true));
    return;
  }
  const ms = machList().filter(m=>logSite==='all'||m.site===logSite);
  const mk = logMonth, first = mk+'-01', last = lastOfMonth(first), upto = last < todayStr() ? last : todayStr();
  const cellFor = (m, cl)=>{
    if(cl.freq==='monthly'){
      const st = checkStatus(m, cl, first);
      return st.rec ? `<span class="oc ${hasFix(st.rec)?'oc-bad':st.sign?'oc-ok':'oc-info'}">${st.sign?'&#10003;&#10003;':'&#10003;'} ${esc(st.rec.by.split(' ')[0])}</span>` : (first>todayStr()?'':`<span class="oc oc-mute">—</span>`);
    }
    let exp=0, done=0;
    if(cl.freq==='daily'){ for(let d=first; d<=upto; d=addDays(d,1)){ exp++; if(S.pm?.[pmKey(m.id,cl.id,'D'+d)]) done++; } }
    else { for(let d=weekStart(first); d<=upto; d=addDays(d,7)){ if(d.slice(0,7)!==mk && d<first) { if(addDays(d,6)<first) continue; } exp++; if(S.pm?.[pmKey(m.id,cl.id,'W'+d)]) done++; } }
    const pct = exp?done/exp:1;
    return exp ? `<span class="oc ${pct>=1?'oc-ok':pct>=.6?'oc-warn':'oc-bad'}">${done}/${exp}</span>` : '';
  };
  el.innerHTML = `<div class="ops-bar"><h2>Maintenance logs</h2>
      <input type="month" class="f-in" id="lg-m" value="${esc(mk)}" style="width:auto">
      ${siteSelect('lg-site', logSite)}
      <button class="ob" id="lg-all">&#11015; Excel — all machines (${esc(mk.slice(0,4))})</button></div>
    <div class="ops-card" style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.82rem">
      <thead><tr>${['Machine','Site','Area','Preventive checks this month','Open issues',''].map(h=>`<th style="background:#1C2333;color:#fff;padding:7px 9px;text-align:left;font-weight:500">${h}</th>`).join('')}</tr></thead>
      <tbody>${ms.map(m=>`<tr style="border-top:1px solid #E0E2E8">
        <td style="padding:7px 9px;font-weight:600">${esc(m.name)}</td><td style="padding:7px 9px">${siteChip(m.site)}</td><td style="padding:7px 9px" class="muted">${esc(m.area||'')}</td>
        <td style="padding:7px 9px">${checklists(m).map(cl=>`<span class="small muted">${esc(FREQ[cl.freq])}:</span> ${cellFor(m,cl)}`).join(' &nbsp; ')}</td>
        <td style="padding:7px 9px">${(n=>n?`<span class="oc oc-bad">${n}</span>`:'<span class="muted">0</span>')(openIssuesFor(m.id).length)}</td>
        <td style="padding:7px 9px;text-align:right"><button class="ob ob-sm" onclick="ops.openLog('${esc(m.id)}')">Open log</button></td></tr>`).join('') || `<tr><td colspan="6" class="ops-empty">No machines</td></tr>`}</tbody></table></div>
    <p class="small muted">&#10003; done · &#10003;&#10003; done and signed off by a senior · red = something needed fixing.</p>`;
  el.querySelector('#lg-m').onchange=e=>{ if(e.target.value){ logMonth=e.target.value; logYear=+logMonth.slice(0,4); renderLogs(el);} };
  el.querySelector('#lg-site').onchange=e=>{ logSite=e.target.value; renderLogs(el); };
  el.querySelector('#lg-all').onclick=()=>exportXlsx(ms, +mk.slice(0,4), `Maintenance logs ${logSite==='all'?'all sites':logSite} ${mk.slice(0,4)}.xlsx`).catch(()=>toast('Could not load Excel export',true));
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR (replaces the Outlook makerspace calendar)
// ═══════════════════════════════════════════════════════════════════════════
let calY = new Date().getFullYear(), calM = new Date().getMonth(), calLoc='all';
const evList = () => Object.entries(S.events||{}).map(([id,e])=>({id,...e}));
const EV_LOCS = LOCS.filter(l=>l!=='Day Off').concat(['All']);
export function renderCalendar(el){
  if(!S.ready) return loading(el);
  const can = isSenior(), t=todayStr();
  const first = new Date(calY, calM, 1); const start = fmtDate(new Date(calY, calM, 1-first.getDay()));
  const evs = evList().filter(e=>calLoc==='all'||e.loc===calLoc||e.loc==='All');
  const byDay = {}; evs.forEach(e=>(byDay[e.date]=byDay[e.date]||[]).push(e));
  Object.values(byDay).forEach(a=>a.sort((x,y)=>String(x.start).localeCompare(y.start)));
  let cells=''; for(let i=0;i<42;i++){
    const d=addDays(start,i), inM=parseDate(d).getMonth()===calM, list=byDay[d]||[];
    cells += `<div class="day ${inM?'':'other'} ${d===t?'today':''} ${can?'can':''}" data-d="${d}"><div class="dn">${parseDate(d).getDate()}</div>
      ${list.slice(0,3).map(e=>{ const s=LOC_STYLE[e.loc]||LOC_STYLE.All; const mine=asArray(e.staff).includes(S.me.name);
        return `<div class="ev" data-id="${esc(e.id)}" style="background:${s.bg};color:${s.fg};${mine?'box-shadow:inset 3px 0 0 '+s.fg:''}" title="${esc(e.title)}">${esc(e.start||'')} ${esc(e.title)}</div>`; }).join('')}
      ${list.length>3?`<div class="more">+${list.length-3} more</div>`:''}</div>`;
  }
  const upcoming = evs.filter(e=>e.date>=t && e.date<=addDays(t,14)).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  el.innerHTML = `<div class="ops-bar"><h2>Makerspace calendar</h2>
      <button class="ob" id="c-prev">&#8249;</button><b style="min-width:130px;text-align:center">${MONTHS[calM]} ${calY}</b><button class="ob" id="c-next">&#8250;</button>
      <button class="ob" id="c-today">Today</button>
      <select class="f-sel" id="c-loc" style="width:auto"><option value="all">All locations</option>${EV_LOCS.filter(l=>l!=='All').map(l=>`<option${l===calLoc?' selected':''}>${l}</option>`).join('')}</select>
      ${can?`<button class="ob ob-p" id="c-add">+ Event</button>`:''}</div>
    <div class="mcal">${DAY_ABBR.map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="ops-card" style="margin-top:12px"><div class="ops-card-h"><h3>Next 14 days</h3></div><div class="ops-card-b ev-list">${upcoming.map(evRow).join('')||`<div class="ops-empty" style="padding:1rem">No upcoming events</div>`}</div></div>`;
  const mv = n=>{ const d=new Date(calY, calM+n, 1); calY=d.getFullYear(); calM=d.getMonth(); renderCalendar(el); };
  el.querySelector('#c-prev').onclick=()=>mv(-1); el.querySelector('#c-next').onclick=()=>mv(1);
  el.querySelector('#c-today').onclick=()=>{ calY=new Date().getFullYear(); calM=new Date().getMonth(); renderCalendar(el); };
  el.querySelector('#c-loc').onchange=e=>{ calLoc=e.target.value; renderCalendar(el); };
  const add=el.querySelector('#c-add'); if(add) add.onclick=()=>editEvent(null, t);
  el.querySelectorAll('.mcal .ev').forEach(x=>x.onclick=e=>{ e.stopPropagation(); viewEvent(x.dataset.id); });
  if(can) el.querySelectorAll('.mcal .day').forEach(x=>x.onclick=()=>editEvent(null, x.dataset.d));
}
function rostered(date, loc){
  const E=emps(); if(!loc||loc==='All') return [];
  return E.map((e,i)=>({n:empName(e), a:assign(date,i)})).filter(x=> x.a===loc || (locToSite(x.a) && locToSite(x.a)===locToSite(loc))).map(x=>x.n);
}
export function viewEvent(id){
  const e = S.events?.[id]; if(!e) return;
  const s=LOC_STYLE[e.loc]||LOC_STYLE.All, ros=rostered(e.date, e.loc);
  const box = modal(`<h3>${esc(e.title)}</h3>
    <div class="om-sub">${parseDate(e.date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${esc(e.start||'')}${e.end?'–'+esc(e.end):''}</div>
    <div style="margin-bottom:8px"><span class="oc" style="background:${s.bg};color:${s.fg}">&#128205; ${esc(e.loc)}</span>${e.seriesId?' <span class="oc oc-mute">Repeats weekly</span>':''}</div>
    ${asArray(e.staff).length?`<div style="font-size:.85rem;margin-bottom:6px"><b>Assigned:</b> ${esc(asArray(e.staff).join(', '))}</div>`:''}
    ${ros.length?`<div style="font-size:.82rem;margin-bottom:6px" class="muted"><b>On the roster at ${esc(e.loc)} that day:</b> ${esc(ros.join(', '))}</div>`:''}
    ${e.notes?`<div style="font-size:.85rem;white-space:pre-wrap;background:#F8FAFC;border-radius:6px;padding:8px">${esc(e.notes)}</div>`:''}
    <div class="small muted" style="margin-top:8px">Added by ${esc(e.by||'')}</div>
    <div class="om-actions"><button class="ob" onclick="ops.closeModal()">Close</button>
      ${isSenior()?`<button class="ob ob-d" id="ev-del">Delete</button><button class="ob ob-p" id="ev-ed">Edit</button>`:''}</div>`);
  const ed=box.querySelector('#ev-ed'); if(ed) ed.onclick=()=>editEvent(id);
  const dl=box.querySelector('#ev-del'); if(dl) dl.onclick=async()=>{
    if(e.seriesId){
      const all = confirm('This event repeats.\n\nOK = delete this and all FUTURE events in the series\nCancel = choose again');
      if(all){ const upd={}; evList().filter(x=>x.seriesId===e.seriesId && x.date>=e.date).forEach(x=>upd[x.id]=null); await update(ref(db,'events'),upd); closeModal(); toast('Series deleted'); return; }
      if(!confirm('Delete only this one event?')) return;
    } else if(!confirm('Delete this event?')) return;
    await remove(ref(db,'events/'+id)); closeModal(); toast('Deleted');
  };
}
export function editEvent(id, date){
  const e = id ? S.events[id] : {title:'', date, start:'10:00', end:'12:00', loc:'KHBP', staff:[], notes:''};
  const box = modal(`<h3>${id?'Edit event':'New event'}</h3><div class="om-sub">Shows on everyone's calendar and on My Day.</div>
    <label class="f-lbl">Title</label><input class="f-in" id="ev-t" value="${esc(e.title)}" placeholder="e.g. Robotics workshop — school visit">
    <div class="f-row"><div><label class="f-lbl">Date</label><input type="date" class="f-in" id="ev-d" value="${esc(e.date)}"></div>
      <div><label class="f-lbl">From</label><input type="time" class="f-in" id="ev-s" value="${esc(e.start||'')}"></div>
      <div><label class="f-lbl">To</label><input type="time" class="f-in" id="ev-e" value="${esc(e.end||'')}"></div></div>
    <label class="f-lbl">Location</label><select class="f-sel" id="ev-l">${EV_LOCS.map(l=>`<option${l===e.loc?' selected':''}>${l}</option>`).join('')}</select>
    <label class="f-lbl">Staff <span style="font-weight:400">(bold = rostered at this location that day)</span> <button type="button" class="ob ob-sm" id="ev-ros" style="margin-left:6px">Select rostered</button></label>
    <div class="staff-pick" id="ev-staff"></div>
    ${id?'':`<div class="f-row"><div><label class="f-lbl">Repeat</label><select class="f-sel" id="ev-r"><option value="">Does not repeat</option><option value="weekly">Every week</option></select></div>
      <div><label class="f-lbl">Until</label><input type="date" class="f-in" id="ev-u" disabled></div></div>`}
    <label class="f-lbl">Notes</label><textarea class="f-ta" id="ev-n" placeholder="Materials, contact person, number of participants…">${esc(e.notes||'')}</textarea>
    <div class="ev-err small" style="color:#DC2626;margin-top:6px"></div>
    <div class="om-actions"><button class="ob" onclick="ops.closeModal()">Cancel</button><button class="ob ob-p" id="ev-go">Save</button></div>`, {wide:true});
  const q=k=>box.querySelector(k);
  let picked = new Set(asArray(e.staff));
  const drawStaff = ()=>{
    picked = new Set([...q('#ev-staff').querySelectorAll('input:checked')].map(i=>i.value).concat(q('#ev-staff').children.length?[]:[...picked]));
    const ros = new Set(rostered(q('#ev-d').value, q('#ev-l').value));
    q('#ev-staff').innerHTML = emps().map(x=>empName(x)).map(n=>`<label class="${ros.has(n)?'rost':''}"><input type="checkbox" value="${esc(n)}"${picked.has(n)?' checked':''}> ${esc(n)}</label>`).join('') || '<span class="small muted">No staff in the list yet</span>';
  };
  drawStaff();
  q('#ev-d').onchange=drawStaff; q('#ev-l').onchange=drawStaff;
  q('#ev-ros').onclick=()=>{ const ros=new Set(rostered(q('#ev-d').value, q('#ev-l').value)); q('#ev-staff').querySelectorAll('input').forEach(i=>{ if(ros.has(i.value)) i.checked=true; }); };
  if(q('#ev-r')) q('#ev-r').onchange=()=>{ q('#ev-u').disabled = !q('#ev-r').value; if(q('#ev-r').value && !q('#ev-u').value) q('#ev-u').value=addDays(q('#ev-d').value||todayStr(), 28); };
  q('#ev-go').onclick = async ()=>{
    const rec = {title:q('#ev-t').value.trim(), date:q('#ev-d').value, start:q('#ev-s').value, end:q('#ev-e').value, loc:q('#ev-l').value,
      staff:[...q('#ev-staff').querySelectorAll('input:checked')].map(i=>i.value), notes:q('#ev-n').value.trim(), by:S.me.name, uid:S.me.uid, at:Date.now()};
    if(!rec.title || !rec.date){ q('.ev-err').textContent='Title and date are required.'; return; }
    try{
      if(id){ await set(ref(db,'events/'+id), {...rec, seriesId:e.seriesId||null}); }
      else if(q('#ev-r')?.value==='weekly' && q('#ev-u').value){
        const sid = push(ref(db,'events')).key, upd={};
        for(let d=rec.date, n=0; d<=q('#ev-u').value && n<104; d=addDays(d,7), n++) upd[push(ref(db,'events')).key] = {...rec, date:d, seriesId:sid};
        await update(ref(db,'events'), upd);
      } else { await set(push(ref(db,'events')), rec); }
      closeModal(); toast('Event saved ✓');
    }catch(err){ q('.ev-err').textContent='Could not save: '+(err.code||err.message); }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MACHINES (seniors + admin)
// ═══════════════════════════════════════════════════════════════════════════
const SEED = [
  // [site, area, name, [[freq, [items]] ...]]
  ['KHBP','3D printers area','Delta WASP 40100',[['monthly',['Check nozzle','Check filament / feeder','Levelling','Overall status / cleaning']]]],
  ['KHBP','3D printers area','Sinterit Lisa Pro',[['monthly',['Oil and grease','Bed and machine cleanliness','Light source check','Overall status and cleaning','Cords','Glass cleaning']]]],
  ['KHBP','3D printers area','WASP 4070',[['monthly',['Check nozzle','Check filament and feeders','Levelling & Z offset','Overall status and cleaning']]]],
  ['KHBP','3D printers area','WASP 3MT',[['monthly',['Check extruder (Clay & Pellet)','Check feeder system','Check clay pipe','Check clay screw','Check clay tank','Check pellet']]]],
  ['KHBP','CNC area','Wood & metal area tools',[['monthly',['Return all tools','Check for missing items','Area cleanliness','Table & workbenches status']]]],
  ['KHBP','CNC area','Manual Lathe machine',[['monthly',['Oiling','Overall status / cleaning']]]],
  ['KHBP','CNC area','Sanders (orbital & belt)',[['monthly',['Check overall status / cleaning','Sanding material']]]],
  ['KHBP','Electronics area','Electronics workbench',[['monthly',['Check workbench tools','Check soldering iron & sponge','Check power supply & wires','Check function generator & wires','Check oscilloscope & wires','Check for any missing tools']]]],
  ['KHBP','Electronics area','Roland SRM-20',[['monthly',['End mills status','Overall status and cleaning','Bed / sacrifice material status']]]],
  ['KHBP','Vinyl, UV printer & sewing','Sewing machines',[['monthly',['Oiling','Sewing machine tools','Overall area status']]]],
  ['KHBP','Vinyl, UV printer & sewing','Roland BD-8',[['monthly',['Manual cleaning','Overall status','Check UV nozzles']],['daily',['Cleaning test']]]],
  ['KHBP','Vinyl, UV printer & sewing','Vinyl cutter',[['monthly',['Check cut end mill status','Check vinyl status','Overall status']]]],
  ['KHBP','Laser cutter area','xTool',[['monthly',['Clean lens field','Clean fan field','Check laser calibration','Check filter','Check machine overall status']]]],
  ['KHBP','Laser cutter area','Laser cutter tools',[['monthly',['Check all tools are available & in place','Area cleanliness']]]],
  ['KHBP','Laser cutter area','Epilog Laser',[['monthly',['Lens status','Mirror status','Overall status & cleaning','Bed status']]]],
  ['KHBP','Laser cutter area','Trotec Speedy 400',[['monthly',['Lens and mirrors','Oil and cleanliness','Exhaust','Bed status']]]],
  ['KHBP','KUKA robotic arm','KUKA Robotic Arm',[['monthly',['Check FDM extruder status','Check clay extruder status','Check clay tank status','Check CNC mill and tools status','Check wire cutter status','Check KR-4 and KUKA status','Check ENSY software status','Check air pressure system','Oiling / lubrication','Axes status']]]],
  ['AYC','AYC machines','Wood & metal area tools (AYC)',[['monthly',['Return all tools','Check for missing items','Area cleanliness','Table & workbenches status']]]],
  ['AYC','AYC machines','Electronics workbench (AYC)',[['monthly',['Check workbench tools','Check soldering iron & sponge','Check power supply & wires','Check function generator & wires','Check oscilloscope & wires','Check for any missing tools']]]],
];
async function seedMachines(){
  const upd={};
  SEED.forEach(([site,area,name,cls],i)=>{
    const id='m'+String(i+1).padStart(2,'0');
    upd[id]={createdAt:Date.now(), name, site, area, serial: name==='Trotec Speedy 400'?'S4-1443':'', purchased: name==='Trotec Speedy 400'?'Jan 2018':'',
      checklists: cls.map(([freq,items],j)=>({id:'c'+(j+1), freq, name:'', items}))};
  });
  await update(ref(db,'machines'), upd);
  toast(`Loaded ${SEED.length} machines ✓`);
}

let mSite='all', mShowRetired=false;
export function renderMachines(el){
  if(!S.ready) return loading(el);
  const all = machList(true);
  const ms = all.filter(m=>(mSite==='all'||m.site===mSite) && (mShowRetired||!m.retired));
  el.innerHTML = `<div class="ops-bar"><h2>Machines &amp; checklists</h2>${siteSelect('m-site', mSite)}
      <label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="m-ret"${mShowRetired?' checked':''}> Show retired</label>
      ${!all.length?`<button class="ob" id="m-seed">Load starter list from Planner</button>`:''}
      <button class="ob ob-p" onclick="ops.editMachine(null)">+ Add machine</button></div>
    ${ms.length?`<div class="ops-card" style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.82rem">
      <thead><tr>${['Machine','Site','Area','Serial','Purchased','Checklists',''].map(h=>`<th style="background:#1C2333;color:#fff;padding:7px 9px;text-align:left;font-weight:500">${h}</th>`).join('')}</tr></thead>
      <tbody>${ms.map(m=>`<tr style="border-top:1px solid #E0E2E8;${m.retired?'opacity:.5':''}"><td style="padding:7px 9px;font-weight:600">${esc(m.name)}${m.retired?' <span class="oc oc-mute">retired</span>':''}</td>
        <td style="padding:7px 9px">${siteChip(m.site)}</td><td style="padding:7px 9px">${esc(m.area||'')}</td><td style="padding:7px 9px">${esc(m.serial||'')}</td><td style="padding:7px 9px">${esc(m.purchased||'')}</td>
        <td style="padding:7px 9px">${checklists(m).map(c=>`<span class="oc oc-info">${FREQ[c.freq]} · ${c.items.length}</span>`).join(' ')}</td>
        <td style="padding:7px 9px;text-align:right;white-space:nowrap"><button class="ob ob-sm" onclick="ops.openLog('${esc(m.id)}')">Log</button> <button class="ob ob-sm" onclick="ops.editMachine('${esc(m.id)}')">Edit</button></td></tr>`).join('')}</tbody></table></div>`
    :`<div class="ops-empty">No machines yet. ${!all.length?'Click <b>Load starter list from Planner</b> to import the machines and checklists from your Teams Planner board, then adjust.':''}</div>`}`;
  el.querySelector('#m-site').onchange=e=>{ mSite=e.target.value; renderMachines(el); };
  el.querySelector('#m-ret').onchange=e=>{ mShowRetired=e.target.checked; renderMachines(el); };
  const sd=el.querySelector('#m-seed'); if(sd) sd.onclick=()=>seedMachines().catch(e=>toast('Could not load: '+(e.code||e.message),true));
}
export function editMachine(id){
  const m = id ? machine(id) : {name:'', site:'KHBP', area:'', serial:'', purchased:'', checklists:[{id:'c1',freq:'monthly',items:[]}]};
  const areas = [...new Set(machList(true).map(x=>x.area).filter(Boolean))];
  let cls = checklists(m);
  const box = modal(`<h3>${id?'Edit machine':'Add machine'}</h3><div class="om-sub">Each checklist becomes a recurring task for whoever is at that site.</div>
    <div class="f-row"><div><label class="f-lbl">Name</label><input class="f-in" id="mm-n" value="${esc(m.name)}"></div>
      <div><label class="f-lbl">Site</label><select class="f-sel" id="mm-s">${SITES.map(s=>`<option${s===m.site?' selected':''}>${s}</option>`).join('')}</select></div></div>
    <div class="f-row"><div><label class="f-lbl">Area</label><input class="f-in" id="mm-a" list="dl-areas" value="${esc(m.area||'')}"><datalist id="dl-areas">${areas.map(a=>`<option value="${esc(a)}">`).join('')}</datalist></div>
      <div><label class="f-lbl">Serial number</label><input class="f-in" id="mm-sr" value="${esc(m.serial||'')}"></div>
      <div><label class="f-lbl">Purchase date</label><input class="f-in" id="mm-p" value="${esc(m.purchased||'')}" placeholder="Jan 2018"></div></div>
    <div id="mm-cls"></div>
    <button class="ob ob-sm" id="mm-addcl" style="margin-top:6px">+ Add another checklist (e.g. daily)</button>
    ${id?`<label class="small" style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="mm-ret"${m.retired?' checked':''}> Retired (hide from boards, keep its log)</label>`:''}
    <div class="mm-err small" style="color:#DC2626;margin-top:6px"></div>
    <div class="om-actions">${id&&isAdmin()?`<button class="ob ob-d" id="mm-del" style="margin-right:auto">Delete</button>`:''}<button class="ob" onclick="ops.closeModal()">Cancel</button><button class="ob ob-p" id="mm-go">Save</button></div>`, {wide:true});
  const q=k=>box.querySelector(k);
  const read = ()=>{ cls = [...q('#mm-cls').querySelectorAll('.ci')].map(b=>({id:b.dataset.id, freq:b.querySelector('select').value, name:b.querySelector('.cl-n').value.trim(),
      items:b.querySelector('textarea').value.split('\n').map(s=>s.trim()).filter(Boolean)})); };
  const draw = ()=>{ q('#mm-cls').innerHTML = cls.map((c,i)=>`<div class="ci" data-id="${esc(c.id)}" style="margin-top:8px">
      <div class="ci-top"><select class="f-sel" style="width:auto">${Object.entries(FREQ).map(([k,v])=>`<option value="${k}"${c.freq===k?' selected':''}>${v}</option>`).join('')}</select>
      <input class="f-in cl-n" style="flex:1" placeholder="Checklist name (optional)" value="${esc(c.name||'')}">${cls.length>1?`<button class="ob ob-sm ob-d" data-rm="${i}">Remove</button>`:''}</div>
      <label class="f-lbl">Items — one per line</label><textarea class="f-ta" style="min-height:110px">${esc(c.items.join('\n'))}</textarea></div>`).join('');
    q('#mm-cls').querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ read(); cls.splice(+b.dataset.rm,1); draw(); }); };
  draw();
  q('#mm-addcl').onclick=()=>{ read(); cls.push({id:'c'+Date.now().toString(36), freq:'daily', name:'', items:[]}); draw(); };
  q('#mm-go').onclick = async ()=>{
    read();
    const rec = {name:q('#mm-n').value.trim(), site:q('#mm-s').value, area:q('#mm-a').value.trim(), serial:q('#mm-sr').value.trim(), purchased:q('#mm-p').value.trim(),
      retired: !!q('#mm-ret')?.checked, createdAt: m.createdAt||Date.now(), checklists: cls.filter(c=>c.items.length)};
    if(!rec.name || !rec.checklists.length){ q('.mm-err').textContent='Give it a name and at least one checklist item.'; return; }
    try{ await set(id ? ref(db,'machines/'+id) : push(ref(db,'machines')), rec); closeModal(); toast('Machine saved ✓'); }
    catch(e){ q('.mm-err').textContent='Could not save: '+(e.code||e.message); }
  };
  const del=q('#mm-del'); if(del) del.onclick=async()=>{
    if(!confirm(`Delete "${m.name}"? Its checks stay in the database but the machine and its log page disappear. Usually "Retired" is better.`)) return;
    await remove(ref(db,'machines/'+id)); closeModal(); toast('Deleted');
  };
}

// ── Expose for inline onclick handlers ────────────────────────────────────
export const RENDER = {myday:renderMyDay, maint:renderBoard, issues:renderIssues, calendar:renderCalendar, signoff:renderSignoff, logs:renderLogs, machines:renderMachines};
window.ops = {openCheck, openReport, openFix, delIssue, reviewCheck, openLog, viewEvent, editEvent, editMachine, closeModal};

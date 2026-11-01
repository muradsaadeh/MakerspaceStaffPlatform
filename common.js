// ═══════════════════════════════════════════════════════════════════════════
// common.js — shared by index.html, staff.html and admin.html
// Firebase connection, personal logins + roles, small helpers.
// ═══════════════════════════════════════════════════════════════════════════
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase, ref, get, set, update, push, remove, onValue } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword,
         signOut, sendPasswordResetEmail, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyASdaaOJffrkqkiJJXyUbLwiPRjeczUZcg",
  authDomain: "makerspace-platform.firebaseapp.com",
  databaseURL: "https://makerspace-platform-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "makerspace-platform",
  storageBucket: "makerspace-platform.firebasestorage.app",
  messagingSenderId: "392623391871",
  appId: "1:392623391871:web:c30b9658012367a4832b4a"
};

// ── EmailJS (used for schedule notifications and new-issue alerts to seniors) ──
export const EMAILJS_CONFIG = {
  publicKey:  'OjGr7k1SNyAdV5CUn',
  serviceId:  'service_q3bhk4a',
  templateId: 'template_dmnossn',        // schedule notification template
  issueTemplateId: 'template_dmnossn',   // template for new-issue alerts (can be a separate one)
  siteUrl:    'https://YOUR-USERNAME.github.io/YOUR-REPO/'   // ← set to your GitHub Pages address
};
export function emailReady(){
  return typeof window.emailjs !== 'undefined' && EMAILJS_CONFIG.publicKey && !EMAILJS_CONFIG.publicKey.startsWith('YOUR');
}
let _ejsInit = false;
export async function sendEmail(templateId, params){
  if(!emailReady()) throw new Error('EmailJS not configured');
  if(!_ejsInit){ window.emailjs.init({publicKey: EMAILJS_CONFIG.publicKey}); _ejsInit = true; }
  return window.emailjs.send(EMAILJS_CONFIG.serviceId, templateId, params);
}

export const app  = initializeApp(firebaseConfig);
export const db   = getDatabase(app);
export const auth = getAuth(app);
export { ref, get, set, update, push, remove, onValue };

// ── Locations ──────────────────────────────────────────────────────────────
export const LOCS = ["KHBP","AYC Morning","AYC Night","Mobile Lab","Outreach","Aqaba","Day Off"];
export const LOC_STYLE = {
  "KHBP":       {bg:"#D6E8F7",fg:"#0D3F6E"},
  "AYC Morning":{bg:"#D5F0E5",fg:"#084D37"},
  "AYC Night":  {bg:"#E9E5FC",fg:"#31216B"},
  "Mobile Lab": {bg:"#FDEECE",fg:"#6B3E00"},
  "Outreach":   {bg:"#FDE0EB",fg:"#6B162F"},
  "Aqaba":      {bg:"#CFF4F4",fg:"#055160"},
  "Day Off":    {bg:"#F0F0EE",fg:"#888"},
  "All":        {bg:"#E5E7EB",fg:"#374151"},
};
// Machine sites (where equipment physically lives)
export const SITES = ["KHBP","AYC","Mobile Lab","Aqaba"];
export const SITE_STYLE = {
  "KHBP":{bg:"#D6E8F7",fg:"#0D3F6E"}, "AYC":{bg:"#D5F0E5",fg:"#084D37"},
  "Mobile Lab":{bg:"#FDEECE",fg:"#6B3E00"}, "Aqaba":{bg:"#CFF4F4",fg:"#055160"}
};
export function locToSite(loc){
  if(loc==='KHBP') return 'KHBP';
  if(loc==='AYC Morning'||loc==='AYC Night') return 'AYC';
  if(loc==='Mobile Lab') return 'Mobile Lab';
  if(loc==='Aqaba') return 'Aqaba';
  return null;
}
export const ROLES = {junior:'Junior technician', senior:'Senior', admin:'Admin'};

// ── Helpers ────────────────────────────────────────────────────────────────
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function parseDate(s){ return new Date(s+'T00:00:00'); }
export function todayStr(){ return fmtDate(new Date()); }
export function addDays(s,n){ const d=parseDate(s); return fmtDate(new Date(d.getFullYear(),d.getMonth(),d.getDate()+n)); }
export function weekStart(s){ const d=parseDate(s); return fmtDate(new Date(d.getFullYear(),d.getMonth(),d.getDate()-d.getDay())); } // Sunday
export function niceDate(s, withYear=true){ return parseDate(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',...(withYear?{year:'numeric'}:{})}); }
export function niceTs(ts){ return ts ? new Date(ts).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''; }
export const FREQ = {daily:'Daily', weekly:'Weekly', monthly:'Monthly'};
export function periodKey(freq, dateStr){
  if(freq==='daily')  return 'D'+dateStr;
  if(freq==='weekly') return 'W'+weekStart(dateStr);
  return 'M'+dateStr.slice(0,7);
}
export function periodLabel(pk){
  if(!pk) return '';
  const t=pk[0], v=pk.slice(1);
  if(t==='D') return niceDate(v);
  if(t==='W') return 'Week of '+niceDate(v);
  const [y,m]=v.split('-'); return MONTHS[+m-1]+' '+y;
}
export function empName(e){ return typeof e==='string' ? e : (e?.name||''); }
export function empEmail(e){ return typeof e==='string' ? '' : (e?.email||''); }
export function initials(n){ return String(n||'?').split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
export function asArray(v){ return Array.isArray(v) ? v : (v ? Object.values(v) : []); }

// ── Modal + toast (namespaced so they don't clash with page code) ──────────
export function modal(html, {wide=false}={}){
  let root=document.getElementById('ops-modal');
  if(!root){ root=document.createElement('div'); root.id='ops-modal'; document.body.appendChild(root); }
  root.innerHTML=`<div class="om-back"><div class="om-box ${wide?'wide':''}" role="dialog">${html}</div></div>`;
  root.querySelector('.om-back').addEventListener('click',e=>{ if(e.target.classList.contains('om-back')) closeModal(); });
  return root.querySelector('.om-box');
}
export function closeModal(){ const r=document.getElementById('ops-modal'); if(r) r.innerHTML=''; }
let _tt;
export function toast(msg, warn=false){
  let t=document.getElementById('ops-toast');
  if(!t){ t=document.createElement('div'); t.id='ops-toast'; document.body.appendChild(t); }
  t.textContent=msg; t.className='show'+(warn?' warn':'');
  clearTimeout(_tt); _tt=setTimeout(()=>t.className='',3500);
}

// ── Accounts ───────────────────────────────────────────────────────────────
export async function logout(){ await signOut(auth); location.href='index.html'; }

// Admin creates a login for a staff member without being signed out:
// a throw-away second Firebase app creates the account, then a
// "set your password" email is sent to the new user.
export async function createStaffLogin(email){
  const tmp = initializeApp(firebaseConfig, 'create-'+Date.now());
  try{
    const tmpAuth = initializeAuth(tmp, {persistence: inMemoryPersistence});
    const pw = crypto.getRandomValues(new Uint32Array(4)).join('-') + 'Aa!';
    const cred = await createUserWithEmailAndPassword(tmpAuth, email, pw);
    await signOut(tmpAuth);
    await sendPasswordResetEmail(auth, email);
    return cred.user.uid;
  } finally { await deleteApp(tmp); }
}
export function resetPassword(email){ return sendPasswordResetEmail(auth, email); }

// ── Login gate ─────────────────────────────────────────────────────────────
// gate({allow:['junior','senior','admin'], onReady(me)})
// me = {uid, email, role, name, empIdx}
export function gate({allow=['junior','senior','admin'], onReady}){
  const ov=document.createElement('div'); ov.id='auth-gate';
  ov.innerHTML=`<div class="ag-box"><div class="ag-logo">&#128295;</div><div class="ag-body">Loading…</div></div>`;
  document.body.appendChild(ov);
  const body=ov.querySelector('.ag-body');
  let started=false;

  function showLogin(msg=''){
    body.innerHTML=`<h1>The Makerspace</h1><p class="ag-sub">Sign in with your work email</p>
      <form id="ag-form" autocomplete="on">
        <input id="ag-email" type="email" placeholder="Email" autocomplete="username" required>
        <input id="ag-pw" type="password" placeholder="Password" autocomplete="current-password" required>
        <button type="submit" class="ag-btn">Sign in</button>
      </form>
      <div class="ag-err">${esc(msg)}</div>
      <button class="ag-link" id="ag-forgot">Forgot password / first time? Send me a link</button>`;
    body.querySelector('#ag-form').onsubmit=async e=>{
      e.preventDefault();
      const em=body.querySelector('#ag-email').value.trim(), pw=body.querySelector('#ag-pw').value;
      body.querySelector('.ag-err').textContent='';
      try{ await signInWithEmailAndPassword(auth, em, pw); }
      catch(err){ body.querySelector('.ag-err').textContent = /invalid|wrong|not-found|credential/i.test(err.code||'') ? 'Email or password is incorrect.' : 'Sign-in failed: '+(err.code||err.message); }
    };
    body.querySelector('#ag-forgot').onclick=async()=>{
      const em=body.querySelector('#ag-email').value.trim();
      if(!em){ body.querySelector('.ag-err').textContent='Type your email above first.'; return; }
      try{ await sendPasswordResetEmail(auth, em); body.querySelector('.ag-err').innerHTML='<span style="color:#4ADE80">Link sent — check your inbox (and spam).</span>'; }
      catch(err){ body.querySelector('.ag-err').textContent='Could not send: '+(err.code||err.message); }
    };
  }

  onAuthStateChanged(auth, async user=>{
    if(!user){ ov.style.display='flex'; showLogin(); return; }
    if(started) return;
    body.innerHTML='Checking your access…';
    try{
      const rolesSnap = await get(ref(db,'roles'));
      const roles = rolesSnap.val() || {};
      let role = roles[user.uid];
      if(!role && Object.keys(roles).length===0){
        body.innerHTML=`<h1>First-time setup</h1><p class="ag-sub">No admin exists yet. Signed in as <b>${esc(user.email)}</b>.</p>
          <button class="ag-btn" id="ag-claim">Make me the admin</button>
          <button class="ag-link" id="ag-out">Sign out</button>`;
        body.querySelector('#ag-claim').onclick=async()=>{ await set(ref(db,'roles/'+user.uid),'admin'); location.reload(); };
        body.querySelector('#ag-out').onclick=()=>signOut(auth);
        return;
      }
      if(!role){
        await set(ref(db,'pending/'+user.uid),{email:user.email, at:Date.now()}).catch(()=>{});
        body.innerHTML=`<h1>Almost there</h1><p class="ag-sub">You're signed in as <b>${esc(user.email)}</b>, but an admin hasn't given you access yet. They've been notified in the admin panel.</p>
          <button class="ag-link" id="ag-out">Sign out</button>`;
        body.querySelector('#ag-out').onclick=()=>signOut(auth);
        return;
      }
      if(!allow.includes(role)){
        body.innerHTML=`<h1>No access</h1><p class="ag-sub">This page is for ${allow.map(r=>ROLES[r]).join(' / ')} accounts.</p>
          <a class="ag-btn" href="staff.html" style="display:block;text-decoration:none">Go to my workspace</a>
          <button class="ag-link" id="ag-out">Sign out</button>`;
        body.querySelector('#ag-out').onclick=()=>signOut(auth);
        return;
      }
      const empSnap = await get(ref(db,'rotation/employees'));
      const emps = asArray(empSnap.val());
      const em = (user.email||'').toLowerCase();
      const empIdx = emps.findIndex(e=>empEmail(e).toLowerCase()===em);
      const me = {uid:user.uid, email:user.email, role, empIdx, name: empIdx>=0 ? empName(emps[empIdx]) : (user.email||'').split('@')[0]};
      started=true;
      ov.style.display='none';
      onReady(me);
    }catch(err){
      console.error(err);
      body.innerHTML=`<h1>Can't load</h1><p class="ag-sub">${esc(err.code||err.message)}</p><button class="ag-link" id="ag-out">Sign out</button>`;
      body.querySelector('#ag-out').onclick=()=>signOut(auth);
    }
  });
}

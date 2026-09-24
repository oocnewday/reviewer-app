/* OOC Question Bank – Reviewer app (phase 3a). Talks to Supabase directly; RLS + RPCs enforce access. */
const SUPABASE_URL = 'https://djqsffknczddefukbuzu.supabase.co';
// Public (anon) key: safe to ship in a web page; every table is protected by RLS.
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcXNmZmtuY3pkZGVmdWtidXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxOTE0NDUsImV4cCI6MjEwNTc2NzQ0NX0.-4r_Mp6GKRLLoqotKPEDmFglsZOnyHrRpuo5j3klIcE';
const DOC_URL = 'https://claude.ai/code/artifact/aa2a7b7c-a88d-41f2-b4d9-7e79ff8c5b67';
const MSG_SOLVE = `المستند: ${DOC_URL} – هذه محادثة حل معزول. اقرأ 'معايير الشرح' و'أدوات محادثة الحل'، ثم استخدم next_unsolved وحل بـ save_solution، وللمختلف فقط reveal_source ثم set_disagreement_reason.`;
const MSG_REVISE = `المستند: ${DOC_URL} – نفّذ التعديلات المعلقة: اقرأ reviews المفتوحة، أنشئ نسخًا جديدة، اكتب resolution_note، وراجع الأسئلة التي عليها needs_consistency_check.`;
const HAND_LABEL = 'ملاحظة منقولة من ملف الأسئلة – مكتوبة بخط اليد';
const MAX_REC_SECONDS = 600;

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const S = { session: null, profile: null, isAdmin: false, rows: [], queue: [], notices: [], pipeline: null, bundle: null, qid: null, showExtra: false, noteOpen: false, noteDraft: '', view: null, recovery: false };
const $app = document.getElementById('app');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
// reassuring message box (green = done, red = problem, blue = info); tap to dismiss
function notify(title, sub = '', kind = 'ok', ms = 4200) {
  document.querySelectorAll('.nbox').forEach(x => x.remove());
  const n = document.createElement('div'); n.className = `nbox ${kind === 'ok' ? '' : kind}`;
  n.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  n.innerHTML = `<span class="ic" aria-hidden="true">${kind === 'ok' ? '✓' : kind === 'err' ? '!' : 'i'}</span><div><div class="tt">${esc(title)}</div>${sub ? `<div class="sb">${esc(sub)}</div>` : ''}</div>`;
  const bye = () => { n.classList.add('out'); setTimeout(() => n.remove(), 260); };
  n.onclick = bye; document.body.appendChild(n); setTimeout(bye, ms);
}
const fail = e => notify('لم يتم الإجراء', errText(e), 'err', 6000);
function errText(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Not allowed/i.test(m)) return 'ليست لديك صلاحية على هذا السؤال.';
  if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة السر غير صحيحة.';
  if (/Email not confirmed/i.test(m)) return 'البريد لم يُؤكَّد بعد. افتح رسالة التأكيد في بريدك ثم سجّل الدخول.';
  if (/User already registered/i.test(m)) return 'هذا البريد مسجّل بالفعل. استخدم تسجيل الدخول.';
  if (/Edit reason too short/i.test(m)) return 'اكتب سبب واضح للتعديل (كلمتين على الأقل)، عشان باقي الفريق وClaude يفهموا اتعدّل ليه.';
  if (/Password should be|weak password|at least/i.test(m)) return 'كلمة السر ضعيفة: 8 أحرف على الأقل، ويُفضّل تخلط حروف وأرقام.';
  if (/revision request needs/i.test(m)) return 'طلب التعديل يحتاج نوعًا أو ملاحظة مكتوبة.';
  if (/already have an open request/i.test(m)) return 'عندك طلب مفتوح بالفعل على السؤال ده؛ عدّله بدل ما تعمل طلب جديد.';
  if (/Request is not open/i.test(m)) return 'الطلب ده اتنفّذ أو اتلغى بالفعل. حدّث الصفحة.';
  if (/Not your/i.test(m)) return 'ده مش طلبك/اعتمادك، فمش هتقدر تغيّره.';
  if (/not approved|No approval/i.test(m)) return 'السؤال مش معتمد حاليًا.';
  if (/Nothing to undo/i.test(m)) return 'مفيش خطوة سابقة ترجعلها في السؤال ده. حدّث الصفحة.';
  if (/Already original/i.test(m)) return 'السؤال أصلًا على نسخته الأصلية.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'لا يوجد اتصال بالإنترنت. تأكد من الاتصال وحاول مرة أخرى.';
  return m;
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) throw error;
  return data;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  notify('تم نسخ الرسالة بفضل الله', 'الصقها في محادثة Claude جديدة.');
}
const seenKey = (n, kind) => `notice:${S.session?.user?.id}:${n.id}:${kind}`;
const seen = (n, kind) => { try { return localStorage.getItem(seenKey(n, kind)) === '1'; } catch { return false; } };
const markSeen = (n, kind) => { try { localStorage.setItem(seenKey(n, kind), '1'); } catch { } };
const CONF = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
const STATUS_AR = { extracted: 'مستخرج', solved: 'محلول', in_review: 'في المراجعة', needs_revision: 'ينتظر التعديل', revised: 'معدّل', approved: 'معتمد', archived: 'مؤرشف' };
const DECISION_AR = { approve: 'اعتمد', needs_revision: 'طلب تعديلًا', comment: 'علّق' };

/* ---------- word diff (round 2 highlighting) ---------- */
function diffHTML(oldS, newS) {
  oldS = oldS || ''; newS = newS || '';
  if (oldS === newS) return nl(newS);
  const a = oldS.split(/(\s+)/), b = newS.split(/(\s+)/);
  const n = a.length, m = b.length;
  if (n * m > 600000) return `<mark class="ins">${nl(newS)}</mark>`;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, s) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('=', b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('-', a[i]); i++; }
    else { push('+', b[j]); j++; }
  }
  while (i < n) push('-', a[i++]);
  while (j < m) push('+', b[j++]);
  return out.map(p => p.t === '=' ? nl(p.s) : p.t === '+' ? (p.s.trim() ? `<mark class="ins">${nl(p.s)}</mark>` : nl(p.s)) : (p.s.trim() ? `<del class="rem">${nl(p.s)}</del>` : '')).join('');
}

/* ---------- auth ---------- */
function renderAuth(mode = 'in', msg = '') {
  const tabs = mode === 'in' || mode === 'up';
  $app.innerHTML = `
  <main class="auth">
    <h1>مراجعة بنك الأسئلة</h1>
    <p class="lead">بوابة استشاريي OOC medical dep. لمراجعة أسئلة سكند الزمالة.</p>
    ${tabs ? `<div class="tabs" role="tablist">
      <button role="tab" aria-selected="${mode === 'in'}" data-mode="in">تسجيل الدخول</button>
      <button role="tab" aria-selected="${mode === 'up'}" data-mode="up">حساب جديد</button></div>` : ''}
    <form id="authf" novalidate>
      ${mode === 'up' ? `<label class="f" for="name">الاسم كما يظهر للفريق</label><input class="t" id="name" autocomplete="name" required>` : ''}
      ${mode !== 'reset' ? `<label class="f" for="email">البريد الإلكتروني</label><input class="t" id="email" type="email" dir="ltr" autocomplete="email" required>` : ''}
      ${mode !== 'forgot' ? `<label class="f" for="pass">${mode === 'reset' ? 'كلمة السر الجديدة' : 'كلمة السر'}</label><input class="t" id="pass" type="password" dir="ltr" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" required minlength="8">` : ''}
      <div class="err" id="aerr" role="alert">${esc(msg)}</div>
      <button class="btn primary block" style="margin-top:14px" type="submit">${{ in: 'ادخل', up: 'أنشئ الحساب', forgot: 'أرسل رابط تغيير كلمة السر', reset: 'احفظ كلمة السر' }[mode]}</button>
    </form>
    ${mode === 'in' ? `<p><button class="linkbtn quiet" data-mode="forgot">نسيت كلمة السر؟</button></p>` : ''}
    ${mode === 'forgot' ? `<p><button class="linkbtn quiet" data-mode="in">رجوع لتسجيل الدخول</button></p>` : ''}
    ${installCard()}
  </main>`;
  $app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  bindInstall();
  document.getElementById('authf').onsubmit = async ev => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    const v = id => (document.getElementById(id)?.value || '').trim();
    const err = t => { document.getElementById('aerr').textContent = t; btn.disabled = false; };
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: v('email'), password: document.getElementById('pass').value });
        if (error) throw error;
      } else if (mode === 'up') {
        if (!v('name')) return err('اكتب اسمك.');
        if (document.getElementById('pass').value.length < 8) return err('كلمة السر لازم تكون 8 أحرف على الأقل.');
        const { data, error } = await sb.auth.signUp({ email: v('email'), password: document.getElementById('pass').value,
          options: { data: { display_name: v('name') }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { renderAuth('in'); return notify('تم إنشاء حسابك بفضل الله', 'افتح رسالة التأكيد اللي وصلت بريدك، وبعدها سجّل الدخول.', 'ok', 9000); }
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(v('email'), { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        renderAuth('in'); return notify('تم إرسال رابط تغيير كلمة السر بفضل الله', 'افتح الرابط من بريدك واكتب كلمة السر الجديدة.', 'ok', 8000);
      } else if (mode === 'reset') {
        const { error } = await sb.auth.updateUser({ password: document.getElementById('pass').value });
        if (error) throw error;
        S.recovery = false; notify('تم حفظ كلمة السر الجديدة بفضل الله');
        const { data: { session } } = await sb.auth.getSession(); await onSession(session);
      }
    } catch (e) { err(errText(e)); }
  };
}

function renderPending() {
  $app.innerHTML = `
  <main class="auth">
    <h1>في انتظار تفعيل الأدمن</h1>
    <p class="lead">حسابك (${esc(S.session.user.email)}) مسجّل. سيفعّله الأدمن ويحدد الأسئلة التي تراجعها، ثم تظهر لك هنا.</p>
    <button class="btn primary block" id="recheck">تحقق مرة أخرى</button>
    <p><button class="linkbtn quiet" id="out">خروج</button></p>
    ${installCard()}
  </main>`;
  bindInstall();
  document.getElementById('recheck').onclick = () => onSession(S.session);
  document.getElementById('out').onclick = signOut;
}
async function signOut() { stopSolverTimer(); closeSheets(); await sb.auth.signOut(); S.session = null; location.hash = ''; renderAuth('in'); }

async function onSession(session) {
  S.session = session;
  if (S.recovery) return renderAuth('reset');
  if (!session) return renderAuth('in');
  $app.innerHTML = '<div class="loading">جاري التحميل…</div>';
  const { data: prof, error } = await sb.rpc('my_profile');
  if (error) { $app.innerHTML = `<div class="loading">${esc(errText(error))}</div>`; return; }
  S.profile = prof;
  if (!prof || !prof.is_active) return renderPending();
  S.isAdmin = prof.is_staff === true;
  if (!S.resumeChecked) {
    S.resumeChecked = true;
    const r = Resume.read();
    if (r && Date.now() - r.ts < 14 * 864e5) {
      if (!location.hash && r.hash) history.replaceState(null, '', r.hash);
      if (r.sheet && location.hash === r.hash) S.pendingSheet = r.sheet;
      if (r.hash && r.hash.startsWith('#q/')) S.resumedHere = true;
    }
  }
  await route();
  if (!S.draftNoticeShown) {
    S.draftNoticeShown = true;
    const n = Drafts.count();
    if (S.resumedHere && !S.pendingSheet) notify('رجّعتك للمكان اللي كنت فيه', n ? `وعندك ${n} ${n === 1 ? 'مسودة محفوظة' : 'مسودات محفوظة'} مستنية قرارك.` : '', 'info');
    else if (n && !S.pendingSheet) notify(`عندك ${n} ${n === 1 ? 'مسودة لم تُرسل' : 'مسودات لم تُرسل'}`, 'تلاقيها في فولدر "مسودات لم تُرسل"، محفوظة ومستنية قرارك.', 'info', 6500);
  }
}

/* ---------- drafts: saved on every keystroke (device) + synced to the account (server) ---------- */
// kinds: request (new revision request) · edit_request (changes to my open request) · quick_edit · approve_note
const DRAFT_LABEL = { request: 'طلب تعديل لم يُرسل', edit_request: 'تعديلات على طلبك لم تُحفظ', quick_edit: 'تعديل سريع لم يُحفظ', approve_note: 'ملاحظة للطلاب لم تُنشر' };
const Drafts = {
  cache: {}, timers: {}, listeners: new Set(),
  lsKey() { return `drafts:${S.session?.user?.id}`; },
  k(qid, kind) { return `${qid}:${kind}`; },
  load() { try { this.cache = JSON.parse(localStorage.getItem(this.lsKey()) || '{}'); } catch { this.cache = {}; } },
  persist() { try { localStorage.setItem(this.lsKey(), JSON.stringify(this.cache)); } catch { } },
  get(qid, kind) { const d = this.cache[this.k(qid, kind)]; return d && !d.deleted ? d : null; },
  qids() { const s = new Set(); for (const [k, d] of Object.entries(this.cache)) if (!d.deleted) s.add(Number(k.split(':')[0])); return s; },
  count() { return this.qids().size; },
  notify(state) { this.listeners.forEach(fn => { try { fn(state); } catch { } }); },
  save(qid, kind, payload) {
    const k = this.k(qid, kind);
    this.cache[k] = { payload, updated_at: new Date().toISOString(), synced: false };
    this.persist(); this.notify('local');
    clearTimeout(this.timers[k]); this.timers[k] = setTimeout(() => this.sync(k), 900);
  },
  async sync(k) {
    const d = this.cache[k]; if (!d) return;
    const [qid, kind] = k.split(':');
    try {
      if (d.deleted) {
        const { error } = await sb.from('review_drafts').delete().eq('qid', Number(qid)).eq('kind', kind);
        if (!error) { delete this.cache[k]; this.persist(); }
        return;
      }
      const { error } = await sb.from('review_drafts').upsert({ qid: Number(qid), kind, payload: d.payload, updated_at: d.updated_at }, { onConflict: 'user_id,qid,kind' });
      if (!error && this.cache[k] === d) { d.synced = true; this.persist(); this.notify('synced'); }
    } catch { /* offline: stays unsynced and is retried later */ }
  },
  async clear(qid, kind) {
    const k = this.k(qid, kind);
    clearTimeout(this.timers[k]);
    this.cache[k] = { deleted: true, updated_at: new Date().toISOString() }; this.persist();
    await VoiceStore.del(`${qid}:${kind}`).catch(() => { });
    this.sync(k);
  },
  async pull() {
    // merge the account copy with this device: the newer one wins; flush anything this device could not send yet
    let rows = [];
    try { const { data, error } = await sb.from('review_drafts').select('qid,kind,payload,updated_at'); if (!error) rows = data || []; else return; } catch { return; }
    const onServer = new Set();
    for (const r of rows) {
      const k = this.k(r.qid, r.kind); onServer.add(k);
      const loc = this.cache[k];
      if (!loc || (!loc.deleted && new Date(r.updated_at) > new Date(loc.updated_at))) this.cache[k] = { payload: r.payload, updated_at: r.updated_at, synced: true };
    }
    for (const [k, d] of Object.entries(this.cache)) {
      if (d.deleted || !d.synced) this.sync(k);
      else if (!onServer.has(k)) delete this.cache[k];            // finished on another device
    }
    this.persist();
  },
  flush() { for (const [k, d] of Object.entries(this.cache)) if (d.deleted || !d.synced) { clearTimeout(this.timers[k]); this.sync(k); } },
};
window.addEventListener('online', () => Drafts.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { Drafts.flush(); Resume.save(); } });
window.addEventListener('pagehide', () => { Drafts.flush(); Resume.save(); });

/* voice recordings of unsent requests are kept on the device (IndexedDB) */
const VoiceStore = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('ooc-review', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('voice');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  key(k) { return `${S.session?.user?.id}:${k}`; },
  async put(k, blob, mime) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('voice', 'readwrite'); t.objectStore('voice').put({ blob, mime, at: Date.now() }, this.key(k)); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction('voice').objectStore('voice').get(this.key(k)); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); },
  async del(k) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('voice', 'readwrite'); t.objectStore('voice').delete(this.key(k)); t.oncomplete = res; t.onerror = res; }); },
};

/* resume: the app reopens where the reviewer left it (question + open window) */
const Resume = {
  key() { return `resume:${S.session?.user?.id}`; },
  state: { hash: '', sheet: null, ts: 0 },
  read() { try { return JSON.parse(localStorage.getItem(this.key()) || 'null'); } catch { return null; } },
  save(patch) { if (!S.session) return; Object.assign(this.state, patch || {}, { hash: location.hash, ts: Date.now() }); try { localStorage.setItem(this.key(), JSON.stringify(this.state)); } catch { } },
};
window.addEventListener('hashchange', () => Resume.save({ sheet: null }));

function savedLine(el, kind) {
  if (!el) return () => { };
  const t = () => new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const set = state => { el.innerHTML = state === 'synced' ? `✓ محفوظ على جهازك وعلى حسابك (${t()})` : `✓ محفوظ على جهازك (${t()})، وجاري حفظه على حسابك…`; };
  Drafts.listeners.add(set);
  return () => Drafts.listeners.delete(set);
}
function draftAge(d) {
  if (!d?.updated_at) return '';
  return new Date(d.updated_at).toLocaleString('ar-EG', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ---------- data ---------- */
const FOLDERS = [
  { id: 'todo', label: 'تنتظرك', test: r => r.status === 'in_review' || r.status === 'revised' },
  { id: 'drafts', label: 'مسودات لم تُرسل', test: r => Drafts.qids().has(r.qid) },
  { id: 'new', label: 'لم تُفتح', test: r => r.status === 'in_review' && !r.seen },
  { id: 'seen', label: 'فُتحت بلا قرار', test: r => r.status === 'in_review' && r.seen },
  { id: 'requested', label: 'طُلب تعديلها', test: r => r.status === 'needs_revision' },
  { id: 'revised', label: 'عدّلها Claude', test: r => r.status === 'revised' && r.last_edit_label !== 'reviewer_quick_edit' },
  { id: 'quick', label: 'عُدّلت سريعًا', test: r => r.status === 'revised' && r.last_edit_label === 'reviewer_quick_edit' },
  { id: 'notes', label: 'ملاحظات للطلاب', test: r => !!r.note_state },
  { id: 'approved', label: 'معتمدة', test: r => r.status === 'approved' },
  { id: 'all', label: 'الكل', test: () => true },
];
const SORTS = { priority: 'الأولوية (المختلف والأقل ثقة أولًا)', id_asc: 'رقم السؤال: تصاعدي', id_desc: 'رقم السؤال: تنازلي', conf_low: 'الثقة: الأقل أولًا', conf_high: 'الثقة: الأعلى أولًا' };
const CONF_RANK = { low: 0, medium: 1, high: 2 };
const VIEW_KEY = () => `view:${S.session?.user?.id}`;
function loadView() {
  let v = {}; try { v = JSON.parse(localStorage.getItem(VIEW_KEY()) || '{}'); } catch { }
  return { folder: 'todo', sort: 'priority', conf: 'all', disagree: false, incomplete: false, showFilters: false, ...v };
}
function saveView() { try { localStorage.setItem(VIEW_KEY(), JSON.stringify(S.view)); } catch { } }
function listFor(view = S.view) {
  const f = FOLDERS.find(x => x.id === view.folder) || FOLDERS[0];
  let rows = S.rows.filter(f.test);
  if (view.conf !== 'all') rows = rows.filter(r => r.ai_confidence === view.conf);
  if (view.disagree) rows = rows.filter(r => r.match_status === 'disagree');
  if (view.incomplete) rows = rows.filter(r => r.is_incomplete);
  const cr = r => CONF_RANK[r.ai_confidence] ?? 1;
  const by = {
    priority: (a, b) => a.priority - b.priority || a.qid - b.qid,
    id_asc: (a, b) => a.qid - b.qid, id_desc: (a, b) => b.qid - a.qid,
    conf_low: (a, b) => cr(a) - cr(b) || a.qid - b.qid, conf_high: (a, b) => cr(b) - cr(a) || a.qid - b.qid,
  }[view.sort] || ((a, b) => a.qid - b.qid);
  return rows.sort(by);
}
async function loadQueue() {
  if (!S.draftsLoaded) { Drafts.load(); S.draftsLoaded = true; }
  const tasks = [rpc('reviewer_questions'), rpc('reviewer_notices'), Drafts.pull()];
  if (S.isAdmin) tasks.push(rpc('pipeline_status').catch(() => null));
  const [q, n, , p] = await Promise.all(tasks);
  S.rows = q || []; S.notices = n || []; S.pipeline = p || null;
  S.queue = S.rows.filter(FOLDERS[0].test);
}
async function route() {
  if (!S.view) S.view = loadView();
  const m = location.hash.match(/^#q\/(\d+)/);
  try {
    if (m) await openQuestion(Number(m[1]));
    else { closeSheets(); await loadQueue(); renderQueue(); }
  } catch (e) { $app.innerHTML = `<div class="wrap"><div class="empty">${esc(errText(e))}<p><button class="btn" id="err-back">رجوع للقائمة</button></p></div></div>`; document.getElementById('err-back').onclick = () => { location.hash = ''; route(); }; }
}
window.addEventListener('hashchange', () => { if (S.session && S.profile?.is_active) route(); });
function topBar(inner) { return `<header class="bar"><div class="bar-in">${inner}</div></header>`; }
const remaining = () => `فاضلك ${S.queue.length} سؤال`;

/* ---------- list (folders, sorting, filters) ---------- */
function reasonTags(r, showStatus) {
  const t = [];
  if (showStatus) t.push(`<span class="tag cobalt">${esc(STATUS_AR[r.status] || r.status)}</span>`);
  if (r.match_status === 'disagree') t.push('<span class="tag warn">مختلف مع المصدر</span>');
  if (r.ai_confidence) t.push(`<span class="tag ${r.ai_confidence === 'low' ? 'amber' : ''}">ثقة ${esc(CONF[r.ai_confidence] || r.ai_confidence)}</span>`);
  if (r.is_incomplete) t.push('<span class="tag amber">ناقص في المصدر</span>');
  if (r.status === 'revised' && r.last_edit_label === 'reviewer_quick_edit') t.push(`<span class="tag cobalt">⚡ عدّله سريعًا${r.last_edit_by ? ': ' + esc(r.last_edit_by) : ''}</span>`);
  else if (r.status === 'revised') t.push(`<span class="tag cobalt">جولة ${(r.rounds || 1) + 1}</span>`);
  if (Drafts.qids().has(r.qid)) t.push('<span class="tag amber">📝 مسودة لم تُرسل</span>');
  if (r.my_open_request_id) t.push('<span class="tag amber">طلبك مفتوح</span>');
  else if (r.open_requests) t.push('<span class="tag amber">طلب من مراجع آخر</span>');
  return t.join('');
}
function renderQueue() {
  S.bundle = null; S.qid = null; closeSheets();
  const v = S.view, list = listFor();
  const counts = Object.fromEntries(FOLDERS.map(f => [f.id, S.rows.filter(f.test).length]));
  const activeFilters = (v.conf !== 'all') + v.disagree + v.incomplete;
  const items = list.map(r => `<li><a href="#q/${r.qid}">
      <span class="qid">${r.seen ? '' : '<span class="dot-new" title="لم تُفتح"></span>'}${esc(r.qid_display)}</span>
      <span class="qmeta"><span>${esc(r.chapter || '')}</span>${r.years ? ` <span class="small muted">(${esc(r.years)})</span>` : ''}<div class="code">${esc(r.code || '')}</div><div class="tags">${reasonTags(r, v.folder === 'all')}</div>${v.folder === 'notes' && r.note_text ? notePreview(r) : ''}</span>
    </a></li>`).join('');
  $app.innerHTML = topBar(`<span class="brand">مراجعة OOC</span><span class="grow"></span>${installBtn()}<span class="small muted who">${esc(S.profile.display_name || '')}</span><button class="linkbtn quiet" id="out">خروج</button>`) + `
  <main class="wrap">
    ${staffCard()}
    <form class="search" id="goto" role="search"><input class="t" id="goto-n" inputmode="numeric" pattern="[0-9]*" placeholder="اذهب لسؤال رقم… (مثال: 21)" aria-label="رقم السؤال"><button class="btn" type="submit">افتح</button></form>
    <div class="chips" role="tablist" aria-label="الفولدرات">${FOLDERS.filter(f => f.id !== 'drafts' || counts.drafts || v.folder === 'drafts').map(f => `<button class="chip" role="tab" aria-pressed="${v.folder === f.id}" data-folder="${f.id}">${f.label}<span class="n">${counts[f.id]}</span></button>`).join('')}</div>
    <div class="tools">
      <select class="t" id="sort" aria-label="الترتيب">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${v.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn" id="tog-f" aria-expanded="${v.showFilters}">تصفية${activeFilters ? ` (${activeFilters})` : ''}</button>
    </div>
    ${v.showFilters ? `<div class="filters">
      <div class="lbl">درجة ثقة Claude</div>
      <div class="chips" style="padding-bottom:4px">${[['all', 'الكل'], ['high', 'عالية'], ['medium', 'متوسطة'], ['low', 'منخفضة']].map(([k, l]) => `<button class="chip" aria-pressed="${v.conf === k}" data-conf="${k}">${l}</button>`).join('')}</div>
      <div class="chips" style="padding-bottom:0">
        <button class="chip" aria-pressed="${v.disagree}" id="f-dis">المختلف مع المصدر فقط</button>
        <button class="chip" aria-pressed="${v.incomplete}" id="f-inc">الناقص فقط</button>
        ${activeFilters ? '<button class="chip" id="f-clear">مسح التصفية</button>' : ''}
      </div></div>` : ''}
    <div class="qhead"><h2>${esc(FOLDERS.find(f => f.id === v.folder)?.label || '')}</h2><span class="count">${list.length} سؤال</span></div>
    ${list.length ? `<ul class="qlist">${items}</ul>
      <p style="margin-top:16px"><a class="btn primary block" href="#q/${list[0].qid}">ابدأ من أول سؤال في القائمة</a></p>`
      : `<div class="empty"><p>لا توجد أسئلة هنا${activeFilters ? ' بهذه التصفية' : ''}.</p><button class="btn" id="refresh">تحديث</button></div>`}
  </main>`;
  document.getElementById('out').onclick = signOut;
  const r = document.getElementById('refresh'); if (r) r.onclick = route;
  const set = patch => { Object.assign(S.view, patch); saveView(); const y = scrollY; renderQueue(); scrollTo(0, y); };
  $app.querySelectorAll('[data-folder]').forEach(b => b.onclick = () => set({ folder: b.dataset.folder }));
  $app.querySelectorAll('[data-conf]').forEach(b => b.onclick = () => set({ conf: b.dataset.conf }));
  document.getElementById('sort').onchange = e => set({ sort: e.target.value });
  document.getElementById('tog-f').onclick = () => set({ showFilters: !v.showFilters });
  const fd = document.getElementById('f-dis'); if (fd) fd.onclick = () => set({ disagree: !v.disagree });
  const fi = document.getElementById('f-inc'); if (fi) fi.onclick = () => set({ incomplete: !v.incomplete });
  const fc = document.getElementById('f-clear'); if (fc) fc.onclick = () => set({ conf: 'all', disagree: false, incomplete: false });
  document.getElementById('goto').onsubmit = ev => {
    ev.preventDefault();
    const n = parseInt(document.getElementById('goto-n').value, 10);
    if (!n) return toast('اكتب رقم السؤال.');
    if (!S.rows.some(x => x.qid === n)) notify(`السؤال رقم ${n} مش ضمن فولدراتك`, 'هحاول أفتحه لو عندك صلاحية عليه.', 'info');
    location.hash = `#q/${n}`;
  };
  $app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(b.dataset.copy === 'solve' ? MSG_SOLVE : MSG_REVISE));
  bindInstall();
  const ow = document.getElementById('staff'); if (ow) ow.addEventListener('toggle', () => { try { localStorage.setItem('staffOpen', ow.open ? '1' : '0'); } catch { } });
  if (S.isAdmin && S.pipeline) loadSolver();
}

const NOTE_STATE = { published: ['منشورة للطلاب', 'ok'], pending: ['مستنية الاعتماد', 'amber'], in_request: ['في طلب تعديل', 'cobalt'] };
function notePreview(r) {
  const [label, cls] = NOTE_STATE[r.note_state] || ['', ''];
  const txt = r.note_text.length > 140 ? r.note_text.slice(0, 140) + '…' : r.note_text;
  return `<div class="npv"><span class="tag ${cls}">${label}</span><span class="npv-t" dir="auto">📝 ${esc(txt)}</span></div>`;
}

/* ---------- question ---------- */
async function openQuestion(qid) {
  stopSolverTimer(); closeSheets();
  if (!S.rows.length && !S.notices.length) await loadQueue();
  if (!S.bundle || S.qid !== qid) $app.innerHTML = '<div class="loading">جاري تحميل السؤال…</div>';
  const b = await rpc('question_bundle', { p_qid: qid });
  if (!b) throw new Error('هذا السؤال غير متاح لك.');
  S.bundle = b; S.qid = qid; S.showExtra = false;
  const nd = Drafts.get(qid, 'approve_note'); S.noteDraft = nd?.payload?.note || ''; S.noteOpen = !!nd;
  renderQuestion(); scrollTo(0, 0);
  rpc('mark_seen', { p_qid: qid }).then(() => { const r = S.rows.find(x => x.qid === qid); if (r) r.seen = true; }).catch(() => { });
  if (S.pendingSheet) {
    // the app was closed while this window was open: reopen it with everything that was typed or recorded
    const k = S.pendingSheet; S.pendingSheet = null;
    const myReq = (b.reviews || []).find(r => r.status === 'open' && r.reviewer_id === S.session.user.id);
    let opened = true;
    if (k === 'quick_edit' && Drafts.get(qid, k)) openQuickEdit();
    else if (k === 'edit_request' && myReq && Drafts.get(qid, k)) await openRevision({ edit: myReq });
    else if (k === 'request' && Drafts.get(qid, k)) await openRevision();
    else opened = false;
    notify('رجّعتك للمكان اللي كنت فيه', opened ? 'واللي كتبته محفوظ، ومستني تأكيدك أو إلغاءك.' : '', 'info');
    return;
  }
  await showBeforeFirst(qid);
}
function navInfo() {
  // navigate inside the current folder; if the question is not in it (opened by number or link), use its own folder
  let folder = S.view.folder, list = listFor(), i = list.findIndex(r => r.qid === S.qid);
  const row = S.rows.find(r => r.qid === S.qid);
  if (i < 0 && row) {
    const f = FOLDERS.slice(1).find(x => x.id !== 'all' && x.test(row)) || FOLDERS.find(x => x.id === 'all');
    folder = f.id; list = listFor({ ...S.view, folder, conf: 'all', disagree: false, incomplete: false }); i = list.findIndex(r => r.qid === S.qid);
  }
  return { list, i, folder, prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}
function go(r) {
  if (!r) return;
  const nav = navInfo();
  if (nav.folder !== S.view.folder) { S.view = { ...S.view, folder: nav.folder, conf: 'all', disagree: false, incomplete: false }; saveView(); }
  location.hash = `#q/${r.qid}`;
}

function renderQuestion() {
  stopSolverTimer();
  const b = S.bundle, q = b.question, v = b.current_version || {}, tax = b.taxonomy || {};
  const me = S.session.user.id;
  const { base, kind } = diffBase(b);
  const T = (cur, old) => base ? diffHTML(old, cur) : nl(cur);
  const baseOpts = {}; (base?.options || []).forEach(o => baseOpts[o.key] = o);
  const years = (tax.year || []).map(x => x.name).join('، ');
  const claude = (v.options || []).filter(o => o.is_correct).map(o => o.key).join(', ') || '—';
  const access = b.my_access || 0;
  const ms = q.match_status;
  const openReqs = (b.reviews || []).filter(r => r.status === 'open');
  const myReq = openReqs.find(r => r.reviewer_id === me);
  const row = S.rows.find(r => r.qid === q.qid);
  const nav = navInfo();
  const dReq = Drafts.get(q.qid, 'request'), dEdit = Drafts.get(q.qid, 'edit_request'), dQe = Drafts.get(q.qid, 'quick_edit');
  const editValid = dEdit && myReq && dEdit.payload?.reviewId === myReq.id;
  const dpanel = (icon, title, sub, btns) => `<section class="panel draft"><h3>${icon} ${title}</h3><p class="small" style="margin:0 0 10px">${sub}</p><div class="dbtns">${btns}</div></section>`;
  const draftPanels = [
    dReq ? dpanel('📝', myReq ? 'عندك مسودة طلب، وليك طلب مفتوح بالفعل' : 'عندك طلب تعديل لم يُرسل', `محفوظ تلقائيًا (آخر حفظ: ${esc(draftAge(dReq))}) ومستني قرارك.`,
      myReq ? `<button class="btn ok" data-draft-convert="request">✓ ضيفها كتعديل على طلبك</button><button class="btn warn" data-draft-drop="request">✕ احذفها</button>`
            : `<button class="btn ok" data-draft-open="request">✓ أكمل وأكّد الطلب</button><button class="btn warn" data-draft-drop="request">✕ إلغاء الطلب</button>`) : '',
    dEdit ? (editValid
      ? dpanel('✏️', 'عندك تعديلات على طلبك لم تُحفظ', `محفوظة تلقائيًا (آخر حفظ: ${esc(draftAge(dEdit))}).`, `<button class="btn ok" data-draft-open="edit_request">✓ أكمل وأكّد التعديل</button><button class="btn warn" data-draft-drop="edit_request">✕ تجاهل التعديلات</button>`)
      : dpanel('✏️', 'طلبك اتنفّذ أو اتلغى قبل ما تحفظ تعديلاتك عليه', 'تقدر تحوّل التعديلات لطلب جديد، أو تحذفها.', `<button class="btn ok" data-draft-convert="edit_request">✓ حوّلها لطلب جديد</button><button class="btn warn" data-draft-drop="edit_request">✕ احذفها</button>`)) : '',
    dQe ? dpanel('⚡', 'عندك تعديل سريع لم يُحفظ', `محفوظ تلقائيًا (آخر حفظ: ${esc(draftAge(dQe))}).`, `<button class="btn ok" data-draft-open="quick_edit">✓ أكمل وأكّد التعديل</button><button class="btn warn" data-draft-drop="quick_edit">✕ إلغاء التعديل</button>`) : '',
  ].join('');
  const folderLabel = FOLDERS.find(f => f.id === nav.folder)?.label || '';

  const facts = [
    years ? `<span>ورد في: <b>${esc(years)}</b></span>` : '',
    q.source_question_no ? `<span>رقمه في المصدر: <b>${esc(q.source_question_no)}</b>${q.source_page ? ` (صفحة ${esc(q.source_page)})` : ''}</span>` : '',
    tax.chapter ? `<span>الشابتر: <b>${esc(tax.chapter.map(x => x.name).join('، '))}</b></span>` : '',
    `<span>الحالة: <b>${esc(STATUS_AR[q.status] || q.status)}</b></span>`
  ].join('');

  const verdict = `
    <div class="verdict has-foot" aria-label="مقارنة الإجابتين">
      <div class="side"><div class="who">حل Claude</div><div class="letter">${esc(claude)}</div></div>
      <div class="side"><div class="who">الحل الأصلي (ملف الزملاء)</div><div class="letter">${esc(q.source_answer || '—')}</div>${q.source_answer_text ? `<div class="note">${esc(q.source_answer_text)}</div>` : ''}</div>
    </div>
    <div class="verdict-foot">
      <span class="badge ${ms === 'agree' ? 'agree' : ms === 'disagree' ? 'disagree' : 'na'}">${ms === 'agree' ? 'متفق مع المصدر' : ms === 'disagree' ? 'مختلف مع المصدر' : 'لا مقارنة'}</span>
      ${q.ai_confidence ? `<span class="small muted" style="margin-inline-start:8px">ثقة Claude: ${esc(CONF[q.ai_confidence] || q.ai_confidence)}</span>` : ''}
      ${ms === 'disagree' && q.disagreement_reason ? `<div class="reason"><b>سبب الاختلاف:</b> ${esc(q.disagreement_reason)}</div>` : ''}
    </div>`;

  const lr = b.last_request;
  const round2 = kind === 'request' ? `
    <section class="panel round2"><h3>الجولة الثانية</h3>
      <p style="margin:0"><b>طلبت:</b> ${esc(labelType(lr.review.revision_type))}${lr.review.comment_internal ? ` – ${nl(lr.review.comment_internal)}` : ''}${lr.review.voice_transcript ? `<br><span class="small muted">الفويس:</span> ${nl(lr.review.voice_transcript)}` : ''}</p>
      <p style="margin:8px 0 0"><b>اتعمل:</b> ${nl(lr.review.resolution_note || '')}</p>
      <p class="small muted" style="margin:8px 0 0">التغييرات مظللة <mark class="ins">هكذا</mark>، والمحذوف <del class="rem">مشطوب</del>.</p>
    </section>` : kind === 'quick' ? `
    <section class="panel round2"><h3>⚡ عُدّل تعديلًا سريعًا${row?.last_edit_by ? ` بواسطة ${esc(row.last_edit_by)}` : ''}</h3>
      <p style="margin:0"><b>السبب:</b> ${nl(v.change_note || '')}</p>
      <p class="small muted" style="margin:6px 0 0">التعديل محفوظ ومستني الاعتماد، وClaude هيراجع اتساق الشرح معاه في أول محادثة تعديلات. التغييرات مظللة <mark class="ins">هكذا</mark>.</p></section>` : '';

  const reqPanel = openReqs.length ? openReqs.map(r => `
    <section class="panel mine"><h3>${r.reviewer_id === me ? 'طلبك المفتوح' : `طلب مفتوح من ${esc(r.reviewer_name || 'مراجع')}`} <span class="small muted">(${new Date(r.created_at).toLocaleString('ar-EG')})</span></h3>
      ${r.revision_type ? `<div><b>${esc(labelType(r.revision_type))}</b></div>` : ''}
      ${r.comment_internal ? `<div class="pre">${esc(r.comment_internal)}</div>` : ''}
      ${r.voice_transcript ? `<div class="pre"><span class="muted">نص الفويس:</span> ${esc(r.voice_transcript)}</div>` : ''}
      ${r.voice_path ? `<audio class="audio" controls preload="none" data-voice="${esc(r.voice_path)}"></audio>` : ''}
      ${r.student_note ? `<div class="pre small"><span class="muted">ملاحظة للطلاب:</span> ${esc(r.student_note)}</div>` : ''}
      <p class="small muted" style="margin:6px 0 0">ينتظر تنفيذ Claude في محادثة التعديلات، ثم يرجع لك في فولدر "عدّلها Claude".</p>
    </section>`).join('') : '';

  const incomplete = q.is_incomplete ? `
    <section class="panel warn"><h3>سؤال ناقص في المصدر</h3>
      ${q.source_answer_text ? `<p style="margin:0 0 6px">ما ورد في المصدر: <span dir="auto">${nl(q.source_answer_text)}</span></p>` : ''}
      <p style="margin:0 0 10px">اختر: يظهر للطلاب كما هو مع ملاحظة توضح الوضع، أو اطلب تكميله.</p>
      ${access >= 2 && ['in_review', 'revised'].includes(q.status) ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="inc-asis">يظهر كما هو مع ملاحظة</button><button class="btn" id="inc-complete">اطلب تكميله</button></div>` : ''}
    </section>` : '';

  const extraOn = S.showExtra;
  const opts = (v.options || []).map(o => {
    const old = baseOpts[o.key] || {};
    return `<li class="opt ${o.is_correct ? 'correct' : ''}">
      <div class="head"><span class="key">${esc(o.key)}.</span><span class="otext">${T(o.text, old.text)}</span>${o.is_correct ? '<span class="mark">✓ الإجابة</span>' : ''}</div>
      ${o.explanation ? `<div class="expl">${T(o.explanation, old.explanation)}</div>` : ''}
      ${extraOn && o.explanation_extra ? `<div class="expl extra"><span class="lbl">مزيد من الشرح</span>${T(o.explanation_extra, old.explanation_extra)}</div>` : ''}
    </li>`;
  }).join('');

  const ref = b.reference ? `${esc(b.reference.name)}${b.reference.edition ? ` (${esc(b.reference.edition)})` : ''}` : '';
  const refLine = (ref || v.reference_detail) ? `<p class="ref"><b>المرجع</b><span class="refv">${ref}${ref && v.reference_detail ? '<br>' : ''}${T(v.reference_detail, base?.reference_detail)}</span></p>` : '';
  const hand = q.handwritten_note ? `
    <section class="panel hand"><h3>${HAND_LABEL}</h3><div class="pre" dir="auto">${esc(q.handwritten_note)}</div>
      ${q.handwritten_image_path ? `<img id="handimg" alt="صورة الملاحظة الأصلية" style="max-width:100%;margin-top:10px;border-radius:8px">` : ''}</section>` : '';
  const studentNote = v.student_note ? `<section class="panel"><h3>ملاحظة للطلاب (تظهر في التطبيق)</h3><div class="pre" dir="auto">${T(v.student_note, base?.student_note)}</div></section>` : '';
  const shown = (b.reviews || []).filter(r => r.status !== 'open');
  const hist = shown.length ? `<details class="hist"><summary>سجل المراجعة (${shown.length})</summary>
    ${shown.map(r => `<div class="hitem"><b>${esc(r.reviewer_name || '—')}</b> <span class="small muted">جولة ${r.round}، ${new Date(r.created_at).toLocaleString('ar-EG')}</span>
      <div>${esc(DECISION_AR[r.decision] || r.decision)}${r.revision_type ? `: ${esc(labelType(r.revision_type))}` : ''}${r.status === 'cancelled' ? ' <span class="tag">أُلغي</span>' : ''}</div>
      ${r.comment_internal ? `<div class="pre">${esc(r.comment_internal)}</div>` : ''}
      ${r.voice_transcript ? `<div class="pre"><span class="muted">الفويس:</span> ${esc(r.voice_transcript)}</div>` : ''}
      ${r.voice_path ? `<audio class="audio" controls preload="none" data-voice="${esc(r.voice_path)}"></audio>` : ''}
      ${r.resolution_note ? `<div class="pre"><span class="muted">الرد:</span> ${esc(r.resolution_note)}</div>` : ''}
    </div>`).join('')}</details>` : '';

  // action bar by state
  let bar = '';
  const qe = access >= 3 ? `<button class="btn sec" id="qe">⚡ ${dQe ? 'أكمل التعديل السريع' : 'تعديل سريع'}</button>` : '';
  const un = b.undo && (b.undo.previous || b.undo.original) ? `<button class="btn warn" id="undo">↩️ رجوع…</button>` : '';
  const row2 = (...btns) => { const x = btns.filter(Boolean); return x.length ? `<div class="row2" style="grid-template-columns:repeat(${x.length},1fr)">${x.join('')}</div>` : ''; };
  if (access >= 2) {
    if (q.status === 'in_review' || q.status === 'revised') {
      bar = `<div id="apnote" class="notebox ${S.noteOpen ? '' : 'hidden'}"><label class="f" for="apnote-t" style="margin-top:0">ملاحظة للطلاب تُنشر مع الاعتماد</label><textarea class="t" id="apnote-t" dir="auto" placeholder="تظهر للطلاب تحت الشرح">${esc(S.noteDraft || '')}</textarea><div class="saved-line" id="apnote-saved">${S.noteDraft ? 'ملاحظتك محفوظة، وهتتنشر لما تضغط موافق.' : 'بتتحفظ تلقائيًا وإنت بتكتب.'}</div></div>
        <div class="two"><button class="btn ok" id="approve">✅ موافق</button><button class="btn primary" id="revise">${dReq ? '📝 أكمل طلب التعديل' : '✏️ محتاج تعديل'}</button></div>
        ${row2(`<button class="btn sec" id="addnote" aria-expanded="${!!S.noteOpen}">📝 ${S.noteOpen ? 'إخفاء الملاحظة' : 'ملاحظة للطلاب'}</button>`, qe, un)}`;
    } else if (q.status === 'needs_revision') {
      bar = `<div class="two"><button class="btn ok" id="approve-anyway">✅ اعتمده كما هو</button><button class="btn primary" id="revise">✏️ ${myReq ? (editValid ? 'أكمل تعديل طلبك' : 'عدّل طلبك') : (dReq ? 'أكمل طلبك' : 'أضف طلبك')}</button></div>
        ${row2(un, qe)}`;
    } else if (q.status === 'approved') {
      bar = `<div class="${un ? 'two' : ''}"><button class="btn primary ${un ? '' : 'block'}" id="revise">✏️ اطلب تعديلًا</button>${un}</div>
        ${row2(qe)}`;
    }
  }

  $app.innerHTML = topBar(`<button class="linkbtn" id="back" aria-label="رجوع للقائمة">→ القائمة</button><span class="grow"></span>
    <span class="pos">${nav.i >= 0 ? `${nav.i + 1} من ${nav.list.length}` : 'خارج القائمة'}<span class="fl"> · ${esc(folderLabel)}</span></span>
    <span class="nav"><button class="navbtn" id="prev" aria-label="السؤال السابق" title="السابق" ${nav.prev ? '' : 'disabled'}><span dir="ltr">→</span></button><button class="navbtn" id="next" aria-label="السؤال التالي" title="التالي" ${nav.next ? '' : 'disabled'}><span dir="ltr">←</span></button></span>`) + `
  <main class="wrap" id="qmain">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <h1 style="margin:4px 0 0;font-size:1.5rem">سؤال ${esc(q.qid_display)}</h1>
      <span class="small muted" dir="ltr">${esc(q.code || '')}</span>
    </div>
    <div class="facts">${facts}</div>
    ${draftPanels}
    ${verdict}
    ${reqPanel}
    ${round2}
    ${incomplete}
    <article class="content" lang="en">
      <p class="stem">${T(v.stem, base?.stem)}</p>
      ${v.explanation_main ? `<div class="expl"><span class="lbl">الشرح</span>${T(v.explanation_main, base?.explanation_main)}</div>` : ''}
      ${extraOn && v.explanation_extra ? `<div class="expl extra"><span class="lbl">مزيد من الشرح</span>${T(v.explanation_extra, base?.explanation_extra)}</div>` : ''}
      <ul class="opts">${opts}</ul>
    </article>
    <p><button class="btn block" id="toggle-extra" aria-expanded="${extraOn}">${extraOn ? 'إخفاء مزيد من الشرح' : 'مزيد من الشرح'}</button></p>
    ${refLine}
    ${studentNote}
    ${hand}
    ${hist}
    ${access < 2 ? `<section class="panel"><p style="margin:0">صلاحيتك على هذا السؤال قراءة فقط.</p></section>` : ''}
    <p class="small muted" style="text-align:center;margin-top:18px">اسحب يمينًا أو شمالًا للتنقل بين الأسئلة</p>
  </main>
  ${bar ? `<div class="actions"><div class="actions-in">${bar}</div></div>` : ''}`;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('back', () => { location.hash = ''; });
  on('prev', () => go(nav.prev)); on('next', () => go(nav.next));
  on('toggle-extra', () => { S.showExtra = !S.showExtra; const y = scrollY; renderQuestion(); scrollTo(0, y); });
  on('qe', openQuickEdit);
  on('undo', openUndo);
  on('approve', () => {
    if (dReq && !confirm('عندك طلب تعديل لم يُرسل على السؤال ده. الاعتماد هيمسح المسودة دي. تكمل؟')) return;
    doApprove(document.getElementById('apnote-t')?.value);
  });
  on('revise', () => openRevision(myReq ? { edit: myReq } : {}));
  on('addnote', () => { S.noteDraft = document.getElementById('apnote-t')?.value || S.noteDraft; S.noteOpen = !S.noteOpen; renderQuestion(); if (S.noteOpen) document.getElementById('apnote-t')?.focus(); });
  on('inc-asis', () => { S.noteOpen = true; renderQuestion(); const t = document.getElementById('apnote-t'); if (t) { t.placeholder = 'مثال: هذا السؤال وصل ناقصًا في المصدر، ونعرضه كما ورد…'; t.focus(); } notify('اكتب الملاحظة للطلاب ثم اضغط موافق', '', 'info'); });
  on('inc-complete', () => openRevision({ type: 'other', comment: 'تكميل السؤال الناقص: ' }));
  on('approve-anyway', async () => {
    const others = openReqs.filter(r => r.reviewer_id !== me);
    if (!confirm(others.length ? `في طلب تعديل مفتوح من ${others.map(r => r.reviewer_name || 'مراجع').join('، ')}. الاعتماد هيلغي كل الطلبات المفتوحة. تكمل؟` : 'اعتماد السؤال كما هو وإلغاء طلبك؟')) return;
    await doApprove('');
  });
  on('cancel-req', async () => {
    if (!confirm('إلغاء طلب التعديل؟ السؤال هيرجع لحالته قبل الطلب.')) return;
    try { const st = await rpc('cancel_my_request', { p_review_id: myReq.id }); Drafts.clear(q.qid, 'edit_request'); notify(`تم إلغاء طلب التعديل للسؤال رقم ${q.qid_display} بفضل الله`, `رجع السؤال لحالته: ${STATUS_AR[st] || st}.`); await refreshCurrent(); } catch (e) { fail(e); }
  });
  on('undo-approve', async () => {
    if (!confirm('ترجّع السؤال للمراجعة؟ لو كان له اعتماد سابق يرجع الطلاب يشوفوه، وإلا يختفي من تطبيق الطلاب لحد ما يتعتمد تاني.')) return;
    try { await rpc('undo_approval', { p_qid: q.qid }); notify(`تم إرجاع السؤال رقم ${q.qid_display} للمراجعة بفضل الله`, 'تلاقيه في فولدر "تنتظرك".'); await refreshCurrent(); } catch (e) { fail(e); }
  });
  const ta = document.getElementById('apnote-t');
  if (ta) { const un = savedLine(document.getElementById('apnote-saved')); S.unlistenNote && S.unlistenNote(); S.unlistenNote = un;
    ta.oninput = () => { S.noteDraft = ta.value; ta.value.trim() ? Drafts.save(q.qid, 'approve_note', { note: ta.value }) : Drafts.clear(q.qid, 'approve_note'); }; }
  $app.querySelectorAll('[data-draft-open]').forEach(bt => bt.onclick = () => { const k = bt.dataset.draftOpen; k === 'quick_edit' ? openQuickEdit() : openRevision(k === 'edit_request' ? { edit: myReq } : {}); });
  $app.querySelectorAll('[data-draft-drop]').forEach(bt => bt.onclick = async () => {
    const k = bt.dataset.draftDrop;
    if (!confirm({ request: 'إلغاء الطلب ومسح كل اللي كتبته أو سجلته فيه؟', edit_request: 'تجاهل التعديلات؟ طلبك الأصلي هيفضل زي ما هو.', quick_edit: 'إلغاء التعديل السريع؟ السؤال هيفضل زي ما هو.' }[k])) return;
    await Drafts.clear(q.qid, k); notify({ request: 'تم إلغاء الطلب', edit_request: 'تم تجاهل التعديلات', quick_edit: 'تم إلغاء التعديل' }[k], 'واتمسحت المسودة.', 'info'); renderQuestion();
  });
  $app.querySelectorAll('[data-draft-convert]').forEach(bt => bt.onclick = async () => {
    const from = bt.dataset.draftConvert, to = from === 'request' ? 'edit_request' : 'request';
    const d = Drafts.get(q.qid, from); if (!d) return;
    const vv = await VoiceStore.get(`${q.qid}:${from}`).catch(() => null);
    if (vv) await VoiceStore.put(`${q.qid}:${to}`, vv.blob, vv.mime).catch(() => { });
    Drafts.save(q.qid, to, { ...d.payload, reviewId: to === 'edit_request' ? myReq.id : null });
    await Drafts.clear(q.qid, from);
    openRevision(to === 'edit_request' ? { edit: myReq } : {});
  });
  attachMic(document.getElementById('apnote-t'), 'ar-EG');
  if (q.handwritten_image_path) signed('handwritten-crops', q.handwritten_image_path).then(u => { const im = document.getElementById('handimg'); if (im && u) im.src = u; });
  $app.querySelectorAll('audio[data-voice]').forEach(a => signed('voice-notes', a.dataset.voice).then(u => { if (u) a.src = u; }));
  attachSwipe(document.getElementById('qmain'), () => go(nav.next), () => go(nav.prev));
}
function labelType(v) { const t = (S.bundle?.revision_types || []).find(x => x.value === v); return t ? t.label : (v || ''); }
async function signed(bucket, path) { const { data } = await sb.storage.from(bucket).createSignedUrl(path, 3600); return data?.signedUrl || null; }

// horizontal swipe: finger to the left = next (RTL reading order), to the right = previous
function attachSwipe(el, onNext, onPrev) {
  if (!el) return;
  let x0 = null, y0 = null, t0 = 0;
  el.addEventListener('touchstart', e => { if (e.touches.length !== 1 || document.querySelector('.scrim')) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 60 && Date.now() - t0 < 700 && !window.getSelection()?.toString()) { dx < 0 ? onNext() : onPrev(); }
  }, { passive: true });
}

/* ---------- decisions ---------- */
async function refreshCurrent() { await loadQueue(); await openQuestion(S.qid); }
async function afterDecision(qid, title, sub) {
  notify(title, sub);
  const hadTodo = S.queue.length;
  const before = listFor().map(r => r.qid); const idx = before.indexOf(qid);
  await loadQueue();
  await showAfterLast(qid);
  const now = new Set(listFor().map(r => r.qid));
  const next = before.slice(idx + 1).find(id => now.has(id) && id !== qid) ?? [...now].find(id => id !== qid);
  if (hadTodo && !S.queue.length) setTimeout(() => notify('ما شاء الله، خلّصت كل الأسئلة اللي كانت مستنياك', 'جزاك الله خيرًا. هنبلغك لما يوصل أسئلة جديدة في فولدر "تنتظرك".', 'ok', 7000), 1600);
  location.hash = next ? `#q/${next}` : '';
}
async function doApprove(note) {
  const btn = document.getElementById('approve') || document.getElementById('approve-anyway'); if (btn) btn.disabled = true;
  try {
    await rpc('submit_review', { p_qid: S.qid, p_decision: 'approve', p_student_note: (note || '').trim() || null });
    S.noteDraft = ''; S.noteOpen = false; Drafts.clear(S.qid, 'approve_note'); Drafts.clear(S.qid, 'request');
    await afterDecision(S.qid, `تم اعتماد السؤال رقم ${S.bundle.question.qid_display} بفضل الله`, (note || '').trim() ? 'واتنشرت ملاحظتك للطلاب معاه.' : '');
  } catch (e) { if (btn) btn.disabled = false; fail(e); }
}

/* ---------- sheets: drag down / tap outside / back button to close ---------- */
let sheetClose = null;
function closeSheets() { if (sheetClose) sheetClose(true); document.querySelectorAll('.scrim').forEach(s => s.remove()); }
function openSheet(html, { onClose, canClose } = {}) {
  closeSheets();
  const sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="grab" type="button" aria-label="اسحب لأسفل للإغلاق"><span></span></button>${html}</div>`;
  document.body.appendChild(sc);
  const sheet = sc.querySelector('.sheet');
  let closed = false, cleanup = () => { };
  const close = (silent) => {
    if (closed) return true;
    if (!silent && canClose && !canClose()) return false;
    closed = true; sheetClose = null; stopDictation(); onClose && onClose(); cleanup();
    sheet.style.transform = 'translateY(100%)'; setTimeout(() => sc.remove(), 180);
    if (!silent && history.state?.sheet) history.back();
    return true;
  };
  sheetClose = close;
  history.pushState({ sheet: true }, '');
  sc.addEventListener('click', e => { if (e.target === sc) close(); });
  // drag to close: from the handle/header anywhere, or from the body when it is scrolled to the top
  let y0 = null, dy = 0;
  const start = e => { const t = e.touches ? e.touches[0] : e; if (e.target.closest('textarea,input,select,audio,button:not(.grab)')) return; if (!e.target.closest('.grab,.sheet-head') && sheet.scrollTop > 0) return; y0 = t.clientY; dy = 0; sheet.classList.add('dragging'); };
  const move = e => { if (y0 === null) return; const t = e.touches ? e.touches[0] : e; dy = Math.max(0, t.clientY - y0); if (dy > 0) { sheet.style.transform = `translateY(${dy}px)`; if (e.cancelable && e.touches) e.preventDefault(); } };
  const end = () => { if (y0 === null) return; sheet.classList.remove('dragging'); y0 = null; if (dy > 110) { if (!close()) sheet.style.transform = ''; } else sheet.style.transform = ''; };
  sheet.addEventListener('touchstart', start, { passive: true }); sheet.addEventListener('touchmove', move, { passive: false }); sheet.addEventListener('touchend', end);
  sheet.querySelector('.grab').addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') start(e); });
  const pm = e => { if (e.pointerType === 'mouse') move(e); }, pu = e => { if (e.pointerType === 'mouse') end(e); };
  window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);
  cleanup = () => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); };
  sheet.querySelector('.grab').onclick = () => { if (dy < 5) close(); };
  return { sc, sheet, close };
}
window.addEventListener('popstate', () => { if (sheetClose) { const c = sheetClose; if (!c(false)) history.pushState({ sheet: true }, ''); } });

/* ---------- dictation (speech to text, browser service) ---------- */
const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
const D = { active: false, sr: null, target: null, lang: localStorage.getItem('dictLang') || 'ar-EG', ui: null, stack: [], restarts: 0 };
function mountDictation(box, getTarget, defLang) {
  if (!SRClass) {
    box.innerHTML = `<span class="target-hint">للكتابة بالصوت: اضغط في الخانة، ثم زر الميكروفون في الكيبورد.</span>`;
    return;
  }
  const lang = defLang === 'en-US' && !localStorage.getItem('dictLang') ? 'en-US' : D.lang;
  box.innerHTML = `<button class="mic" type="button" aria-pressed="false">🎙️ <span>اتكلم وأنا أكتب</span></button>
    <span class="seg" role="group" aria-label="لغة الكلام"><button type="button" data-lang="ar-EG" aria-pressed="${lang === 'ar-EG'}">عربي</button><button type="button" data-lang="en-US" aria-pressed="${lang === 'en-US'}">English</button></span>
    <button class="linkbtn quiet small hidden" type="button" data-undo>تراجع عن آخر جملة</button>
    <div style="flex-basis:100%"><div class="interim" aria-live="polite"></div><div class="dict-msg" role="alert"></div></div>`;
  const ui = { box, mic: box.querySelector('.mic'), interim: box.querySelector('.interim'), msg: box.querySelector('.dict-msg'), undo: box.querySelector('[data-undo]'), lang };
  ui.mic.onclick = () => (D.active && D.ui === ui) ? stopDictation() : startDictation(ui, getTarget());
  box.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
    ui.lang = b.dataset.lang; D.lang = ui.lang; localStorage.setItem('dictLang', ui.lang);
    box.querySelectorAll('[data-lang]').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (D.active && D.ui === ui) { const t = D.target; stopDictation(); startDictation(ui, t); }
  });
  ui.undo.onclick = () => {
    const last = D.stack.pop(); const t = getTarget();
    if (last && t && t.value.endsWith(last)) { t.value = t.value.slice(0, -last.length).replace(/\s+$/, ''); t.dispatchEvent(new Event('input', { bubbles: true })); }
    if (!D.stack.length) ui.undo.classList.add('hidden');
  };
}
const MIC_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>';
// every place the reviewer writes gets its own mic: speak and the words appear in that field
function attachMic(el, defLang = 'ar-EG') {
  if (!el || el.dataset.mic) return; el.dataset.mic = '1';
  const box = document.createElement('div'); box.className = 'mf';
  el.parentNode.insertBefore(box, el); box.appendChild(el);
  const bar = document.createElement('div'); bar.className = 'mf-bar'; box.appendChild(bar);
  const msg = document.createElement('div'); msg.className = 'mf-msg'; msg.setAttribute('role', 'alert'); box.after(msg);
  if (!SRClass) { bar.innerHTML = `<span class="mf-hint">🎙️ للكتابة بالصوت: اضغط في الخانة ثم ميكروفون الكيبورد</span>`; return; }
  const ui = { box, lang: defLang, msg };
  bar.innerHTML = `<button type="button" class="mf-mic" aria-pressed="false" aria-label="اتكلم وأنا أكتب">${MIC_SVG}<span class="mf-t">اتكلم</span></button>
    <span class="mf-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
    <span class="mf-live" aria-live="polite"></span>
    <button type="button" class="mf-undo hidden" title="امسح آخر جملة اتكتبت بالصوت">↶ آخر جملة</button>
    <button type="button" class="mf-lang" aria-label="لغة الكلام">${defLang === 'en-US' ? 'EN' : 'عربي'}</button>`;
  ui.mic = bar.querySelector('.mf-mic'); ui.label = bar.querySelector('.mf-t'); ui.interim = bar.querySelector('.mf-live'); ui.undo = bar.querySelector('.mf-undo');
  ui.mic.onclick = () => (D.active && D.ui === ui) ? stopDictation() : startDictation(ui, el);
  const langBtn = bar.querySelector('.mf-lang');
  langBtn.onclick = () => {
    ui.lang = ui.lang === 'ar-EG' ? 'en-US' : 'ar-EG'; langBtn.textContent = ui.lang === 'en-US' ? 'EN' : 'عربي';
    if (D.active && D.ui === ui) { stopDictation(); startDictation(ui, el); }
  };
  ui.undo.onclick = () => {
    const last = D.stack.pop();
    if (last && el.value.endsWith(last)) { el.value = el.value.slice(0, -last.length).replace(/\s+$/, ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
    if (!D.stack.length) ui.undo.classList.add('hidden');
  };
}
function setMic(ui, on) {
  if (!ui) return;
  ui.mic.classList.toggle('on', on); ui.mic.setAttribute('aria-pressed', on);
  const lbl = ui.label || ui.mic.querySelector('span'); if (lbl) lbl.textContent = on ? 'إيقاف' : (ui.label ? 'اتكلم' : 'اتكلم وأنا أكتب');
  ui.box && ui.box.classList.toggle('listening', on);
  if (!on) ui.interim.textContent = '';
}
function startDictation(ui, target) {
  if (!target) return;
  if (V.on) stopRec();
  stopDictation();
  D.active = true; D.ui = ui; D.target = target; D.restarts = 0; ui.msg.textContent = '';
  document.querySelectorAll('.dict-target').forEach(x => x.classList.remove('dict-target')); target.classList.add('dict-target');
  setMic(ui, true);
  const run = () => {
    const r = new SRClass(); r.lang = ui.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    D.stack = D.stack || [];
    r.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i], txt = res[0].transcript.trim();
        if (!txt) continue;
        if (res.isFinal) {
          const piece = (target.value && !/\s$/.test(target.value) ? ' ' : '') + txt;
          target.value += piece; D.stack.push(piece); ui.undo.classList.remove('hidden');
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.scrollTop = target.scrollHeight;
        } else interim += txt + ' ';
      }
      ui.interim.textContent = interim;
    };
    r.onerror = ev => {
      const m = {
        'not-allowed': 'الميكروفون مش مسموح له. من الأيقونة اللي جنب رابط الموقع ← الأذونات ← الميكروفون ← سماح.',
        'service-not-allowed': 'خدمة تحويل الكلام مش متاحة في المتصفح ده. استخدم ميكروفون الكيبورد.',
        'audio-capture': 'الميكروفون مشغول بتطبيق أو تسجيل تاني. اقفله وجرب تاني.',
        'network': 'تحويل الكلام محتاج إنترنت. اتأكد من الاتصال.',
        'language-not-supported': 'اللغة دي مش مدعومة هنا.',
      }[ev.error];
      if (m) { ui.msg.textContent = m; D.active = false; setMic(ui, false); }
    };
    r.onend = () => { if (D.active && D.ui === ui && D.restarts++ < 200) { try { run(); } catch { } } else setMic(ui, false); };
    try { r.start(); D.sr = r; } catch (e) { ui.msg.textContent = 'تعذّر تشغيل الميكروفون. جرّب تاني.'; D.active = false; setMic(ui, false); }
  };
  run();
}
function stopDictation() {
  const ui = D.ui; D.active = false;
  try { D.sr && D.sr.stop(); } catch { } D.sr = null;
  setMic(ui, false); D.ui = null;
}

/* ---------- voice recording (separate from dictation) ---------- */
const V = { rec: null, stream: null, chunks: [], blob: null, mime: '', t0: 0, timer: null, on: false };
function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return (window.MediaRecorder && c.find(t => MediaRecorder.isTypeSupported(t))) || '';
}
async function startRec(sheet, onBlob) {
  const state = sheet.querySelector('#rec-state'), btn = sheet.querySelector('#rec-btn');
  stopDictation();
  try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
  catch { state.textContent = 'الميكروفون مش مسموح له. من الأيقونة اللي جنب رابط الموقع ← الأذونات ← الميكروفون ← سماح.'; return; }
  V.mime = pickMime(); V.chunks = []; V.blob = null;
  V.rec = new MediaRecorder(V.stream, V.mime ? { mimeType: V.mime, audioBitsPerSecond: 20000 } : { audioBitsPerSecond: 20000 });
  V.mime = V.rec.mimeType || V.mime || 'audio/webm';
  V.rec.ondataavailable = e => { if (e.data && e.data.size) V.chunks.push(e.data); };
  V.rec.onstop = () => {
    V.blob = new Blob(V.chunks, { type: V.mime.split(';')[0] });
    const play = sheet.querySelector('#rec-play'); if (play) { play.src = URL.createObjectURL(V.blob); play.classList.remove('hidden'); }
    sheet.querySelector('#rec-del')?.classList.remove('hidden');
    state.textContent = `تسجيل جاهز ومحفوظ على الجهاز (${Math.round(V.blob.size / 1024)} KB). Claude بيقرا النص بس، فاكتب (أو اتكلم) المطلوب تعديله في الخانة فوق كمان.`;
    onBlob && onBlob(V.blob);
  };
  V.rec.start(1000); V.on = true; V.t0 = Date.now(); btn.textContent = '■ إيقاف التسجيل';
  V.timer = setInterval(() => {
    const s = Math.floor((Date.now() - V.t0) / 1000);
    state.innerHTML = `<span class="dot" style="display:inline-block"></span> ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= MAX_REC_SECONDS) stopRec();
  }, 500);
}
function stopRec() {
  if (!V.on) return;
  V.on = false; clearInterval(V.timer);
  try { V.rec && V.rec.state !== 'inactive' && V.rec.stop(); } catch { }
  try { V.stream && V.stream.getTracks().forEach(t => t.stop()); } catch { }
  const b = document.getElementById('rec-btn'); if (b) b.textContent = '● سجّل من جديد';
}

/* ---------- revision request sheet (new or edit) – autosaved draft, explicit confirm / cancel ---------- */
async function openRevision(pre = {}) {
  const b = S.bundle, q = b.question, v = b.current_version || {};
  const types = b.revision_types || [];
  const edit = pre.edit || null;
  const kind = edit ? 'edit_request' : 'request';
  const letters = (v.options || []).map(o => o.key);
  const fromReq = r => ({ type: r.revision_type || '', comment: [r.comment_internal, r.voice_transcript].filter(Boolean).join('\n').replace(/الإجابة الصحيحة:\s*[A-Z]\s*\n?/, '').trim(), student: r.student_note || '', answer: (r.comment_internal || '').match(/الإجابة الصحيحة:\s*([A-Z])/)?.[1] || '', keepVoice: r.voice_path || null, reviewId: r.id });
  const saved = Drafts.get(q.qid, kind);
  const base = edit ? fromReq(edit) : { type: pre.type || '', comment: pre.comment || '', student: '', answer: '', keepVoice: null };
  const st = { ...base, ...(saved?.payload || {}) };
  V.blob = null; V.chunks = [];
  if (st.hasVoice) { try { const vv = await VoiceStore.get(`${q.qid}:${kind}`); if (vv) { V.blob = vv.blob; V.mime = vv.mime; } } catch { } }
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  let decided = false;
  Resume.save({ sheet: kind });
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>${edit ? 'تعديل طلبك على السؤال' : 'طلب تعديل للسؤال'} ${esc(q.qid_display)}</h2>
    ${saved ? `<div class="draft-note">رجّعتلك اللي كنت كاتبه (آخر حفظ: ${esc(draftAge(saved))}).</div>` : ''}</div>
    <label class="f">نوع التعديل</label>
    <div class="types" id="rv-types">${types.map(t => `<button type="button" class="chip" data-type="${esc(t.value)}" aria-pressed="${st.type === t.value}">${esc(t.label)}</button>`).join('')}</div>
    <div id="rv-letters" class="${st.type === 'change_answer' ? '' : 'hidden'}"><label class="f">الإجابة الصحيحة في رأيك</label>
      <div class="letters">${letters.map(k => `<button type="button" data-letter="${esc(k)}" aria-pressed="${st.answer === k}">${esc(k)}</button>`).join('')}</div></div>
    <label class="f" for="rv-comment">المطلوب تعديله <span class="lbl-sub">(Claude بينفذه، والفريق بيشوفه)</span></label>
    <textarea class="t" id="rv-comment" dir="auto" rows="4" placeholder="مثال: بسّط شرح الاختيار B، واذكر إن الـ IOP في الأطفال بيتقاس تحت تخدير">${esc(st.comment)}</textarea>
    <label class="f" for="rv-student">ملاحظة للطلاب <span class="lbl-sub">(اختيارية، تظهر في تطبيق الطلاب)</span></label>
    <textarea class="t" id="rv-student" dir="auto" rows="2" placeholder="تظهر للطلاب تحت الشرح لو كتبتها">${esc(st.student)}</textarea>
    <label class="f">تسجيل صوتي (اختياري، للفريق)</label>
    ${st.keepVoice ? `<div id="old-voice"><audio class="audio" controls preload="none" data-voice="${esc(st.keepVoice)}"></audio><button class="linkbtn quiet small" type="button" id="old-voice-del">احذف التسجيل القديم</button></div>` : ''}
    ${canRec ? `<div class="rec"><button class="btn" id="rec-btn" type="button">● ${V.blob ? 'سجّل من جديد' : 'سجّل فويس'}</button><span id="rec-state" class="small muted" aria-live="polite">${V.blob ? 'تسجيلك محفوظ على الجهاز.' : ''}</span></div>
      <audio id="rec-play" controls class="${V.blob ? '' : 'hidden'} audio"></audio><button class="linkbtn quiet small ${V.blob ? '' : 'hidden'}" id="rec-del" type="button">احذف التسجيل</button>` : '<p class="hint">التسجيل غير مدعوم في هذا المتصفح.</p>'}
    <div class="saved-line" id="rv-saved" aria-live="polite">${saved ? `✓ محفوظ (${esc(draftAge(saved))})` : 'أي حاجة تكتبها أو تسجلها بتتحفظ تلقائيًا لحظة بلحظة.'}</div>
    <div class="err" id="rv-err" role="alert"></div>
    <div class="foot"><button class="btn ok" id="rv-send">✓ ${edit ? 'تأكيد حفظ التعديل على طلبك' : 'تأكيد وإرسال الطلب'}</button><button class="btn warn" id="rv-discard" type="button">✕ ${edit ? 'تجاهل التعديلات' : 'إلغاء الطلب'}</button></div>
    <p class="small muted" style="text-align:center;margin:8px 0 0">لو قفلت النافذة من غير ما تختار، هتلاقي كل حاجة محفوظة لما ترجع.</p>
  `, {
    onClose: () => {
      stopRec(); unlisten();
      if (!decided) {
        Resume.save({ sheet: null });
        if (Drafts.get(q.qid, kind)) { notify('المسودة محفوظة', `تقدر تكمّلها أو تلغيها من السؤال رقم ${q.qid_display} في أي وقت.`, 'info'); if (S.qid === q.qid) renderQuestion(); }
      }
    },
  });
  const $ = s => sheet.querySelector(s);
  const unlisten = savedLine($('#rv-saved'));
  if (V.blob) { $('#rec-play').src = URL.createObjectURL(V.blob); }
  const isEmpty = () => !st.type && !$('#rv-comment').value.trim() && !$('#rv-student').value.trim() && !V.blob && !st.answer;
  const unchanged = () => edit && st.type === base.type && $('#rv-comment').value.trim() === base.comment && $('#rv-student').value.trim() === base.student && st.answer === base.answer && !V.blob && st.keepVoice === base.keepVoice;
  const persist = () => {
    if (isEmpty() || unchanged()) { if (Drafts.get(q.qid, kind)) Drafts.clear(q.qid, kind); return; }
    Drafts.save(q.qid, kind, { type: st.type, answer: st.answer, comment: $('#rv-comment').value, student: $('#rv-student').value, keepVoice: st.keepVoice, hasVoice: !!V.blob, reviewId: edit?.id || null });
  };
  ['#rv-comment', '#rv-student'].forEach(s => { const t = $(s); t.addEventListener('input', persist); attachMic(t, 'ar-EG'); });
  sheet.querySelectorAll('[data-type]').forEach(bt => bt.onclick = () => {
    st.type = st.type === bt.dataset.type ? '' : bt.dataset.type;
    sheet.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', x.dataset.type === st.type));
    $('#rv-letters').classList.toggle('hidden', st.type !== 'change_answer'); persist();
  });
  sheet.querySelectorAll('[data-letter]').forEach(bt => bt.onclick = () => {
    st.answer = bt.dataset.letter; sheet.querySelectorAll('[data-letter]').forEach(x => x.setAttribute('aria-pressed', x === bt)); persist();
  });
  const rb = $('#rec-btn'); if (rb) rb.onclick = () => V.on ? stopRec() : startRec(sheet, blob => { VoiceStore.put(`${q.qid}:${kind}`, blob, V.mime).catch(() => { }); persist(); });
  const rd = $('#rec-del'); if (rd) rd.onclick = () => { V.blob = null; VoiceStore.del(`${q.qid}:${kind}`).catch(() => { }); $('#rec-play').classList.add('hidden'); rd.classList.add('hidden'); $('#rec-state').textContent = ''; persist(); };
  const od = $('#old-voice-del'); if (od) od.onclick = () => { st.keepVoice = null; $('#old-voice').remove(); persist(); };
  sheet.querySelectorAll('audio[data-voice]').forEach(a => signed('voice-notes', a.dataset.voice).then(u => { if (u) a.src = u; }));
  if (!edit && pre.comment && !saved) { const t = $('#rv-comment'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }

  $('#rv-discard').onclick = async () => {
    if (!isEmpty() && !unchanged() && !confirm(edit ? 'تجاهل كل التعديلات اللي عملتها على طلبك؟ طلبك الأصلي هيفضل زي ما هو.' : 'إلغاء الطلب ومسح كل اللي كتبته أو سجلته فيه؟')) return;
    decided = true; stopRec(); stopDictation();
    await Drafts.clear(q.qid, kind); V.blob = null;
    Resume.save({ sheet: null }); close(true);
    notify(edit ? 'تم تجاهل التعديلات' : 'تم إلغاء الطلب', edit ? 'طلبك الأصلي زي ما هو.' : 'واتمسحت المسودة بتاعته.', 'info');
    if (S.qid === q.qid) renderQuestion();
  };
  $('#rv-send').onclick = async () => {
    const btn = $('#rv-send'), err = $('#rv-err');
    stopDictation(); if (V.on) stopRec();
    let comment = $('#rv-comment').value.trim();
    const student = $('#rv-student').value.trim() || null;
    if (st.type === 'change_answer') {
      if (!st.answer) { err.textContent = 'اختار الإجابة الصحيحة في رأيك (الحروف فوق).'; return; }
      comment = `الإجابة الصحيحة: ${st.answer}` + (comment ? `\n${comment}` : '');
    }
    if (!st.type && !comment) { err.textContent = V.blob ? 'Claude بيقرا النص بس: اكتب المطلوب تعديله أو اختار نوع التعديل.' : 'اختار نوع التعديل أو اكتب المطلوب تعديله.'; return; }
    btn.disabled = true; err.textContent = '';
    try {
      let path = st.keepVoice;
      if (V.blob) {
        btn.textContent = 'جاري رفع الفويس…';
        const ext = (V.mime || '').includes('mp4') ? 'm4a' : (V.mime || '').includes('ogg') ? 'ogg' : 'webm';
        path = `${S.session.user.id}/${q.qid_display}_${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('voice-notes').upload(path, V.blob, { contentType: (V.mime || 'audio/webm').split(';')[0], upsert: false });
        if (error) throw error;
      }
      if (edit) {
        await rpc('update_my_request', { p_review_id: edit.id, p_revision_type: st.type || null, p_comment: comment || null, p_student_note: student, p_voice_path: path, p_voice_transcript: null });
      } else {
        await rpc('submit_review', { p_qid: q.qid, p_decision: 'needs_revision', p_revision_type: st.type || null, p_comment: comment || null, p_student_note: student, p_voice_path: path, p_voice_transcript: null });
      }
      decided = true; V.blob = null;
      await Drafts.clear(q.qid, kind); Resume.save({ sheet: null }); close(true);
      if (edit) { notify(`تم حفظ التعديل على طلبك للسؤال رقم ${q.qid_display} بفضل الله`); await refreshCurrent(); }
      else await afterDecision(q.qid, `تم إرسال طلب التعديل للسؤال رقم ${q.qid_display} بفضل الله`, 'هيرجعلك في فولدر "عدّلها Claude" بعد التنفيذ.');
    } catch (e) {
      btn.disabled = false; btn.textContent = `✓ ${edit ? 'تأكيد حفظ التعديل على طلبك' : 'تأكيد وإرسال الطلب'}`;
      err.textContent = errText(e) + ' — مسودتك محفوظة، جرّب تاني.';
    }
  };
}

/* ---------- quick edit (access 3) – autosaved draft, explicit confirm / cancel ---------- */
function openQuickEdit() {
  const q = S.bundle.question, v = S.bundle.current_version;
  const saved = Drafts.get(q.qid, 'quick_edit');
  const ta = (id, val, cls = 'en', rows = 3) => `<textarea class="t ${cls}" id="${id}" rows="${rows}">${esc(val || '')}</textarea>`;
  let decided = false;
  Resume.save({ sheet: 'quick_edit' });
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>تعديل سريع للسؤال ${esc(q.qid_display)}</h2>
    ${saved ? `<div class="draft-note">رجّعتلك تعديلاتك اللي ما اتحفظتش (آخر حفظ: ${esc(draftAge(saved))}).</div>` : ''}
    <p class="hint">للتعديلات البسيطة فقط. الإجابة الصحيحة لا تتغير من هنا؛ لتغييرها اطلب تعديلًا بنوع "تغيير الإجابة". في كل خانة زرار 🎙️ تكتب بيه بصوتك.</p></div>
    <label class="f" for="qe-stem">نص السؤال</label>${ta('qe-stem', v.stem)}
    <label class="f" for="qe-main">الشرح (تحت السؤال)</label>${ta('qe-main', v.explanation_main, 'en', 4)}
    <label class="f" for="qe-extra">مزيد من الشرح (تحت السؤال)</label>${ta('qe-extra', v.explanation_extra, 'en', 4)}
    ${(v.options || []).map((o, i) => `<fieldset style="border:1px solid var(--line);border-radius:12px;margin-top:14px;padding:8px 12px">
      <legend style="font-weight:700">الاختيار ${esc(o.key)}${o.is_correct ? ' ✓' : ''}</legend>
      <label class="f" for="qe-o${i}-t" style="margin-top:4px">النص</label>${ta(`qe-o${i}-t`, o.text, 'en', 2)}
      <label class="f" for="qe-o${i}-e">الشرح</label>${ta(`qe-o${i}-e`, o.explanation)}
      <label class="f" for="qe-o${i}-x">مزيد من الشرح (اختياري)</label>${ta(`qe-o${i}-x`, o.explanation_extra)}
    </fieldset>`).join('')}
    <label class="f" for="qe-ref">تفاصيل المرجع</label><input class="t" id="qe-ref" dir="ltr" value="${esc(v.reference_detail || '')}">
    <label class="f" for="qe-note">ملاحظة للطلاب</label>${ta('qe-note', v.student_note, '', 2)}
    <label class="f" for="qe-why">سبب التعديل (مطلوب، كلمتين على الأقل)</label><input class="t" id="qe-why" dir="auto" placeholder="مثال: تصحيح خطأ إملائي في الاختيار C">
    <div class="saved-line" id="qe-saved" aria-live="polite">${saved ? `✓ محفوظ (${esc(draftAge(saved))})` : 'تعديلاتك بتتحفظ تلقائيًا لحظة بلحظة لحد ما تأكدها أو تلغيها.'}</div>
    <div class="err" id="qe-err" role="alert"></div>
    <div class="foot"><button class="btn ok" id="qe-save">✓ تأكيد حفظ التعديل</button><button class="btn warn" id="qe-cancel" type="button">✕ إلغاء التعديل</button></div>
  `, {
    onClose: () => {
      unlisten();
      if (!decided) { Resume.save({ sheet: null }); if (Drafts.get(q.qid, 'quick_edit')) { notify('تعديلاتك محفوظة', `تقدر تكمّلها أو تلغيها من السؤال رقم ${q.qid_display}.`, 'info'); if (S.qid === q.qid) renderQuestion(); } }
    },
  });
  const $ = s => sheet.querySelector(s);
  const fields = [...sheet.querySelectorAll('textarea,input')];
  const initial = Object.fromEntries(fields.map(x => [x.id, x.value]));
  if (saved?.payload?.fields) for (const [id, val] of Object.entries(saved.payload.fields)) { const el = $('#' + id); if (el) el.value = val; }
  const dirty = () => fields.some(x => x.value !== initial[x.id]);
  const unlisten = savedLine($('#qe-saved'));
  const persist = () => { if (!dirty()) { if (Drafts.get(q.qid, 'quick_edit')) Drafts.clear(q.qid, 'quick_edit'); return; } Drafts.save(q.qid, 'quick_edit', { fields: Object.fromEntries(fields.filter(x => x.value !== initial[x.id]).map(x => [x.id, x.value])) }); };
  fields.forEach(x => x.addEventListener('input', persist));
  fields.forEach(x => attachMic(x, ['qe-note', 'qe-why'].includes(x.id) ? 'ar-EG' : 'en-US'));
  $('#qe-cancel').onclick = async () => {
    if (dirty() && !confirm('إلغاء كل التعديلات اللي عملتها هنا؟ السؤال هيفضل زي ما هو.')) return;
    decided = true; await Drafts.clear(q.qid, 'quick_edit'); Resume.save({ sheet: null }); close(true);
    notify('تم إلغاء التعديل', 'السؤال زي ما هو، واتمسحت المسودة.', 'info'); if (S.qid === q.qid) renderQuestion();
  };
  $('#qe-save').onclick = async () => {
    const g = id => $('#' + id).value, norm = s => (s || '').trim(), err = $('#qe-err');
    const why = norm(g('qe-why'));
    if (why.replace(/[\s\p{P}]/gu, '').length < 4 || why.split(/\s+/).length < 2) { err.textContent = 'اكتب سبب واضح للتعديل (كلمتين على الأقل)، عشان باقي الفريق وClaude يفهموا اتعدّل ليه.'; $('#qe-why').focus(); return; }
    const ch = {};
    if (norm(g('qe-stem')) !== norm(v.stem)) ch.stem = norm(g('qe-stem'));
    if (norm(g('qe-main')) !== norm(v.explanation_main)) ch.explanation_main = norm(g('qe-main')) || null;
    if (norm(g('qe-extra')) !== norm(v.explanation_extra)) ch.explanation_extra = norm(g('qe-extra')) || null;
    if (norm(g('qe-ref')) !== norm(v.reference_detail)) ch.reference_detail = norm(g('qe-ref')) || null;
    if (norm(g('qe-note')) !== norm(v.student_note)) ch.student_note = norm(g('qe-note')) || null;
    let optChanged = false;
    const opts = (v.options || []).map((o, i) => {
      const n = { ...o, text: norm(g(`qe-o${i}-t`)), explanation: norm(g(`qe-o${i}-e`)) };
      const x = norm(g(`qe-o${i}-x`)); if (x) n.explanation_extra = x; else delete n.explanation_extra;
      if (n.text !== norm(o.text) || n.explanation !== norm(o.explanation) || (n.explanation_extra || '') !== norm(o.explanation_extra)) optChanged = true;
      return n;
    });
    if (optChanged) ch.options = opts;
    if (!Object.keys(ch).length) { err.textContent = 'لم يتغير شيء في السؤال.'; return; }
    const btn = $('#qe-save'); btn.disabled = true;
    try {
      await rpc('quick_edit', { p_qid: q.qid, p_changes: ch, p_note: why });
      decided = true; await Drafts.clear(q.qid, 'quick_edit'); Resume.save({ sheet: null }); close(true);
      notify(`تم حفظ التعديل السريع للسؤال رقم ${q.qid_display} بفضل الله`, 'تلاقيه في فولدر "عُدّلت سريعًا" لحد ما يتعتمد.'); await refreshCurrent();
    } catch (e) { btn.disabled = false; err.textContent = errText(e) + ' — تعديلاتك محفوظة، جرّب تاني.'; }
  };
}

/* ---------- two ways back: previous state / original question ---------- */
function openUndo() {
  const b = S.bundle, q = b.question, u = b.undo || {};
  const PREV = {
    cancel_request: ['إلغاء طلب التعديل المفتوح', 'الطلب بيتلغي قبل ما Claude ينفذه، والسؤال يرجع لحالته قبل الطلب.'],
    undo_approval: ['إلغاء الاعتماد', 'السؤال يرجع لفولدر "تنتظرك". لو كان له اعتماد أقدم، الطلاب يرجعوا يشوفوه؛ وإلا يختفي من تطبيق الطلاب لحد ما يتعتمد تاني.'],
    undo_quick_edit: ['إلغاء آخر تعديل سريع', 'النص يرجع زي ما كان قبل التعديل السريع بالظبط.'],
    undo_claude_revision: ['رفض تعديل Claude الأخير', 'السؤال يرجع للنسخة اللي طلبت عليها التعديل، والطلب يتسجل إنه اترفض. تقدر تطلب تعديل جديد بعدها.'],
  };
  const p = u.previous && PREV[u.previous];
  const approvedNote = q.status === 'approved' ? ' الطلاب هيفضلوا يشوفوا النسخة المعتمدة لحد ما تعتمده تاني.' : '';
  const card = (mode, icon, title, sub, what) => `<button type="button" class="ucard" data-mode="${mode}" aria-pressed="false">
      <span class="uic">${icon}</span><span class="utx"><b>${title}</b><span class="uwhat">${what}</span><span class="usub">${sub}</span></span></button>`;
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>↩️ رجوع في السؤال ${esc(q.qid_display)}</h2>
    <p class="hint" style="margin-top:4px">اختار نوع الرجوع. كل حاجة بتفضل محفوظة في سجل السؤال، فمفيش حاجة بتضيع.</p></div>
    <div class="ucards">
      ${p ? card('previous', '↩️', 'العودة للوضع السابق', p[1], p[0]) : ''}
      ${u.original ? card('original', '⟲', 'العودة للسؤال بدون أي تعديلات', `يرجع لنسخة Claude الأصلية اللي دخلت المراجعة (النسخة ${esc(u.baseline_version_no || '')})، ويلغي طلبك المفتوح لو فيه.${approvedNote}`, 'كل التعديلات تتلغي') : ''}
    </div>
    <div class="err" id="u-err" role="alert"></div>
    <div class="foot"><button class="btn ok" id="u-go" disabled>✓ تأكيد الرجوع</button><button class="btn" id="u-cancel" type="button">إغلاق</button></div>`);
  let mode = null;
  const go = sheet.querySelector('#u-go');
  sheet.querySelectorAll('.ucard').forEach(c => c.onclick = () => {
    mode = c.dataset.mode; sheet.querySelectorAll('.ucard').forEach(x => x.setAttribute('aria-pressed', x === c));
    go.disabled = false; go.textContent = mode === 'previous' ? '✓ تأكيد العودة للوضع السابق' : '✓ تأكيد العودة للسؤال الأصلي';
  });
  const only = sheet.querySelectorAll('.ucard'); if (only.length === 1) only[0].click();
  sheet.querySelector('#u-cancel').onclick = () => close();
  go.onclick = async () => {
    if (!mode) return;
    go.disabled = true;
    try {
      const st = await rpc('revert_question', { p_qid: q.qid, p_mode: mode });
      if (u.previous === 'cancel_request' || mode === 'original') Drafts.clear(q.qid, 'edit_request');
      close(true);
      notify(mode === 'previous' ? `تم الرجوع للوضع السابق للسؤال رقم ${q.qid_display} بفضل الله` : `تم إرجاع السؤال رقم ${q.qid_display} لنسخته الأصلية بفضل الله`,
             `حالته دلوقتي: ${STATUS_AR[st] || st}.`);
      await refreshCurrent();
    } catch (e) { go.disabled = false; sheet.querySelector('#u-err').textContent = errText(e); }
  };
}

/* ---------- PWA: install guide (Android / computer / Apple) ---------- */
let installEvt = null;
const UA = navigator.userAgent;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const IS_IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /android/i.test(UA);
const IS_MAC = /Macintosh/.test(UA) && !IS_IOS;
const BROWSER = /SamsungBrowser/.test(UA) ? 'samsung' : /FxiOS|Firefox/.test(UA) ? 'firefox' : /EdgA?\//.test(UA) ? 'edge' : /CriOS/.test(UA) ? 'chrome-ios' : /Chrome/.test(UA) ? 'chrome' : /Safari/.test(UA) ? 'safari' : 'other';
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; document.querySelectorAll('[data-install-now]').forEach(b => b.classList.remove('hidden')); });
window.addEventListener('appinstalled', () => { installEvt = null; closeSheets(); notify('تم تثبيت التطبيق بفضل الله', 'هتلاقي أيقونة "مراجعة OOC" على الشاشة الرئيسية.'); document.querySelectorAll('.install-card,#install').forEach(x => x.remove()); });
function installBtn() { return isStandalone() ? '' : `<button class="install" id="install" type="button" aria-label="أضف التطبيق للشاشة الرئيسية">📲 <span class="who">ثبّت التطبيق</span></button>`; }
function installCard() {
  if (isStandalone()) return '';
  return `<button class="install-card" type="button" data-open-install><img src="/icon-192.png" alt=""><div><b>📲 أضف التطبيق للشاشة الرئيسية</b><span>يفتح بضغطة زي أي تطبيق، وبشاشة كاملة. أندرويد، كمبيوتر، أو آيفون.</span></div></button>`;
}
function bindInstall() {
  document.querySelectorAll('[data-open-install],#install').forEach(b => b.onclick = openInstall);
}
async function installNow() {
  if (!installEvt) return;
  installEvt.prompt();
  const r = await installEvt.userChoice.catch(() => null);
  installEvt = null;
  if (r?.outcome !== 'accepted') notify('لم يتم التثبيت', 'تقدر تثبّته في أي وقت من نفس الزر.', 'info');
}
const K = (en, ar) => `<bdi class="k">${en}</bdi>${ar ? ` <span class="ar">(${ar})</span>` : ''}`;
const SHARE_SVG = '<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="زر المشاركة"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const DOTS_V = '<bdi class="k">⋮</bdi>', DOTS_H = '<bdi class="k">⋯</bdi>', BARS = '<bdi class="k">☰</bdi>';
function group(title, here, steps) {
  return `<section class="bgroup ${here ? 'here' : ''}"><h3>${title}${here ? '<span class="here-tag">متصفحك الحالي</span>' : ''}</h3><ol class="steps">${steps.map(x => `<li>${x}</li>`).join('')}</ol></section>`;
}
function installTab(tab) {
  const now = installEvt ? `<button class="btn ok block" data-install-now style="margin-bottom:14px">📲 ثبّت الآن بضغطة واحدة</button>` : '';
  if (tab === 'android') {
    const g = [
      ['chrome', group('Chrome (كروم)', BROWSER === 'chrome' || BROWSER === 'edge', [
        `اضغط زر القائمة ${DOTS_V} فوق.`,
        `اختار ${K('Add to Home screen', 'إضافة إلى الشاشة الرئيسية')} أو ${K('Install app', 'تثبيت التطبيق')}.`,
        `اضغط ${K('Install', 'تثبيت')} أو ${K('Add', 'إضافة')}.`])],
      ['samsung', group('Samsung Internet (متصفح سامسونج)', BROWSER === 'samsung', [
        `اضغط زر القائمة ${BARS} تحت.`,
        `اختار ${K('Add page to', 'إضافة الصفحة إلى')}، وبعدها ${K('Home screen', 'الشاشة الرئيسية')}.`,
        `اضغط ${K('Add', 'إضافة')}.`])],
      ['firefox', group('Firefox (فايرفوكس)', BROWSER === 'firefox', [
        `اضغط زر القائمة ${DOTS_V}.`,
        `اختار ${K('Install', 'تثبيت')} أو ${K('Add to Home screen', 'إضافة إلى الشاشة الرئيسية')}.`,
        'أكّد الإضافة.'])],
    ];
    g.sort((a, b) => (b[0] === BROWSER) - (a[0] === BROWSER));
    return now + g.map(x => x[1]).join('');
  }
  if (tab === 'desktop') {
    const parts = [
      group('Chrome (كروم)', BROWSER === 'chrome' && !IS_ANDROID, [
        `في آخر شريط العنوان، اضغط أيقونة التثبيت (شاشة صغيرة فيها سهم)، أو افتح القائمة ${DOTS_V}.`,
        `من القائمة اختار ${K('Cast, save, and share', 'إرسال وحفظ ومشاركة')} ثم ${K('Install page as app', 'تثبيت الصفحة كتطبيق')}.`,
        `اضغط ${K('Install', 'تثبيت')}. هيظهر التطبيق في قائمة Start وعلى سطح المكتب.`]),
      group('Microsoft Edge (إيدج)', BROWSER === 'edge' && !IS_ANDROID, [
        `افتح القائمة ${DOTS_H} فوق.`,
        `اختار ${K('Apps', 'التطبيقات')} ثم ${K('Install this site as an app', 'تثبيت هذا الموقع كتطبيق')}.`,
        `اضغط ${K('Install', 'تثبيت')}.`]),
    ];
    if (BROWSER === 'edge') parts.reverse();
    return now + parts.join('') + `<p class="small muted" style="margin:0">فايرفوكس على الكمبيوتر ما بيدعمش التثبيت؛ افتح الرابط في كروم أو إيدج.</p>`;
  }
  // apple
  return [
    group('آيفون وآيباد (Safari)', IS_IOS && BROWSER !== 'chrome-ios', [
      `افتح الرابط في متصفح ${K('Safari', 'سفاري')}.`,
      `اضغط زر المشاركة ${SHARE_SVG}: تحت في الآيفون، وفوق في الآيباد.`,
      `انزل في القائمة واختار ${K('Add to Home Screen', 'إضافة إلى الشاشة الرئيسية')}.`,
      `اضغط ${K('Add', 'إضافة')} فوق. الأيقونة هتظهر على الشاشة الرئيسية.`]),
    group('آيفون من Chrome', BROWSER === 'chrome-ios', [
      `اضغط زر المشاركة ${SHARE_SVG} في شريط العنوان فوق.`,
      `اختار ${K('Add to Home Screen', 'إضافة إلى الشاشة الرئيسية')}، ثم ${K('Add', 'إضافة')}.`]),
    group('ماك (Safari 17 أو أحدث)', IS_MAC, [
      `من القائمة العلوية اختار ${K('File', 'ملف')}.`,
      `اضغط ${K('Add to Dock', 'إضافة إلى Dock')} ثم ${K('Add', 'إضافة')}.`]),
  ].join('');
}
function openInstall() {
  const def = IS_IOS || IS_MAC ? 'apple' : IS_ANDROID ? 'android' : 'desktop';
  const tabs = [['android', 'أندرويد'], ['desktop', 'ويندوز / كمبيوتر'], ['apple', 'آيفون / أبل']];
  const body = isStandalone()
    ? `<div class="installed"><span class="ic" style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--ok);color:#fff">✓</span><div>التطبيق مثبت بالفعل، وإنت فاتحه دلوقتي من الشاشة الرئيسية.</div></div>`
    : `<div class="ptabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-ptab="${k}" aria-selected="${k === def}">${l}</button>`).join('')}</div><div id="ptab-body">${installTab(def)}</div>
       <p class="small muted" style="margin:6px 0 0">أسماء القوائم ممكن تختلف شوية حسب نسخة المتصفح.</p>`;
  const { sheet, close } = openSheet(`<div class="sheet-head"><h2>📲 أضف التطبيق للشاشة الرئيسية</h2>
    <p class="hint" style="margin-top:4px">بعدها يفتح بضغطة من أيقونة "مراجعة OOC"، بشاشة كاملة من غير شريط المتصفح.</p></div>${body}
    <div class="foot"><button class="btn" type="button" data-close>إغلاق</button></div>`);
  const bindNow = () => sheet.querySelectorAll('[data-install-now]').forEach(b => b.onclick = installNow);
  sheet.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => {
    sheet.querySelectorAll('[data-ptab]').forEach(x => x.setAttribute('aria-selected', x === b));
    sheet.querySelector('#ptab-body').innerHTML = installTab(b.dataset.ptab); bindNow();
  });
  sheet.querySelector('[data-close]').onclick = () => close();
  bindNow();
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
}

function staffCard() {
  const p = S.pipeline; if (!S.isAdmin || !p) return '';
  const st = p.by_status || {};
  const chats = Math.ceil((p.unsolved || 0) / 35);
  const act = (p.unsolved || 0) + (p.awaiting_reason || 0) + (p.open_requests || 0) + (p.consistency_checks || 0);
  const openState = localStorage.getItem('staffOpen') === '1';
  return `<details class="staff" ${openState ? 'open' : ''} id="staff"><summary style="cursor:pointer;list-style:none"><h2 id="staff-h" style="display:inline">لوحة الإدارة</h2>
    <span class="small muted" style="margin-inline-start:8px">${act ? `${act} يحتاج إجراء` : 'لا شيء يحتاج إجراء'} ▾</span></summary>
    <div class="row"><div class="grow">
      <div class="stat">${p.unsolved || 0} ${p.unsolved_incomplete ? `<span class="small muted">+ ${p.unsolved_incomplete} ناقص</span>` : ''}</div>
      <div class="small muted">سؤال ينتظر الحل${p.unsolved ? ` (حوالي ${chats} ${chats === 1 ? 'محادثة' : 'محادثات'}، 30–40 سؤالًا لكل محادثة)` : '. تظهر هنا بعد الاستخراج.'}</div>
    </div>${p.unsolved || p.awaiting_reason ? `<button class="btn primary" data-copy="solve">انسخ رسالة محادثة الحل</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">افتح Claude</a>` : ''}</div>
    ${p.awaiting_reason ? `<div class="row"><div class="grow small">${p.awaiting_reason} سؤال محلول ومختلف مع المصدر ينتظر كتابة سبب الاختلاف (نفس رسالة الحل).</div></div>` : ''}
    <div class="row"><div class="grow">
      <div class="stat">${p.open_requests || 0}</div>
      <div class="small muted">طلب تعديل مفتوح${p.consistency_checks ? `، و${p.consistency_checks} سؤال عُدّل سريعًا يحتاج مراجعة اتساق` : ''}</div>
    </div>${p.open_requests || p.consistency_checks ? `<button class="btn primary" data-copy="revise">انسخ رسالة محادثة التعديلات</button>` : ''}</div>
    <div class="row" id="solver-box"><div class="grow small muted">جاري تحميل حالة المحلّل الآلي…</div></div>
    <div class="row small muted">في المراجعة ${st.in_review || 0}، معدّل ${st.revised || 0}، ينتظر التعديل ${st.needs_revision || 0}، معتمد ${st.approved || 0}.</div>
  </details>`;
}
/* ---------- paid API solver (staff panel) ---------- */
const PHASE_AR = {
  solve: 'Anthropic يحل الأسئلة الآن كدفعة (Batch): عادةً أقل من ساعة، وقد تصل إلى 24 ساعة. النتائج تُحفظ في القاعدة عند فتح هذه الصفحة.',
  second: 'رأي ثانٍ مستقل للأسئلة المختلفة مع المصدر (دفعة جديدة).',
  reason: 'كتابة سبب الاختلاف للأسئلة المختلفة مع المصدر (دفعة أخيرة).',
};
const usd = n => '\u2066$' + (Number(n) || 0).toFixed(2) + '\u2069'; // isolate so "$0.10" never flips inside Arabic text
async function solverCall(action, extra = {}) {
  const { data, error } = await sb.functions.invoke('solver', { body: { action, ...extra } });
  if (error) {
    let d = null; try { d = await error.context.json(); } catch { }
    const e = new Error(d?.error || error.message); e.detail = d; throw e;
  }
  return data;
}
function solverErr(e) {
  const d = e.detail || {}, c = d.error || e.message;
  if (c === 'no_key') return 'لا يوجد مفتاح API بعد.';
  if (c === 'run_active') return 'توجد تشغيلة جارية بالفعل.';
  if (c === 'trial_waiting_approval') return 'التجربة انتهت وتنتظر قرارك قبل أي تشغيلة جديدة.';
  if (c === 'nothing_to_solve') return 'لا توجد أسئلة تنتظر الحل.';
  if (c === 'no_trial_yet') return 'لم تنجح أي تجربة بعد.';
  if (c === 'over_budget') return `التكلفة المتوقعة ${usd(d.estimate)} أعلى من الحد الأقصى للتشغيلة ${usd(d.cap)}. قلّل عدد الأسئلة.`;
  if (c === 'anthropic_error') {
    if (d.status === 401) return 'مفتاح API غير صحيح. أنشئ مفتاحًا جديدًا وضعه مكان القديم في Supabase.';
    if (/credit balance/i.test(d.detail || '')) return 'رصيد حساب Anthropic غير كافٍ. اشحن الرصيد ثم حاول مرة أخرى.';
    return `رد Anthropic بخطأ (${d.status}): ${String(d.detail || '').slice(0, 160)}`;
  }
  if (c === 'admins_only') return 'للإدارة فقط.';
  return errText(e);
}
function solverSummary(r) {
  const c = r.counts || {}, n = (c.agree || 0) + (c.disagree || 0) + (c.not_applicable || 0);
  return `حُل ${n} من ${r.requested}: اتفاق ${c.agree || 0}، اختلاف ${c.disagree || 0}` +
    (c.second_differs ? ` (${c.second_differs} اختلف فيها الرأي الثاني، فثقتها منخفضة)` : '') +
    (c.error ? `، تعذّر ${c.error} (تبقى للتشغيلة القادمة)` : '') +
    `. التكلفة الفعلية ${usd(r.cost_usd)}${n ? ` (${usd(r.cost_usd / n)} للسؤال)` : ''}.`;
}
let solverTimer = null;
function stopSolverTimer() { if (solverTimer) { clearInterval(solverTimer); solverTimer = null; } }
async function loadSolver(pollFirst = true) {
  const box = document.getElementById('solver-box'); if (!box) return;
  try {
    let st = await solverCall('status');
    if (st.active && pollFirst) { await solverCall('poll', { run_id: st.active.id }).catch(() => null); st = await solverCall('status'); }
    renderSolver(st);
  } catch (e) { box.innerHTML = `<div class="grow small"><b>المحلّل الآلي:</b> تعذّر الوصول إليه. ${esc(solverErr(e))}</div><button class="btn" id="sv-retry">حاول مرة أخرى</button>`; document.getElementById('sv-retry').onclick = () => loadSolver(); }
}
function renderSolver(st) {
  const box = document.getElementById('solver-box'); if (!box) return;
  stopSolverTimer();
  const head = `<b>المحلّل الآلي (مدفوع)</b> <span class="small muted" dir="ltr">${esc(st.model || '')} · ${esc(st.effort || '')}</span>`;
  const last = (st.runs || []).find(r => !['solve', 'second', 'reason'].includes(r.status));
  let html = '';
  if (!st.configured) {
    html = `<div class="grow">${head}<div class="small">غير مفعّل – يحتاج مفتاح API. لا تُصرف أي تكلفة قبل ذلك.</div>
      <details class="small" style="margin-top:6px"><summary style="cursor:pointer;color:var(--cobalt)">كيف أفعّله؟</summary><ol style="margin:6px 0;padding-inline-start:20px">
        <li>من <a href="https://platform.claude.com" target="_blank" rel="noopener">platform.claude.com</a>: اشحن رصيدًا صغيرًا (مثلًا 5 دولار) وضع حد صرف شهري.</li>
        <li>API Keys ← Create Key، وانسخ المفتاح (يظهر مرة واحدة).</li>
        <li>لوحة Supabase ← مشروع OOC Question Bank ← Edge Functions ← Secrets: أضف الاسم <code dir="ltr">ANTHROPIC_API_KEY</code> والقيمة هي المفتاح.</li>
        <li>ارجع هنا واضغط "تحقق".</li></ol></details></div>
      <button class="btn" disabled>حل الدفعة</button><button class="btn" id="sv-check">تحقق</button>`;
  } else if (st.active) {
    const r = st.active, c = r.counts || {};
    html = `<div class="grow">${head}<div class="small">${r.mode === 'trial' ? 'التجربة' : 'تشغيلة'} رقم ${r.id} (${r.requested} سؤال). ${esc(PHASE_AR[r.status] || '')}</div>
      <div class="small muted">التكلفة حتى الآن ${usd(r.cost_usd)} من حد ${usd(r.max_cost_usd)}${c.in_review || c.done_disagree ? `، وصل للمراجعة ${(c.in_review || 0) + (c.done_disagree || 0)}` : ''}.</div></div>
      <button class="btn" id="sv-poll">تحقق الآن</button><button class="btn" id="sv-stop">أوقف</button>`;
    solverTimer = setInterval(() => loadSolver(), 60000);
  } else if (!st.trial_approved && !st.trial_done) {
    const n = Math.min(st.trial_size || 10, st.unsolved || 0);
    html = `<div class="grow">${head}<div class="small">أول تشغيل إجباري: تجربة على ${st.trial_size || 10} أسئلة${n ? `، تكلفتها المتوقعة حوالي ${usd(n * st.est_per_q)}` : ''}. بعدها ترى التكلفة الفعلية وتقرر.</div>
      ${st.unsolved ? '' : '<div class="small muted">لا توجد أسئلة تنتظر الحل الآن؛ التجربة تبدأ بعد استخراج الدفعة الجاية.</div>'}
      ${last ? `<div class="small muted">آخر محاولة: ${esc(solverSummary(last))}</div>` : ''}</div>
      <button class="btn primary" id="sv-start" ${st.unsolved ? '' : 'disabled'}>ابدأ التجربة</button>`;
  } else if (!st.trial_approved) {
    const trial = (st.runs || []).find(r => r.mode === 'trial' && r.status === 'done') || last;
    html = `<div class="grow">${head}<div class="small">${trial ? esc(solverSummary(trial)) : ''}</div>
      <div class="small">باقي الأسئلة (${st.unsolved}) تكلفتها المتوقعة حوالي ${usd(st.unsolved * st.est_per_q)}.</div>
      <div class="small muted">راجع شرح أسئلة التجربة في القائمة أولًا. الحد الأقصى لكل تشغيلة ${usd(st.max_cost_usd)}.</div></div>
      <button class="btn primary" id="sv-approve">افتح الدفعات الكاملة</button>`;
  } else {
    const def = Math.min(st.unsolved || 0, st.max_run_size || 100, Math.max(1, Math.floor((st.max_cost_usd || 5) / (st.est_per_q || 0.12))));
    html = `<div class="grow">${head}<div class="small">${st.unsolved} سؤال ينتظر الحل. التكلفة المتوقعة للسؤال ${usd(st.est_per_q)}، والحد الأقصى للتشغيلة ${usd(st.max_cost_usd)}.</div>
      ${last ? `<div class="small muted">آخر تشغيلة: ${esc(solverSummary(last))}</div>` : ''}
      <label class="small" style="display:flex;align-items:center;gap:8px;margin-top:6px">عدد الأسئلة <input class="t" id="sv-size" type="number" min="1" max="${st.max_run_size}" value="${def || 1}" style="width:90px;min-height:36px;padding:4px 8px"> <span id="sv-est" class="muted"></span></label></div>
      <button class="btn primary" id="sv-start" ${st.unsolved ? '' : 'disabled'}>حل الدفعة</button>`;
  }
  box.innerHTML = html + '<div class="err small" id="sv-err" role="alert" style="flex-basis:100%"></div>';
  const err = t => { const e = document.getElementById('sv-err'); if (e) e.textContent = t; };
  const busy = (b, on) => { if (b) { b.disabled = on; } };
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = async () => { busy(b, true); err(''); try { await fn(); } catch (e) { err(solverErr(e)); busy(b, false); } }; };
  const size = document.getElementById('sv-size');
  if (size) { const upd = () => { const n = Number(size.value) || 0; const est = n * st.est_per_q; document.getElementById('sv-est').textContent = `≈ ${usd(est)}${est > st.max_cost_usd ? ' (أعلى من الحد)' : ''}`; }; size.oninput = upd; upd(); }
  on('sv-check', () => loadSolver());
  on('sv-poll', () => loadSolver(true));
  on('sv-start', async () => {
    const n = size ? Number(size.value) || 1 : st.trial_size;
    if (!confirm(st.trial_approved ? `بدء حل ${n} سؤال بتكلفة متوقعة حوالي ${usd(n * st.est_per_q)}؟` : `بدء التجربة على ${Math.min(st.trial_size, st.unsolved)} أسئلة؟`)) { const b = document.getElementById('sv-start'); if (b) b.disabled = false; return; }
    await solverCall('start', { size: n }); notify('بدأت التشغيلة بفضل الله', 'تابعها من لوحة الإدارة؛ النتائج بتتحفظ أول ما تخلص.'); await loadSolver(false);
  });
  on('sv-stop', async () => {
    if (!confirm('إيقاف التشغيلة؟ ما حُل يبقى محفوظًا، والأسئلة المختلفة تنتقل للمراجعة بسبب مكتوب آليًا.')) { const b = document.getElementById('sv-stop'); if (b) b.disabled = false; return; }
    await solverCall('stop', { run_id: st.active.id }); notify('تم إيقاف التشغيلة', 'اللي اتحل محفوظ، والباقي يفضل للتشغيلة الجاية.', 'info'); await loadQueue(); renderQueue();
  });
  on('sv-approve', async () => {
    if (!confirm('فتح الدفعات الكاملة؟ كل تشغيلة ستظل بضغطة منك وبحد أقصى للتكلفة.')) { const b = document.getElementById('sv-approve'); if (b) b.disabled = false; return; }
    await solverCall('approve_trial'); notify('تم فتح الدفعات الكاملة بفضل الله', 'كل تشغيلة هتفضل بضغطة منك وبحد أقصى للتكلفة.'); await loadSolver(false);
  });
  if (st.active === null && (st.runs || [])[0] && S._lastRunStatus && S._lastRunStatus !== st.runs[0].status) { loadQueue().then(renderQueue); }
  S._lastRunStatus = (st.runs || [])[0]?.status;
}

/* ---------- notices (backlog 9) ---------- */
function noticeModal(n) {
  return new Promise(res => {
    const sc = document.createElement('div'); sc.className = 'scrim';
    sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="nt"><h2 id="nt">${esc(n.title || 'تنبيه')}</h2><p class="pre">${esc(n.body)}</p><div class="foot"><button class="btn primary">تمام</button></div></div>`;
    document.body.appendChild(sc); sc.querySelector('button').focus();
    sc.querySelector('button').onclick = () => { sc.remove(); res(); };
  });
}
async function showBeforeFirst(qid) {
  for (const n of S.notices.filter(n => n.placement === 'before_first' && (n.qids || []).includes(qid) && !seen(n, 'before'))) {
    await noticeModal(n); markSeen(n, 'before');
  }
}
async function showAfterLast(qid) {
  const was = S.notices.filter(n => n.placement === 'after_last' && (n.qids || []).includes(qid));
  if (!was.length) return;
  const fresh = await rpc('reviewer_notices').catch(() => []);
  for (const n of fresh.filter(f => was.some(w => w.id === f.id))) {
    if (!(n.pending_qids || []).length && !seen(n, 'after')) { await noticeModal(n); markSeen(n, 'after'); }
  }
  S.notices = fresh;
}

/* ---------- round-2 diff base ---------- */
function diffBase(b) {
  const q = b.question, v = b.current_version;
  if (q.status === 'revised' && b.last_request && b.last_request.before && b.last_request.before.id !== v.id) return { base: b.last_request.before, kind: 'request' };
  if (q.status === 'revised' && v.created_by_label === 'reviewer_quick_edit' && b.previous_version) return { base: b.previous_version, kind: 'quick' };
  return { base: null, kind: null };
}

/* ---------- boot ---------- */
// Supabase fires INITIAL_SESSION on load, then SIGNED_IN / SIGNED_OUT / PASSWORD_RECOVERY.
// Work is deferred with setTimeout so no Supabase call runs inside the auth callback.
let currentUser = null;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = session; setTimeout(() => renderAuth('reset'), 0); return; }
  if (event === 'SIGNED_OUT') { currentUser = null; S.session = null; S.profile = null; setTimeout(() => renderAuth('in'), 0); return; }
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
    const uid = session?.user?.id || null;
    if (event === 'SIGNED_IN' && uid && uid === currentUser) { S.session = session; return; } // token refresh / tab focus
    const fresh = event === 'SIGNED_IN' && !currentUser;
    currentUser = uid;
    setTimeout(async () => { await onSession(session); if (fresh && S.profile?.is_active) notify(`أهلًا بيك يا ${S.profile.display_name || 'دكتور'}`, S.queue.length ? `في ${S.queue.length} سؤال مستنيين مراجعتك.` : 'مفيش أسئلة مستنياك دلوقتي.', 'info'); }, 0);
  }
  if (event === 'TOKEN_REFRESHED') S.session = session;
});

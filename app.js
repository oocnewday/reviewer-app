/* OOC Question Bank – Reviewer app (phase 3a). Talks to Supabase directly; RLS + RPCs enforce access. */
const SUPABASE_URL = 'https://djqsffknczddefukbuzu.supabase.co';
// Public (anon) key: safe to ship in a web page; every table is protected by RLS.
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcXNmZmtuY3pkZGVmdWtidXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxOTE0NDUsImV4cCI6MjEwNTc2NzQ0NX0.-4r_Mp6GKRLLoqotKPEDmFglsZOnyHrRpuo5j3klIcE';
// Main project doc. The copy buttons hand a new Claude chat a short pointer; the full chat messages live in the doc (v4.8, item 92 phase 1).
const DOC_URL = 'https://claude.ai/artifact/N1k7faWZATPnTFg7AoUyft';
const chatMsg = role => `دورك: ${role} (بنك أسئلة OOC).\nاقرا بأدوات Claude Docs من المستند الرئيسي، قسم "رسائل البداية الجاهزة"، رسالة "${role}"، ونفّذها بالحرف. ماتقراش أي حاجة تانية إلا اللي الرسالة بتقول عليه.\n${DOC_URL}`;
const MSG_SOLVE = chatMsg('محادثة حل معزول');
const MSG_REVISE = chatMsg('محادثة تنفيذ التعديلات');
// Chapter card (v4.8, item 92 phase 2): the batch line (and the attached file for extraction) ride under the same short text.
const msgExtract = (batch, file) => `${chatMsg('محادثة استخراج')}\nالدفعة: ${batch}\nالملف المرفق: ${file}`;
const msgSolveBatch = batch => `${MSG_SOLVE}\nالدفعة: ${batch}`;
const HAND_LABEL = 'ملاحظة منقولة من ملف الأسئلة – مكتوبة بخط اليد';
const MAX_REC_SECONDS = 600;
const APP_VERSION = '5.0';
const APP_BUILD = '5/10/2026';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const S = { session: null, profile: null, isAdmin: false, rows: [], rebuild: [], queue: [], notices: [], pipeline: null, bundle: null, qid: null, showExtra: false, noteOpen: false, noteDraft: '', view: null, recovery: false, studentUrl: null, studentUrlAt: 0 };
const $app = document.getElementById('app');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
// reassuring message box (green = done, red = problem, blue = info)
// dismiss: tap, swipe in any direction, Esc; the timer pauses while a finger is on it
let nboxKill = null;
function notify(title, sub = '', kind = 'ok', ms = 4200) {
  if (nboxKill) nboxKill();                                   // the previous box cleans up its own timer and key listener
  document.querySelectorAll('.nbox').forEach(x => x.remove());
  const n = document.createElement('div'); n.className = `nbox ${kind === 'ok' ? '' : kind}`;
  n.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  n.innerHTML = `<span class="ic" aria-hidden="true">${kind === 'ok' ? '✓' : kind === 'err' ? '!' : 'i'}</span><div><div class="tt">${esc(title)}</div>${sub ? `<div class="sb">${esc(sub)}</div>` : ''}</div><span class="nbar" style="animation-duration:${ms}ms" aria-hidden="true"></span>`;
  document.body.appendChild(n);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let left = ms, t0 = Date.now(), timer = null, gone = false;
  const place = (dx, dy, o) => { n.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px)`; n.style.opacity = o; };
  const bye = (dx = 0, dy = -24) => {
    if (gone) return; gone = true; clearTimeout(timer);
    document.removeEventListener('keydown', onKey); if (nboxKill === kill) nboxKill = null;
    n.style.transition = still ? 'opacity .15s' : 'transform .22s ease-out, opacity .22s ease-out';
    if (!still) place(dx, dy, 0); else n.style.opacity = 0;
    setTimeout(() => n.remove(), 240);
  };
  const run = () => { t0 = Date.now(); clearTimeout(timer); timer = setTimeout(() => bye(), left); n.classList.remove('paused'); };
  const hold = () => { clearTimeout(timer); left = Math.max(800, left - (Date.now() - t0)); n.classList.add('paused'); };
  // finger (or mouse) follows the box; far or fast enough = fly away in that direction
  let x0 = null, y0 = null, tStart = 0, dx = 0, dy = 0;
  n.addEventListener('pointerdown', e => {
    if (gone) return; x0 = e.clientX; y0 = e.clientY; tStart = Date.now(); dx = dy = 0;
    hold(); n.setPointerCapture && n.setPointerCapture(e.pointerId); n.style.transition = 'none';
  });
  n.addEventListener('pointermove', e => {
    if (x0 === null) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    const d = Math.hypot(dx, dy); place(dx, dy, Math.max(0.15, 1 - d / 260));
  });
  const end = () => {
    if (x0 === null) return; x0 = null;
    const d = Math.hypot(dx, dy), v = d / Math.max(1, Date.now() - tStart);
    if (d < 8) { if (Date.now() - tStart < 350) return bye(); n.style.transition = ''; return run(); }   // quick tap closes; a long press was for reading
    if (d > 70 || v > 0.6) {                                   // a swipe: leave in its direction
      const k = 420 / Math.max(d, 1); return bye(dx * k, dy * k);
    }
    n.style.transition = 'transform .2s ease, opacity .2s ease'; place(0, 0, 1); run();   // not far enough: back in place
  };
  n.addEventListener('pointerup', end); n.addEventListener('pointercancel', end);
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.scrim')) bye(); };
  const kill = () => { gone = true; clearTimeout(timer); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey); nboxKill = kill;
  run();
}
function toast(msg, ms = 2600) { notify(msg, '', 'info', ms); }
const fail = e => notify('لم يتم الإجراء', errText(e), 'err', 6000);
function errText(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Not allowed/i.test(m)) return 'ليست لديك صلاحية على هذا السؤال.';
  // 4.8: return to solving (backlog 37, migration 043)
  if (/NOT_IN_REVIEW/.test(m)) return 'السؤال ده رجع للحل أو لسه ماتحلّش، فمش هينفع تراجعه دلوقتي. ارجع للقائمة وحدّثها.';
  if (/QUESTION_CHANGED/.test(m)) return 'السؤال اتغيّر من ساعة ما فتحته (حد عدّله أو اعتمده). ارجع للسؤال وافتحه تاني.';
  if (/RESOLVE_STATUS/.test(m)) return 'السؤال ده مش في حالة ينفع ترجّعه فيها للحل.';
  if (/Resolve reason too short/i.test(m)) return 'اكتب السبب في كلمتين على الأقل.';
  if (/Not allowed to return question/i.test(m)) return 'الرجوع للحل لصلاحية 3 والإدارة بس.';
  // 4.8: chapter card (migration 039)
  if (/DUPLICATE_FILE/.test(m)) return 'الملف ده متسجّل قبل كده باسمه ده. لو هو نفس الشابتر، كمّل من كارته في لوحة الإدارة. ولو شابتر تاني، غيّر اسم الملف وارفعه.';
  if (/File must be a PDF/i.test(m)) return 'لازم الملف يكون PDF، واسمه من غير / أو \\.';
  if (/larger than 50 MB/i.test(m) || /exceeded the maximum allowed size|Payload too large/i.test(m)) return 'الملف أكبر من 50 ميجا. صغّره (مثلًا اطبعه PDF بجودة أقل) وجرّب تاني.';
  if (/DRIVE_LINK/.test(m)) return 'لينك درايف لازم يبدأ بـ https://drive.google.com/';
  if (/Chapter name is required/i.test(m)) return 'اكتب اسم الشابتر.';
  if (/Source is required/i.test(m)) return 'اكتب المصدر.';
  if (/Admins only/i.test(m)) return 'الجزء ده للإدارة بس.';
  // 4.1: decide_duplicate / undo_duplicate (migration 037)
  if (/Not your duplicate decision/i.test(m)) return 'القرار ده أخده مراجع تاني، والتراجع عنه لصاحبه أو للإدارة.';
  if (/Duplicate already decided/i.test(m)) return 'الزوج ده اتاخد فيه قرار بالفعل. حدّث الصفحة.';
  if (/Duplicate questions not solved yet/i.test(m)) return 'القرار بيتاخد بعد ما السؤالين يتحلّوا.';
  if (/Duplicate suggestion not found/i.test(m)) return 'الاقتراح ده مش موجود دلوقتي. حدّث الصفحة.';
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
  if (/Not solved yet/i.test(m)) return 'تقرير الاستخراج بيظهر بعد حل السؤال.';
  if (/Nothing to undo/i.test(m)) return 'مفيش خطوة سابقة ترجعلها في السؤال ده. حدّث الصفحة.';
  if (/Already original/i.test(m)) return 'السؤال أصلًا على نسخته الأصلية.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'لا يوجد اتصال بالإنترنت. تأكد من الاتصال وحاول مرة أخرى.';
  return m;
}
// 4.8 (review (ع)): a page opened before the question went back to solving – say so plainly and refresh it
// (drafts are already saved on every keystroke, so closing the open sheet loses nothing)
function staleQuestion() {
  S.dirty = true;
  if (!location.hash.startsWith('#q/')) return;
  setTimeout(() => {
    closeSheets();
    notify('السؤال ده رجع للحل من جديد', 'حد من الفريق رجّعه للحل وإنت فاتح الصفحة، فمراجعته هتبقى بعد ما يتحل. الصفحة اتحدّثت.', 'info');
    reloadQuestion().catch(e => console.warn('reload after NOT_IN_REVIEW:', e));
  }, 0);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) { if (/NOT_IN_REVIEW/.test(error.message || '')) staleQuestion(); throw error; }
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
    ${appFooter()}
  </main>`;
  $app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  bindFooter();
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
    ${appFooter()}
  </main>`;
  bindInstall(); bindFooter();
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
// kinds: request (new revision request) · edit_request (changes to my open request) · quick_edit · approve_note · rebuild (4.0: rebuild screen, migration 036)
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
  { id: 'rebuild', label: 'محتاجة إعادة تركيب 🛠️', test: () => false },   // 4.0 (backlog 30): unsolved questions from rebuild_queue, not reviewer_questions
  { id: 'drafts', label: 'مسودات لم تُرسل', test: r => Drafts.qids().has(r.qid) },
  { id: 'new', label: 'لم تُفتح', test: r => r.status === 'in_review' && !r.seen },
  { id: 'seen', label: 'فُتحت بلا قرار', test: r => r.status === 'in_review' && r.seen },
  { id: 'requested', label: 'طُلب تعديلها', test: r => r.status === 'needs_revision' },
  { id: 'revised', label: 'عدّلها Claude', test: r => r.status === 'revised' && r.last_edit_label !== 'reviewer_quick_edit' },
  { id: 'quick', label: 'عُدّلت سريعًا', test: r => r.status === 'revised' && r.last_edit_label === 'reviewer_quick_edit' },
  { id: 'notes', label: 'ملاحظات للطلاب', test: r => !!r.note_state },
  { id: 'approved', label: 'معتمدة', test: r => r.status === 'approved' },
  { id: 'alerts', label: 'فيها تنبيه ⚠️', test: r => !!(r.alert_kinds && r.alert_kinds.length) },   // 3.9: "⚠️ للمراجع" block (backlog 24); kept before 'all' so navigation inside folders is unchanged
  { id: 'dups', label: 'محتمل مكرر 🔁', test: r => (r.dup_pending || 0) > 0 },   // 4.1 (backlog 29): pairs waiting for a decision; the chip shows only when it has questions
  { id: 'all', label: 'الكل', test: () => true },
];
const SORTS = { priority: 'الأولوية (المختلف والأقل ثقة أولًا)', id_asc: 'رقم السؤال: تصاعدي', id_desc: 'رقم السؤال: تنازلي', conf_low: 'الثقة: الأقل أولًا', conf_high: 'الثقة: الأعلى أولًا' };
const CONF_RANK = { low: 0, medium: 1, high: 2 };
const VIEW_KEY = () => `view:${S.session?.user?.id}`;
function loadView() {
  let v = {}; try { v = JSON.parse(localStorage.getItem(VIEW_KEY()) || '{}'); } catch { }
  return { folder: 'todo', sort: 'priority', conf: 'all', disagree: false, incomplete: false, chapter: 'all', hidden: false, hiddenKind: 'all', showFilters: false, ...v };
}
function saveView() { try { localStorage.setItem(VIEW_KEY(), JSON.stringify(S.view)); } catch { } }
/* 4.1: two more list filters, in the interface only (integration_backlog 31, 32).
   31 – chapter: the chapters that have at least one question students can see now (student_state 'ai' or 'reviewed'),
        worked out from reviewer_questions, so a chapter that opens for students shows up by itself. One choice.
   32 – hidden from students: any student_state that starts with "hidden_", with a sub-filter per kind that exists now,
        so a new hidden kind shows up by itself.
   Counts next to each choice = questions in the open folder that pass the other filters. The "rebuild" folder ignores them. */
const NO_FILTERS = { conf: 'all', disagree: false, incomplete: false, chapter: 'all', hidden: false, hiddenKind: 'all' };
const VISIBLE_STATES = new Set(['ai', 'reviewed']);
const isHidden = r => String(r.student_state || '').startsWith('hidden_');
const HIDDEN_SHORT = { hidden_disagree: 'اختلاف مع المصدر', hidden_low_confidence: 'ثقة منخفضة', hidden_incomplete: 'ناقص', hidden_completed: 'اختياراته من المراجع', hidden_no_source: 'المصدر من غير إجابة', hidden_answer_fix: 'لحد تصليح الإجابة', hidden_admin: 'بقرار الإدارة', hidden_archived: 'مؤرشف' };
const hiddenLabel = k => HIDDEN_SHORT[k] || String(k).replace(/^hidden_/, '').replace(/_/g, ' ');
function countBy(rows, key) { const o = {}; for (const r of rows) { const k = key(r); o[k] = (o[k] || 0) + 1; } return o; }
function chapterList() { return [...new Set(S.rows.filter(r => r.chapter && VISIBLE_STATES.has(r.student_state)).map(r => r.chapter))].sort((a, b) => a.localeCompare(b)); }
function hiddenKinds() {
  const order = Object.keys(STUDENT_STATE), rank = k => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
  return [...new Set(S.rows.filter(isHidden).map(r => r.student_state))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
// a saved chapter or hidden kind that is not in the lists any more goes back to "الكل"
function fixView() {
  const v = S.view; if (!v) return;
  let changed = false;
  if (v.chapter && v.chapter !== 'all' && !chapterList().includes(v.chapter)) { v.chapter = 'all'; changed = true; }
  if (v.hiddenKind && v.hiddenKind !== 'all' && !hiddenKinds().includes(v.hiddenKind)) { v.hiddenKind = 'all'; changed = true; }
  if (changed) saveView();
}
function applyFilters(rows, view, skip) {
  if (view.conf && view.conf !== 'all') rows = rows.filter(r => r.ai_confidence === view.conf);
  if (view.disagree) rows = rows.filter(r => r.match_status === 'disagree');
  if (view.incomplete) rows = rows.filter(r => r.is_incomplete);
  if (skip !== 'chapter' && view.chapter && view.chapter !== 'all') rows = rows.filter(r => r.chapter === view.chapter);
  if (skip !== 'hidden' && view.hidden) rows = rows.filter(r => isHidden(r) && (!view.hiddenKind || view.hiddenKind === 'all' || r.student_state === view.hiddenKind));
  return rows;
}
function facetHTML(v) {
  const f = FOLDERS.find(x => x.id === v.folder) || FOLDERS[0], inFolder = S.rows.filter(f.test);
  const chRows = applyFilters(inFolder, v, 'chapter'), chN = countBy(chRows, r => r.chapter), chapters = chapterList();
  const chip = (attr, k, label, n, on) => `<button class="chip" aria-pressed="${on}" ${attr}="${esc(k)}"><bdi>${esc(label)}</bdi><span class="n">${n}</span></button>`;
  const ch = chapters.length ? `<div class="lbl">الشابتر (الظاهر للطلاب)</div>
      <div class="chips" style="padding-bottom:4px" aria-label="الشابتر">${chip('data-chapter', 'all', 'الكل', chRows.length, v.chapter === 'all')}${chapters.map(c => chip('data-chapter', c, c, chN[c] || 0, v.chapter === c)).join('')}</div>` : '';
  let hid = '';
  if (v.hidden) {
    const hRows = applyFilters(inFolder, v, 'hidden').filter(isHidden), hN = countBy(hRows, r => r.student_state), hk = v.hiddenKind || 'all';
    hid = `<div class="chips sub" aria-label="نوع المخفي">${chip('data-hkind', 'all', 'كل المخفي', hRows.length, hk === 'all')}${hiddenKinds().map(k => chip('data-hkind', k, hiddenLabel(k), hN[k] || 0, hk === k)).join('')}</div>`;
  }
  return { ch, hid };
}
function listFor(view = S.view) {
  if (view.folder === 'rebuild') return [...(S.rebuild || [])];   // already ordered by number; sorting and filters do not apply
  const f = FOLDERS.find(x => x.id === view.folder) || FOLDERS[0];
  let rows = applyFilters(S.rows.filter(f.test), view);
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
  const since = localStorage.getItem(FEED_KEY()) || new Date(Date.now() - 7 * 864e5).toISOString();
  rpc('team_activity_new_count', { p_since: since }).then(n => { S.newCount = n || 0; const bd = document.getElementById('feed-n'); if (bd) { bd.textContent = S.newCount; bd.classList.toggle('hidden', !S.newCount); } }).catch(() => { });
  const rb = rpc('rebuild_queue').catch(() => []);   // empty for anyone below access 3
  const tasks = [rpc('reviewer_questions'), rpc('reviewer_notices'), Drafts.pull(), loadStudentUrl()];
  if (S.isAdmin) {
    tasks.push(rpc('pipeline_status').catch(() => null));
    // v4.8: chapter cards (migration 039). Missing function or no network: the panel falls back to the two 4.7-style rows.
    tasks.push(rpc('chapter_runs_status').catch(e => { console.warn('chapter_runs_status:', e && e.message); return null; }));
  }
  const [q, n, , , p, ch] = await Promise.all(tasks);
  S.rows = q || []; S.notices = n || []; S.pipeline = p || null; S.chapters = Array.isArray(ch) ? ch : null; S.rowsAt = Date.now(); S.dirty = false; S.prefetch = {};
  S.queue = S.rows.filter(FOLDERS[0].test);
  S.rebuild = (await rb) || [];
  fixView();
}
/* 4.7 (backlog 28): the student app link comes from settings.student_app_url (RLS lets any active reviewer read settings),
   never from the code, so a new domain needs no app update. The row itself is the switch: it is added (migration 038) only
   after the student app version with direct links (8.9) is live, and while it is missing the button stays hidden.
   Read with the queue, at most every 10 minutes; any failure keeps the last good value (or none). */
async function loadStudentUrl() {
  if (S.studentUrlAt && Date.now() - S.studentUrlAt < 10 * 60000) return;
  try {
    const { data, error } = await sb.from('settings').select('value').eq('key', 'student_app_url').maybeSingle();
    if (error) return;
    S.studentUrlAt = Date.now();
    S.studentUrl = safeStudentBase(data && data.value);
  } catch { }
}
function safeStudentBase(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    u.search = ''; u.hash = '';
    return u.href;
  } catch { return null; }
}
/* Same link shape in both apps: <student_app_url>/?q=<qid_display>, e.g. https://newday-app.onrender.com/?q=000112 */
function studentLink(qidDisplay) {
  if (!S.studentUrl || !/^\d{1,9}$/.test(String(qidDisplay || ''))) return '';
  const u = new URL(S.studentUrl);
  u.searchParams.set('q', String(qidDisplay));
  return u.href;
}
/* Question page: the students' line, and next to it the button – only while students can see the question. */
function studentRowHTML(b, q) {
  const line = studentLine(b.student_state, true);
  const href = VISIBLE_STATES.has(b.student_state) ? studentLink(q.qid_display) : '';
  if (!href) return line;
  return `<div class="svrow">${line}<a class="svlink" id="open-student" href="${esc(href)}" target="_blank" rel="noopener noreferrer">👁️ افتحه في تطبيق الطلاب</a></div>`;
}
async function route() {
  if (!S.view) S.view = loadView();
  const m = location.hash.match(/^#q\/(\d+)/);
  try {
    const rm = location.hash.match(/^#report\/(\d+)/), bm = location.hash.match(/^#rebuild\/(\d+)/), sm = location.hash.match(/^#resolve\/(\d+)/);
    if (location.hash === '#activity') { if (!S.rows.length) await loadQueue(); await renderActivity(false); }
    else if (rm) await renderBatchReport(Number(rm[1]));
    else if (bm) await renderRebuild(Number(bm[1]));
    else if (sm) await renderRebuild(Number(sm[1]), 'resolve');
    else if (m) await openQuestion(Number(m[1]));
    else {
      closeSheets();
      const fresh = S.rowsAt && Date.now() - S.rowsAt < 60000 && !S.dirty;
      if (!fresh) await loadQueue();
      renderQueue();
      if (S.listScroll) { const y = S.listScroll; requestAnimationFrame(() => scrollTo(0, y)); }
    }
  } catch (e) { $app.innerHTML = `<div class="wrap"><div class="empty">${esc(errText(e))}<p><button class="btn" id="err-back">رجوع للقائمة</button></p></div></div>`; document.getElementById('err-back').onclick = () => { location.hash = ''; route(); }; }
}
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const inQ = h => h.startsWith('#q/') || h.startsWith('#rebuild/') || h.startsWith('#resolve/');
  if (!inQ(lastHash) && !lastHash.startsWith('#report/') && lastHash !== '#activity' && inQ(location.hash)) S.listScroll = scrollY;   // leaving the list
  if (!location.hash) { /* back to list keeps listScroll */ } else if (!inQ(location.hash) && !location.hash.startsWith('#report/')) S.listScroll = 0;
  lastHash = location.hash;
  if (S.session && S.profile?.is_active) route();
});
// pause background work while the app is hidden; refresh quietly when it comes back after a while
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); stopDictation(); stopSolverTimer(); return; }
  if (!S.session || !S.profile?.is_active) return;
  if (hiddenAt && Date.now() - hiddenAt > 120000) { S.dirty = true; if (!location.hash && !document.querySelector('.scrim')) route(); }
  else if (!location.hash && S.isAdmin && document.getElementById('solver-box')) loadSolver(false);
});
function topBar(inner) { return `<header class="bar"><div class="bar-in">${inner}</div></header>`; }
const remaining = () => `فاضلك ${S.queue.length} سؤال`;

/* ---------- list (folders, sorting, filters) ---------- */
function reasonTags(r, showStatus) {
  const t = [];
  if (showStatus) t.push(`<span class="tag cobalt">${esc(STATUS_AR[r.status] || r.status)}</span>`);
  if (r.match_status === 'disagree') t.push('<span class="tag warn">مختلف مع المصدر</span>');
  if (r.ai_confidence) t.push(`<span class="tag ${r.ai_confidence === 'low' ? 'amber' : ''}">ثقة ${esc(CONF[r.ai_confidence] || r.ai_confidence)}</span>`);
  if (r.is_incomplete) t.push('<span class="tag amber">ناقص في المصدر</span>');
  t.push(alertTags(r.alert_kinds, r.is_incomplete));
  if (r.dup_linked) t.push(`<span class="tag dup-l">🔁 مكرر مع <bdi>${esc(r.dup_with || '')}</bdi></span>`);   // 4.1 (backlog 29)
  if (r.dup_pending) t.push(`<span class="tag dup-p">🔁 محتمل مكرر${r.dup_pending > 1 ? ` (${r.dup_pending})` : ''}</span>`);
  if (r.status === 'revised' && r.last_edit_label === 'reviewer_quick_edit') t.push(`<span class="tag cobalt">⚡ عدّله سريعًا${r.last_edit_by ? ': ' + esc(r.last_edit_by) : ''}</span>`);
  else if (r.status === 'revised') t.push(`<span class="tag cobalt">جولة ${(r.rounds || 1) + 1}</span>`);
  if (Drafts.qids().has(r.qid)) t.push('<span class="tag amber">📝 مسودة لم تُرسل</span>');
  if (r.my_open_request_id) t.push('<span class="tag amber">طلبك مفتوح</span>');
  else if (r.open_requests) t.push('<span class="tag amber">طلب من مراجع آخر</span>');
  return t.join('');
}
function renderQueue() {
  S.bundle = null; S.qid = null; S.navHold = null; closeSheets();
  const v = S.view, list = listFor();
  const counts = Object.fromEntries(FOLDERS.map(f => [f.id, S.rows.filter(f.test).length]));
  counts.rebuild = (S.rebuild || []).length;
  const isRb = v.folder === 'rebuild';
  const activeFilters = (v.conf !== 'all') + v.disagree + v.incomplete + (v.chapter !== 'all') + !!v.hidden;
  const fx = !isRb && v.showFilters ? facetHTML(v) : { ch: '', hid: '' };
  const shown = list.slice(0, S.listLimit || 60);
  const items = isRb ? shown.map(rbItem).join('') : shown.map(r => `<li><a href="#q/${r.qid}">
      <span class="qid">${r.seen ? '' : '<span class="dot-new" title="لم تُفتح"></span>'}${esc(r.qid_display)}</span>
      <span class="qmeta"><span>${esc(r.chapter || '')}</span>${r.years ? ` <span class="small muted">(${esc(r.years)})</span>` : ''}<div class="code">${esc(r.code || '')}</div><div class="tags">${reasonTags(r, v.folder === 'all')}</div>${studentLine(r.student_state)}${v.folder === 'notes' && r.note_text ? notePreview(r) : ''}${lastLine(r)}</span>
    </a></li>`).join('');
  $app.innerHTML = topBar(`<span class="brand">مراجعة OOC</span><span class="grow"></span>${installBtn()}<span class="small muted who">${esc(S.profile.display_name || '')}</span><button class="linkbtn quiet" id="out">خروج</button>`) + `
  <main class="wrap">
    ${staffCard()}
    <a class="feed-btn" href="#activity"><span aria-hidden="true">👥</span> نشاط الفريق <span class="feed-sub">مين اعتمد إيه، وطلب إيه</span><span class="badge-n ${S.newCount ? '' : 'hidden'}" id="feed-n" aria-label="أحداث جديدة">${S.newCount || 0}</span></a>
    <form class="search" id="goto" role="search"><input class="t" id="goto-n" inputmode="numeric" autocomplete="off" placeholder="اذهب لسؤال رقم… (مثال: 21)" aria-label="رقم السؤال"><button class="btn" type="submit">افتح</button></form>
    <div class="chips" role="tablist" aria-label="الفولدرات">${FOLDERS.filter(f => (f.id !== 'drafts' || counts.drafts || v.folder === 'drafts') && (f.id !== 'rebuild' || counts.rebuild || isRb) && (f.id !== 'dups' || counts.dups || v.folder === 'dups')).map(f => `<button class="chip" role="tab" aria-pressed="${v.folder === f.id}" data-folder="${f.id}">${f.label}<span class="n">${counts[f.id]}</span></button>`).join('')}</div>
    ${isRb ? `<p class="hint rb-lead">أسئلة لسه ماتحلّتش، وفيها مشكلة بتمنع حلها. اكتب نصها واختياراتها من مرجع موثوق، وبعدها بترجع للحل المعزول لوحدها.</p>` : `<div class="tools">
      <select class="t" id="sort" aria-label="الترتيب">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${v.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn" id="tog-f" aria-expanded="${v.showFilters}">تصفية${activeFilters ? ` (${activeFilters})` : ''}</button>
    </div>
    ${v.showFilters ? `<div class="filters">
      <div class="lbl">درجة ثقة Claude</div>
      <div class="chips" style="padding-bottom:4px">${[['all', 'الكل'], ['high', 'عالية'], ['medium', 'متوسطة'], ['low', 'منخفضة']].map(([k, l]) => `<button class="chip" aria-pressed="${v.conf === k}" data-conf="${k}">${l}</button>`).join('')}</div>
      ${fx.ch}
      <div class="chips" style="padding-bottom:0">
        <button class="chip" aria-pressed="${v.disagree}" id="f-dis">المختلف مع المصدر فقط</button>
        <button class="chip" aria-pressed="${v.incomplete}" id="f-inc">الناقص فقط</button>
        <button class="chip" aria-pressed="${!!v.hidden}" id="f-hid">المخفي عن الطلاب فقط</button>
      </div>
      ${fx.hid}
      ${activeFilters ? '<div class="chips" style="padding:8px 0 0"><button class="chip" id="f-clear">مسح التصفية</button></div>' : ''}
    </div>` : ''}`}
    <div class="qhead"><h2>${esc(FOLDERS.find(f => f.id === v.folder)?.label || '')}</h2><span class="count">${list.length} سؤال <button class="linkbtn quiet small" id="reload" title="تحديث القائمة" aria-label="تحديث القائمة">🔄</button></span></div>
    ${list.length ? `<ul class="qlist">${items}</ul>${list.length > shown.length ? `<p><button class="btn block" id="more-q">عرض المزيد (${list.length - shown.length})</button></p>` : ''}
      <p style="margin-top:16px"><a class="btn primary block" href="#${isRb ? 'rebuild' : 'q'}/${list[0].qid}">ابدأ من أول سؤال في القائمة</a></p>`
      : `<div class="empty"><p>${isRb ? 'مفيش أسئلة مستنية إعادة تركيب.' : v.folder === 'dups' && !activeFilters ? 'مفيش أسئلة مستنية قرار التكرار.' : `لا توجد أسئلة هنا${activeFilters ? ' بهذه التصفية' : ''}.`}</p><button class="btn" id="refresh">تحديث</button></div>`}
    ${installListCard()}
    ${appFooter()}
  </main>`;
  document.getElementById('out').onclick = signOut;
  const r = document.getElementById('refresh'); if (r) r.onclick = () => { S.dirty = true; route(); };
  const rl = document.getElementById('reload'); if (rl) rl.onclick = async () => { rl.disabled = true; await loadQueue(); renderQueue(); notify('تم تحديث القائمة', '', 'info', 1800); };
  const mq = document.getElementById('more-q'); if (mq) mq.onclick = () => { S.listLimit = (S.listLimit || 60) + 60; const y = scrollY; renderQueue(); scrollTo(0, y); };
  bindFooter();
  const set = patch => { Object.assign(S.view, patch); saveView(); S.listLimit = 60; const y = scrollY; renderQueue(); scrollTo(0, y); };
  $app.querySelectorAll('[data-folder]').forEach(b => b.onclick = () => set({ folder: b.dataset.folder }));
  $app.querySelectorAll('[data-conf]').forEach(b => b.onclick = () => set({ conf: b.dataset.conf }));
  const so = document.getElementById('sort'); if (so) so.onchange = e => set({ sort: e.target.value });
  const tf = document.getElementById('tog-f'); if (tf) tf.onclick = () => set({ showFilters: !v.showFilters });
  const fd = document.getElementById('f-dis'); if (fd) fd.onclick = () => set({ disagree: !v.disagree });
  const fi = document.getElementById('f-inc'); if (fi) fi.onclick = () => set({ incomplete: !v.incomplete });
  const fh = document.getElementById('f-hid'); if (fh) fh.onclick = () => set({ hidden: !v.hidden, hiddenKind: 'all' });
  $app.querySelectorAll('[data-chapter]').forEach(b => b.onclick = () => set({ chapter: b.dataset.chapter }));
  $app.querySelectorAll('[data-hkind]').forEach(b => b.onclick = () => set({ hiddenKind: b.dataset.hkind }));
  const fc = document.getElementById('f-clear'); if (fc) fc.onclick = () => set({ ...NO_FILTERS });
  document.getElementById('goto').onsubmit = ev => {
    ev.preventDefault();
    const m = String(document.getElementById('goto-n').value || '').match(/\d+/);   // 4.7: also "Q ID 000112" pasted from the student app
    const n = m ? parseInt(m[0], 10) : 0;
    if (!n) return toast('اكتب رقم السؤال.');
    if ((S.rebuild || []).some(x => x.qid === n)) { location.hash = `#rebuild/${n}`; return; }   // still unsolved, waiting for a rebuild
    if (!S.rows.some(x => x.qid === n)) notify(`السؤال رقم ${n} مش ضمن فولدراتك`, 'هحاول أفتحه لو عندك صلاحية عليه.', 'info');
    location.hash = `#q/${n}`;
  };
  $app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText((S.copyMsgs || {})[b.dataset.copy] || (b.dataset.copy === 'solve' ? MSG_SOLVE : MSG_REVISE)));
  const ncb = document.getElementById('nc-open'); if (ncb) ncb.onclick = () => openNewChapter();
  $app.querySelectorAll('details.chap').forEach(d => d.addEventListener('toggle', () => {
    const id = Number(d.dataset.run), set = new Set(chapOpen());
    if (d.open) set.add(id); else set.delete(id);
    try { localStorage.setItem('chapOpen', JSON.stringify([...set])); } catch { }
  }));
  const sd = document.getElementById('solver-d'); if (sd) sd.addEventListener('toggle', () => { try { localStorage.setItem('solverOpen', sd.open ? '1' : '0'); } catch { } });
  $app.querySelectorAll('[data-viewpages]').forEach(b => b.onclick = () => {
    const c = (S.chapters || []).find(x => Number(x.run_id) === Number(b.dataset.viewpages)); if (!c) return;
    openPageViewer({ prefix: c.pages_prefix, ext: c.pages_ext || 'webp', bucket: c.pages_bucket || 'source-pages', page_count: Number(c.pages_done) || Number(c.page_count), page_offset: Number(c.page_offset) || 0 }, 1);
  });
  $app.querySelectorAll('[data-link]').forEach(b => b.onclick = () => { const c = (S.chapters || []).find(x => Number(x.run_id) === Number(b.dataset.link)); if (c) openDriveLink(c); });
  $app.querySelectorAll('[data-pages]').forEach(b => b.onclick = () => { const c = (S.chapters || []).find(x => Number(x.run_id) === Number(b.dataset.pages)); if (c) openPagesSheet(c); });
  $app.querySelectorAll('[data-gofolder]').forEach(b => b.onclick = () => { Object.assign(S.view, { folder: b.dataset.gofolder }); saveView(); S.listLimit = 60; renderQueue(); const c = document.querySelector('.chips'); if (c) c.scrollIntoView({ block: 'start' }); });
  bindInstall();
  const ow = document.getElementById('staff'); if (ow) ow.addEventListener('toggle', () => { try { localStorage.setItem('staffOpen', ow.open ? '1' : '0'); } catch { } });
  if (S.isAdmin && S.pipeline) loadSolver();
}

/* What students see for each question (student_state from the database, migration 026).
   A filled dot = shown to students; a ring = hidden. Labels are fixed text, so no escaping is needed. */
const STUDENT_STATE = {
  reviewed: ['ظاهر للطلاب – <bdi dir="ltr">Reviewed</bdi>', 'on'],
  ai: ['ظاهر للطلاب – بانتظار مراجعتك', 'ai'],
  hidden_disagree: ['مخفي – اختلاف مع المصدر، محتاج اعتمادك', 'wait'],
  hidden_low_confidence: ['مخفي – ثقة Claude منخفضة، محتاج اعتمادك', 'wait'],
  hidden_no_source: ['مخفي – المصدر من غير إجابة، محتاج اعتمادك', 'wait'],
  hidden_incomplete: ['مخفي – سؤال ناقص، محتاج قرارك', 'wait'],
  hidden_completed: ['مخفي – اختياراته من المراجع، محتاج اعتمادك', 'wait'],   // 4.0 (migration 035)
  hidden_answer_fix: ['مخفي – لحد تصليح الإجابة', 'fix'],
  hidden_admin: ['مخفي بقرار الإدارة', 'off'],
  hidden_archived: ['مخفي – مؤرشف', 'off'],
  not_ready: ['مش ظاهر – لسه ماتحلّش', 'off'],
};
function studentLine(state, big) {
  const s = STUDENT_STATE[state];
  if (!s) return '';
  return `<div class="sv sv-${s[1]}${big ? ' sv-big' : ''}"><span class="sv-i" aria-hidden="true"></span><span>${s[0]}</span></div>`;
}
const NOTE_STATE = { published: ['منشورة للطلاب', 'ok'], pending: ['مستنية الاعتماد', 'amber'], in_request: ['في طلب تعديل', 'cobalt'] };
function notePreview(r) {
  const [label, cls] = NOTE_STATE[r.note_state] || ['', ''];
  const txt = r.note_text.length > 140 ? r.note_text.slice(0, 140) + '…' : r.note_text;
  return `<div class="npv"><span class="tag ${cls}">${label}</span><span class="npv-t" dir="auto">📝 ${esc(txt)}</span></div>`;
}

/* ---------- 3.9: "⚠️ للمراجع" card (integration_backlog 24) ----------
   The extraction chat appends a block at the end of handwritten_note: an empty line, a line starting with "⚠️ للمراجع",
   then one "• " line per problem. These are Claude's words, not the source's, so they get their own card above the
   transcribed note, and the note is shown without them. Display only: the stored note is never changed.
   The same kinds are computed on the server (private.alert_kinds, migration 030) for the folder and the list tags. */
const ALERT_HEAD = '⚠️ للمراجع';
const ALERT_KINDS = [   // first words of a line -> key (same keys as the server), badge label
  ['إجابة المصدر', 'source_answer'], ['مكرر', 'duplicate'], ['ناقص', 'incomplete'],
  ['غير مؤكد', 'uncertain'], ['تصليح كتابة', 'typo'], ['تصنيف', 'category'],
];
const ALERT_LABEL = Object.fromEntries(ALERT_KINDS.map(([label, key]) => [key, label]));
function splitAlert(note) {
  const s = String(note || '');
  const at = s.startsWith(ALERT_HEAD) ? 0 : s.indexOf('\n\n' + ALERT_HEAD);
  if (at < 0) return { main: s, alert: null };
  const [head, ...rest] = s.slice(at === 0 ? 0 : at + 2).split('\n');
  const lines = [];
  for (const raw of rest) {
    const t = raw.trim(); if (!t) continue;
    if (!t.startsWith('•')) { if (lines.length) lines[lines.length - 1].text += '\n' + t; else lines.push({ key: null, label: '', text: t }); continue; }
    const body = t.replace(/^•\s*/, '');
    const hit = ALERT_KINDS.find(([label]) => body.startsWith(label) && /^(\s|:|$)/.test(body.slice(label.length)));
    lines.push(hit ? { key: hit[1], label: hit[0], text: body.slice(hit[0].length).replace(/^\s*:\s*/, '') } : { key: null, label: '', text: body });
  }
  return { main: at === 0 ? '' : s.slice(0, at), alert: { head: head.trim(), lines } };
}
function alertTags(kinds, incompleteShown) {
  if (!kinds || !kinds.length) return '';
  const keys = ALERT_KINDS.map(k => k[1]).filter(k => kinds.includes(k) && !(k === 'incomplete' && incompleteShown));   // "ناقص في المصدر" is already there
  if (!keys.length) return '<span class="tag ak ak-other">⚠️ تنبيه للمراجع</span>';
  return keys.map((k, i) => `<span class="tag ak ak-${k}">${i ? '' : '⚠️ '}${ALERT_LABEL[k]}</span>`).join('');
}
function alertCardHTML(al, src) {
  if (!al) return '';
  const sub = al.head.slice(ALERT_HEAD.length).trim().replace(/:\s*$/, '');
  const items = al.lines.map(l => `<li>${l.key ? `<span class="tag ak ak-${l.key}">${esc(l.label)}</span> ` : ''}<span dir="auto">${nl(l.text)}</span></li>`).join('');
  return `<section class="panel alert" aria-labelledby="alert-h">
      <div class="al-head"><h3 id="alert-h">⚠️ للمراجع</h3>${src?.pdf_page ? `<button class="btn sec pgbtn" type="button" data-page="${Number(src.pdf_page)}">📄 افتح صفحة المصدر</button>` : ''}</div>
      ${sub ? `<div class="al-sub" dir="auto">${esc(sub)}</div>` : ''}
      <ul class="al-list">${items}</ul>
      <p class="al-foot">ملاحظات Claude وقت نقل السؤال من الملف، مش كلام المصدر. القرار فيها ليك.</p>
    </section>`;
}

/* ---------- 4.1: similar questions (integration_backlog 29, migration 037) ----------
   The database pairs solved questions whose stem + options are at least 75% alike (pg_trgm, settings.duplicate_similarity_min),
   plus the pairs the extraction chat marked "similar" at a lower score (source = 'extraction').
   The reviewer decides: "مكرر" = both stay visible to students and each is linked to the other (not a merge),
   "مش مكرر" = the pair is closed for good. The undo button sits on the card, not in the question's "رجوع" menu,
   because the decision belongs to the pair, not to one version of one question.
   question_bundle.duplicates (question_duplicates): pending pairs first; can_decide needs access 2 on both questions;
   can_undo is for the reviewer who decided, or an admin. Nothing here reaches students yet (that is backlog 33). */
const pct = s => (s == null || s === '' || !Number.isFinite(Number(s))) ? '' : `${Math.round(Number(s) * 100)}%`;
function dupCardHTML(d) {
  const o = d.other || {}, id = Number(d.id), st = d.status;
  let foot;
  if (st === 'pending') foot = d.can_decide
    ? `<div class="dup-btns"><button class="btn sec" type="button" data-dup-set="linked" data-pair="${id}">🔁 مكرر</button><button class="btn sec" type="button" data-dup-set="distinct" data-pair="${id}">مش مكرر</button></div>
      <p class="dup-help"><span><b>مكرر:</b> الاتنين يفضلوا ظاهرين، وكل واحد مربوط بالتاني.</span><span><b>مش مكرر:</b> الاقتراح بيتقفل للسؤالين دول.</span></p>`
    : '<p class="dup-help">القرار محتاج صلاحية مراجعة على السؤالين.</p>';
  else {
    const who = d.decided_mine ? 'إنت' : (d.decided_by || 'مراجع');
    foot = `<div class="dup-dec"><p>القرار: <b>${st === 'linked' ? 'مكرر' : 'مش مكرر'}</b>، أخده ${esc(who)}${d.decided_at ? ` <time class="muted" datetime="${esc(d.decided_at)}">${esc(ago(d.decided_at))}</time>` : ''}</p>${d.can_undo ? `<button class="btn warn" type="button" data-dup-undo="${id}">↩️ تراجع</button>` : ''}</div>`;
  }
  return `<section class="panel dup${st === 'linked' ? ' is-linked' : st === 'distinct' ? ' is-distinct' : ''}" id="dup-${id}" aria-labelledby="dup-h-${id}">
      <div class="dup-head"><h3 id="dup-h-${id}">🔁 سؤال مشابه <span class="dup-pct" dir="ltr">${pct(d.score)}</span></h3>${d.source === 'extraction' ? '<span class="tag">من الاستخراج</span>' : ''}</div>
      <div class="dup-row"><a class="qchip" href="#q/${Number(o.qid) || 0}">سؤال ${esc(o.qid_display || '')}</a><button class="btn sec dup-cmpb" type="button" data-dup-cmp="${id}" aria-expanded="false" aria-controls="dupc-${id}">قارن</button></div>
      <div class="dup-cmp" id="dupc-${id}" hidden></div>
      ${foot}
    </section>`;
}
// options are matched by their words (at least half in common), best pairs first, because the order and the letters can differ
const optWords = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
function optSim(a, b) {
  const A = optWords(a), B = optWords(b);
  if (!A.length || !B.length) return A.length === B.length ? 1 : 0;
  const bag = new Map(); A.forEach(w => bag.set(w, (bag.get(w) || 0) + 1));
  let c = 0; B.forEach(w => { const n = bag.get(w); if (n) { c++; bag.set(w, n - 1); } });
  return 2 * c / (A.length + B.length);
}
function matchOptions(mine, theirs) {
  const cand = [];
  theirs.forEach((x, i) => mine.forEach((y, j) => cand.push([optSim(y.text, x.text), i, j])));
  cand.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
  const res = theirs.map(() => -1), taken = new Set();
  for (const [sc, i, j] of cand) { if (sc < 0.5) break; if (res[i] < 0 && !taken.has(j)) { res[i] = j; taken.add(j); } }
  return res;
}
// the other question, marked against this one: highlighted = only in the other question, struck = only in this one
function dupCompareHTML(d, v) {
  const o = d.other || {}, mine = Array.isArray(v.options) ? v.options : [], theirs = Array.isArray(o.options) ? o.options : [];
  const m = matchOptions(mine, theirs), taken = new Set(m.filter(j => j >= 0));
  const keys = a => a.filter(x => x.is_correct).map(x => x.key);
  const myK = keys(mine), thK = keys(theirs), other = esc(o.qid_display || '');
  const same = myK.length > 0 && myK.length === thK.length && theirs.every((x, i) => !x.is_correct || (m[i] >= 0 && mine[m[i]].is_correct));
  const row = (key, text, ok, note, gone) => `<li class="dup-o${ok ? ' ok' : ''}${gone ? ' gone' : ''}"><span class="dk">${esc(key)}</span><span class="t">${text}</span>${ok ? '<span class="c" title="الإجابة الصح" aria-label="الإجابة الصح">✓</span>' : ''}${note ? `<span class="nt" dir="rtl">${note}</span>` : ''}</li>`;
  const rows = theirs.map((x, i) => {
    const y = m[i] >= 0 ? mine[m[i]] : null;
    return row(x.key, y ? diffHTML(y.text, x.text) : `<mark class="ins">${nl(x.text)}</mark>`, !!x.is_correct, y ? (y.key !== x.key ? `هنا ${esc(y.key)}` : '') : 'مش موجود هنا', false);
  }).join('') + mine.filter((y, j) => !taken.has(j)).map(y => row(y.key, `<del class="rem">${nl(y.text)}</del>`, false, 'هنا بس', true)).join('');
  return `<p class="dup-legend"><mark class="ins">المظلّل</mark> في سؤال ${other} بس، و<del class="rem">المشطوب</del> في السؤال ده بس، و✓ إجابة سؤال ${other}.</p>
      <p class="dup-ans">إجابة Claude: هنا <b dir="ltr">${esc(myK.join(', ') || '—')}</b>، وفي سؤال ${other} <b dir="ltr">${esc(thK.join(', ') || '—')}</b>${myK.length && thK.length ? ` <span class="tag ${same ? 'ok' : 'warn'}">${same ? 'نفس الإجابة' : 'الإجابة مختلفة'}</span>` : ''}</p>
      <div class="dup-q" lang="en" dir="ltr"><p class="dup-stem">${diffHTML(v.stem, o.stem)}</p><ul class="dup-opts">${rows}</ul></div>`;
}
function bindDupCards(b, v) {
  const find = id => (b.duplicates || []).find(x => Number(x.id) === id);
  $app.querySelectorAll('[data-dup-cmp]').forEach(bt => bt.onclick = () => {
    const id = Number(bt.dataset.dupCmp), box = document.getElementById(`dupc-${id}`), d = find(id);
    if (!box || !d) return;
    if (!box.dataset.ready) { box.innerHTML = dupCompareHTML(d, v); box.dataset.ready = '1'; }   // built on first open only
    const open = box.hidden; box.hidden = !open;
    bt.setAttribute('aria-expanded', String(open)); bt.textContent = open ? 'إخفاء المقارنة' : 'قارن';
  });
  $app.querySelectorAll('[data-dup-set]').forEach(bt => bt.onclick = () => dupAction(Number(bt.dataset.pair), bt.dataset.dupSet));
  $app.querySelectorAll('[data-dup-undo]').forEach(bt => bt.onclick = () => dupAction(Number(bt.dataset.dupUndo), 'undo'));
}
async function dupAction(id, what) {
  const d = (S.bundle?.duplicates || []).find(x => Number(x.id) === id); if (!d) return;
  const card = document.getElementById(`dup-${id}`), btns = card ? [...card.querySelectorAll('[data-dup-set],[data-dup-undo]')] : [];
  btns.forEach(x => { x.disabled = true; });
  const a = S.bundle.question.qid_display, o = d.other?.qid_display || '';
  const before = listFor().map(r => r.qid), folder = S.view.folder;
  try {
    if (what === 'undo') await rpc('undo_duplicate', { p_pair_id: id });
    else await rpc('decide_duplicate', { p_pair_id: id, p_decision: what });
    if (what === 'linked') notify(`تم تسجيل إن السؤالين ${a} و${o} مكررين بفضل الله`, 'الاتنين بيفضلوا ظاهرين، وكل واحد مربوط بالتاني.');
    else if (what === 'distinct') notify(`تم تسجيل إن السؤالين ${a} و${o} مش مكررين بفضل الله`, 'الاقتراح اتقفل للسؤالين دول، ومش هيتعرض تاني.');
    else notify('تم التراجع عن قرار التكرار بفضل الله', 'الزوج رجع مستني قرار في فولدر "محتمل مكرر 🔁".');
    S.navHold = before.includes(S.qid) ? { qid: S.qid, folder, list: before } : null;   // next / previous stay in this folder
    await reloadQuestion();
  } catch (e) {
    const m = e?.message || '';
    if (/Duplicate already decided|Nothing to undo|Duplicate suggestion not found/i.test(m)) {   // someone changed the pair meanwhile: show what stands now
      notify('لم يتم الإجراء', /Nothing to undo/i.test(m) ? 'الزوج ده رجع مستني قرار بالفعل، والكارت اتحدّث.' : /not found/i.test(m) ? 'الاقتراح ده مش موجود دلوقتي، والصفحة اتحدّثت.' : 'مراجع تاني أخد قرار في الزوج ده، والكارت اتحدّث بقراره.', 'err', 6500);
      await reloadQuestion().catch(() => { });
      return;
    }
    btns.forEach(x => { x.disabled = false; });
    fail(e);
  }
}
// same question, same scroll position; the list is reloaded too, so folder counts and badges follow the decision
async function reloadQuestion() {
  const qid = S.qid, y = scrollY;
  const [b, tl] = await Promise.all([rpc('question_bundle', { p_qid: qid }), rpc('question_timeline', { p_qid: qid }).catch(() => null), loadQueue().catch(() => { })]);
  if (S.qid !== qid || !b || location.hash !== `#q/${qid}`) return;
  S.bundle = b; S.timeline = tl || []; delete VerCache[qid];
  renderQuestion(); scrollTo(0, y);
}

/* ---------- 4.8: question versions, before/after (migration 043 question_versions) ---------- */
const VerCache = {};
async function loadVersions(qid, fresh) {
  if (!fresh && VerCache[qid]) return VerCache[qid];
  const list = await rpc('question_versions', { p_qid: qid });
  if (!Array.isArray(list)) throw new Error('Not allowed');
  return (VerCache[qid] = list);
}
const SOLVER_LABELS = ['claude_solver', 'claude_api_solver'];
// 5.0: a Claude version after an earlier Claude solution (no return to solving in between) is a rewrite, not a new solve;
// an executed revision names the reviewer who asked for it (question_versions.requested_by, migration 044)
const verLabel = (v, list) => {
  const l = v.label || '';
  if (SOLVER_LABELS.includes(l) && list) {
    const before = list.filter(x => x.id < v.id);
    const lastReset = Math.max(0, ...before.filter(x => x.label === 'reviewer_completion').map(x => x.id));
    if (before.some(x => SOLVER_LABELS.includes(x.label) && x.id > lastReset)) return '🤖 تحديث Claude للشرح';
  }
  if (v.requested_by && (l === 'claude_revision' || l === 'claude')) return `🤖 تنفيذ Claude لطلب تعديل – بطلب ${v.requested_by}`;
  if (l === 'reviewer_completion') return /^Returned to solving/.test(v.note || '') ? '🔁 رجّعه للحل' : '🛠️ إعادة تركيب';
  return { claude_extraction: '📥 الاستخراج', claude_solver: '🤖 حل Claude', claude_api_solver: '🤖 المحلّل الآلي', claude_revision: '🤖 تنفيذ Claude لطلب تعديل', claude: '🤖 تعديل Claude', reviewer_quick_edit: '⚡ تعديل سريع', reviewer: '📝 تعديل المراجع' }[l] || l;
};
function versionsHTML(list) {
  if (!list.length) return '<p class="small muted">مفيش نسخ.</p>';
  return `<ol class="vers">${list.slice().reverse().map((v, i, arr) => `<li><div><b>النسخة ${esc(v.version_no)}</b> ${esc(verLabel(v, list))}${v.current ? ' <span class="tag ok">الحالية</span>' : ''}</div>
    <div class="small muted">${v.by ? `${esc(v.by)}، ` : ''}<time datetime="${esc(v.at)}">${esc(ago(v.at))}</time>${i < arr.length - 1 ? ` · <button class="linkbtn cmpb" type="button" data-cmp-q="${Number(S.qid)}" data-cmp-v="${Number(v.version_no)}">🔍 قارن باللي قبلها</button>` : ''}</div></li>`).join('')}</ol>`;
}
function bindVersions() {
  const d = document.getElementById('vers'); if (!d) return;
  d.addEventListener('toggle', async () => {
    if (!d.open || d.dataset.loaded) return;
    const body = document.getElementById('vers-body'), qid = S.qid;
    try { const list = await loadVersions(qid, true); if (S.qid !== qid) return; d.dataset.loaded = '1'; body.className = ''; body.innerHTML = versionsHTML(list); }
    catch (e) { console.warn('question_versions:', e); body.textContent = errText(e); }
  });
}
// one field: unchanged = one quiet line; changed = the new text with the changes marked (deleted struck, added highlighted)
function cmpField(title, before, after) {
  const a = before || '', b = after || '';
  if (a === b) return a ? `<div class="cmpf same"><span class="small muted">${esc(title)}: زي ما هو</span></div>` : '';
  return `<div class="cmpf chg"><div class="cmpt">${esc(title)} <span class="tag amber">اتغيّر</span></div><div class="pre" dir="auto">${a ? diffHTML(a, b) : `<mark class="ins">${nl(b)}</mark>`}</div></div>`;
}
const optLine = o => `${o.key}) ${o.text || ''}${o.is_correct ? '  ✓' : ''}`;
function compareHTML(prev, v) {
  const pk = (prev.options || []).map(o => o.key).join(), vk = (v.options || []).map(o => o.key).join();
  const sameSet = pk === vk && JSON.stringify((prev.options || []).map(o => o.text)) === JSON.stringify((v.options || []).map(o => o.text));
  let opts = '';
  if (!sameSet) {
    opts = cmpField('الاختيارات', (prev.options || []).map(optLine).join('\n'), (v.options || []).map(optLine).join('\n'));
  } else {
    opts = (v.options || []).map((o, i) => { const p = prev.options[i] || {};
      return cmpField(`الاختيار ${o.key}: الإجابة`, p.is_correct ? 'صح ✓' : 'غلط', o.is_correct ? 'صح ✓' : 'غلط')
        + cmpField(`الاختيار ${o.key}: الشرح`, p.explanation, o.explanation) + cmpField(`الاختيار ${o.key}: المزيد`, p.explanation_extra, o.explanation_extra); }).join('');
  }
  const body = cmpField('نص السؤال', prev.stem, v.stem) + opts + cmpField('الشرح', prev.explanation_main, v.explanation_main)
    + cmpField('مزيد من الشرح', prev.explanation_extra, v.explanation_extra)
    + cmpField('المرجع', [prev.reference, prev.reference_detail].filter(Boolean).join(' – '), [v.reference, v.reference_detail].filter(Boolean).join(' – '))
    + cmpField('ملاحظة للطلاب', prev.student_note, v.student_note);
  return body.includes('cmpf chg') ? body : '<p class="small muted">مفيش فرق في المحتوى بين النسختين.</p>' + body;
}
async function openCompare(qid, vn) {
  const { sheet } = openSheet(`<div class="sheet-head"><h2>🔍 قبل وبعد</h2></div><div id="cmp-body" class="small muted">جاري التحميل…</div>`);
  const body = sheet.querySelector('#cmp-body');
  try {
    const list = await loadVersions(qid, !VerCache[qid] || !VerCache[qid].some(x => Number(x.version_no) === vn));
    const idx = list.findIndex(x => Number(x.version_no) === vn);
    if (idx < 1) { body.textContent = 'مفيش نسخة قبل دي.'; return; }
    const v = list[idx], prev = list[idx - 1];
    body.className = '';
    body.innerHTML = `<div class="cmp-head"><b>النسخة ${esc(v.version_no)}</b> ${esc(verLabel(v, list))}${v.current ? ' <span class="tag ok">الحالية</span>' : ''}<div class="small muted">${v.by ? `${esc(v.by)}، ` : ''}${esc(ago(v.at))}، مقارنة بالنسخة ${esc(prev.version_no)} (${esc(verLabel(prev, list))})</div>${v.note ? `<div class="small" dir="auto">${nl(v.note)}</div>` : ''}</div>
      <p class="hint">المشطوب اتشال، والمتعلّم عليه اتضاف.</p>${compareHTML(prev, v)}`;
  } catch (e) { console.warn('compare:', e); body.textContent = errText(e); }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-cmp-v]'); if (!b) return;
  e.preventDefault(); openCompare(Number(b.dataset.cmpQ), Number(b.dataset.cmpV));
});

/* ---------- 3.9: extraction report (integration_backlog 25) ----------
   import_batches stays admin-only; reviewers read it through question_report / batch_report (migration 030).
   Both refuse questions that are not solved yet (same isolation as the solving chats). */
const REP_KIND = { fix: ['تصليح كتابة', ''], uncertain: ['غير مؤكد', 'amber'], note: ['ملاحظة', 'cobalt'], dup: ['مكرر', 'violet'] };
const RepCache = {};
function repLineHTML(l, self, batchId) {
  const [label, cls] = REP_KIND[l.kind] || [l.kind, ''];
  const links = (l.links || []), open = links.filter(x => x.open && x.qid !== self), closed = links.filter(x => !x.open).length;
  const other = batchId && l.batch_id !== batchId ? ` <span class="small muted" dir="auto">(من ${esc(l.batch_name || '')})</span>` : '';
  return `<li class="rl"><div class="rl-h"><span class="tag ${cls}">${esc(label)}</span> <b>${l.general ? 'على الدفعة كلها' : `سؤال ${/[A-Za-z–,-]/.test(l.q || '') ? `<bdi dir="ltr">${esc(l.q)}</bdi>` : esc(l.q)}`}</b>${other}
      ${open.map(x => `<a class="qchip" href="#q/${Number(x.qid)}" title="افتح السؤال">↗ ${esc(x.qid_display)}</a>`).join('')}${closed && !self ? `<span class="small muted">${closed === 1 ? 'وسؤال لسه ماتحلّش' : `و${closed} لسه ماتحلّوش`}</span>` : ''}</div>
      <div class="rl-t" dir="auto">${nl(l.text)}</div></li>`;
}
function reportSectionHTML(q) {
  if (!q.batch_id || q.status === 'extracted') return '';
  const c = RepCache[q.qid], isOpen = S.repOpen === q.qid;
  return `<details class="rep" id="rep" ${isOpen ? 'open' : ''}><summary>📋 تقرير الاستخراج <span class="small muted">(التصليحات والملاحظات وقت نقل السؤال)</span></summary>
    <div id="rep-body">${c ? repBodyHTML(c, q) : '<p class="small muted" style="margin:8px 0 0">جاري التحميل…</p>'}</div></details>`;
}
function repBodyHTML(c, q) {
  const lines = c.lines || [];
  return `${lines.length ? `<ol class="rlist">${lines.map(l => repLineHTML(l, q.qid, q.batch_id)).join('')}</ol>` : '<p class="small muted" style="margin:8px 0">مفيش سطور خاصة بالسؤال ده في التقرير.</p>'}
    <a class="btn block" href="#report/${Number(q.batch_id)}" id="rep-all">📑 تقرير الدفعة كامل${c.batch?.name ? ` <span class="small muted" dir="auto">(${esc(c.batch.name)})</span>` : ''}</a>`;
}
function bindReportSection(q) {
  const d = document.getElementById('rep'); if (!d) return;
  const fill = async () => {
    const box = document.getElementById('rep-body');
    try {
      if (!RepCache[q.qid] || Date.now() - RepCache[q.qid].at > 10 * 60000) RepCache[q.qid] = { ...(await rpc('question_report', { p_qid: q.qid })), at: Date.now() };
      if (box && document.getElementById('rep') === d) box.innerHTML = repBodyHTML(RepCache[q.qid], q);
    } catch (e) { if (box) box.innerHTML = `<p class="small" style="margin:8px 0 0">${esc(errText(e))}</p>`; }
  };
  d.addEventListener('toggle', () => { S.repOpen = d.open ? q.qid : null; if (d.open) fill(); });
  if (d.open && !RepCache[q.qid]) fill();
}
async function renderBatchReport(id) {
  stopSolverTimer(); closeSheets(); S.bundle = null; S.qid = null;
  $app.innerHTML = '<div class="loading">جاري تحميل تقرير الدفعة…</div>';
  const r = await rpc('batch_report', { p_batch_id: id });
  const st = r.stats || {}, lines = r.lines || [];
  const per = lines.filter(l => !l.general), gen = lines.filter(l => l.general);
  $app.innerHTML = topBar(`<button class="linkbtn" id="back">→ رجوع</button><span class="grow"></span><span class="brand">تقرير الاستخراج</span>`) + `
  <main class="wrap">
    <h1 class="rep-title" dir="auto">${esc(r.name)}</h1>
    <p class="small muted" dir="auto" style="margin:0 0 8px">${esc(r.source_ref || '')}</p>
    <div class="facts">${st.questions != null ? `<span>الأسئلة: <b>${esc(st.questions)}</b></span>` : ''}${st.incomplete ? `<span>ناقص: <b>${esc(st.incomplete)}</b></span>` : ''}${st.duplicate_year_links ? `<span>مكرر مربوط بسؤال قديم: <b>${esc(st.duplicate_year_links)}</b></span>` : ''}</div>
    <p class="small muted" style="margin-top:0">كل رقم سؤال (↗) بيفتح السؤال. أرقام السطور هي أرقام الأسئلة في ملف المصدر.</p>
    ${per.length ? `<ol class="rlist">${per.map(l => repLineHTML(l, null, null)).join('')}</ol>` : ''}
    ${r.hidden ? `<section class="panel rep-hidden"><p style="margin:0">🔒 فيه ${esc(r.hidden)} ${r.hidden === 1 ? 'سطر' : 'سطور'} لأسئلة لسه ماتحلّتش، هتظهر هنا أول ما تتحل.</p></section>` : ''}
    ${gen.length ? `<h3 class="dayh">على الدفعة كلها</h3><ol class="rlist">${gen.map(l => repLineHTML(l, null, null)).join('')}</ol>` : ''}
    ${!lines.length && !r.hidden ? '<div class="empty">التقرير فاضي.</div>' : ''}
  </main>`;
  document.getElementById('back').onclick = () => { if (history.length > 1 && S.cameFromApp) history.back(); else location.hash = ''; };
  scrollTo(0, 0);
}
window.addEventListener('hashchange', e => { S.cameFromApp = !!(e.oldURL && e.oldURL.split('#')[0] === location.href.split('#')[0]); });

/* ---------- 4.0: rebuild an unsolved question (integration_backlog 30, migration 035) ----------
   Questions that cannot be solved as they are (fewer than two options, or flagged by the isolated solver) wait in
   the folder "محتاجة إعادة تركيب" for a reviewer with access 3. The reviewer rewrites the stem and options from a
   trusted reference; the server saves a NEW version (reviewer_completion), shuffles the options and sends the
   question back to the isolated solver, which sees only the stem and the options. The draft is kept on the device
   and the account like every other form (kind 'rebuild', migration 036). */
const RB_SRC = { auto: 'تلقائي', solver: 'Claude وقت الحل', reviewer: 'مراجع', extraction: 'الاستخراج' };
const rbReason = x => x.reason === 'fewer_than_two_options' ? 'السؤال فيه أقل من اختيارين، فمايتحلّش بالشكل ده.' : (x.reason || '');
function rbItem(r) {
  const tags = (r.reasons || []).map(x => `<span class="tag amber">🛠️ ${esc(x.source === 'auto' ? 'اختيارات ناقصة' : RB_SRC[x.source] || x.source)}</span>`).join('')
    + (Drafts.get(r.qid, 'rebuild') ? '<span class="tag amber">📝 مسودة لم تُرسل</span>' : '');
  return `<li><a href="#rebuild/${r.qid}">
      <span class="qid">${esc(r.qid_display)}</span>
      <span class="qmeta"><span>${esc(r.chapter || '')}</span>${r.years ? ` <span class="small muted">(${esc(r.years)})</span>` : ''}<div class="code">${esc(r.code || '')}</div><div class="tags">${tags}</div></span>
    </a></li>`;
}
/* 4.8 (backlog 37): the same screen, mode 'resolve', sends a SOLVED question back to isolated solving (resolve_question,
   migration 043): text and options pre-filled from the current version, a reason instead of the team note, and the
   current version id travels with the save so a change made meanwhile is refused (QUESTION_CHANGED). */
const RESOLVE_STATES = ['in_review', 'needs_revision', 'revised', 'approved'];
async function renderRebuild(qid, mode = 'rebuild') {
  const RS = mode === 'resolve', DK = RS ? 'resolve' : 'rebuild';
  stopSolverTimer(); closeSheets(); S.bundle = null; S.qid = null;
  $app.innerHTML = '<div class="loading">جاري تحميل السؤال…</div>';
  if (!S.draftsLoaded) { Drafts.load(); S.draftsLoaded = true; }
  let r = null, verId = null;
  if (RS) {
    const b = await rpc('question_bundle', { p_qid: qid }).catch(e => { console.warn('resolve bundle:', e); return null; });
    const q = b && b.question, v = (b && b.current_version) || {};
    if (q && (b.my_access || 0) >= 3 && RESOLVE_STATES.includes(q.status)) {
      verId = v.id;
      r = { qid: q.qid, qid_display: q.qid_display, chapter: ((b.taxonomy || {}).chapter || []).map(x => x.name).join('، '),
            years: ((b.taxonomy || {}).year || []).map(x => x.name).join('، '), source_question_no: q.source_question_no, source_page: q.source_page,
            source: b.source, stem: v.stem, options: (v.options || []).slice().sort((x, y) => String(x.key).localeCompare(String(y.key))),
            source_answer: q.source_answer, source_answer_text: q.source_answer_text, handwritten_note: q.handwritten_note, reasons: [], student_note: v.student_note };
    }
  } else {
    S.rebuild = (await rpc('rebuild_queue')) || [];
    r = S.rebuild.find(x => x.qid === qid);
  }
  const back = () => { if (history.length > 1 && S.cameFromApp) history.back(); else location.hash = RS ? `#q/${qid}` : ''; };
  const head = topBar(`<button class="linkbtn" id="back">→ رجوع</button><span class="grow"></span><span class="brand">${RS ? 'رجّعه للحل من جديد' : 'إعادة تركيب السؤال'}</span>`);
  if (!r) {
    $app.innerHTML = head + `<main class="wrap"><div class="empty"><p>${RS ? `السؤال رقم ${esc(String(qid))} مش في حالة ينفع ترجّعه فيها للحل، أو الرجوع للحل مش ضمن صلاحيتك (صلاحية 3 والإدارة).` : `السؤال رقم ${esc(String(qid))} مش مستني إعادة تركيب: يمكن اتكمّل خلاص، أو مش ضمن صلاحيتك.`}</p></div></main>`;
    document.getElementById('back').onclick = back;
    return;
  }
  const saved = Drafts.get(qid, DK);
  const hasSrc = !!(r.source_answer_text || r.source_answer);
  const cur = r.options || [];
  const ta = (id, val, cls = 'en', rows = 2) => `<textarea class="t ${cls}" id="${id}" rows="${rows}"${cls ? '' : ' dir="auto"'}>${esc(val || '')}</textarea>`;
  $app.innerHTML = head + `
  <main class="wrap rb">
    <h1 class="rep-title">السؤال ${esc(r.qid_display)}</h1>
    <div class="facts">${r.chapter ? `<span>الشابتر: <b>${esc(r.chapter)}</b></span>` : ''}${r.years ? `<span>السنة: <b>${esc(r.years)}</b></span>` : ''}${r.source_question_no ? `<span>رقمه في المصدر: <b>${esc(r.source_question_no)}</b>${r.source_page ? ` (صفحة ${esc(r.source_page)})` : ''}</span>` : ''}</div>
    ${r.source?.pdf_page ? '<p><button class="btn sec" type="button" id="rb-page">📄 افتح صفحة المصدر</button></p>' : ''}
    ${RS ? `<section class="panel warn"><h3>إيه اللي هيحصل</h3><ul class="rb-why"><li>السؤال هيختفي عن الطلاب، ويرجع "ينتظر الحل"، ومحادثة الحل المعزول هتحله من الأول بالنص والاختيارات الجديدة.</li><li>بعد الحل هيوصل للمراجعة، ومش هيظهر للطلاب غير بعد اعتماد استشاري.</li><li>الاعتمادات وطلبات التعديل المفتوحة القديمة هتتلغي، وتفضل في "تاريخ السؤال"، وكل النسخ القديمة بتفضل محفوظة.</li><li>للتعديل الصغير (كلمة أو توضيح) استخدم طلب التعديل أو التعديل السريع.</li></ul></section>${r.student_note ? `<section class="panel"><h3>ملاحظة الطلاب الحالية</h3><div class="pre" dir="auto">${nl(r.student_note)}</div><p class="hint">مش هتتنقل لوحدها للنسخة الجديدة، لأن النص هيتغير. لو لسه مناسبة، ضيفها تاني بزرار "📝 ملاحظة للطلاب" وإنت بتعتمد بعد الحل.</p></section>` : ''}`
      : `<section class="panel"><h3>ليه السؤال هنا</h3><ul class="rb-why">${(r.reasons || []).map(x => `<li><b>${esc(RB_SRC[x.source] || x.source)}:</b> <span dir="auto">${esc(rbReason(x))}</span></li>`).join('')}</ul></section>`}
    <section class="panel"><h3>رد المصدر</h3>
      ${hasSrc ? `${r.source_answer_text ? `<p class="rb-src" dir="auto">${nl(r.source_answer_text)}</p>` : ''}${r.source_answer ? `<p class="small muted">الحرف المتسجل في المصدر: <b>${esc(r.source_answer)}</b>، والحروف هتتغير مع الترتيب الجديد.</p>` : ''}`
        : '<p class="small muted" style="margin:0">المصدر مالوش رد متسجل للسؤال ده.</p>'}
      ${r.handwritten_note ? `<details class="rb-note"><summary>الملاحظة المنقولة من المصدر</summary><div class="pre" dir="auto">${nl(r.handwritten_note)}</div></details>` : ''}
    </section>
    ${saved ? `<div class="draft-note">رجّعتلك مسودتك (آخر حفظ: ${esc(draftAge(saved))}).</div>` : ''}
    <p class="hint">اكتب نص السؤال واختياراته من مرجع موثوق. الاختيارات بتترتب عشوائي بعد الحفظ، فاكتبها بأي ترتيب. خلّيها بطول وأسلوب متقارب، عشان مايبقاش فيه اختيار باين إنه الإجابة. Claude وقت الحل بيشوف النص والاختيارات بس. في كل خانة زرار 🎙️ تكتب بيه بصوتك.</p>
    <label class="f" for="rb-stem">نص السؤال</label>${ta('rb-stem', r.stem, 'en', 4)}
    ${[0, 1, 2, 3, 4].map(i => `<label class="f" for="rb-o${i}">الاختيار ${i + 1}${i < 2 ? '' : ' (اختياري)'}</label>${ta(`rb-o${i}`, cur[i]?.text)}`).join('')}
    ${hasSrc ? `<div class="f" id="rb-m-l">رد المصدر بيقابل أنهي اختيار؟</div>
      <div class="letters" id="rb-match" role="group" aria-labelledby="rb-m-l">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-m="${n}" aria-pressed="false">${n}</button>`).join('')}<button type="button" data-m="0" aria-pressed="false">ولا واحد</button></div>
      <p class="hint">لو اخترت رقم، المقارنة بعد الحل بتحصل لوحدها. \"ولا واحد\" معناه إنك شايف رد المصدر مش ضمن الاختيارات، والمقارنة هتبقى عليك.</p>` : ''}
    <label class="f" for="rb-ref">المرجع اللي الاختيارات جاية منه (مطلوب)</label><input class="t" id="rb-ref" dir="auto" placeholder="مثال: Kanski 9th ed., p. 350">
    ${RS ? `<label class="f" for="rb-reason">السبب (مطلوب، كلمتين على الأقل)</label>${ta('rb-reason', '', '', 2)}
    <p class="hint">المرجع والسبب بيظهروا في تاريخ السؤال ونشاط الفريق للفريق بس، ومابيوصلوش لـ Claude وقت الحل.</p>`
      : `<label class="f" for="rb-note">ملاحظة للفريق (اختياري)</label>${ta('rb-note', '', '', 2)}
    <p class="hint">المرجع والملاحظة بيظهروا في تاريخ السؤال للفريق بس، ومابيوصلوش لـ Claude وقت الحل.</p>`}
    <div class="saved-line" id="rb-saved" aria-live="polite">${saved ? `✓ محفوظ (${esc(draftAge(saved))})` : 'مسودتك بتتحفظ تلقائيًا على جهازك وعلى حسابك.'}</div>
    <div class="err" id="rb-err" role="alert"></div>
    <div class="rb-foot"><button class="btn ok" id="rb-save" type="button">✓ ${RS ? 'رجّعه للحل من جديد' : 'حفظ وإرجاعه للحل'}</button><button class="btn warn" id="rb-clear" type="button">✕ مسح المسودة</button></div>
  </main>`;
  const $ = sel => $app.querySelector(sel);
  document.getElementById('back').onclick = back;
  const pg = $('#rb-page'); if (pg) pg.onclick = () => openPageViewer(r.source, Number(r.source.pdf_page));
  const fields = [...$app.querySelectorAll('main textarea, main input')];
  const initial = Object.fromEntries(fields.map(x => [x.id, x.value]));
  let match = null;   // 1–5 = the option box the source answer matches, 0 = none of them
  if (saved?.payload?.fields) for (const [id, val] of Object.entries(saved.payload.fields)) { const el = $('#' + id); if (el) el.value = val; }
  if (hasSrc && saved?.payload && Number.isInteger(saved.payload.match)) match = saved.payload.match;
  const mBox = $('#rb-match');
  const paintMatch = () => {
    if (!mBox) return;
    mBox.querySelectorAll('[data-m]').forEach(b => {
      const n = Number(b.dataset.m), empty = n > 0 && !$('#rb-o' + (n - 1)).value.trim();
      if (empty && match === n) match = null;
      b.disabled = empty; b.setAttribute('aria-pressed', String(match === n));
    });
  };
  paintMatch();
  const unlisten = savedLine($('#rb-saved'));
  window.addEventListener('hashchange', unlisten, { once: true });
  const dirty = () => fields.some(x => x.value !== initial[x.id]) || match !== null;
  const persist = () => {
    if (!dirty()) { if (Drafts.get(qid, DK)) Drafts.clear(qid, DK); return; }
    Drafts.save(qid, DK, { fields: Object.fromEntries(fields.filter(x => x.value !== initial[x.id]).map(x => [x.id, x.value])), match });
  };
  fields.forEach(x => x.addEventListener('input', () => { paintMatch(); persist(); }));
  if (mBox) mBox.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { match = Number(b.dataset.m); paintMatch(); persist(); });
  fields.forEach(x => attachMic(x, x.id === 'rb-note' || x.id === 'rb-reason' ? 'ar-EG' : 'en-US'));
  $('#rb-clear').onclick = async () => {
    if (!Drafts.get(qid, DK) && !dirty()) { toast('مفيش مسودة تتمسح.'); return; }
    if (!confirm(RS ? 'مسح اللي كتبته هنا؟ السؤال هيفضل زي ما هو.' : 'مسح اللي كتبته هنا؟ السؤال هيفضل في الفولدر زي ما هو.')) return;
    await Drafts.clear(qid, DK);
    notify('اتمسحت المسودة', RS ? 'السؤال زي ما هو.' : 'السؤال لسه مستني إعادة تركيب.', 'info');
    renderRebuild(qid, mode);
  };
  $('#rb-save').onclick = async () => {
    const err = $('#rb-err'), val = id => $('#' + id).value.trim();
    err.textContent = '';
    const stem = val('rb-stem');
    const filled = [0, 1, 2, 3, 4].map(i => ({ box: i + 1, text: val('rb-o' + i) })).filter(o => o.text);
    if (stem.length < 10) { err.textContent = 'اكتب نص السؤال كامل.'; $('#rb-stem').focus(); return; }
    if (filled.length < 2) { err.textContent = 'اكتب اختيارين على الأقل.'; $('#rb-o0').focus(); return; }
    const low = filled.map(o => o.text.toLowerCase());
    if (new Set(low).size !== low.length) { err.textContent = 'فيه اختيارين بنفس النص.'; return; }
    if (hasSrc && match === null) { err.textContent = 'اختار رد المصدر بيقابل أنهي اختيار، أو "ولا واحد".'; mBox.scrollIntoView({ block: 'center' }); return; }
    const ref = val('rb-ref');
    if (ref.length < 3) { err.textContent = 'اكتب المرجع اللي الاختيارات جاية منه.'; $('#rb-ref').focus(); return; }
    const idx = match ? filled.findIndex(o => o.box === match) + 1 : 0;
    const reason = RS ? val('rb-reason') : '';
    if (RS && reason.split(/\s+/).filter(Boolean).length < 2) { err.textContent = 'اكتب السبب في كلمتين على الأقل.'; $('#rb-reason').focus(); return; }
    if (!confirm(RS ? `ترجّع السؤال ${r.qid_display} للحل من جديد؟\nهيختفي عن الطلاب، والاعتمادات والطلبات المفتوحة القديمة هتتلغي، والاختيارات هتترتب عشوائي.` : `حفظ السؤال ${r.qid_display} وإرجاعه للحل؟\nهيتحفظ كنسخة جديدة، والاختيارات هتترتب عشوائي.`)) return;
    const btn = $('#rb-save'); btn.disabled = true;
    try {
      if (RS) await rpc('resolve_question', { p_qid: qid, p_expected_version_id: verId, p_stem: stem, p_options: filled.map(o => o.text), p_source_match: idx || null, p_reference: ref, p_reason: reason });
      else await rpc('rebuild_question', { p_qid: qid, p_stem: stem, p_options: filled.map(o => o.text), p_source_match: idx || null, p_reference: ref, p_note: val('rb-note') || null });
      await Drafts.clear(qid, DK);
      S.dirty = true;
      notify(RS ? `السؤال ${r.qid_display} رجع للحل من جديد بفضل الله` : `تم حفظ السؤال ${r.qid_display} بفضل الله`, RS ? 'اختفى عن الطلاب، وهيتحل من الأول. بعد الحل هيوصلك في "تنتظرك"، ويفضل مخفي لحد الاعتماد.' : 'رجع للحل المعزول. بعد ما يتحل هيوصلك في "تنتظرك"، ويفضل مخفي عن الطلاب لحد اعتمادك.');
      location.hash = '';
    } catch (e) { btn.disabled = false; err.textContent = errText(e) + ' — مسودتك محفوظة، جرّب تاني.'; }
  };
  scrollTo(0, 0);
}

/* ---------- 3.9: source page viewer (integration_backlog 23) ----------
   Each PDF page is an image in the private bucket "source-pages" (table source_files says where, and the page offset:
   PDF page = printed page + offset). Opened with a 1-hour signed link, so phones need no PDF viewer.
   Pinch or double-tap to zoom, drag to move, buttons for the neighbouring pages (a question may continue there). */
const PageUrls = {};
async function pageUrl(src, n) {
  const path = `${src.prefix}/p${String(n).padStart(3, '0')}.${src.ext || 'webp'}`;
  const hit = PageUrls[path]; if (hit && Date.now() - hit.at < 50 * 60000) return hit.url;
  const { data, error } = await sb.storage.from(src.bucket || 'source-pages').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw error || new Error('no url');
  PageUrls[path] = { url: data.signedUrl, at: Date.now() };
  return data.signedUrl;
}
function openPageViewer(src, start) {
  if (!src || !start) return;
  closeSheets();
  const total = Math.max(src.page_count || start, start), off = src.page_offset || 0;
  let page = start, zoom = 1, seq = 0, closed = false;
  const sc = document.createElement('div'); sc.className = 'scrim pv';
  sc.innerHTML = `<div class="pv-box" role="dialog" aria-modal="true" aria-label="صفحة المصدر">
    <div class="pv-bar">
      <button class="pv-b" type="button" data-pv="close" aria-label="إغلاق">✕</button>
      <div class="pv-title"><b id="pv-t"></b><span id="pv-s"></span></div>
      <button class="pv-b" type="button" data-pv="out" aria-label="تصغير">−</button><button class="pv-b" type="button" data-pv="in" aria-label="تكبير">+</button>
    </div>
    <div class="pv-stage" id="pv-stage" dir="ltr"><img id="pv-img" alt="صفحة من ملف المصدر" draggable="false"><div class="pv-msg" id="pv-msg" role="status"></div></div>
    <div class="pv-nav"><button class="pv-b wide" type="button" data-pv="prev"><span dir="ltr">→</span> الصفحة اللي قبل</button><span class="pv-hint">كبّر بصباعين أو اضغط مرتين</span><button class="pv-b wide" type="button" data-pv="next">الصفحة اللي بعد <span dir="ltr">←</span></button></div>
  </div>`;
  document.body.appendChild(sc);
  const $ = sel => sc.querySelector(sel);
  const stage = $('#pv-stage'), img = $('#pv-img'), msg = $('#pv-msg');
  const setZoom = (z, px, py) => {                      // keep the point under the fingers where it is
    z = Math.min(5, Math.max(1, z)); if (Math.abs(z - zoom) < 0.001) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    px = px ?? w / 2; py = py ?? h / 2;
    const fx = stage.scrollLeft + px, fy = stage.scrollTop + py, k = z / zoom;
    zoom = z; img.style.width = `${z * 100}%`;
    stage.scrollLeft = fx * k - px; stage.scrollTop = fy * k - py;
    stage.classList.toggle('zoomed', z > 1.01);
  };
  const load = async n => {
    page = Math.min(Math.max(1, n), total); zoom = 1; img.style.width = '100%'; stage.classList.remove('zoomed');
    const printed = page - off;
    $('#pv-t').textContent = (printed >= 1 ? `صفحة ${printed}` : 'الغلاف') + (page === start ? ' · صفحة السؤال' : '');
    $('#pv-s').textContent = `رقم ${page} من ${total} في الملف`;
    $('[data-pv="prev"]').disabled = page <= 1; $('[data-pv="next"]').disabled = page >= total;
    img.classList.add('pv-wait'); msg.textContent = 'جاري تحميل الصفحة…'; msg.hidden = false;
    const my = ++seq;
    try { const u = await pageUrl(src, page); if (my === seq && !closed) img.src = u; }
    catch { if (my === seq) msg.textContent = 'صورة الصفحة دي مش متاحة لسه (ممكن تكون لسه ماترفعتش). جرّب تاني بعدين.'; }
  };
  img.onload = () => {
    msg.hidden = true; img.classList.remove('pv-wait'); stage.scrollTop = 0; stage.scrollLeft = 0;
    const c = navigator.connection;
    if (!(c && (c.saveData || /2g/.test(c.effectiveType || ''))) && page < total) pageUrl(src, page + 1).then(u => { const i = new Image(); i.src = u; }).catch(() => { });
  };
  img.onerror = () => { if (img.getAttribute('src')) { msg.textContent = 'تعذّر تحميل الصورة. تأكد من الاتصال وحاول تاني.'; msg.hidden = false; } };
  // two fingers: zoom around their middle; double tap: zoom in there / back to the whole width
  let pinch = null, raf = 0, last = null, tap = null;
  const mid = (a, b) => { const r = stage.getBoundingClientRect(); return [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top]; };
  stage.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: zoom }; tap = null; e.preventDefault(); }
    else if (e.touches.length === 1) tap = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: false });
  stage.addEventListener('touchmove', e => {
    if (tap && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 10) tap = null;
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches, [px, py] = mid(a, b);
    last = [pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d, px, py];
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) setZoom(...last); });
  }, { passive: false });
  let lastTap = null;
  stage.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinch = null;
    if (!tap || e.touches.length) return;
    const now = Date.now(); if (now - tap.t > 300) { tap = null; return; }
    if (lastTap && now - lastTap.t < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40) {
      const r = stage.getBoundingClientRect(); setZoom(zoom > 1.2 ? 1 : 2.5, tap.x - r.left, tap.y - r.top); lastTap = null; e.preventDefault();
    } else lastTap = { ...tap, t: now };
    tap = null;
  }, { passive: false });
  stage.addEventListener('dblclick', e => { const r = stage.getBoundingClientRect(); setZoom(zoom > 1.2 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top); });
  stage.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const r = stage.getBoundingClientRect(); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  // mouse: drag to move when zoomed in
  let drag = null;
  stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || zoom <= 1.01) return; drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drag) return; stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); });
  const endDrag = () => { drag = null; }; stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  sc.addEventListener('gesturestart', e => e.preventDefault());   // iOS: no page zoom behind the viewer
  const close = () => {
    if (closed) return true; closed = true; seq++; sheetClose = null;
    document.removeEventListener('keydown', onKey); sc.remove();
    return true;
  };
  const onKey = e => {
    if (e.key === 'Escape') history.state?.pv ? history.back() : close();
    else if (e.key === 'ArrowLeft') load(page + 1); else if (e.key === 'ArrowRight') load(page - 1);
    else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25); else if (e.key === '-') setZoom(zoom / 1.25);
  };
  document.addEventListener('keydown', onKey);
  sc.querySelectorAll('[data-pv]').forEach(bt => bt.onclick = () => {
    const k = bt.dataset.pv;
    if (k === 'close') { history.state?.pv ? history.back() : close(); }
    else if (k === 'prev') load(page - 1); else if (k === 'next') load(page + 1);
    else if (k === 'in') setZoom(zoom * 1.4); else if (k === 'out') setZoom(zoom / 1.4);
  });
  // the phone's back button closes the viewer (same mechanism as the sheets)
  sheetClose = close; history.pushState({ sheet: true, pv: true }, '');
  $('[data-pv="close"]').focus();
  load(start);
}

/* ---------- team activity + question timeline ---------- */
const FEED_KEY = () => `feedSeen:${S.session?.user?.id}`;
function ago(t) {
  const d = new Date(t), s = (Date.now() - d.getTime()) / 1000;
  const hm = d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  if (s < 60) return 'دلوقتي';
  if (s < 3600) { const m = Math.max(1, Math.round(s / 60)); return m === 1 ? 'من دقيقة' : m === 2 ? 'من دقيقتين' : m <= 10 ? `من ${m} دقايق` : `من ${m} دقيقة`; }
  if (s < 86400 && d.getDate() === new Date().getDate()) { const h = Math.round(s / 3600); return h === 1 ? 'من ساعة' : h === 2 ? 'من ساعتين' : h <= 10 ? `من ${h} ساعات` : `النهارده ${hm}`; }
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `امبارح ${hm}`;
  return `${d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })} ${hm}`;
}
function dayLabel(t) {
  const d = new Date(t), y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return 'النهارده';
  if (d.toDateString() === y.toDateString()) return 'امبارح';
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}
const REQ_STATUS = { open: ['مفتوح', 'amber'], done: ['اتنفّذ', 'ok'], rejected: ['اترفض تنفيذه', 'warn'], cancelled: ['اتلغى', ''], closed: ['', ''] };
// one event -> icon, who, what, extra lines
function describe(ev, forList) {
  const d = ev.detail || {}, who = ev.mine ? 'إنت' : (ev.actor || 'مراجع');
  const clip = (x, n = 160) => x && x.length > n ? x.slice(0, n) + '…' : (x || '');
  const out = { icon: '•', who, what: '', lines: [], badge: null, voice: null, cls: '' };
  switch (ev.kind) {
    case 'approved': Object.assign(out, { icon: '✅', what: 'اعتماد السؤال', cls: 'ok' });
      if (d.student_note) out.lines.push(['ملاحظة للطلاب', d.student_note]);
      if (d.status === 'cancelled') out.badge = ['اتلغى الاعتماد بعدين', ''];
      break;
    case 'requested': Object.assign(out, { icon: '✏️', what: `طلب تعديل${d.type_label ? `: ${d.type_label}` : ''}`, cls: 'cobalt' });
      if (d.comment) out.lines.push(['المطلوب', forList ? clip(d.comment) : d.comment]);
      if (d.transcript) out.lines.push(['نص الفويس', forList ? clip(d.transcript) : d.transcript]);
      if (d.student_note) out.lines.push(['ملاحظة للطلاب', d.student_note]);
      if (d.voice) out.voice = d.voice;
      if (REQ_STATUS[d.status]?.[0]) out.badge = REQ_STATUS[d.status];
      if (d.resolution && d.status === 'done' && !forList) out.lines.push(['رد Claude', d.resolution]);
      break;
    case 'commented': Object.assign(out, { icon: '💬', what: 'تعليق' }); if (d.comment) out.lines.push(['', d.comment]); break;
    case 'quick_edit': Object.assign(out, { icon: '⚡', what: 'تعديل سريع', cls: 'cobalt' }); if (d.note) out.lines.push(['السبب', d.note]); break;
    case 'rebuilt': Object.assign(out, { icon: '🛠️', what: 'إعادة تركيب النص والاختيارات', cls: 'cobalt' }); if (d.note) out.lines.push(['', d.note]); break;
    case 'returned_to_solving': {   // 4.8 (backlog 37): version note = "Returned to solving by reviewer – reason: …\noptions from: …"
      Object.assign(out, { icon: '🔁', what: 'رجّعه للحل من جديد', cls: 'warn' });
      const mm = String(d.note || '').match(/reason:\s*([\s\S]*?)(?:\noptions from:\s*([\s\S]*))?$/);
      if (mm && mm[1]) out.lines.push(['السبب', mm[1].trim()]);
      if (mm && mm[2]) out.lines.push(['المرجع', mm[2].trim()]);
      break; }
    case 'rebuild_requested': Object.assign(out, { icon: '🛠️', who: d.by || who, what: 'طلب إعادة تركيب السؤال' }); if (d.reason) out.lines.push(['السبب', d.reason]); break;
    case 'note_added': Object.assign(out, { icon: '📝', what: 'ملاحظة للطلاب مع الاعتماد' }); if (d.student_note) out.lines.push(['', d.student_note]); break;
    case 'claude_revised': Object.assign(out, { icon: '🤖', who: 'Claude', what: `نفّذ طلب ${d.request?.by || 'المراجع'}${d.request?.type_label ? ` (${d.request.type_label})` : ''}`, cls: 'cobalt' });
      if (d.request?.resolution) out.lines.push(['اللي اتعمل', forList ? clip(d.request.resolution) : d.request.resolution]); break;
    case 'request_cancelled': Object.assign(out, { icon: '↩️', what: 'إلغاء طلب التعديل', cls: 'warn' }); break;
    case 'approval_undone': Object.assign(out, { icon: '↩️', what: `تراجع عن الاعتماد${d.approved_by && d.approved_by !== ev.actor ? ` (كان اعتماد ${d.approved_by})` : ''}`, cls: 'warn' }); break;
    case 'quick_edit_undone': Object.assign(out, { icon: '↩️', what: `إلغاء تعديل سريع${d.edited_by && d.edited_by !== ev.actor ? ` لـ ${d.edited_by}` : ''}`, cls: 'warn' }); if (d.reason) out.lines.push(['سبب التعديل الملغي', d.reason]); break;
    case 'claude_revision_rejected': Object.assign(out, { icon: '↩️', what: 'رفض تعديل Claude والرجوع للنسخة السابقة', cls: 'warn' }); break;
    case 'returned_to_original': Object.assign(out, { icon: '⟲', what: 'رجوع السؤال لنسخته الأصلية', cls: 'warn' }); break;
    case 'extracted': Object.assign(out, { icon: '📄', who: 'البداية', what: 'اتنقل السؤال من ملف المصدر' }); break;
    case 'solved': Object.assign(out, { icon: '🤖', who: 'Claude', what: 'حل السؤال وكتب الشرح' }); break;
    case 'updated': Object.assign(out, { icon: '🛠️', who: 'Claude', what: 'تحديث للنص' }); break;
    case 'dup_linked': case 'dup_distinct': {   // 4.1 (migration 037): one event on each question of the pair
      const linked = ev.kind === 'dup_linked';
      Object.assign(out, { icon: '🔁', what: `قرار التكرار: ${linked ? 'مكرر' : 'مش مكرر'} مع سؤال ${d.other_display || ''}`, cls: linked ? 'cobalt' : '' });
      if (!forList && pct(d.score)) out.lines.push(['نسبة التشابه', pct(d.score)]);
      break;
    }
    case 'dup_undone': Object.assign(out, { icon: '↩️', what: `تراجع عن قرار التكرار مع سؤال ${d.other_display || ''}`, cls: 'warn' });
      if (d.was) out.badge = [`كان: ${d.was === 'linked' ? 'مكرر' : 'مش مكرر'}`, ''];
      break;
    default: out.what = ev.kind;
  }
  return out;
}
function lastLine(r) {
  if (!r.last_kind) return '';
  const e = describe({ kind: r.last_kind, actor: r.last_actor, mine: r.last_mine, detail: r.last_detail || {} }, true);
  return `<div class="last ${e.cls}"><span aria-hidden="true">${e.icon}</span> <b>${esc(e.who)}</b>: ${esc(e.what)} <span class="muted">${esc(ago(r.last_at))}</span></div>`;
}
function evCard(ev, withQ) {
  const e = describe(ev, withQ);
  const lines = e.lines.map(([k, v]) => `<div class="evl">${k ? `<span class="evk">${esc(k)}:</span> ` : ''}<span dir="auto">${nl(v)}</span></div>`).join('');
  return `<li class="ev ${e.cls}">
    <span class="evi" aria-hidden="true">${e.icon}</span>
    <div class="evb">
      <div class="evh"><b>${esc(e.who)}</b> <span>${esc(e.what)}</span>${e.badge && e.badge[0] ? ` <span class="tag ${e.badge[1]}">${esc(e.badge[0])}</span>` : ''}</div>
      ${lines}
      ${e.voice ? `<audio class="audio" controls preload="none" data-voice="${esc(e.voice)}"></audio>` : ''}
      <div class="evt">${withQ ? `<a href="#q/${ev.qid}" class="evq">سؤال ${esc(ev.qid_display)}</a> · ` : ''}<time datetime="${esc(ev.at)}">${esc(ago(ev.at))}</time>${cmpBtn(ev, withQ)}</div>
    </div></li>`;
}
// 4.8: versions (migration 043) – "🔍 قبل وبعد" on history events that created a version, and "🗂️ نسخ السؤال" on the question page
const cmpBtn = (ev, withQ) => {
  const vn = Number((ev.detail || {}).version_no), qid = withQ ? Number(ev.qid) : Number(S.qid);
  return vn > 1 && qid && ev.kind !== 'extracted' ? ` · <button class="linkbtn cmpb" type="button" data-cmp-q="${qid}" data-cmp-v="${vn}">🔍 قبل وبعد</button>` : '';
};
function timelineHTML(tl, open) {
  if (!tl || !tl.length) return '';
  return `<details class="tl" ${open ? 'open' : ''}><summary>🕘 تاريخ السؤال (${tl.length === 1 ? 'خطوة واحدة' : tl.length === 2 ? 'خطوتين' : tl.length <= 10 ? `${tl.length} خطوات` : `${tl.length} خطوة`})</summary>
    <ol class="evs timeline">${tl.slice().reverse().map(ev => evCard(ev, false)).join('')}</ol></details>`;
}

async function renderActivity(more) {
  stopSolverTimer(); closeSheets(); S.bundle = null; S.qid = null;
  if (!more) { $app.innerHTML = '<div class="loading">جاري تحميل نشاط الفريق…</div>'; S.feed = []; S.feedEnd = false; }
  const before = more && S.feed.length ? S.feed[S.feed.length - 1].at : null;
  const rows = await rpc('team_activity', { p_limit: 150, p_before: before });
  S.feed = more ? S.feed.concat(rows || []) : (rows || []);
  if (!rows || rows.length < 150) S.feedEnd = true;
  const lastSeen = localStorage.getItem(FEED_KEY()) || new Date(Date.now() - 7 * 864e5).toISOString();
  try { localStorage.setItem(FEED_KEY(), new Date().toISOString()); } catch { }
  S.newCount = 0;
  drawActivity(lastSeen);
}
function drawActivity(lastSeen) {
  const F = S.feedFilter || (S.feedFilter = { who: 'all', kind: 'all' });
  const people = [...new Set(S.feed.filter(e => !e.mine && e.actor && !['claude_revised'].includes(e.kind)).map(e => e.actor))];
  const KINDS = { all: 'كل الأحداث', approved: 'الاعتماد', requested: 'طلبات التعديل', quick_edit: 'التعديل السريع', claude: 'تنفيذ Claude', dup: 'المكرر', back: 'الرجوع والإلغاء' };
  const kindOk = e => F.kind === 'all' || (F.kind === 'claude' ? e.kind === 'claude_revised' : F.kind === 'dup' ? e.kind.startsWith('dup_') : F.kind === 'back' ? /undone|cancelled|rejected|original|solving/.test(e.kind) : e.kind === F.kind);
  const whoOk = e => F.who === 'all' || (F.who === 'others' ? !e.mine : F.who === 'me' ? e.mine : e.actor === F.who && !e.mine);
  const list = S.feed.filter(e => kindOk(e) && whoOk(e));
  let html = '', day = '';
  for (const e of list) {
    const dl = dayLabel(e.at);
    if (dl !== day) { if (day) html += '</ol>'; html += `<h3 class="dayh">${esc(dl)}</h3><ol class="evs">`; day = dl; }
    html += evCard(e, true).replace('<li class="ev', `<li class="ev${lastSeen && !e.mine && e.at > lastSeen ? ' fresh' : ''}`);
  }
  if (day) html += '</ol>';
  $app.innerHTML = topBar(`<button class="linkbtn" id="back">→ القائمة</button><span class="grow"></span><span class="brand">نشاط الفريق</span>`) + `
  <main class="wrap">
    <p class="small muted" style="margin-top:0">كل اللي اتعمل على الأسئلة اللي ليك صلاحية عليها، الأحدث فوق. اضغط رقم السؤال عشان تفتحه.</p>
    <div class="chips" aria-label="مين">${[['all', 'الكل'], ['others', 'غيري'], ['me', 'أنا'], ...people.map(p => [p, p])].map(([k, l]) => `<button class="chip" data-who="${esc(k)}" aria-pressed="${F.who === k}">${esc(l)}</button>`).join('')}</div>
    <div class="chips" aria-label="نوع الحدث">${Object.entries(KINDS).map(([k, l]) => `<button class="chip" data-kind="${k}" aria-pressed="${F.kind === k}">${l}</button>`).join('')}</div>
    ${list.length ? html : `<div class="empty">مفيش نشاط${F.who !== 'all' || F.kind !== 'all' ? ' بالتصفية دي' : ' لسه'}.</div>`}
    ${S.feedEnd ? '' : `<p><button class="btn block" id="more">عرض أقدم</button></p>`}
  </main>`;
  document.getElementById('back').onclick = () => { location.hash = ''; };
  $app.querySelectorAll('[data-who]').forEach(b => b.onclick = () => { F.who = b.dataset.who; drawActivity(lastSeen); });
  $app.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { F.kind = b.dataset.kind; drawActivity(lastSeen); });
  const m = document.getElementById('more'); if (m) m.onclick = () => renderActivity(true);
  $app.querySelectorAll('audio[data-voice]').forEach(a => a.addEventListener('play', async () => { if (!a.src) { const u = await signed('voice-notes', a.dataset.voice); if (u) { a.src = u; a.play(); } } }, { once: true }));
}

/* ---------- question ---------- */
async function openQuestion(qid) {
  stopSolverTimer(); closeSheets();
  if (!S.rows.length && !S.notices.length) await loadQueue();
  if (!S.bundle || S.qid !== qid) $app.innerHTML = '<div class="loading">جاري تحميل السؤال…</div>';
  const pre = S.prefetch && S.prefetch[qid];
  const [b, tl] = pre && Date.now() - pre.at < 60000 ? [pre.b, pre.tl] : await Promise.all([rpc('question_bundle', { p_qid: qid }), rpc('question_timeline', { p_qid: qid }).catch(() => null)]);
  if (S.prefetch) delete S.prefetch[qid];
  if (!b) throw new Error('هذا السؤال غير متاح لك.');
  S.timeline = tl || [];
  S.bundle = b; S.qid = qid; S.showExtra = false;
  const nd = Drafts.get(qid, 'approve_note'); S.noteDraft = nd?.payload?.note || ''; S.noteOpen = !!nd;
  renderQuestion(); scrollTo(0, 0);
  prefetchNext();
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
// quietly load the next question while the current one is being read (skipped in data-saver mode)
function prefetchNext() {
  const c = navigator.connection; if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
  const next = navInfo().next; if (!next || (S.prefetch && S.prefetch[next.qid])) return;
  const run = async () => {
    try {
      const [b, tl] = await Promise.all([rpc('question_bundle', { p_qid: next.qid }), rpc('question_timeline', { p_qid: next.qid }).catch(() => null)]);
      if (b) { S.prefetch = S.prefetch || {}; S.prefetch[next.qid] = { b, tl, at: Date.now() }; }
    } catch { }
  };
  (window.requestIdleCallback || (f => setTimeout(f, 900)))(run);
}
function navInfo() {
  // navigate inside the current folder; if the question is not in it (opened by number or link), use its own folder
  let folder = S.view.folder, list = listFor(), i = list.findIndex(r => r.qid === S.qid);
  const row = S.rows.find(r => r.qid === S.qid);
  // 4.1: a duplicate decision can take the question out of the open folder ("محتمل مكرر"): keep that folder and its order
  const hold = S.navHold;
  if (i < 0 && hold && hold.qid === S.qid && hold.folder === folder) {
    const at = hold.list.indexOf(S.qid), pick = ids => { for (const id of ids) { const r = list.find(x => x.qid === id); if (r) return r; } return null; };
    return { list, i, folder, prev: pick(hold.list.slice(0, at).reverse()), next: pick(hold.list.slice(at + 1)) };
  }
  if (i < 0 && row) {
    const f = FOLDERS.slice(1).find(x => x.id !== 'all' && x.test(row)) || FOLDERS.find(x => x.id === 'all');
    folder = f.id; list = listFor({ ...S.view, folder, ...NO_FILTERS }); i = list.findIndex(r => r.qid === S.qid);
  }
  return { list, i, folder, prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}
function go(r) {
  if (!r) return;
  const nav = navInfo();
  if (nav.folder !== S.view.folder) { S.view = { ...S.view, folder: nav.folder, ...NO_FILTERS }; saveView(); }
  location.hash = `#q/${r.qid}`;
}

// 4.8.1: the fixed action bar can be 1–3 rows tall; the page keeps that much room under its last line (was a fixed 140px)
function fitActions() {
  const a = $app.querySelector('.actions'), m = document.getElementById('qmain');
  if (!a || !m) return;
  m.style.paddingBottom = Math.max(140, Math.ceil(a.getBoundingClientRect().height) + 24) + 'px';
}
window.addEventListener('resize', () => fitActions());
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
    q.source_question_no ? `<span>رقمه في المصدر: <b>${esc(q.source_question_no)}</b>${q.source_page ? ` (صفحة ${esc(q.source_page)})` : ''}${b.source?.pdf_page ? ` <button class="linkbtn pglink" type="button" data-page="${Number(b.source.pdf_page)}">📄 افتح الصفحة</button>` : ''}</span>` : '',
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
  const split = splitAlert(q.handwritten_note);   // 3.9: the "⚠️ للمراجع" block gets its own card; the note is shown without it
  const hand = split.main.trim() || q.handwritten_image_path ? `
    <section class="panel hand"><h3>${HAND_LABEL}</h3>${split.main.trim() ? `<div class="pre" dir="auto">${esc(split.main)}</div>` : ''}
      ${q.handwritten_image_path ? `<img id="handimg" alt="صورة الملاحظة الأصلية" style="max-width:100%;margin-top:10px;border-radius:8px">` : ''}</section>` : '';
  const studentNote = v.student_note ? `<section class="panel"><h3>ملاحظة للطلاب (تظهر في التطبيق)</h3><div class="pre" dir="auto">${T(v.student_note, base?.student_note)}</div></section>` : '';
  const hist = timelineHTML(S.timeline, q.status === 'approved') + `<details class="tl" id="vers"><summary>🗂️ نسخ السؤال</summary><div id="vers-body" class="small muted">جاري التحميل…</div></details>`;
  // action bar by state
  let bar = '';
  const qe = access >= 3 ? `<button class="btn sec" id="qe">⚡ ${dQe ? 'أكمل التعديل السريع' : 'تعديل سريع'}</button>` : '';
  const un = b.undo && (b.undo.previous || b.undo.original) ? `<button class="btn warn" id="undo">↩️ رجوع…</button>` : '';
  // 4.8 (backlog 37): a big change (options replaced, meaning changed) sends the question back to isolated solving
  const rsv = access >= 3 && ['in_review', 'needs_revision', 'revised', 'approved'].includes(q.status)
    ? `<div class="rsv-row"><a class="linkbtn" id="rsv" href="#resolve/${Number(q.qid)}">🔁 تعديل كبير؟ رجّعه للحل من جديد${Drafts.get(q.qid, 'resolve') ? ' (عندك مسودة)' : ''}</a></div>` : '';
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
    ${studentRowHTML(b, q)}
    ${draftPanels}
    ${verdict}
    ${alertCardHTML(split.alert, b.source)}
    ${reportSectionHTML(q)}
    ${(b.duplicates || []).map(dupCardHTML).join('')}
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
    ${rsv}
    <p class="small muted" style="text-align:center;margin-top:18px">اسحب يمينًا أو شمالًا للتنقل بين الأسئلة</p>
  </main>
  ${bar ? `<div class="actions"><div class="actions-in">${bar}</div></div>` : ''}`;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('back', () => { location.hash = ''; });
  on('prev', () => go(nav.prev)); on('next', () => go(nav.next));
  on('toggle-extra', () => { S.showExtra = !S.showExtra; const y = scrollY; renderQuestion(); scrollTo(0, y); });
  fitActions();
  bindVersions();   // 4.8: "🗂️ نسخ السؤال" loads on first open
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
  $app.querySelectorAll('[data-page]').forEach(bt => bt.onclick = () => openPageViewer(b.source, Number(bt.dataset.page)));
  bindDupCards(b, v);
  bindReportSection(q);
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
async function refreshCurrent() { S.prefetch = {}; await loadQueue(); await openQuestion(S.qid); }
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
    await afterDecision(S.qid, `تم اعتماد السؤال رقم ${S.bundle.question.qid_display} بفضل الله`, 'هيظهر للطلاب بعلامة Reviewed' + ((note || '').trim() ? '، ومعاه ملاحظتك.' : '.'));
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
      else await afterDecision(q.qid, `تم إرسال طلب التعديل للسؤال رقم ${q.qid_display} بفضل الله`,
        (st.type === 'change_answer' ? 'واتخفى السؤال من الطلاب لحد ما التصليح يتعتمد. ' : '') + 'هيرجعلك في فولدر "عدّلها Claude" بعد التنفيذ.');
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

/* ---------- footer: version, brand line, force update ---------- */
function appFooter() {
  return `<footer class="appfoot">
    <div class="ver">مراجعة OOC · الإصدار <bdi dir="ltr">${APP_VERSION}</bdi> <span class="muted">(${APP_BUILD})</span></div>
    <div class="brandline">بفضل الله، إحدى خدمات<br><bdi dir="ltr" class="corp">Online Ophthalmology Corporation</bdi></div>
    <button class="linkbtn quiet small" type="button" data-update>🔄 تحديث التطبيق لآخر إصدار</button>
  </footer>`;
}
function bindFooter() {
  document.querySelectorAll('[data-update]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'جاري التحديث…';
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { }
    try { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('ooc-review')).map(k => caches.delete(k))); } catch { }
    Drafts.flush(); Resume.save();
    location.reload();
  });
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
function installBtn() {
  const inst = isStandalone();
  return `<button class="install" id="install" type="button" aria-label="${inst ? 'شرح تثبيت التطبيق' : 'أضف التطبيق للشاشة الرئيسية'}">📲 <span class="who">${inst ? 'التثبيت' : 'ثبّت التطبيق'}</span></button>`;
}
// bottom-of-list card: always available, also for sharing the app with colleagues
function installListCard() {
  const inst = isStandalone();
  return `<button class="install-card list-card" type="button" data-open-install><img src="/icon-192.png" alt=""><div><b>📲 ${inst ? 'تثبيت التطبيق على جهاز تاني، أو شرحه لزميل' : 'أضف التطبيق للشاشة الرئيسية'}</b><span>شرح خطوة بخطوة لأندرويد والكمبيوتر والآيفون، وزرار تبعت بيه الرابط والطريقة لزمايلك.</span></div></button>`;
}
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
  const inst = isStandalone();
  const body = `${inst ? `<div class="installed"><span class="ok-dot" aria-hidden="true">✓</span><div><b>التطبيق مثبت على جهازك بفضل الله</b><div class="small muted">الشرح تحت لو عايز تثبته على جهاز تاني أو تشرحه لزميل.</div></div></div>` : ''}
    <div class="share-box">
      <div><b>ابعت التطبيق لزميل</b><div class="small muted">الرابط ومعاه طريقة التثبيت في رسالة واحدة.</div></div>
      <button class="btn primary" type="button" id="share-app">↗️ مشاركة</button>
    </div>
    <div class="ptabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-ptab="${k}" aria-selected="${k === def}">${l}</button>`).join('')}</div><div id="ptab-body">${installTab(def)}</div>
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
  sheet.querySelector('#share-app').onclick = shareApp;
  bindNow();
}
async function shareApp() {
  const url = location.origin + '/';
  const text = `تطبيق مراجعة بنك الأسئلة – OOC\n${url}\n\nطريقة التثبيت:\n• أندرويد (كروم): افتح الرابط، واضغط "📲 ثبّت التطبيق"، أو من قائمة كروم ⋮ اختار "إضافة إلى الشاشة الرئيسية".\n• آيفون (سفاري): افتح الرابط، واضغط زر المشاركة، ثم "إضافة إلى الشاشة الرئيسية".\n• كمبيوتر (كروم أو إيدج): أيقونة التثبيت في آخر شريط العنوان.`;
  try {
    if (navigator.share) { await navigator.share({ title: 'مراجعة OOC', text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  notify('تم نسخ الرابط وطريقة التثبيت بفضل الله', 'الصقهم في واتساب أو أي رسالة لزميلك.');
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
}

function staffCard() {
  const p = S.pipeline; if (!S.isAdmin || !p) return '';
  const st = p.by_status || {};
  const act = (p.unsolved || 0) + (p.awaiting_reason || 0) + (p.open_requests || 0) + (p.consistency_checks || 0);
  const openState = localStorage.getItem('staffOpen') === '1';
  S.copyMsgs = { solve: MSG_SOLVE, revise: MSG_REVISE };
  const body = S.chapters && S.chapters.length ? chapterList(S.chapters) : legacyRows(p);
  const newBtn = S.chapters ? '<div class="row"><div class="grow small muted">كل شابتر جديد يبدأ من هنا: ملفه، وصور صفحاته، ورسايل محادثاته.</div><button class="btn sec" id="nc-open">➕ شابتر جديد</button></div>' : '';
  return `<details class="staff" ${openState ? 'open' : ''} id="staff"><summary style="cursor:pointer;list-style:none"><h2 id="staff-h" style="display:inline">لوحة الإدارة</h2>
    <span class="small muted" style="margin-inline-start:8px">${act ? `${act} يحتاج إجراء` : 'لا شيء يحتاج إجراء'} ▾</span></summary>
    ${newBtn}${body}
    <details class="solver-d" id="solver-d" ${localStorage.getItem('solverOpen') === '1' ? 'open' : ''}><summary>🤖 المحلّل الآلي (مدفوع): <span id="solver-sum" class="small muted">جاري التحميل…</span></summary>
      <div class="row" id="solver-box"><div class="grow small muted">جاري تحميل حالة المحلّل الآلي…</div></div></details>
    <div class="row small muted">في المراجعة ${st.in_review || 0}، معدّل ${st.revised || 0}، ينتظر التعديل ${st.needs_revision || 0}، معتمد ${st.approved || 0}.</div>
  </details>`;
}
const OPEN_CLAUDE = '<a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">افتح Claude</a>';
// 4.8 rows, kept as the fallback while chapter_runs_status is unavailable (before migration 039, or on a failed call).
function legacyRows(p) {
  const chats = Math.ceil((p.unsolved || 0) / 15);   // ~15 per solve chat in practice (v4.8)
  return `<div class="row"><div class="grow">
      <div class="stat">${p.unsolved || 0} ${p.unsolved_incomplete ? `<span class="small muted">+ ${p.unsolved_incomplete} ينتظر إعادة التركيب</span>` : ''}</div>
      <div class="small muted">سؤال ينتظر الحل${p.unsolved ? ` (حوالي ${chats} ${chats === 1 ? 'محادثة' : 'محادثات'}، وحوالي 15 سؤالًا لكل محادثة)` : '. تظهر هنا بعد الاستخراج.'}</div>
    </div>${p.unsolved || p.awaiting_reason ? `<button class="btn primary" data-copy="solve">انسخ رسالة محادثة الحل</button>${OPEN_CLAUDE}` : ''}</div>
    ${p.awaiting_reason ? `<div class="row"><div class="grow small">${p.awaiting_reason} سؤال محلول ومختلف مع المصدر ينتظر كتابة سبب الاختلاف (نفس رسالة الحل).</div></div>` : ''}
    <div class="row"><div class="grow">
      <div class="stat">${p.open_requests || 0}</div>
      <div class="small muted">طلب تعديل مفتوح${p.consistency_checks ? `، و${p.consistency_checks} سؤال عُدّل سريعًا يحتاج مراجعة اتساق` : ''}</div>
    </div>${p.open_requests || p.consistency_checks ? `<button class="btn primary" data-copy="revise">انسخ رسالة محادثة التعديلات</button>${OPEN_CLAUDE}` : ''}</div>`;
}
/* v4.8 (item 92 phase 2): one card per chapter file, steps in order with counts from the bank (chapter_runs_status, migration 039).
   A copy button sits next to every step a chat can do now; two can be open at once (new questions to solve + revisions).
   The suggested step is the first one with work, in pipeline order. Old Glaucoma batches (no single batch) get no batch line. */
// 5.0: chapters with work first (newest first), finished chapters (all approved, nothing to do) grouped at the end
const chapOpen = () => { try { return JSON.parse(localStorage.getItem('chapOpen') || '[]'); } catch { return []; } };
function chapWork(c) { const n = k => Number(c[k]) || 0; return (!!c.batch_id && n('total') === 0) || n('unsolved') + n('awaiting_reason') + n('awaiting_rebuild') + n('in_review') + n('revised') + n('open_requests') + n('consistency_checks') > 0; }
function chapterList(list) {
  const sorted = list.slice().sort((a, b) => (chapWork(b) - chapWork(a)) || (Number(b.run_id) - Number(a.run_id)));
  const done = sorted.filter(c => !chapWork(c) && Number(c.total) > 0 && Number(c.approved) === Number(c.total));
  const active = sorted.filter(c => !done.includes(c));
  return active.map(chapterCard).join('') + (done.length ? `<details class="chap-done"><summary>✅ شباتر خلصت (${done.length})</summary>${done.map(chapterCard).join('')}</details>` : '');
}
function chapterCard(c) {
  const n = k => Number(c[k]) || 0;
  const b = c.batch_id, key = `r${Number(c.run_id)}`;
  const solveN = n('unsolved') + n('awaiting_reason'), revN = n('open_requests') + n('consistency_checks'), reviewN = n('in_review') + n('revised');
  if (b) { S.copyMsgs[`x${key}`] = msgExtract(b, c.file_name || ''); S.copyMsgs[`s${key}`] = msgSolveBatch(b); }
  const chats = Math.ceil(n('unsolved') / 15);
  const steps = [
    { id: 'extract', name: 'استخراج', work: !!b && n('total') === 0,
      text: n('total') ? `${n('total')} سؤال` : 'لسه مفيش أسئلة',
      btn: b ? `<button class="btn${n('total') ? ' sec' : ' primary'}" data-copy="x${key}">انسخ رسالة الاستخراج</button>` : '' },
    { id: 'solve', name: 'حل', work: solveN > 0,
      text: solveN ? `${n('unsolved')} ينتظر الحل${n('unsolved') ? ` (حوالي ${chats} ${chats === 1 ? 'محادثة' : 'محادثات'})` : ''}${n('awaiting_reason') ? `، و${n('awaiting_reason')} ينتظر سبب الاختلاف` : ''}` : 'مفيش أسئلة تنتظر الحل',
      btn: solveN ? `<button class="btn primary" data-copy="${b ? `s${key}` : 'solve'}">انسخ رسالة الحل</button>${OPEN_CLAUDE}` : '' },
    { id: 'rebuild', name: 'إعادة تركيب', work: n('awaiting_rebuild') > 0,
      text: n('awaiting_rebuild') ? `${n('awaiting_rebuild')} ينتظر إعادة التركيب` : 'لا شيء',
      btn: n('awaiting_rebuild') ? '<button class="btn sec" data-gofolder="rebuild">افتح الفولدر</button>' : '' },
    { id: 'review', name: 'مراجعة', work: reviewN > 0,
      text: reviewN ? `${reviewN} ينتظر المراجعة` : 'لا شيء',
      btn: reviewN ? '<button class="btn sec" data-gofolder="todo">افتح الفولدر</button>' : '' },
    { id: 'revise', name: 'تعديلات', work: revN > 0,
      text: revN ? `${n('open_requests')} طلب تعديل مفتوح${n('consistency_checks') ? `، و${n('consistency_checks')} عُدّل سريعًا يحتاج مراجعة اتساق` : ''}` : 'لا شيء',
      btn: revN ? `<button class="btn primary" data-copy="revise">انسخ رسالة التعديلات</button>${OPEN_CLAUDE}` : '' },
    { id: 'done', name: 'خلاصة', work: false, text: `معتمد ${n('approved')} من ${n('total')}`, btn: '' },
  ];
  const rec = (steps.find(s => s.work) || {}).id;
  const file = b ? [
    n('page_count') && n('pages_done') < n('page_count') ? `<span class="tag amber">صور الصفحات: ${n('pages_done')} من ${n('page_count')}</span><button class="linkbtn" type="button" data-pages="${Number(c.run_id)}">كمّل صور الصفحات</button>` : '',
    c.file_uploaded ? '<span class="tag">نسخة من الملف في التطبيق</span>' : '',
  ].join('') : '';
  const recStep = steps.find(s => s.id === rec);
  const chips = [n('unsolved') + n('awaiting_reason') ? `${n('unsolved') + n('awaiting_reason')} للحل` : '', n('awaiting_rebuild') ? `${n('awaiting_rebuild')} تركيب` : '',
    reviewN ? `${reviewN} مراجعة` : '', revN ? `${revN} تعديلات` : '', `معتمد ${n('approved')} من ${n('total')}`].filter(Boolean).join(' · ');
  const isOpen = chapOpen().includes(Number(c.run_id));
  return `<details class="chap" data-run="${Number(c.run_id)}" ${isOpen ? 'open' : ''}>
    <summary><div class="chap-h"><b>${esc(c.chapter)}</b> <span class="small muted">${esc(c.source || '')}${c.years || c.years_auto ? ` (${esc(c.years || c.years_auto)})` : ''}</span></div>
      <div class="chap-sum small">${recStep ? `<span class="tag cobalt">المقترح: ${recStep.name}</span> ` : ''}<span class="muted">${chips}</span></div></summary>
    <div class="small muted">${b ? `الدفعة ${esc(b)}، الملف: ${esc(c.file_name || '')}` : 'دفعات قديمة لكل سنة'}</div>
    <div class="tags">${c.pages_prefix && (n('pages_done') || n('page_count')) ? `<button class="linkbtn" type="button" data-viewpages="${Number(c.run_id)}">👁️ اعرض الصفحات</button>` : ''}${DRIVE_RX.test(c.drive_link || '') ? `<a class="linkbtn" href="${esc(c.drive_link)}" target="_blank" rel="noopener noreferrer">📁 الملف على درايف</a>` : ''}<button class="linkbtn" type="button" data-link="${Number(c.run_id)}">${c.drive_link ? 'غيّر لينك درايف' : '➕ لينك درايف'}</button></div>
    ${file || n('no_source_pages') ? `<div class="tags">${file}${n('no_source_pages') ? `<span class="tag warn">${n('no_source_pages')} سؤال بدون صفحات مصدر مسجّلة</span>` : ''}</div>` : ''}
    <ol class="chsteps">${steps.map(s => `<li class="chstep${s.id === rec ? ' rec' : ''}${s.work ? '' : ' idle'}"><div class="grow"><b>${s.name}</b> <span class="small muted">${s.text}</span>${s.id === rec ? ' <span class="tag cobalt">الخطوة المقترحة</span>' : ''}</div>${s.btn}</li>`).join('')}</ol>
  </details>`;
}
/* ---------- v4.8 (item 92 phase 2): ➕ new chapter ----------
   pdf.js (Mozilla, Apache-2.0, legacy build 5.6.205, approved 4/10) is self-hosted under /vendor and imported only here,
   for owners/admins, on first use: reviewers never download it. No eval, no wasm (the CSP allows neither). */
const PDFJS_BASE = '/vendor/pdfjs-5.6.205/';
let pdfjsP = null;
function loadPdfJs() {
  if (!pdfjsP) pdfjsP = import(PDFJS_BASE + 'pdf.min.js')
    .then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js'; return m; })
    .catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}
async function openPdf(bytes) {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: bytes, isEvalSupported: false, useWasm: false }).promise;
}
function pdfErrText(e) {
  const n = e && e.name;
  if (n === 'PasswordException') return 'الملف عليه كلمة سر. افتحه واحفظه من غير كلمة سر وجرّب تاني.';
  if (n === 'InvalidPDFException' || n === 'MissingPDFException') return 'الملف ده مش PDF سليم. جرّب تفتحه على الجهاز وتحفظه تاني.';
  if (/Failed to fetch|import|module/i.test(String(e && e.message))) return 'مكتبة قراية الملف ماتحمّلتش. اتأكد من النت وجرّب تاني.';
  return 'الملف ماتقراش: ' + ((e && e.message) || e);
}
const MB = n => (Number(n) / 1048576).toFixed(1);
const CH_MAX = 52428800;   // = bucket chapter-files limit (migration 039)
const DRIVE_RX = /^https:\/\/drive\.google\.com\//;   // same rule as chapter_set_link (migration 042)
// v4.8 (owner decision 4/10): the PDF lives on the project Drive (link on the card); a copy in the app is optional.
const STORE_HELP = `<div class="help-box hidden" id="nc-help">
    <p><b>📁 درايف المشروع (المقترح):</b> الملف مابياخدش أي مساحة من التطبيق، والرفع أسرع على الموبايل. خلّي الملف مقفول على حسابات الفريق بس (مش "أي حد معاه اللينك")، لأن فيه إجابات المصدر. ولو التقطيع وقف وحبيت تكمّل من جهاز تاني، هتنزّل الملف من درايف الأول.</p>
    <p><b>📥 نسخة في التطبيق:</b> لو التقطيع وقف، بيكمّل من أي جهاز لوحده من غير ما تختار الملف تاني. بس بتاخد من مساحة التطبيق المحدودة (الملف ممكن يبقى من 10 لـ 40 ميجا).</p>
    <p>ينفع تعمل الاتنين. وفي الحالتين صور الصفحات بتترفع، ودي اللي المراجعين بيفتحوها من "📄 افتح صفحة المصدر".</p></div>`;
function openNewChapter() {
  let last = {}; try { last = JSON.parse(localStorage.getItem('chapterLast') || '{}'); } catch { }
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>➕ شابتر جديد</h2></div>
    <p class="small muted">اختار ملف الشابتر، واكتب بياناته. التطبيق هيقطّعه لصور صفحات ويرفعها.</p>
    <label class="f" for="nc-file">ملف الشابتر (PDF)</label>
    <input type="file" id="nc-file" accept="application/pdf,.pdf">
    <div class="small muted" id="nc-info" aria-live="polite"></div>
    <label class="f" for="nc-ch">الشابتر</label><input class="ci" id="nc-ch" dir="auto" maxlength="120" placeholder="مثال: Cornea">
    <label class="f" for="nc-src">المصدر</label><input class="ci" id="nc-src" dir="auto" maxlength="160" value="${esc(last.source || '')}" placeholder="مثال: Arab Board Q Bank of Ophthalmology">
    <label class="f" for="nc-years">السنين <span class="lbl-sub">(اختياري)</span></label><input class="ci" id="nc-years" dir="auto" maxlength="60" placeholder="مثال: 2010–2021">
    <p class="hint">لو سبتها فاضية، محادثة الاستخراج بتطلّع سنة كل سؤال من الملف، والكارت بيكتب أول وآخر سنة لوحده.</p>
    <div class="f store-h">حفظ ملف الشابتر <button class="infobtn" type="button" id="nc-help-b" aria-expanded="false" aria-controls="nc-help" title="الفرق بين الطريقتين">ℹ️ الفرق بين الطريقتين</button></div>
    ${STORE_HELP}
    <label class="f" for="nc-link">📁 لينك الملف على درايف المشروع <span class="lbl-sub">(اختياري، وتقدر تضيفه بعدين من الكارت)</span></label>
    <input class="ci" id="nc-link" dir="ltr" inputmode="url" maxlength="500" placeholder="https://drive.google.com/…">
    <label class="chk"><input type="checkbox" id="nc-copy"> 📥 احفظ نسخة من الملف في التطبيق كمان</label>
    <div class="err" id="nc-err" role="alert"></div>
    <div class="foot"><button class="btn primary" id="nc-go" disabled>سجّل الشابتر وابدأ</button></div>`, { canClose: () => !busy || confirm('التسجيل لسه شغال. تقفل؟') });
  const $s = sel => sheet.querySelector(sel), err = t => { $s('#nc-err').textContent = t || ''; };
  let file = null, pages = 0, busy = false;
  bindHelp(sheet, '#nc-help-b', '#nc-help');
  $s('#nc-file').onchange = async ev => {
    file = null; pages = 0; $s('#nc-go').disabled = true; err('');
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    if (!/\.pdf$/i.test(f.name) || /[\/\\]/.test(f.name)) return err('لازم الملف يكون PDF.');
    if (f.size > CH_MAX) return err(`الملف ${MB(f.size)} ميجا، والحد 50 ميجا. صغّره وجرّب تاني.`);
    $s('#nc-info').textContent = 'جاري قراية الملف…';
    try {
      const doc = await openPdf(new Uint8Array(await f.arrayBuffer()));
      pages = doc.numPages; await doc.destroy();
    } catch (e) { console.warn('pdf open:', e); $s('#nc-info').textContent = ''; return err(pdfErrText(e)); }
    file = f;
    $s('#nc-info').textContent = `${pages} صفحة، ${MB(f.size)} ميجا.`;
    const ch = $s('#nc-ch'); if (!ch.value.trim()) ch.value = f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
    $s('#nc-go').disabled = false;
  };
  $s('#nc-go').onclick = async () => {
    if (!file || busy) return;
    const go = $s('#nc-go'); err('');
    const chapter = $s('#nc-ch').value.trim(), source = $s('#nc-src').value.trim(), years = $s('#nc-years').value.trim();
    const link = $s('#nc-link').value.trim(), copy = $s('#nc-copy').checked;
    if (!chapter) return err('اكتب اسم الشابتر.');
    if (!source) return err('اكتب المصدر.');
    if (link && !DRIVE_RX.test(link)) return err('لينك درايف لازم يبدأ بـ https://drive.google.com/');
    busy = true; go.disabled = true;
    let r = null;
    try {
      go.textContent = 'جاري تسجيل الشابتر…';
      const res = await rpc('chapter_create', { p_chapter: chapter, p_source: source, p_years: years || null, p_file_name: file.name, p_file_size: file.size, p_page_count: pages });
      try { localStorage.setItem('chapterLast', JSON.stringify({ source })); } catch { }
      r = { run_id: res.run_id, batch_id: res.batch_id, chapter, page_count: pages, pages_done: 0, file_name: file.name, file_size: file.size };
      if (link) await rpc('chapter_set_link', { p_run_id: r.run_id, p_link: link });
      if (copy) {
        go.textContent = `جاري رفع نسخة الملف (${MB(file.size)} ميجا)…`;
        const { error } = await sb.storage.from('chapter-files').upload(res.file_path || `ch-${r.batch_id}/source.pdf`, file, { contentType: 'application/pdf', upsert: true });
        if (error) throw Object.assign(new Error(error.message), { stage: 'copy' });
        await rpc('chapter_set_progress', { p_run_id: r.run_id, p_file_uploaded: true });
        r.file_uploaded = true;
      }
    } catch (e) {
      console.warn('new chapter:', e);
      busy = false; go.disabled = false; go.textContent = 'سجّل الشابتر وابدأ';
      if (!r) return err(errText(e));
      // the chapter exists: a failed link or copy must not stop the pages (both can be added later)
      notify(e.stage === 'copy' ? 'نسخة الملف ماترفعتش' : 'لينك درايف ماتحفظش', `${errText(e)} الشابتر اتسجّل، والتقطيع هيبدأ دلوقتي.${e.stage === 'copy' ? '' : ' تقدر تضيف اللينك من الكارت.'}`, 'info');
    }
    busy = false; close(true);
    openPagesSheet(r, new Uint8Array(await file.arrayBuffer()));
  };
}
function bindHelp(root, btnSel, boxSel) {
  const b = root.querySelector(btnSel), box = root.querySelector(boxSel);
  b.onclick = () => { const open = box.classList.toggle('hidden') === false; b.setAttribute('aria-expanded', String(open)); };
}
function openDriveLink(c) {
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>📁 لينك درايف – ${esc(c.chapter)}</h2></div>
    <div class="f store-h">ليه درايف؟ <button class="infobtn" type="button" id="dl-help-b" aria-expanded="false" aria-controls="nc-help">ℹ️ الفرق بين الطريقتين</button></div>
    ${STORE_HELP}
    <label class="f" for="dl-link">لينك الملف على درايف المشروع</label>
    <input class="ci" id="dl-link" dir="ltr" inputmode="url" maxlength="500" value="${esc(c.drive_link || '')}" placeholder="https://drive.google.com/…">
    <p class="small muted">سيبه فاضي واحفظ لو عايز تشيل اللينك.</p>
    <div class="err" id="dl-err" role="alert"></div>
    <div class="foot"><button class="btn primary" id="dl-save">احفظ اللينك</button></div>`);
  bindHelp(sheet, '#dl-help-b', '#nc-help');
  sheet.querySelector('#dl-save').onclick = async () => {
    const v = sheet.querySelector('#dl-link').value.trim(), e = sheet.querySelector('#dl-err'), b = sheet.querySelector('#dl-save');
    if (v && !DRIVE_RX.test(v)) { e.textContent = 'لينك درايف لازم يبدأ بـ https://drive.google.com/'; return; }
    b.disabled = true;
    try { await rpc('chapter_set_link', { p_run_id: c.run_id, p_link: v || null }); close(true); notify(v ? 'تم حفظ لينك درايف' : 'اتشال لينك درايف', ''); await loadQueue(); renderQueue(); }
    catch (x) { console.warn('drive link:', x); b.disabled = false; e.textContent = errText(x); }
  };
}
/* v4.8: page images. One page at a time (weak phones): render with pdf.js, encode WebP (JPEG where the browser cannot encode
   WebP, e.g. Safari; same file name, real content type, the viewer shows either), upload to source-pages/ch-<batch>/pNNN.webp
   (the name question_bundle/rebuild_queue already build), and save the count after every page, so a stop resumes from the
   next page, on this device or another (the PDF is then read back from chapter-files). */
const PAGE_W = 1300, PAGE_MAX = 2097152;   // width in px; bucket source-pages limit (2 MB)
const canvasBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));
async function renderPage(doc, i) {
  const page = await doc.getPage(i);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(3, PAGE_W / vp1.width) });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  try {
    await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
    let blob = await canvasBlob(cv, 'image/webp', 0.8);
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(cv, 'image/jpeg', 0.82);
    if (blob && blob.size > PAGE_MAX) blob = await canvasBlob(cv, 'image/jpeg', 0.6);
    if (!blob) throw new Error('canvas encode failed');
    return blob;
  } finally { page.cleanup(); cv.width = cv.height = 0; }
}
async function chapterPdfBytes(run) {
  const { data, error } = await sb.storage.from('chapter-files').createSignedUrl(`ch-${run.batch_id}/source.pdf`, 600);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'no signed url');
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error('download ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}
// No stored copy: the same file is picked again on this device (name and size must match the registered file).
function pickSameFile(sheet, run) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.innerHTML = `<label class="f" for="pg-file">اختار نفس الملف من جهازك: <b dir="ltr">${esc(run.file_name || '')}</b> (${MB(run.file_size)} ميجا)</label>
      <input type="file" id="pg-file" accept="application/pdf,.pdf"><p class="small muted">مش معاك على الجهاز ده؟ نزّله من لينك درايف في كارت الشابتر.</p>`;
    sheet.querySelector('#pg-txt').before(box); sheet.querySelector('#pg-txt').textContent = '';
    box.querySelector('#pg-file').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      if (f.name !== run.file_name || f.size !== Number(run.file_size)) { sheet.querySelector('#pg-err').textContent = 'ده مش نفس الملف المتسجّل للشابتر ده (الاسم أو الحجم مختلف).'; return; }
      sheet.querySelector('#pg-err').textContent = ''; box.remove(); sheet.querySelector('#pg-txt').textContent = 'جاري التحضير…';
      resolve(new Uint8Array(await f.arrayBuffer()));
    };
  });
}
function openPagesSheet(run, bytes) {
  const total = Number(run.page_count) || 0; let from = (Number(run.pages_done) || 0) + 1, stop = false, busy = true, lock = null;
  const { sheet, close } = openSheet(`
    <div class="sheet-head"><h2>صور صفحات ${esc(run.chapter || '')}</h2></div>
    <p class="small muted">التطبيق بيقطّع الملف لصور ويرفعها. سيب الشاشة مفتوحة لحد ما يخلص. ولو وقفت، تقدر تكمّل بعدين من زرار "كمّل صور الصفحات" في كارته، من الجهاز ده أو من غيره.</p>
    <progress id="pg-bar" max="${total}" value="${from - 1}" style="width:100%"></progress>
    <div id="pg-txt" aria-live="polite">جاري التحضير…</div>
    <div class="err" id="pg-err" role="alert"></div>
    <div class="foot"><button class="btn" id="pg-stop">إيقاف</button></div>`, { canClose: () => !busy || confirm('التقطيع لسه شغال. توقفه؟ (اللي اترفع بيتحفظ)'), onClose: () => { stop = true; } });
  const $s = q => sheet.querySelector(q);
  const done = async (title, body, kind) => { busy = false; try { lock && lock.release(); } catch { } close(true); notify(title, body, kind); await loadQueue().catch(() => { }); renderQueue(); };
  $s('#pg-stop').onclick = () => { stop = true; $s('#pg-stop').disabled = true; $s('#pg-txt').textContent = 'هيقف بعد الصفحة اللي شغال عليها…'; };
  (async () => {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { }   // optional: keeps the phone screen on while it works
    let doc = null, t0 = 0, n = 0;
    try {
      if (!bytes && run.file_uploaded) { $s('#pg-txt').textContent = 'جاري تحميل نسخة الملف من التطبيق…'; bytes = await chapterPdfBytes(run); }
      if (!bytes) bytes = await pickSameFile(sheet, run);
      doc = await openPdf(bytes);
      if (doc.numPages !== total) throw new Error(`الملف فيه ${doc.numPages} صفحة، والمتسجّل ${total}`);
      t0 = performance.now();
      for (let i = from; i <= total && !stop; i++) {
        const blob = await renderPage(doc, i);
        const path = `ch-${run.batch_id}/p${String(i).padStart(3, '0')}.webp`;
        const { error } = await sb.storage.from('source-pages').upload(path, blob, { contentType: blob.type, upsert: true });
        if (error) throw Object.assign(new Error(error.message), { page: i });
        await rpc('chapter_set_progress', { p_run_id: run.run_id, p_pages_done: i });
        n++; from = i + 1;
        const per = (performance.now() - t0) / n / 1000;
        $s('#pg-bar').value = i; $s('#pg-txt').textContent = `صفحة ${i} من ${total} (حوالي ${per.toFixed(1)} ثانية للصفحة، والباقي حوالي ${Math.ceil(per * (total - i) / 60)} دقيقة)`;
      }
      if (from > total) await done(`تم رفع صور صفحات ${run.chapter || ''} بفضل الله`, `${total} صفحة. الخطوة الجاية: انسخ رسالة الاستخراج من كارته، وارفق نفس الملف.`);
      else await done('اتوقف التقطيع', `اترفع ${from - 1} من ${total}. كمّل من زرار "كمّل صور الصفحات" في كارته.`, 'info');
    } catch (e) {
      console.warn('chapter pages:', e);
      busy = false; try { lock && lock.release(); } catch { }
      const where = e.page ? `صفحة ${e.page}: ` : '';
      $s('#pg-err').textContent = `${where}${/Exception$/.test(e.name || '') ? pdfErrText(e) : errText(e)}. اللي اترفع (${from - 1} من ${total}) محفوظ. جرّب تكمّل بعدين، ولو الموبايل ماقدرش كمّل من الكمبيوتر.`;
      $s('#pg-stop').textContent = 'قفل'; $s('#pg-stop').disabled = false; $s('#pg-stop').onclick = () => { close(true); loadQueue().then(renderQueue).catch(() => { }); };
    } finally { if (doc) doc.destroy().catch(() => { }); }
  })();
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
  } catch (e) { const sm = document.getElementById('solver-sum'); if (sm) sm.textContent = 'تعذّر الوصول'; box.innerHTML = `<div class="grow small"><b>المحلّل الآلي:</b> تعذّر الوصول إليه. ${esc(solverErr(e))}</div><button class="btn" id="sv-retry">حاول مرة أخرى</button>`; document.getElementById('sv-retry').onclick = () => loadSolver(); }
}
function renderSolver(st) {
  const box = document.getElementById('solver-box'); if (!box) return;
  stopSolverTimer();
  // 5.0: the panel shows the solver as one line; it opens by itself while a run is going
  const sum = document.getElementById('solver-sum'), sd = document.getElementById('solver-d');
  if (sum) sum.textContent = !st.configured ? 'غير مفعّل' : st.active ? 'شغال دلوقتي' : 'جاهز';
  if (sd && st.active) sd.open = true;
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

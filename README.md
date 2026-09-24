# تطبيق مراجعة بنك الأسئلة – OOC

موقع خفيف (ملف `index.html` واحد) يتكلم مع Supabase مباشرة (مشروع OOC Question Bank). لا يوجد سيرفر، فلا ينام ولا يستهلك ساعات تشغيل.
المفتاح الموجود داخل الملف هو المفتاح العام (anon) لـ Supabase، وآمن في صفحة عامة: الحماية الفعلية من RLS داخل القاعدة.

## النشر لأول مرة

### 1) GitHub (حساب oocnewday)
1. New repository، الاسم: `reviewer-app`، النوع: **Public**، ثم Create repository.
2. اضغط **uploading an existing file**، واسحب `index.html` و `README.md`، ثم **Commit changes**.

### 2) Render (حساب Render الخاص بالمشروع)
1. سجّل في render.com بحساب Google الخاص بالمشروع.
2. **New ← Static Site**، ثم تبويب **Public Git Repository**، والصق: `https://github.com/oocnewday/reviewer-app`
3. الإعدادات:
   - Name: `ooc-review` (يصبح الرابط `https://ooc-review.onrender.com`؛ لو الاسم محجوز اختر غيره).
   - Branch: `main`
   - Build Command: اتركه فارغًا (لو طلب قيمة اكتب `echo ok`).
   - Publish Directory: `.`
4. **Create Static Site** وانتظر حتى تظهر Live.

### 3) Supabase (مرة واحدة، ضروري لرسائل التأكيد وتغيير كلمة السر)
لوحة Supabase ← مشروع **OOC Question Bank** ← Authentication ← URL Configuration:
- **Site URL**: رابط الموقع من Render، مثل `https://ooc-review.onrender.com`
- **Redirect URLs**: أضف `https://ooc-review.onrender.com/**`

(مشروع تطبيق الطلاب منفصل، فهذا الإعداد لا يؤثر عليه.)

### 4) أول دخول
الحسابات المدعوة (المسجلة في القاعدة) تتفعل تلقائيًا بدورها أول ما تسجل وتأكد الإيميل. أي إيميل تاني يستنى التفعيل.

## تفعيل مراجع (حتى تُبنى لوحة الأدمن في المرحلة 4)
1. المراجع يسجّل حسابًا من الموقع، ويظهر له "في انتظار تفعيل الأدمن".
2. افتح محادثة Claude في المشروع واكتب مثلًا: "فعّل المراجع (بريده) بصلاحية مراجعة على Glaucoma".

## الملفات (كلها في جذر المستودع)
`index.html` (الصفحة)، `app.js` (الكود)، `app.css` (التصميم)، `manifest.webmanifest` و `sw.js` (نسخة PWA)، والأيقونات `icon-192.png` و `icon-512.png` و `icon-maskable-512.png` و `apple-touch-icon.png`، و `README.md`.
المستودع عام، ومفيهوش أي سر: المفتاح الموجود في `app.js` هو المفتاح العام لـ Supabase، والحماية الفعلية من صلاحيات القاعدة.

## تثبيت التطبيق على الموبايل (PWA)
- أندرويد (كروم): زر "📲 ثبّت التطبيق" أعلى القائمة، أو قائمة كروم ⋮ ← "تثبيت التطبيق".
- آيفون (سفاري): زر المشاركة ← "إضافة إلى الشاشة الرئيسية".
التطبيق يجيب أحدث نسخة من النت في كل فتحة، فأي تحديث ترفعه يوصل للمراجعين فورًا.

## التحديثات
ارفع الملفات الجديدة فوق القديمة على GitHub (Add file ← Upload files ← Commit).
لو لم يتحدث الموقع خلال دقائق، من Render: **Manual Deploy ← Deploy latest commit**.

## المحلّل الآلي المدفوع (مقفول حتى إضافة المفتاح)
مبني ويعمل من كارت المالك، لكنه لا يصرف شيئًا ولا يعمل قبل إضافة مفتاح API:
1. من platform.claude.com: اشحن رصيدًا صغيرًا (مثلًا 5 دولار) وضع حد صرف شهري، ثم API Keys ← Create Key وانسخ المفتاح.
2. لوحة Supabase ← OOC Question Bank ← Edge Functions ← Secrets: أضف `ANTHROPIC_API_KEY` وقيمته المفتاح.
3. في لوحة الإدارة اضغط "تحقق": يظهر زر "ابدأ التجربة" (10 أسئلة إجباريًا) عند وجود أسئلة تنتظر الحل.
4. بعد التجربة ترى التكلفة الفعلية وتقدير باقي الملف، وتقرر "افتح الدفعات الكاملة" أو تكمل بالمسار المجاني.

كل تشغيلة بضغطة من الإدارة، ولها حد أقصى (5 دولار افتراضيًا). الحل يتم كدفعة عند Anthropic (عادةً أقل من ساعة، وقد يصل 24 ساعة)، والنتائج تُحفظ عند فتح الصفحة.

## الحماية (مرة واحدة)
### Render: رؤوس الحماية
Render ← ooc-review ← **Settings** ← **Headers** ← **Add Rule**، والمسار `/*`، وأضف:

| Name | Value |
| --- | --- |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), payment=(), microphone=(self)` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

وقاعدة تانية للمسار `/sw.js`: `Cache-Control` = `no-cache`.

### Supabase: الدخول
لوحة Supabase ← OOC Question Bank ← **Authentication**:
- **Sign In / Providers ← Email**: تأكد إن **Confirm email** شغال.
- **Password security**: أقل طول **8**، واطلب **حروف وأرقام**، وفعّل **Leaked password protection** لو متاح في خطتك.

(سياسة أمان المحتوى الأساسية موجودة بالفعل داخل `index.html`: الموقع مش بيشغّل أي كود غير كوده ومكتبة Supabase.)

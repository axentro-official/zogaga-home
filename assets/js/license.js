/* ============================================
   ZOGAGA HOME - License Gate + Login v1.5
   - تحقق ذكي: فحص كامل كل 12 ساعة فقط، والباقي من الذاكرة (بدون نت)
   - إعادة محاولة تلقائية عند فشل السيرفر
   - جلسة دائمة (تستحمل أي Refresh) + قفل تلقائي بعد 30 دقيقة عدم نشاط
   - تفعيل بمفتاح + قفل جهاز + سماح أوفلاين 72 ساعة
   - شاشة انتهاء اشتراك احترافية: تظهر فورًا من الذاكرة (بدون وميض) + عد تنازلي
     + فحص صامت في الخلفية → لو اتجدد أو الإدارة عدلت التاريخ، يرجع يفتح لوحده
   ============================================ */

(function () {
  'use strict';

  const LICENSE_API = 'https://script.google.com/macros/s/AKfycbwOI1JExM6KE1k5Nd2x0AZqbd7FlRg_ba7p8BrXFwfJ38H1MsJP0mtmpG-e5Hod9Oy2/exec';

  const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;  // فحص كامل كل 12 ساعة — الباقي من الذاكرة
  const GRACE_MS = 72 * 60 * 60 * 1000;           // سماح أوفلاين: 72 ساعة
  const IDLE_LOCK_MS = 30 * 60 * 1000;            // قفل تلقائي بعد 30 دقيقة عدم نشاط
  const FETCH_TIMEOUT = 15000;
  const RETRY_DELAY = 1500;

  const LS_KEY = 'zg_license_key';
  const LS_FP = 'zg_device_fp';
  const LS_LAST = 'zg_last_check';
  const LS_STATUS = 'zg_last_status';   // نص آخر حالة ناجحة (نص الشريحة)
  const LS_PHASH = 'zg_pass_hash';      // بصمة كلمة المرور من آخر دخول ناجح (للأوفلاين فقط)
  const LS_SESSION = 'zg_session';      // الجلسة في localStorage — بتستحمل أي Refresh
  const LS_EXPIRED = 'zg_expired';      // تاريخ انتهاء معروف من فحص سابق (عشان الشاشة تظهر فورًا)

  let gate, licenseBox, gateMsg, gateKey, gateBtn, gateHint, licChip;
  let loginBox, loginMsg, loginPass, loginBtn, loginHint;
  let logoutBtn, logoutModal;
  let expiredOverlay, expiredWhen, expiredCountdown, expiredKey, expiredActivate, expiredHint, countdownTimer;
  let expiredAtMs = 0;
  let sessionActive = false;
  let idleTimer = null;
  let isFetching = false;

  function $(id) { return document.getElementById(id); }

  function bind(id, ev, fn) {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  }

  // --- بصمة الجهاز ---
  function hash32(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  function getDeviceFp() {
    let fp = localStorage.getItem(LS_FP);
    if (fp) return fp;
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    ].join('|');
    fp = 'zg-' + hash32(raw);
    localStorage.setItem(LS_FP, fp);
    return fp;
  }

  function fmtDays(ms) {
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  // --- شاشة انتهاء الاشتراك ---
  function showExpired(endsIso) {
    let expiredAt = null;
    if (endsIso) { try { expiredAt = new Date(endsIso); } catch (e) {} }
    if (!expiredAt || isNaN(expiredAt.getTime())) {
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      expiredAt = last ? new Date(last) : null;
    }
    expiredAtMs = expiredAt ? expiredAt.getTime() : 0;
    if (expiredWhen && expiredAt) {
      expiredWhen.textContent = 'انتهى في: ' + expiredAt.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (expiredKey) expiredKey.value = '';
    if (expiredHint) expiredHint.textContent = '';
    licenseBox.hidden = true;
    loginBox.hidden = true;
    if (expiredOverlay) expiredOverlay.hidden = false;
    document.body.classList.add('gate-open');
    startCountdown();
  }

  function hideExpired() {
    if (expiredOverlay) expiredOverlay.hidden = true;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function startCountdown() {
    if (countdownTimer) return;
    const tick = () => {
      if (!expiredAtMs) { if (expiredCountdown) expiredCountdown.textContent = ''; return; }
      const since = Date.now() - expiredAtMs;
      if (expiredCountdown) {
        expiredCountdown.innerHTML = '⏰ انتهى اشتراكك من <strong>' + fmtDays(since) + ' يوم</strong>';
      }
    };
    tick();
    countdownTimer = setInterval(tick, 60000);
  }

  const GATE_MESSAGES = {
    activate: 'هذا البرنامج خدمة اشتراك شهرية بقيمة <strong>19.99$</strong>.<br>للحصول على مفتاح التفعيل، تواصل مع الإدارة.',
    expired: '<strong>انتهى اشتراك البرنامج.</strong><br>للتجديد والحصول على مفتاح جديد، تواصل مع الإدارة.',
    suspended: '<strong>تم إيقاف الاشتراك مؤقتاً من الإدارة.</strong><br>تواصل مع الإدارة لمعرفة التفاصيل.',
    locked: '<strong>هذا المفتاح مرتبط بجهاز آخر.</strong><br>لنقل الترخيص لجهاز جديد، تواصل مع الإدارة.',
    invalid: '<strong>المفتاح غير صحيح.</strong><br>تأكد من كتابته بالظبط زي ما وصلك على البريد.',
    'error': '<strong>تعذر الاتصال بخادم التراخيص حاليًا.</strong><br>تأكد من الاتصال بالإنترنت وحاول تاني.'
  };

  const LOGIN_MSGS = {
    activated: 'تم تفعيل الترخيص بنجاح ✅<br>سجّل الدخول لبدء استخدام البرنامج',
    back: 'مرحبًا بيك تاني 👋<br>سجّل الدخول للمتابعة',
    loggedout: 'تم تسجيل الخروج بنجاح<br>سجّل الدخول من جديد للمتابعة',
    idle: 'تم قفل البرنامج تلقائيًا بعد فترة عدم نشاط 🔒<br>سجّل الدخول للمتابعة'
  };

  // --- الواجهات: ترخيص / دخول / مفتوح ---
  function openGate() {
    gate.hidden = false;
    document.body.classList.add('gate-open');
  }

  function showGate(mode, extraText) {
    licenseBox.hidden = false;
    loginBox.hidden = true;
    hideExpired();
    openGate();
    gateMsg.innerHTML = GATE_MESSAGES[mode] || GATE_MESSAGES.activate;
    gateHint.textContent = extraText || (mode === 'activate' ? 'أدخل المفتاح اللي وصلك على بريدك الإلكتروني' : '');
    gateBtn.disabled = false;
    gateBtn.textContent = 'تفعيل البرنامج';
  }

  function showLogin(mode) {
    licenseBox.hidden = true;
    loginBox.hidden = false;
    hideExpired();
    openGate();
    loginMsg.innerHTML = LOGIN_MSGS[mode] || LOGIN_MSGS.back;
    loginPass.value = '';
    loginHint.textContent = '';
    setTimeout(() => { try { loginPass.focus(); } catch (e) {} }, 60);
  }

  function unlockApp() {
    sessionActive = true;
    gate.hidden = true;
    hideExpired();
    document.body.classList.remove('gate-open');
    logoutBtn.hidden = false;
    resetIdle();
  }

  function lockApp(mode) {
    sessionActive = false;
    stopIdle();
    localStorage.removeItem(LS_SESSION);
    logoutBtn.hidden = true;
    if (logoutModal) logoutModal.hidden = true;
    showLogin(mode || 'back');
  }

  function updateChip(text) {
    if (!text) { licChip.hidden = true; return; }
    licChip.hidden = false;
    licChip.textContent = text;
  }

  function shakeLogin() {
    loginBox.classList.remove('shake');
    void loginBox.offsetWidth;
    loginBox.classList.add('shake');
  }

  // --- قفل تلقائي بعد عدم نشاط ---
  function resetIdle() {
    if (!sessionActive) return;
    stopIdle();
    idleTimer = setTimeout(() => {
      lockApp('idle');
    }, IDLE_LOCK_MS);
  }

  function stopIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, resetIdle, { passive: true });
  });

  // --- طلب HTTP مع مهلة + إعادة محاولة واحدة ---
  async function fetchWithRetry(url, options) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      try {
        const res = await fetch(url, { ...(options || {}), signal: controller.signal });
        clearTimeout(t);
        return res;
      } catch (e) {
        clearTimeout(t);
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  // --- حالة مخزنة (من آخر تحقق ناجح) ---
  function applyCachedState() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS_STATUS) || 'null'); } catch (e) {}
    const last = Number(localStorage.getItem(LS_LAST) || 0);
    const lastStr = last ? new Date(last).toLocaleString('ar-EG') : '';
    updateChip(cached && cached.remainingText ? cached.remainingText : 'الاشتراك مفعّل — آخر تحقق: ' + lastStr);
    scheduleRecheck();
    if (localStorage.getItem(LS_SESSION) === '1') { unlockApp(); } else { showLogin('back'); }
  }

  function saveSuccessState(data) {
    localStorage.setItem(LS_LAST, String(Date.now()));
    const remainingText = data.is_lifetime
      ? 'الاشتراك: مدى الحياة'
      : `الاشتراك ساري — متبقي ${data.days_left} يوم و ${data.hours_left} ساعة`;
    localStorage.setItem(LS_STATUS, JSON.stringify({ remainingText: remainingText }));
    updateChip(remainingText);
  }

  // --- التحقق من الترخيص ---
  async function verify(key, opts) {
    const isActivation = !!(opts && opts.activating);
    if (isActivation) {
      gateBtn.disabled = true;
      gateBtn.textContent = 'جاري التحقق...';
    }
    if (isFetching) return false;
    isFetching = true;

    const url = LICENSE_API + '?key=' + encodeURIComponent(key) + '&fp=' + encodeURIComponent(getDeviceFp());

    try {
      const res = await fetchWithRetry(url);
      const data = await res.json();

      if (data && data.status === 'active') {
        localStorage.removeItem(LS_EXPIRED);
        localStorage.setItem(LS_KEY, key);
        saveSuccessState(data);
        scheduleRecheck();
        // لو كنا عارفينه منتهي واتصلح — نطفي شاشة الانتهاء ونفتح عادي
        if (localStorage.getItem(LS_SESSION) === '1') { unlockApp(); }
        else { showLogin(isActivation ? 'activated' : 'back'); }
        return true;
      }

      if (data && data.status === 'expired') {
        localStorage.setItem(LS_EXPIRED, String(data.ends || ''));
        showExpired(data.ends);
        return false;
      }
      if (data && data.status === 'suspended') { showGate('suspended'); return false; }
      if (data && data.status === 'locked') { showGate('locked', data.message || ''); return false; }
      showGate('invalid'); return false;

    } catch (e) {
      // السيرفر رنح (404/بطء) أو الشبكة مقطوعة → نعتمد آخر تحقق ناجح خلال 72 ساعة
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      if (!isActivation && last && (Date.now() - last) < GRACE_MS) {
        applyCachedState();
        return true;
      }
      showGate('error');
      return false;
    } finally {
      isFetching = false;
      if (isActivation) { gateBtn.disabled = false; gateBtn.textContent = 'تفعيل البرنامج'; }
    }
  }

  // --- تفعيل مفتاح جديد من شاشة الانتهاء ---
  async function verifyForRenewal(key) {
    const url = LICENSE_API + '?key=' + encodeURIComponent(key) + '&fp=' + encodeURIComponent(getDeviceFp());
    try {
      const res = await fetchWithRetry(url);
      const data = await res.json();

      if (data && data.status === 'active') {
        localStorage.removeItem(LS_EXPIRED);
        localStorage.setItem(LS_KEY, key);
        saveSuccessState(data);
        scheduleRecheck();
        hideExpired();
        // الجلسة القديمة لسه شغالة؟ يفتح البرنامج من نفس النقطة على طول
        if (localStorage.getItem(LS_SESSION) === '1') {
          unlockApp();
        } else {
          showLogin('back');
        }
        return true;
      }

      if (data && data.status === 'expired') { if (expiredHint) expiredHint.textContent = 'هذا المفتاح منتهي كمان — اتأكد إنه المفتاح الجديد'; return false; }
      if (data && data.status === 'suspended') { if (expiredHint) expiredHint.textContent = 'هذا المفتاح موقوف من الإدارة'; return false; }
      if (data && data.status === 'locked') { if (expiredHint) expiredHint.textContent = 'هذا المفتاح مرتبط بجهاز آخر'; return false; }
      if (expiredHint) expiredHint.textContent = 'المفتاح غير صحيح — تأكد من كتابته بالظبط';
      return false;

    } catch (e) {
      if (expiredHint) expiredHint.textContent = 'تعذر الاتصال بالخادم — اتأكد من الإنترنت وحاول تاني';
      return false;
    }
  }

  function activate() {
    const key = gateKey.value.trim().toUpperCase();
    if (!key) { gateHint.textContent = 'اكتب مفتاح التفعيل الأول'; return; }
    verify(key, { activating: true });
  }

  // --- فحص ذكي عند فتح البرنامج ---
  function bootVerify(key) {
    const last = Number(localStorage.getItem(LS_LAST) || 0);
    // عارفين من فحص سابق إن الترخيص منتهي؟ شاشة الانتهاء فورًا (بدون وميض)
    // + فحص صامت في الخلفية: لو الإدارة عدلت التاريخ أو اتجدد → يرجع يفتح لوحده
    const knownExpired = localStorage.getItem(LS_EXPIRED);
    if (knownExpired) {
      showExpired(knownExpired);
      verify(key);
      return;
    }
    // آخر تحقق حديث؟ نفتح فورًا من غير نت خالص
    if (last && (Date.now() - last) < CHECK_INTERVAL_MS) {
      applyCachedState();
      return;
    }
    verify(key);
  }

  // --- الدخول ---
  async function tryLogin() {
    const pass = loginPass.value.trim();
    if (!pass) { loginHint.textContent = 'اكتب كلمة المرور الأول'; return; }

    loginBtn.disabled = true;
    loginBtn.textContent = 'جاري التحقق...';

    let outcome = 'fail';           // fail | ok | offline-ok
    let reachable = true;

    try {
      const res = await fetchWithRetry(LICENSE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verifyLogin', password: pass })
      });
      const data = await res.json();
      if (data && data.valid === true) outcome = 'ok';
    } catch (e) {
      // السيرفر رنح أو الشبكة مقطوعة → fallback محلي
      reachable = false;
    }

    if (outcome === 'fail' && !reachable) {
      const savedHash = localStorage.getItem(LS_PHASH);
      if (savedHash && savedHash === hash32(pass + '|' + getDeviceFp())) {
        outcome = 'offline-ok';
      }
    }

    loginBtn.disabled = false;
    loginBtn.textContent = 'دخول';

    if (outcome === 'ok') {
      localStorage.setItem(LS_PHASH, hash32(pass + '|' + getDeviceFp()));
      localStorage.setItem(LS_SESSION, '1');
      unlockApp();
    } else if (outcome === 'offline-ok') {
      localStorage.setItem(LS_SESSION, '1');
      unlockApp();
      updateChip('وضع أوفلاين — تم الدخول من الذاكرة المحلية');
    } else {
      loginHint.textContent = reachable
        ? 'كلمة المرور غير صحيحة'
        : 'تعذر الاتصال بالخادم — ولم يُسجل دخول ناجح قبل كده على الجهاز ده';
      shakeLogin();
    }
  }

  // --- الخروج ---
  function requestLogout() {
    if (logoutModal) logoutModal.hidden = false;
  }

  function closeLogoutModal() {
    if (logoutModal) logoutModal.hidden = true;
  }

  function confirmLogout() {
    lockApp('loggedout');
  }

  // --- فحص دوري: كل 30 دقيقة بيقارن، والفحص الفعلي كل 12 ساعة ---
  function scheduleRecheck() {
    if (scheduleRecheck._t) return;
    scheduleRecheck._t = setInterval(() => {
      const k = localStorage.getItem(LS_KEY);
      if (!k) return;
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      if ((Date.now() - last) >= CHECK_INTERVAL_MS) verify(k);
    }, 30 * 60 * 1000);
  }

  function init() {
    gate = $('licenseGate');
    licenseBox = $('licenseBox');
    gateMsg = $('gateMsg');
    gateKey = $('gateKey');
    gateBtn = $('gateBtn');
    gateHint = $('gateHint');
    licChip = $('licChip');
    loginBox = $('loginBox');
    loginMsg = $('loginMsg');
    loginPass = $('loginPass');
    loginBtn = $('loginBtn');
    loginHint = $('loginHint');
    logoutBtn = $('logoutBtn');
    logoutModal = $('logoutModal');
    expiredOverlay = $('expiredOverlay');
    expiredWhen = $('expiredWhen');
    expiredCountdown = $('expiredCountdown');
    expiredKey = $('expiredKey');
    expiredActivate = $('expiredActivate');
    expiredHint = $('expiredHint');
    if (!gate) return;

    openGate();

    bind('gateContact', 'click', (e) => {
      e.preventDefault();
      window.open('https://axentro.site/links.html', '_blank');
    });
    bind('gateBtn', 'click', activate);
    bind('gateKey', 'keydown', (e) => { if (e.key === 'Enter') activate(); });

    bind('loginBtn', 'click', tryLogin);
    bind('loginPass', 'keydown', (e) => { if (e.key === 'Enter') tryLogin(); });

    bind('logoutBtn', 'click', requestLogout);
    bind('logoutYes', 'click', confirmLogout);
    bind('logoutNo', 'click', closeLogoutModal);

    bind('expiredActivate', 'click', async () => {
      const key = (expiredKey ? expiredKey.value : '').trim().toUpperCase();
      if (!key) { if (expiredHint) expiredHint.textContent = 'اكتب مفتاح الترخيص الجديد الأول'; return; }
      if (expiredActivate) { expiredActivate.disabled = true; expiredActivate.textContent = 'جاري التحقق...'; }
      await verifyForRenewal(key);
      if (expiredActivate) { expiredActivate.disabled = false; expiredActivate.textContent = 'تفعيل الاشتراك الجديد'; }
    });
    bind('expiredKey', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (expiredActivate) expiredActivate.click(); } });
    bind('expiredContact', 'click', (e) => {
      e.preventDefault();
      window.open('https://axentro.site/links.html', '_blank');
    });

    const savedKey = localStorage.getItem(LS_KEY);
    if (savedKey) {
      bootVerify(savedKey);
    } else {
      showGate('activate');
    }

    // أول ما النت يرجع → لو الفحص مستحق، نعمله فورًا
    window.addEventListener('online', () => {
      const k = localStorage.getItem(LS_KEY);
      if (!k) return;
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      if ((Date.now() - last) >= CHECK_INTERVAL_MS) verify(k);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

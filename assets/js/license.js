/* ============================================
   ZOGAGA HOME - License Gate + Login v1.1
   تفعيل بمفتاح + قفل جهاز + سماح أوفلاين 72 ساعة
   + شاشة دخول بكلمة مرور + خروج بتأكيد مخصص
   ============================================ */

(function () {
  'use strict';

  const LICENSE_API = 'https://script.google.com/macros/s/AKfycbwOI1JExM6KE1k5Nd2x0AZqbd7FlRg_ba7p8BrXFwfJ38H1MsJP0mtmpG-e5Hod9Oy2/exec';
  const LOGIN_PASSWORD = '1407'; // مؤقت — هنتنقل لتحقق من السيرفر في خطوة جاية
  const GRACE_MS = 72 * 60 * 60 * 1000;      // سماح أوفلاين: 72 ساعة
  const RECHECK_MS = 6 * 60 * 60 * 1000;     // إعادة تحقق كل 6 ساعات والبرنامج مفتوح
  const FETCH_TIMEOUT = 15000;               // GAS بيبقى بطيء أول استدعاء — مبنخليش 10 ثواني

  const LS_KEY = 'zg_license_key';
  const LS_FP = 'zg_device_fp';
  const LS_LAST = 'zg_last_check';
  const SS_SESSION = 'zg_session';

  let gate, licenseBox, gateMsg, gateKey, gateBtn, gateHint, licChip;
  let loginBox, loginPass, loginBtn, loginHint;
  let logoutBtn, logoutModal;

  function $(id) { return document.getElementById(id); }

  // --- بصمة الجهاز (ثابتة على نفس الجهاز) ---
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

  const GATE_MESSAGES = {
    activate: 'هذا البرنامج خدمة اشتراك شهرية بقيمة <strong>19.99$</strong>.<br>للحصول على مفتاح التفعيل، تواصل مع الإدارة.',
    expired: '<strong>انتهى اشتراك البرنامج.</strong><br>للتجديد والحصول على مفتاح جديد، تواصل مع الإدارة.',
    suspended: '<strong>تم إيقاف الاشتراك مؤقتاً من الإدارة.</strong><br>تواصل مع الإدارة لمعرفة التفاصيل.',
    locked: '<strong>هذا المفتاح مرتبط بجهاز آخر.</strong><br>لنقل الترخيص لجهاز جديد، تواصل مع الإدارة.',
    invalid: '<strong>المفتاح غير صحيح.</strong><br>تأكد من كتابته بالظبط زي ما وصلك على البريد.',
    'error': '<strong>حدث خطأ في التحقق.</strong><br>حاول تاني، ولو استمرت المشكلة تواصل مع الإدارة.',
    'offline-locked': '<strong>لا يوجد اتصال بالإنترنت، ومرت أكثر من 72 ساعة على آخر تحقق ناجح.</strong><br>اتصل بالإنترنت وحدّث الصفحة.'
  };

  // --- إدارة الواجهات الثلاث: ترخيص / دخول / مفتوح ---
  function openGate() {
    gate.hidden = false;
    document.body.classList.add('gate-open');
  }

  function showGate(mode, extraText) {
    licenseBox.hidden = false;
    loginBox.hidden = true;
    openGate();
    gateMsg.innerHTML = GATE_MESSAGES[mode] || GATE_MESSAGES.activate;
    gateHint.textContent = extraText || (mode === 'activate' ? 'أدخل المفتاح اللي وصلك على بريدك الإلكتروني' : '');
    gateBtn.disabled = false;
    gateBtn.textContent = 'تفعيل البرنامج';
  }

  function showLogin() {
    licenseBox.hidden = true;
    loginBox.hidden = false;
    openGate();
    loginPass.value = '';
    loginHint.textContent = '';
    setTimeout(() => { try { loginPass.focus(); } catch (e) {} }, 60);
  }

  function unlockApp() {
    gate.hidden = true;
    document.body.classList.remove('gate-open');
    logoutBtn.hidden = false;
  }

  function updateChip(text) {
    if (!text) { licChip.hidden = true; return; }
    licChip.hidden = false;
    licChip.textContent = text;
  }

  // --- التحقق من الترخيص ---
  async function verify(key, opts) {
    const isActivation = !!(opts && opts.activating);
    if (isActivation) {
      gateBtn.disabled = true;
      gateBtn.textContent = 'جاري التحقق...';
    }

    const url = LICENSE_API + '?key=' + encodeURIComponent(key) + '&fp=' + encodeURIComponent(getDeviceFp());
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      const data = await res.json();

      if (data && data.status === 'active') {
        localStorage.setItem(LS_KEY, key);
        localStorage.setItem(LS_LAST, String(Date.now()));
        const remaining = data.is_lifetime
          ? 'الاشتراك: مدى الحياة'
          : `الاشتراك ساري — متبقي ${data.days_left} يوم و ${data.hours_left} ساعة`;
        updateChip(remaining);
        scheduleRecheck();
        if (sessionStorage.getItem(SS_SESSION) === '1') { unlockApp(); } else { showLogin(); }
        return true;
      }

      if (data && data.status === 'expired') { showGate('expired', isActivation ? 'هذا المفتاح انتهت مدته.' : ''); return false; }
      if (data && data.status === 'suspended') { showGate('suspended'); return false; }
      if (data && data.status === 'locked') { showGate('locked', data.message || ''); return false; }
      showGate('invalid'); return false;

    } catch (e) {
      clearTimeout(t);
      // الشبكة مقطوعة أو السيرفر بطيء — سماح الـ 72 ساعة
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      if (!isActivation && last && (Date.now() - last) < GRACE_MS) {
        const lastDate = new Date(last).toLocaleString('ar-EG');
        updateChip('وضع أوفلاين — آخر تحقق ناجح: ' + lastDate);
        scheduleRecheck();
        if (sessionStorage.getItem(SS_SESSION) === '1') { unlockApp(); } else { showLogin(); }
        return true;
      }
      showGate(isActivation ? 'error' : 'offline-locked');
      return false;
    } finally {
      if (isActivation) { gateBtn.disabled = false; gateBtn.textContent = 'تفعيل البرنامج'; }
    }
  }

  function activate() {
    const key = gateKey.value.trim().toUpperCase();
    if (!key) { gateHint.textContent = 'اكتب مفتاح التفعيل الأول'; return; }
    verify(key, { activating: true });
  }

  // --- الدخول والخروج ---
  function tryLogin() {
    const pass = loginPass.value.trim();
    if (!pass) { loginHint.textContent = 'اكتب كلمة المرور الأول'; return; }
    if (pass === LOGIN_PASSWORD) {
      sessionStorage.setItem(SS_SESSION, '1');
      unlockApp();
    } else {
      loginHint.textContent = 'كلمة المرور غير صحيحة';
      loginBox.classList.remove('shake');
      void loginBox.offsetWidth;
      loginBox.classList.add('shake');
    }
  }

  function requestLogout() {
    logoutModal.hidden = false;
  }

  function closeLogoutModal() {
    logoutModal.hidden = true;
  }

  function confirmLogout() {
    sessionStorage.removeItem(SS_SESSION);
    logoutBtn.hidden = true;
    closeLogoutModal();
    showLogin();
  }

  function scheduleRecheck() {
    if (scheduleRecheck._t) return;
    scheduleRecheck._t = setInterval(() => {
      const k = localStorage.getItem(LS_KEY);
      if (k) verify(k);
    }, RECHECK_MS);
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
    loginPass = $('loginPass');
    loginBtn = $('loginBtn');
    loginHint = $('loginHint');
    logoutBtn = $('logoutBtn');
    logoutModal = $('logoutModal');
    if (!gate) return;

    openGate(); // البوابة ظاهرة افتراضياً في HTML — نقفل سكرول الخلفية من البداية

    $('gateContact').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://axentro.site/links.html', '_blank');
    });
    gateBtn.addEventListener('click', activate);
    gateKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });

    loginBtn.addEventListener('click', tryLogin);
    loginPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });

    logoutBtn.addEventListener('click', requestLogout);
    $('logoutYes').addEventListener('click', confirmLogout);
    $('logoutNo').addEventListener('click', closeLogoutModal);

    const savedKey = localStorage.getItem(LS_KEY);
    if (savedKey) {
      verify(savedKey);
    } else {
      showGate('activate');
    }

    // أول ما النت يرجع → تحقق فوري
    window.addEventListener('online', () => {
      const k = localStorage.getItem(LS_KEY);
      if (k) verify(k);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

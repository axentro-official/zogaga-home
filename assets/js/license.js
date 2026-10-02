/* ============================================
   ZOGAGA HOME - License Gate v1.0
   تفعيل بمفتاح + قفل جهاز + سماح أوفلاين 72 ساعة
   ============================================ */

(function () {
  'use strict';

  const LICENSE_API = 'https://script.google.com/macros/s/AKfycbwOI1JExM6KE1k5Nd2x0AZqbd7FlRg_ba7p8BrXFwfJ38H1MsJP0mtmpG-e5Hod9Oy2/exec';
  const GRACE_MS = 72 * 60 * 60 * 1000;      // سماح أوفلاين: 72 ساعة
  const RECHECK_MS = 6 * 60 * 60 * 1000;     // إعادة تحقق كل 6 ساعات والبرنامج مفتوح
  const FETCH_TIMEOUT = 10000;

  const LS_KEY = 'zg_license_key';
  const LS_FP = 'zg_device_fp';
  const LS_LAST = 'zg_last_check';

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

  // --- عناصر الواجهة ---
  let gate, gateMsg, gateKey, gateBtn, gateHint, licChip;

  function $(id) { return document.getElementById(id); }

  const GATE_MESSAGES = {
    activate: 'هذا البرنامج خدمة اشتراك شهرية بقيمة <strong>19.99$</strong>.<br>للحصول على مفتاح التفعيل، تواصل مع الإدارة.',
    expired: '<strong>انتهى اشتراك البرنامج.</strong><br>للتجديد والحصول على مفتاح جديد، تواصل مع الإدارة.',
    suspended: '<strong>تم إيقاف الاشتراك مؤقتاً من الإدارة.</strong><br>تواصل مع الإدارة لمعرفة التفاصيل.',
    locked: '<strong>هذا المفتاح مرتبط بجهاز آخر.</strong><br>لنقل الترخيص لجهاز جديد، تواصل مع الإدارة.',
    invalid: '<strong>المفتاح غير صحيح.</strong><br>تأكد من كتابته بالظبط زي ما وصلك على البريد.',
    'error': '<strong>حدث خطأ في التحقق.</strong><br>حاول تاني، ولو استمرت المشكلة تواصل مع الإدارة.',
    'offline-locked': '<strong>لا يوجد اتصال بالإنترنت، ومرت أكثر من 72 ساعة على آخر تحقق ناجح.</strong><br>اتصل بالإنترنت وحدّث الصفحة.'
  };

  function showGate(mode, extraText) {
    gate.hidden = false;
    gateMsg.innerHTML = GATE_MESSAGES[mode] || GATE_MESSAGES.activate;
    gateHint.textContent = extraText || (mode === 'activate' ? 'أدخل المفتاح اللي وصلك على بريدك الإلكتروني' : '');
    gateBtn.disabled = false;
    gateBtn.textContent = 'تفعيل البرنامج';
  }

  function hideGate() {
    gate.hidden = true;
  }

  function setChecking() {
    gateBtn.disabled = true;
    gateBtn.textContent = 'جاري التحقق...';
  }

  function updateChip(text) {
    if (!text) { licChip.hidden = true; return; }
    licChip.hidden = false;
    licChip.textContent = text;
  }

  // --- التحقق من الترخيص ---
  async function verify(key, opts) {
    const isActivation = !!(opts && opts.activating);
    if (isActivation) setChecking();

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
        hideGate();
        const remaining = data.is_lifetime
          ? 'الاشتراك: مدى الحياة'
          : `الاشتراك ساري — متبقي ${data.days_left} يوم و ${data.hours_left} ساعة`;
        updateChip(remaining);
        scheduleRecheck();
        return true;
      }

      if (data && data.status === 'expired') { showGate('expired', isActivation ? 'هذا المفتاح انتهت مدته.' : ''); return false; }
      if (data && data.status === 'suspended') { showGate('suspended'); return false; }
      if (data && data.status === 'locked') { showGate('locked', data.message || ''); return false; }
      showGate('invalid'); return false;

    } catch (e) {
      clearTimeout(t);
      // الشبكة مقطوعة — نطبق سماح الـ 72 ساعة
      const last = Number(localStorage.getItem(LS_LAST) || 0);
      if (!isActivation && last && (Date.now() - last) < GRACE_MS) {
        hideGate();
        const lastDate = new Date(last).toLocaleString('ar-EG');
        updateChip('وضع أوفلاين — آخر تحقق ناجح: ' + lastDate);
        scheduleRecheck();
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

  function scheduleRecheck() {
    if (scheduleRecheck._t) return;
    scheduleRecheck._t = setInterval(() => {
      const k = localStorage.getItem(LS_KEY);
      if (k) verify(k);
    }, RECHECK_MS);
  }

  function init() {
    gate = $('licenseGate');
    gateMsg = $('gateMsg');
    gateKey = $('gateKey');
    gateBtn = $('gateBtn');
    gateHint = $('gateHint');
    licChip = $('licChip');
    if (!gate) return;

    $('gateContact').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://axentro.site/links.html', '_blank');
    });
    gateBtn.addEventListener('click', activate);
    gateKey.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') activate();
    });

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

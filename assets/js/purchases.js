/* ============================================
   ZOGAGA HOME - فواتير الشراء v1.1
   - رقم تلقائي PUR-YYYY-00001 (لا يتكرر أبدًا)
   - المورد اختياري: يُكتب أو يُختار، ويُحفظ تلقائيًا في الموردين
   - خطوط أصناف: بحث ذكي (موجود يتأثر / جديد يتولد من الفاتورة)
   - كميات 3 خانات (كبير/وسطى/قطعة) بتحويل تلقائي بعوامل الصنف
   - شراء جملة/قطاعي بملء السعر تلقائي + خصم لكل صنف (% أو مبلغ)
   - خصم إجمالي (% أو مبلغ) + تفقيط عربي كامل
   - الحفظ: مخزون + متوسط مرجح + سجل تدقيق
   - عرض + طباعة حراري 80mm / A4 بباركود الفاتورة
   ============================================ */

(function () {
  'use strict';

  let inv = null;          // الفاتورة الجارية
  let curLine = null;      // الخط الجاري تحريره
  let invoices = [];
  let confirmAction = null;

  function $(id) { return document.getElementById(id); }
  function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function normAr(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ').trim();
  }

  // ===== تفقيط عربي =====
  const ONES = ['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
  const HUND = ['','مئة','مئتان','ثلاثمئة','أربعمئة','خمسمئة','ستمئة','سبعمئة','ثمانمئة','تسعمئة'];
  const TENS = ['','عشرة','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
  function three(n) {
    let s = ''; const h = Math.floor(n / 100), r = n % 100;
    if (h) s += HUND[h];
    if (r) { if (s) s += ' و'; if (r < 20) s += ONES[r]; else { const o = r % 10; s += (o ? ONES[o] + ' و' : '') + TENS[Math.floor(r / 10)]; } }
    return s;
  }
  function tafqeetInt(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'صفر';
    const parts = [];
    const m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000;
    if (m) parts.push(m === 1 ? 'مليون' : (m === 2 ? 'مليونان' : three(m) + ' مليون'));
    if (t) parts.push(t === 1 ? 'ألف' : (t === 2 ? 'ألفان' : three(t) + ' ألف'));
    if (r) parts.push(three(r));
    return parts.join(' و');
  }
  function tafqeetMoney(v) {
    const p = Math.round(v * 100), g = Math.floor(p / 100), q = p % 100;
    let s = tafqeetInt(g) + ' جنيه';
    if (q) s += ' و ' + tafqeetInt(q) + ' قرش';
    return s + ' فقط لا غير';
  }

  // ===== رقم الفاتورة (تسلسل سنوي لا يتكرر) =====
  async function reserveNumber() {
    const y = new Date().getFullYear();
    let seq = await DB.getSetting('pur_seq');
    if (!seq || seq.y !== y) seq = { y: y, n: 0 };
    seq.n++;
    await DB.setSetting('pur_seq', seq);
    return 'PUR-' + y + '-' + String(seq.n).padStart(5, '0');
  }

  // ===== حساب القطع من الخانات الثلاثة =====
  function linePieces(l) {
    const sps = toNum(l.sps), spc = toNum(l.spc);
    const mid = !!(l.unit_mid && l.unit_mid.trim());
    const top = !!(l.unit_top && l.unit_top.trim());
    let p = toNum(l.qty_pieces);
    if (mid && top) p += toNum(l.qty_top) * spc * sps + toNum(l.qty_mid) * sps;
    else if (top)   p += toNum(l.qty_top) * spc;
    else if (mid)   p += toNum(l.qty_mid) * sps;
    return Math.round(p);
  }

  function lineTotal(l) {
    const gross = linePieces(l) * toNum(l.unit_price);
    let disc = 0;
    if (l.disc_type === 'pct') disc = gross * toNum(l.disc_value) / 100;
    else disc = toNum(l.disc_value);
    return Math.max(0, r2(gross - disc));
  }

  function invTotals() {
    const before = inv.lines.reduce((s, l) => s + lineTotal(l), 0);
    let disc = 0;
    if (inv.disc_type === 'pct') disc = before * toNum(inv.disc_value) / 100;
    else disc = toNum(inv.disc_value);
    disc = Math.min(disc, before);
    return { before: r2(before), disc: r2(disc), after: r2(before - disc) };
  }

  // ===== فتح فاتورة جديدة =====
  async function openNew() {
    const number = await reserveNumber();
    inv = {
      number: number,
      date: new Date().toISOString().slice(0, 10),
      supplier_name: '', supplier_phone: '',
      lines: [], disc_type: 'amt', disc_value: 0, disc_input: '0',
      created_at: Date.now()
    };
    curLine = null;
    renderForm();
    $('purModal').hidden = false;
  }

  // ===== واجهة الفاتورة =====
  function renderForm() {
    const body = $('purBody');
    body.replaceChildren();

    const head = document.createElement('div');
    head.className = 'inv-head';
    head.innerHTML =
      '<div class="inv-num"><span class="sku-chip">' + esc(inv.number) + '</span>' +
      '<span class="inv-date-lbl">التاريخ</span><input type="date" id="purDate" class="f-input f-date" value="' + esc(inv.date) + '"></div>';
    body.appendChild(head);

    const sup = document.createElement('div');
    sup.className = 'f-row';
    sup.innerHTML =
      '<div class="f-col"><label class="f-label">اسم المورد (اختياري)</label>' +
      '<input id="purSupName" class="f-input" list="supListDL" value="' + esc(inv.supplier_name) + '" placeholder="سيبها فاضي لو مش عارفه">' +
      '<datalist id="supListDL"></datalist></div>' +
      '<div class="f-col"><label class="f-label">تليفون المورد</label>' +
      '<input id="purSupPhone" class="f-input" value="' + esc(inv.supplier_phone) + '" placeholder="اختياري"></div>';
    body.appendChild(sup);

    body.appendChild(mkLineEditor());

    const linesBox = document.createElement('div');
    linesBox.id = 'purLines';
    linesBox.className = 'pur-lines';
    body.appendChild(linesBox);

    const totals = document.createElement('div');
    totals.className = 'pur-totals';
    totals.innerHTML =
      '<div class="f-row">' +
      '<div class="f-col"><label class="f-label">خصم على الفاتورة</label>' +
      '<div class="disc-wrap"><input id="purDiscVal" class="f-input" type="number" min="0" step="0.25" value="' + esc(inv.disc_input) + '">' +
      '<select id="purDiscType" class="f-input f-sel"><option value="amt">جنيه</option><option value="pct">%</option></select></div></div>' +
      '<div class="f-col" id="purTotalsBox"></div></div>' +
      '<p id="purTafqeet" class="tafqeet"></p>' +
      '<p id="purHint" class="gate-hint"></p>' +
      '<div class="modal-actions">' +
      '<button id="purSaveBtn" class="btn-save" type="button">💾 حفظ الفاتورة وتحديث المخزون</button>' +
      '<button id="purCancelBtn" class="btn-cancel" type="button">إلغاء</button></div>';
    body.appendChild(totals);

    fillSupDatalist();
    bindForm();
    renderLines();
    renderTotals();
  }

  async function fillSupDatalist() {
    const sups = await DB.all('suppliers');
    const dl = $('supListDL');
    if (!dl) return;
    dl.replaceChildren();
    sups.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.name;
      dl.appendChild(o);
    });
  }

  function bindForm() {
    $('purDate').addEventListener('change', (e) => { inv.date = e.target.value; });
    $('purSupName').addEventListener('input', async (e) => {
      inv.supplier_name = e.target.value;
      const sups = await DB.all('suppliers');
      const hit = sups.find((s) => normAr(s.name) === normAr(e.target.value));
      if (hit && hit.phone) { $('purSupPhone').value = hit.phone; inv.supplier_phone = hit.phone; }
    });
    $('purSupPhone').addEventListener('input', (e) => { inv.supplier_phone = e.target.value; });
    $('purDiscVal').addEventListener('input', (e) => { inv.disc_input = e.target.value; inv.disc_value = toNum(e.target.value); renderTotals(); });
    $('purDiscType').addEventListener('change', (e) => { inv.disc_type = e.target.value; renderTotals(); });
    $('purCancelBtn').addEventListener('click', closePur);
    $('purSaveBtn').addEventListener('click', saveInvoice);
  }

  function closePur() { $('purModal').hidden = true; inv = null; curLine = null; loadInvoices(); }

  // ===== محرر خط الصنف =====
  function mkLineEditor() {
    const box = document.createElement('div');
    box.className = 'line-editor';
    box.innerHTML =
      '<label class="f-label">ابحث عن صنف موجود — أو اكتب اسم صنف جديد</label>' +
      '<div class="search-wrap"><input id="lnSearch" class="search-input" placeholder="اكتب أول حرفين..." autocomplete="off">' +
      '<div id="lnDrop" class="ln-drop" hidden></div></div>' +
      '<div id="lnFields"></div>';
    return box;
  }

  function bindSearch() {
    const inp = $('lnSearch');
    inp.addEventListener('input', async () => {
      const q = normAr(inp.value);
      const drop = $('lnDrop');
      if (!q) { drop.hidden = true; return; }
      const all = await DB.all('items');
      const hits = all.filter((it) =>
        normAr(it.name).includes(q) ||
        (it.synonyms || []).some((s) => normAr(s).includes(q)) ||
        normAr(it.sku).includes(q) || normAr(it.barcode).includes(q)
      ).slice(0, 8);
      drop.replaceChildren();
      hits.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ln-opt';
        b.innerHTML = '<b>' + esc(it.name) + '</b> <span class="sku-chip">' + esc(it.sku || '') + '</span> <span class="item-syn">' + stockTextShort(it) + '</span>';
        b.addEventListener('click', () => pickExisting(it));
        drop.appendChild(b);
      });
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.className = 'ln-opt new';
      nb.textContent = '➕ إنشاء صنف جديد باسم: ' + inp.value.trim();
      nb.addEventListener('click', () => pickNew(inp.value.trim()));
      drop.appendChild(nb);
      drop.hidden = false;
    });
  }

  function stockTextShort(it) {
    let p = it.stock_pieces || 0;
    const sps = it.pieces_per_sheila || 0, spc = it.sheilas_per_carton || 0;
    const out = [];
    if (spc > 0 && sps > 0) { const c = Math.floor(p / (sps * spc)); if (c) { out.push(c + ' ' + (it.unit_top || 'كرتونة')); p -= c * sps * spc; } }
    if (sps > 0) { const s = Math.floor(p / sps); if (s) { out.push(s + ' ' + (it.unit_mid || '')); p -= s * sps; } }
    out.push(p + ' قطعة');
    return out.join('+');
  }

  function pickExisting(it) {
    curLine = {
      existing_id: it.id, name: it.name, sku: it.sku,
      synonyms: it.synonyms || [],
      unit_mid: it.unit_mid || '', unit_top: it.unit_top || '',
      sps: it.pieces_per_sheila || 0, spc: it.sheilas_per_carton || 0,
      qty_top: '', qty_mid: '', qty_pieces: '',
      buy_type: 'wholesale',
      unit_price: it.buy_wholesale || it.buy_retail || 0,
      disc_type: 'amt', disc_value: 0
    };
    $('lnDrop').hidden = true;
    renderLineFields();
  }

  function pickNew(name) {
    curLine = {
      existing_id: null, name: name, sku: '',
      synonyms: [], unit_mid: 'شيالة', unit_top: 'كرتونة',
      sps: '', spc: '', qty_top: '', qty_mid: '', qty_pieces: '',
      buy_type: 'wholesale', unit_price: '',
      sell_retail: '', sell_wholesale: '', min_stock: '',
      disc_type: 'amt', disc_value: 0, is_new: true
    };
    $('lnDrop').hidden = true;
    renderLineFields();
  }

  function renderLineFields() {
    const box = $('lnFields');
    box.replaceChildren();
    if (!curLine) return;

    const info = document.createElement('div');
    info.className = 'ln-head';
    info.innerHTML = '<b>' + esc(curLine.name) + '</b> ' +
      (curLine.existing_id ? '<span class="sku-chip">' + esc(curLine.sku) + '</span> <span class="item-syn">صنف موجود — هيضاف عليه</span>'
                           : '<span class="sku-chip">صنف جديد — هيتولد مع الحفظ</span>');
    box.appendChild(info);

    if (curLine.is_new) {
      const f1 = document.createElement('div');
      f1.className = 'f-row';
      f1.innerHTML =
        '<div class="f-col"><label class="f-label">مرادفات (فاصلة بينهم)</label><input id="nl_syn" class="f-input" placeholder="استكانة, استكان"></div>' +
        '<div class="f-col"><label class="f-label">حد أدنى للمخزون</label><input id="nl_min" class="f-input" type="number" min="0" value="0"></div>';
      box.appendChild(f1);

      const f2 = document.createElement('div');
      f2.className = 'f-row';
      f2.innerHTML =
        '<div class="f-col"><label class="f-label">اسم الوحدة الوسطى (اختياري)</label><input id="nl_umid" class="f-input" value="شيالة"></div>' +
        '<div class="f-col"><label class="f-label">اسم الوحدة الكبيرة (اختياري)</label><input id="nl_utop" class="f-input" value="كرتونة"></div>';
      box.appendChild(f2);

      const f3 = document.createElement('div');
      f3.className = 'f-row';
      f3.innerHTML =
        '<div class="f-col"><label class="f-label" id="nl_sps_l">قطع في الوسطى</label><input id="nl_sps" class="f-input" type="number" min="0"></div>' +
        '<div class="f-col"><label class="f-label" id="nl_spc_l">عدد الوسطى في الكبيرة</label><input id="nl_spc" class="f-input" type="number" min="0"></div>';
      box.appendChild(f3);

      const f4 = document.createElement('div');
      f4.className = 'f-row';
      f4.innerHTML =
        '<div class="f-col"><label class="f-label">سعر بيع قطاعي *</label><input id="nl_retail" class="f-input" type="number" min="0" step="0.25"></div>' +
        '<div class="f-col"><label class="f-label">سعر بيع جملة</label><input id="nl_wholesale" class="f-input" type="number" min="0" step="0.25"></div>';
      box.appendChild(f4);

      ['nl_umid', 'nl_utop'].forEach((id) => $(id).addEventListener('input', updateNewLabels));
    }

    const qt = document.createElement('div');
    qt.className = 'f-row qty3';
    const lblMid = curLine.unit_mid ? 'كمية ' + curLine.unit_mid : 'كمية وسطى';
    const lblTop = curLine.unit_top ? 'كمية ' + curLine.unit_top : 'كمية كبيرة';
    qt.innerHTML =
      '<div class="f-col"><label class="f-label">' + esc(lblTop) + '</label><input id="ql_top" class="f-input" type="number" min="0" step="1" value="' + esc(curLine.qty_top) + '"></div>' +
      '<div class="f-col"><label class="f-label">' + esc(lblMid) + '</label><input id="ql_mid" class="f-input" type="number" min="0" step="1" value="' + esc(curLine.qty_mid) + '" ' + (curLine.unit_mid ? '' : 'disabled') + '></div>' +
      '<div class="f-col"><label class="f-label">قطعة</label><input id="ql_pcs" class="f-input" type="number" min="0" step="1" value="' + esc(curLine.qty_pieces) + '"></div>';
    box.appendChild(qt);

    const pr = document.createElement('div');
    pr.className = 'f-row';
    pr.innerHTML =
      '<div class="f-col"><label class="f-label">نوع الشراء</label>' +
      '<div class="disc-wrap"><select id="ql_btype" class="f-input f-sel">' +
      '<option value="wholesale"' + (curLine.buy_type === 'wholesale' ? ' selected' : '') + '>جملة</option>' +
      '<option value="retail"' + (curLine.buy_type === 'retail' ? ' selected' : '') + '>قطاعي</option></select>' +
      '<input id="ql_price" class="f-input" type="number" min="0" step="0.25" value="' + esc(curLine.unit_price) + '" placeholder="سعر الشراء"></div></div>' +
      '<div class="f-col"><label class="f-label">خصم السطر</label>' +
      '<div class="disc-wrap"><input id="ql_disc" class="f-input" type="number" min="0" step="0.25" value="' + esc(curLine.disc_value) + '">' +
      '<select id="ql_dtype" class="f-input f-sel"><option value="amt"' + (curLine.disc_type === 'amt' ? ' selected' : '') + '>جنيه</option><option value="pct"' + (curLine.disc_type === 'pct' ? ' selected' : '') + '>%</option></select></div></div>';
    box.appendChild(pr);

    const live = document.createElement('p');
    live.className = 'ln-live';
    live.id = 'lnLive';
    box.appendChild(live);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-save';
    add.textContent = '➕ إضافة السطر للفاتورة';
    add.addEventListener('click', addLine);
    box.appendChild(add);

    ['ql_top', 'ql_mid', 'ql_pcs', 'ql_price', 'ql_disc', 'ql_dtype'].forEach((id) => {
      $(id).addEventListener('input', updateLineLive);
      $(id).addEventListener('change', updateLineLive);
    });
    $('ql_btype').addEventListener('change', (e) => {
      curLine.buy_type = e.target.value;
      updateLineLive(true);
    });
    updateLineLive();
  }

  function updateNewLabels() {
    const mid = $('nl_umid').value.trim() || 'الوسطى';
    const top = $('nl_utop').value.trim() || 'الكبيرة';
    $('nl_sps_l').textContent = 'قطع في ' + mid;
    $('nl_spc_l').textContent = 'عدد ' + mid + ' في ' + top;
  }

  function syncLineFromUI() {
    if (!curLine) return 0;
    if (curLine.is_new) {
      curLine.synonyms = ($('nl_syn').value || '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
      curLine.unit_mid = $('nl_umid').value.trim();
      curLine.unit_top = $('nl_utop').value.trim();
      curLine.sps = toNum($('nl_sps').value);
      curLine.spc = toNum($('nl_spc').value);
      curLine.sell_retail = toNum($('nl_retail').value);
      curLine.sell_wholesale = toNum($('nl_wholesale').value);
      curLine.min_stock = toNum($('nl_min').value);
    }
    curLine.qty_top = $('ql_top').value;
    curLine.qty_mid = $('ql_mid').value;
    curLine.qty_pieces = $('ql_pcs').value;
    curLine.unit_price = toNum($('ql_price').value);
    curLine.disc_value = toNum($('ql_disc').value);
    curLine.disc_type = $('ql_dtype').value;
    return linePieces(curLine);
  }

  function updateLineLive(refillPrice) {
    if (!curLine) return;
    const pieces = syncLineFromUI();
    if (refillPrice === true) {
      DB.get('items', curLine.existing_id).then((it) => {
        if (it) { curLine.unit_price = curLine.buy_type === 'wholesale' ? (it.buy_wholesale || 0) : (it.buy_retail || 0); $('ql_price').value = curLine.unit_price; updateLineLive(); }
      });
      return;
    }
    const gross = pieces * toNum(curLine.unit_price);
    const t = lineTotal(curLine);
    $('lnLive').innerHTML = 'الكمية: <b>' + pieces + ' قطعة</b> × ' + r2(curLine.unit_price) + ' ج = <b>' + r2(gross) + ' ج</b>' +
      (gross - t > 0 ? ' − خصم ' + r2(gross - t) + ' ج' : '') +
      ' ← <b>' + r2(t) + ' ج</b>';
  }

  async function addLine() {
    if (!curLine) return;
    const pieces = syncLineFromUI();
    if (pieces <= 0) { $('purHint').textContent = 'اكتب كمية واحدة على الأقل في أي خانة'; return; }
    if (curLine.is_new && curLine.sell_retail <= 0) { $('purHint').textContent = 'الصنف الجديد محتاج سعر بيع قطاعي (أساسي لحساب أرباحك)'; return; }
    if (curLine.unit_price <= 0) { $('purHint').textContent = 'اكتب سعر الشراء'; return; }
    $('purHint').textContent = '';
    inv.lines.push(JSON.parse(JSON.stringify(curLine)));
    curLine = null;
    $('lnSearch').value = '';
    $('lnFields').replaceChildren();
    $('lnDrop').hidden = true;
    renderLines();
    renderTotals();
  }

  function renderLines() {
    const box = $('purLines');
    box.replaceChildren();
    if (!inv.lines.length) {
      const e = document.createElement('p');
      e.className = 'item-syn';
      e.textContent = 'لسه مفيش أصناف في الفاتورة — ابحث فوق وابدأ بإضافة أول سطر.';
      box.appendChild(e);
      return;
    }
    inv.lines.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'line-row';
      const main = document.createElement('div');
      main.className = 'line-main';
      main.innerHTML = '<b>' + esc(l.name) + '</b> <span class="sku-chip">' + esc(l.sku || 'جديد') + '</span>' +
        '<span class="item-syn"> ' + linePieces(l) + ' قطعة × ' + r2(l.unit_price) + ' ج' +
        (toNum(l.disc_value) > 0 ? ' − خصم ' + (l.disc_type === 'pct' ? l.disc_value + '%' : l.disc_value + ' ج') : '') +
        ' = <b>' + r2(lineTotal(l)) + ' ج</b></span>';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-sm danger';
      del.textContent = '✕';
      del.addEventListener('click', () => { inv.lines.splice(i, 1); renderLines(); renderTotals(); });
      row.appendChild(main);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  function renderTotals() {
    const t = invTotals();
    $('purTotalsBox').innerHTML =
      '<div class="tot-line"><span>الإجمالي قبل الخصم</span><b>' + r2(t.before) + ' ج</b></div>' +
      '<div class="tot-line"><span>الخصم</span><b>− ' + r2(t.disc) + ' ج</b></div>' +
      '<div class="tot-line grand"><span>الإجمالي النهائي</span><b>' + r2(t.after) + ' ج</b></div>';
    $('purTafqeet').textContent = t.after > 0 ? tafqeetMoney(t.after) : '';
  }

  // ===== الحفظ: أصناف + مخزون + متوسط مرجح + الفاتورة =====
  async function saveInvoice() {
    if (!inv.lines.length) { $('purHint').textContent = 'الفاتورة فاضية — أضف سطر واحد على الأقل'; return; }
    const btn = $('purSaveBtn');
    btn.disabled = true;
    $('purHint').textContent = '';
    try {
      const t = invTotals();
      inv.total_before = t.before; inv.disc_value_final = t.disc; inv.total_after = t.after;

      // لقطة الكميات — بتتحسب قبل أي حفظ عشان تثبت مع الفاتورة للأبد
      inv.lines.forEach((l) => { l.pieces_saved = linePieces(l); });

      // لفة الأصناف: الموجود يزيد مخزونه ويحدّث تكلفته — الجديد بيتولد
      for (let i = 0; i < inv.lines.length; i++) {
        const l = inv.lines[i];
        if (l.existing_id) {
          const it = await DB.get('items', l.existing_id);
          if (!it) continue;
          const oldStock = it.stock_pieces || 0, oldCost = it.cost_avg || 0;
          const newStock = oldStock + l.pieces_saved;
          const newCost = newStock > 0 ? ((oldStock * oldCost + l.pieces_saved * l.unit_price) / newStock) : l.unit_price;
          it.stock_pieces = newStock;
          it.cost_avg = r2(newCost);
          if (l.buy_type === 'wholesale') it.buy_wholesale = l.unit_price; else it.buy_retail = l.unit_price;
          it.updated_at = Date.now();
          await DB.put('items', it);
          await DB.log('purchase_line', it.sku + ' +' + l.pieces_saved + ' قطعة @ ' + l.unit_price);
        } else {
          const sku = await nextSkuFor();
          const obj = {
            name: l.name, synonyms: l.synonyms || [],
            unit_mid: l.unit_mid || '', unit_top: l.unit_top || '',
            pieces_per_sheila: toNum(l.sps), sheilas_per_carton: toNum(l.spc),
            buy_wholesale: l.buy_type === 'wholesale' ? l.unit_price : 0,
            buy_retail: l.buy_type === 'retail' ? l.unit_price : 0,
            price_retail: toNum(l.sell_retail), price_wholesale: toNum(l.sell_wholesale),
            min_stock: toNum(l.min_stock),
            sku: sku, barcode: '200' + String(parseInt(/^ZG-(\d+)$/.exec(sku)[1], 10)).padStart(9, '0'),
            stock_pieces: l.pieces_saved, cost_avg: l.unit_price,
            created_at: Date.now(), updated_at: Date.now()
          };
          const id = await DB.add('items', obj);
          l.saved_item_id = id; l.saved_sku = sku;
          await DB.log('item_add', sku + ' — ' + l.name + ' (من فاتورة ' + inv.number + ')');
        }
      }

      // حفظ بيانات المورد تلقائيًا لو جديد
      if (inv.supplier_name.trim()) {
        const sups = await DB.all('suppliers');
        const hit = sups.find((s) => normAr(s.name) === normAr(inv.supplier_name));
        if (!hit) {
          await DB.add('suppliers', { name: inv.supplier_name.trim(), phone: inv.supplier_phone || '', notes: 'أُضيف من فاتورة ' + inv.number, created_at: Date.now() });
          await DB.log('supplier_add', inv.supplier_name.trim() + ' (من فاتورة)');
        }
      }

      inv.saved_at = Date.now();
      await DB.add('purchases', inv);
      await DB.log('purchase_save', inv.number + ' — إجمالي ' + inv.total_after + ' ج');

      $('purBody').replaceChildren();
      $('purBody').appendChild(renderSavedView(inv));
    } catch (e) {
      $('purHint').textContent = 'حصل خطأ في الحفظ: ' + (e && e.message ? e.message : 'جرب تاني');
    } finally {
      btn.disabled = false;
    }
  }

  async function nextSkuFor() {
    const all = await DB.all('items');
    let max = 0;
    all.forEach((it) => { const m = /^ZG-(\d+)$/.exec(it.sku || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return 'ZG-' + String(max + 1).padStart(4, '0');
  }

  // ===== عرض الفاتورة المحفوظة =====
  function renderSavedView(doc) {
    const box = document.createElement('div');
    box.innerHTML =
      '<div class="inv-head"><span class="sku-chip">' + esc(doc.number) + '</span>' +
      '<span class="item-syn">اتحفظت ✅ — المخزون اتحدث والتكلفة اتسجلت</span></div>' +
      '<div id="purPreview"></div>' +
      '<div class="modal-actions">' +
      '<button id="prThermal" class="btn-save" type="button">🖨️ طباعة حراري 80mm</button>' +
      '<button id="prA4" class="btn-save" type="button">🖨️ طباعة A4</button>' +
      '<button id="prClose" class="btn-cancel" type="button">إغلاق</button></div>';
    const prev = box.querySelector('#purPreview');
    prev.innerHTML = invoiceHTML(doc, 'thermal', true);
    box.querySelector('#prThermal').addEventListener('click', () => printInvoice(doc, 'thermal'));
    box.querySelector('#prA4').addEventListener('click', () => printInvoice(doc, 'a4'));
    box.querySelector('#prClose').addEventListener('click', closePur);
    return box;
  }

  // ===== بناء HTML الفاتورة (عرض + طباعة) =====
  function invoiceHTML(doc, mode, previewOnly) {
    const t = { before: doc.total_before, disc: doc.disc_value_final || 0, after: doc.total_after };
    const isA4 = mode === 'a4';
    const rows = doc.lines.map((l) => {
      const qty = l.pieces_saved || linePieces(l);
      return '<tr><td>' + esc(l.name) + '</td><td>' + qty + '</td><td>' + r2(l.unit_price) + '</td><td>' + r2(qty * l.unit_price) + '</td></tr>';
    }).join('');
    return '' +
      '<div class="inv ' + (isA4 ? 'inv-a4' : 'inv-th') + '">' +
      '<div class="inv-brand"><img src="assets/images/logo-print.png" alt=""><div class="inv-shop">زجاجه هوم<small>ZOGAGA HOME</small></div>' +
      '<div class="inv-type">فاتورة شراء</div><div class="inv-no">' + esc(doc.number) + '</div></div>' +
      '<svg class="inv-bc" id="invBcSvg"></svg>' +
      '<div class="inv-meta"><span>التاريخ: ' + esc(doc.date) + '</span>' +
      (doc.supplier_name ? '<span>المورد: ' + esc(doc.supplier_name) + (doc.supplier_phone ? ' — ' + esc(doc.supplier_phone) : '') + '</span>' : '<span>المورد: —</span>') + '</div>' +
      '<table class="inv-tbl"><thead><tr><th>الصنف</th><th>قطعة</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
      '<div><span>الإجمالي</span><b>' + r2(t.before) + ' ج</b></div>' +
      (t.disc > 0 ? '<div><span>الخصم</span><b>− ' + r2(t.disc) + ' ج</b></div>' : '') +
      '<div class="grand"><span>الصافي</span><b>' + r2(t.after) + ' ج</b></div>' +
      '<div class="taf">' + tafqeetMoney(t.after) + '</div></div>' +
      '<div class="inv-foot">Powered by <b>Axentro</b> · CONTROL • BUILD • GROW' +
      '<br><img class="inv-qr" src="assets/images/qr.png" alt=""><br><small>Scan Me &gt; Click On Me</small></div>' +
      '</div>';
  }

  function printInvoice(doc, mode) {
    const w = window.open('', '_blank', 'width=' + (mode === 'a4' ? 900 : 420) + ',height=720');
    if (!w) { alert('المتصفح منع النافذة — اسمح بالنوافذ المنبثقة للموقع'); return; }
    const css = mode === 'a4'
      ? 'body{font-family:Tahoma,Arial;direction:rtl;padding:24px;color:#111}.inv{max-width:760px;margin:auto;border:2px solid #222;border-radius:10px;padding:20px}.inv-brand{display:flex;align-items:center;gap:12px;justify-content:space-between}.inv-brand img{width:64px}.inv-shop{font-size:22px;font-weight:800}.inv-shop small{display:block;font-size:10px;color:#666}.inv-type{font-size:18px;font-weight:800}.inv-no{font-size:14px;font-weight:700;direction:ltr}.inv-bc{display:block;margin:8px auto}.inv-meta{display:flex;justify-content:space-between;font-size:13px;margin:10px 0;border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0}.inv-tbl{width:100%;border-collapse:collapse;font-size:15px}.inv-tbl th,.inv-tbl td{border:1px solid #444;padding:8px;text-align:center}.inv-tbl th{background:#eee}.inv-tot{margin-top:12px;font-size:16px}.inv-tot div{display:flex;justify-content:space-between;padding:4px 0}.inv-tot .grand{font-size:20px;font-weight:800;border-top:2px solid #222;padding-top:6px}.taf{font-size:13px;color:#555;text-align:center;margin-top:6px}.inv-foot{text-align:center;margin-top:16px;font-size:12px;color:#555}.inv-qr{width:70px}'
      : 'body{font-family:Tahoma,Arial;direction:rtl;margin:0;padding:6px;color:#000}.inv{width:74mm;margin:auto;font-size:12px}.inv-brand{text-align:center}.inv-brand img{width:26mm}.inv-shop{font-size:16px;font-weight:800}.inv-shop small{display:block;font-size:9px}.inv-type{font-weight:800;margin-top:4px}.inv-no{font-weight:700;direction:ltr}.inv-bc{display:block;margin:4px auto;width:90%}.inv-meta{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0;margin:4px 0;font-size:11px}.inv-meta span{display:block}.inv-tbl{width:100%;border-collapse:collapse;font-size:11px}.inv-tbl th{border-bottom:1px solid #000}.inv-tbl td{padding:3px 0;text-align:center}.inv-tbl td:first-child{text-align:right}.inv-tot{margin-top:6px;font-size:12px}.inv-tot div{display:flex;justify-content:space-between}.inv-tot .grand{font-weight:800;border-top:1px dashed #000;padding-top:3px;font-size:14px}.taf{font-size:10px;text-align:center;margin-top:3px}.inv-foot{text-align:center;margin-top:8px;font-size:10px}.inv-qr{width:18mm}';
    w.document.write(
      '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>' + esc(doc.number) + '</title>' +
      '<style>' + css + ' @media print{body{padding:0}}</style></head><body>' +
      invoiceHTML(doc, mode, false) +
      '<script src="https://axentro-official.github.io/zogaga-home/assets/js/jsbarcode.all.min.js"><\/script>' +
      '<script>window.onload=function(){try{JsBarcode("#invBcSvg","' + esc(doc.number) + '",{format:"CODE128",width:' + (mode === 'a4' ? 2 : 1.4) + ',height:40,fontSize:12,margin:4})}catch(e){}setTimeout(function(){window.print()},400)}<\/script>' +
      '</body></html>'
    );
    w.document.close();
  }

  // ===== قائمة الفواتير =====
  async function loadInvoices() {
    invoices = await DB.all('purchases');
    invoices.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    renderInvoices();
  }

  function renderInvoices() {
    const q = normAr(($('purSearch') || {}).value || '');
    const filtered = invoices.filter((d) => !q || normAr(d.number).includes(q) || normAr(d.supplier_name).includes(q));
    const list = $('purList');
    if (!list) return;
    list.replaceChildren();
    filtered.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML =
        '<div class="item-top"><div class="item-name">' + esc(d.number) + '</div>' +
        '<span class="sku-chip">' + esc(d.date) + '</span></div>' +
        '<div class="item-meta"><span>المورد: <b>' + esc(d.supplier_name || '—') + '</b></span>' +
        '<span>الأصناف: <b>' + d.lines.length + '</b></span>' +
        '<span>الصافي: <b>' + r2(d.total_after) + ' ج</b></span></div>';
      const acts = document.createElement('div');
      acts.className = 'item-actions';
      const view = document.createElement('button');
      view.className = 'btn-sm'; view.textContent = '👁️ عرض';
      view.addEventListener('click', () => { $('purBody').replaceChildren(renderSavedView(d)); $('purModal').hidden = false; });
      const pr = document.createElement('button');
      pr.className = 'btn-sm'; pr.textContent = '🖨️ طباعة';
      pr.addEventListener('click', () => printInvoice(d, 'thermal'));
      const del = document.createElement('button');
      del.className = 'btn-sm danger'; del.textContent = '🗑️ حذف';
      del.addEventListener('click', () => {
        $('purConfirmText').textContent = 'حذف ' + d.number + '؟ ⚠️ المخزون مش هيرجع — لو عايز تقلل كميات، اعملها بفاتورة مرتجع لاحقًا.';
        $('purConfirmModal').hidden = false;
        confirmAction = async () => {
          await DB.del('purchases', d.id);
          await DB.log('purchase_delete', d.number);
          $('purConfirmModal').hidden = true; confirmAction = null; loadInvoices();
        };
      });
      acts.appendChild(view); acts.appendChild(pr); acts.appendChild(del);
      card.appendChild(acts);
      list.appendChild(card);
    });
    const empty = $('purEmpty');
    if (invoices.length === 0) { empty.hidden = false; empty.textContent = 'مفيش فواتير شراء لسه.'; }
    else if (filtered.length === 0) { empty.hidden = false; empty.textContent = 'مفيش نتايج للبحث.'; }
    else empty.hidden = true;
    $('purCount').textContent = '(' + invoices.length + ')';
  }

  function init() {
    if (!$('appMain')) return;
    const newBtn = $('newPurchaseBtn');
    if (newBtn) newBtn.addEventListener('click', openNew);
    const s = $('purSearch');
    if (s) s.addEventListener('input', () => {
      $('purClear').hidden = s.value.length === 0;
      renderInvoices();
    });
    const c = $('purClear');
    if (c) c.addEventListener('click', () => { $('purSearch').value = ''; $('purClear').hidden = true; renderInvoices(); });
    const cy = $('purConfirmYes');
    if (cy) cy.addEventListener('click', () => { if (confirmAction) confirmAction(); });
    const cn = $('purConfirmNo');
    if (cn) cn.addEventListener('click', () => { $('purConfirmModal').hidden = true; confirmAction = null; });
    document.addEventListener('click', (e) => {
      const drop = $('lnDrop');
      if (drop && !drop.hidden && !e.target.closest('.search-wrap')) drop.hidden = true;
    });
    bindSearch();
  }

  window.ZG_loadPurchases = loadInvoices;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

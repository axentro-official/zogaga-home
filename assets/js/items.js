/* ============================================
   ZOGAGA HOME - شاشة الأصناف v1.2
   عرض وتعديل وحذف فقط — الإضافة بتتم من فواتير الشراء
   - 3 ألوان للمخزون: أحمر (خلص) / برتقالي (متوسط) / أخضر (متوفر)
   - بحث ذكي عربي: تطبيع + مرادفات + SKU + باركود
   - كل حركة متسجلة في سجل التدقيق
   ============================================ */

(function () {
  'use strict';

  let items = [];
  let editingId = null;
  let confirmYesAction = null;

  function $(id) { return document.getElementById(id); }

  function normAr(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNum(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  // --- تحويل المخزون بأسماء الوحدات المرنة ---
  function stockText(item) {
    let p = item.stock_pieces || 0;
    const midName = (item.unit_mid || '').trim();
    const topName = (item.unit_top || '').trim();
    const sps = item.pieces_per_sheila || 0;
    const spc = item.sheilas_per_carton || 0;
    const out = [];

    if (topName && spc > 0 && sps > 0) {
      const cartons = Math.floor(p / (sps * spc));
      if (cartons > 0) { out.push(cartons + ' ' + topName); p -= cartons * sps * spc; }
    }
    if (midName && sps > 0) {
      const mids = Math.floor(p / sps);
      if (mids > 0) { out.push(mids + ' ' + midName); p -= mids * sps; }
    }
    out.push(p + ' قطعة');
    return out.join(' + ');
  }

  function barcodeForSku(sku) {
    const m = /^ZG-(\d+)$/.exec(sku || '');
    if (!m) return '';
    return '200' + String(parseInt(m[1], 10)).padStart(9, '0');
  }

  function drawBarcode(svgEl, code, opts) {
    if (!window.JsBarcode || !code) return false;
    try {
      JsBarcode(svgEl, code, opts || { format: 'EAN13', width: 2, height: 46, fontSize: 12, margin: 4 });
      return true;
    } catch (e) { return false; }
  }

  // --- تحميل وعرض ---
  async function loadItems() {
    items = await DB.all('items');
    items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    renderList();
  }

  function matches(it, q) {
    if (!q) return true;
    if (normAr(it.name).includes(q)) return true;
    if ((it.synonyms || []).some((s) => normAr(s).includes(q))) return true;
    if (normAr(it.sku).includes(q)) return true;
    if (normAr(it.barcode).includes(q)) return true;
    return false;
  }

  function renderList() {
    const q = normAr($('itemSearch').value);
    const filtered = items.filter((it) => matches(it, q));
    const list = $('itemsList');
    list.replaceChildren();
    filtered.forEach((it) => list.appendChild(itemCard(it)));

    $('itemsCount').textContent = q
      ? '(' + filtered.length + ' من ' + items.length + ')'
      : '(' + items.length + ')';

    const empty = $('itemsEmpty');
    if (items.length === 0) {
      empty.hidden = false;
      empty.textContent = 'مفيش أصناف لسه — الأصناف بتتولد تلقائيًا أول ما تسجل أول فاتورة شراء.';
    } else if (filtered.length === 0) {
      empty.hidden = false;
      empty.textContent = 'مفيش نتايج للبحث ده.';
    } else {
      empty.hidden = true;
    }
  }

  function itemCard(it) {
    const card = document.createElement('div');
    card.className = 'item-card';

    // ألوان المخزون: أحمر = خلص/عند الحد، برتقالي = متوسط، أخضر = متوفر
    const st = it.stock_pieces || 0, mn = it.min_stock || 0;
    if (st <= 0 || (mn > 0 && st <= mn)) card.classList.add('low');
    else if (mn > 0 && st <= mn * 2) card.classList.add('mid');
    else card.classList.add('ok');

    const top = document.createElement('div');
    top.className = 'item-top';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = it.name;
    const sku = document.createElement('span');
    sku.className = 'sku-chip';
    sku.textContent = it.sku || 'بدون SKU';
    top.appendChild(name);
    top.appendChild(sku);
    card.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const stock = document.createElement('span');
    stock.textContent = 'المخزون: ';
    const stockB = document.createElement('b');
    stockB.textContent = stockText(it);
    stock.appendChild(stockB);
    meta.appendChild(stock);

    const retail = document.createElement('span');
    retail.textContent = 'بيع قطاعي: ';
    const retailB = document.createElement('b');
    retailB.textContent = it.price_retail + ' ج';
    retail.appendChild(retailB);
    meta.appendChild(retail);

    if (it.price_wholesale > 0) {
      const wh = document.createElement('span');
      wh.textContent = 'بيع جملة: ';
      const whB = document.createElement('b');
      whB.textContent = it.price_wholesale + ' ج';
      wh.appendChild(whB);
      meta.appendChild(wh);
    }
    if (it.buy_wholesale > 0 || it.buy_retail > 0) {
      const buy = document.createElement('span');
      buy.textContent = 'شراء: ج ' + (it.buy_wholesale || 0) + ' / قطاعي ' + (it.buy_retail || 0);
      meta.appendChild(buy);
    }
    card.appendChild(meta);

    if ((it.synonyms || []).length) {
      const syn = document.createElement('div');
      syn.className = 'item-syn';
      syn.textContent = 'مرادفات: ' + it.synonyms.join('، ');
      card.appendChild(syn);
    }

    if (it.barcode) {
      const bcText = document.createElement('div');
      bcText.className = 'item-syn';
      bcText.style.direction = 'ltr';
      bcText.textContent = 'باركود: ' + it.barcode;
      card.appendChild(bcText);

      const bcBox = document.createElement('div');
      bcBox.className = 'item-bc';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      bcBox.appendChild(svg);
      if (drawBarcode(svg, it.barcode, { format: 'EAN13', width: 1.4, height: 34, fontSize: 10, margin: 2 })) {
        card.appendChild(bcBox);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm';
    editBtn.textContent = '✏️ تعديل';
    editBtn.addEventListener('click', () => openModal(it));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm danger';
    delBtn.textContent = '🗑️ حذف';
    delBtn.addEventListener('click', () => askDelete(it));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
  }

  // --- تسميات الوحدات الديناميكية في الفورم ---
  function updateUnitLabels() {
    const mid = $('f_unit_mid').value.trim() || 'الوحدة الوسطى';
    const top = $('f_unit_top').value.trim() || 'الوحدة الكبيرة';
    $('lbl_sps').textContent = 'قطع في ' + mid;
    $('lbl_spc').textContent = 'عدد ' + mid + ' في ' + top;
  }

  // --- نافذة تعديل الصنف ---
  async function openModal(item) {
    editingId = item.id;
    $('itemModalTitle').textContent = 'تعديل صنف — ' + item.name;
    $('f_hint').textContent = '';
    $('f_name').value = item.name;
    $('f_synonyms').value = (item.synonyms || []).join('، ');
    $('f_unit_mid').value = item.unit_mid || '';
    $('f_unit_top').value = item.unit_top || '';
    $('f_sps').value = item.pieces_per_sheila || '';
    $('f_spc').value = item.sheilas_per_carton || '';
    $('f_buy_wholesale').value = item.buy_wholesale || '';
    $('f_buy_retail').value = item.buy_retail || '';
    $('f_retail').value = item.price_retail;
    $('f_wholesale').value = item.price_wholesale || '';
    $('f_min').value = item.min_stock || '';
    updateUnitLabels();

    $('f_sku').value = item.sku || '';

    const code = item.barcode || barcodeForSku(item.sku);
    const box = $('barcodeBox');
    if (drawBarcode($('barcodeSvg'), code)) {
      $('barcodeNum').textContent = code;
      box.hidden = false;
    } else {
      box.hidden = true;
      $('barcodeNum').textContent = code;
    }

    $('itemModal').hidden = false;
    setTimeout(() => { try { $('f_name').focus(); } catch (e) {} }, 60);
  }

  function closeModal() {
    $('itemModal').hidden = true;
    editingId = null;
  }

  async function saveItem(e) {
    e.preventDefault();
    const name = $('f_name').value.trim();
    const retail = toNum($('f_retail').value);
    if (!name) { $('f_hint').textContent = 'اكتب اسم الصنف الأول'; return; }
    if (retail <= 0) { $('f_hint').textContent = 'اكتب سعر بيع قطاعي صحيح'; return; }

    const saveBtn = $('itemSaveBtn');
    saveBtn.disabled = true;

    try {
      const existing = items.find((x) => x.id === editingId);
      const obj = Object.assign({}, existing, {
        name: name,
        synonyms: $('f_synonyms').value.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
        unit_mid: $('f_unit_mid').value.trim(),
        unit_top: $('f_unit_top').value.trim(),
        pieces_per_sheila: toNum($('f_sps').value),
        sheilas_per_carton: toNum($('f_spc').value),
        buy_wholesale: toNum($('f_buy_wholesale').value),
        buy_retail: toNum($('f_buy_retail').value),
        price_retail: retail,
        price_wholesale: toNum($('f_wholesale').value),
        min_stock: toNum($('f_min').value),
        updated_at: Date.now()
      });
      await DB.put('items', obj);
      await DB.log('item_edit', (obj.sku || '') + ' — ' + obj.name);
      closeModal();
      await loadItems();
    } catch (err) {
      $('f_hint').textContent = 'حصل خطأ في الحفظ — جرب تاني';
    } finally {
      saveBtn.disabled = false;
    }
  }

  function askDelete(item) {
    $('confirmText').textContent = 'هل انت متأكد من حذف «' + item.name + '»؟ الحذف نهائي ومفيش رجوع فيه.';
    $('confirmModal').hidden = false;
    confirmYesAction = async () => {
      await DB.del('items', item.id);
      await DB.log('item_delete', (item.sku || '') + ' — ' + item.name);
      $('confirmModal').hidden = true;
      confirmYesAction = null;
      await loadItems();
    };
  }

  function init() {
    if (!$('appMain')) return;

    $('itemCancelBtn').addEventListener('click', closeModal);
    $('itemForm').addEventListener('submit', saveItem);
    $('f_unit_mid').addEventListener('input', updateUnitLabels);
    $('f_unit_top').addEventListener('input', updateUnitLabels);
    $('itemSearch').addEventListener('input', () => {
      $('clearSearch').hidden = $('itemSearch').value.length === 0;
      renderList();
    });
    $('clearSearch').addEventListener('click', () => {
      $('itemSearch').value = '';
      $('clearSearch').hidden = true;
      renderList();
      $('itemSearch').focus();
    });
    $('confirmYes').addEventListener('click', () => { if (confirmYesAction) confirmYesAction(); });
    $('confirmNo').addEventListener('click', () => {
      $('confirmModal').hidden = true;
      confirmYesAction = null;
    });
  }

  window.ZG_onUnlock = function () {
    $('appMain').hidden = false;
    loadItems();
    if (typeof window.ZG_loadSuppliers === 'function') window.ZG_loadSuppliers();
    if (typeof window.ZG_loadPurchases === 'function') window.ZG_loadPurchases();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

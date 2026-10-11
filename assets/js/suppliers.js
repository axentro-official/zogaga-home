/* ============================================
   ZOGAGA HOME - الموردين v1.0
   - إضافة/تعديل/حذف مورد + بحث فوري
   - تابات التنقل بين الشاشات
   - كل حركة متسجلة في سجل التدقيق
   ============================================ */

(function () {
  'use strict';

  let suppliers = [];
  let editingId = null;
  let confirmAction = null;

  function $(id) { return document.getElementById(id); }

  function normAr(s) {
    return String(s || '').toLowerCase()
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ').trim();
  }

  // --- تابات التنقل ---
  function initTabs() {
    document.querySelectorAll('.tab[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab[data-view]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        ['items', 'suppliers', 'purchases'].forEach((v) => {
          const el = $('view-' + v);
          if (el) el.hidden = (v !== btn.dataset.view);
        });
        if (btn.dataset.view === 'suppliers') loadSuppliers();
      });
    });
  }

  // --- تحميل وعرض ---
  async function loadSuppliers() {
    suppliers = await DB.all('suppliers');
    suppliers.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    renderList();
  }

  function renderList() {
    const q = normAr($('supSearch').value);
    const filtered = suppliers.filter((s) => {
      if (!q) return true;
      return normAr(s.name).includes(q) || normAr(s.phone).includes(q);
    });
    const list = $('supList');
    list.replaceChildren();
    filtered.forEach((s) => list.appendChild(supCard(s)));
    $('supCount').textContent = '(' + suppliers.length + ')';

    const empty = $('supEmpty');
    if (suppliers.length === 0) {
      empty.hidden = false;
      empty.textContent = 'مفيش موردين لسه — هتضيفهم من زرار «➕ مورد جديد» أو مباشرة وقت أول فاتورة شراء.';
    } else if (filtered.length === 0) {
      empty.hidden = false;
      empty.textContent = 'مفيش نتايج للبحث ده.';
    } else {
      empty.hidden = true;
    }
  }

  function supCard(s) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const top = document.createElement('div');
    top.className = 'item-top';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = s.name;
    top.appendChild(name);
    card.appendChild(top);

    if (s.phone) {
      const ph = document.createElement('div');
      ph.className = 'item-meta';
      const span = document.createElement('span');
      span.textContent = '📞 ';
      const b = document.createElement('b');
      b.style.direction = 'ltr';
      b.textContent = s.phone;
      span.appendChild(b);
      ph.appendChild(span);
      card.appendChild(ph);
    }

    if (s.notes) {
      const n = document.createElement('div');
      n.className = 'item-syn';
      n.textContent = s.notes;
      card.appendChild(n);
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm';
    editBtn.textContent = '✏️ تعديل';
    editBtn.addEventListener('click', () => openModal(s));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm danger';
    delBtn.textContent = '🗑️ حذف';
    delBtn.addEventListener('click', () => askDelete(s));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
  }

  // --- إضافة/تعديل ---
  function openModal(sup) {
    editingId = sup ? sup.id : null;
    $('supModalTitle').textContent = sup ? 'تعديل مورد' : 'مورد جديد';
    $('s_name').value = sup ? sup.name : '';
    $('s_phone').value = sup ? (sup.phone || '') : '';
    $('s_notes').value = sup ? (sup.notes || '') : '';
    $('s_hint').textContent = '';
    $('supModal').hidden = false;
    setTimeout(() => { try { $('s_name').focus(); } catch (e) {} }, 60);
  }

  function closeModal() {
    $('supModal').hidden = true;
    editingId = null;
  }

  async function saveSup(e) {
    e.preventDefault();
    const name = $('s_name').value.trim();
    if (!name) { $('s_hint').textContent = 'اكتب اسم المورد الأول'; return; }

    const saveBtn = $('supSaveBtn');
    saveBtn.disabled = true;
    try {
      const obj = {
        name: name,
        phone: $('s_phone').value.trim(),
        notes: $('s_notes').value.trim(),
        updated_at: Date.now()
      };
      if (editingId) {
        const existing = suppliers.find((x) => x.id === editingId);
        await DB.put('suppliers', Object.assign({}, existing, obj));
        await DB.log('supplier_edit', name);
      } else {
        obj.created_at = Date.now();
        await DB.add('suppliers', obj);
        await DB.log('supplier_add', name);
      }
      closeModal();
      await loadSuppliers();
    } catch (err) {
      $('s_hint').textContent = 'حصل خطأ في الحفظ — جرب تاني';
    } finally {
      saveBtn.disabled = false;
    }
  }

  function askDelete(sup) {
    $('supConfirmText').textContent = 'هل انت متأكد من حذف المورد «' + sup.name + '»؟ (فواتير الشراء القديمة هتفضل محفوظة باسمه)';
    $('supConfirmModal').hidden = false;
    confirmAction = async () => {
      await DB.del('suppliers', sup.id);
      await DB.log('supplier_delete', sup.name);
      $('supConfirmModal').hidden = true;
      confirmAction = null;
      await loadSuppliers();
    };
  }

  function init() {
    if (!$('appMain')) return;
    initTabs();

    $('supCancelBtn').addEventListener('click', closeModal);
    $('supForm').addEventListener('submit', saveSup);
    $('supSearch').addEventListener('input', () => {
      $('supClear').hidden = $('supSearch').value.length === 0;
      renderList();
    });
    $('supClear').addEventListener('click', () => {
      $('supSearch').value = '';
      $('supClear').hidden = true;
      renderList();
      $('supSearch').focus();
    });
    $('supConfirmYes').addEventListener('click', () => { if (confirmAction) confirmAction(); });
    $('supConfirmNo').addEventListener('click', () => {
      $('supConfirmModal').hidden = true;
      confirmAction = null;
    });
  }

  // بتنادى من items.js بعد فتح البرنامج
  window.ZG_loadSuppliers = loadSuppliers;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

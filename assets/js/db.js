/* ============================================
   ZOGAGA HOME - Local Database Layer v1.0
   IndexedDB — سريع، أوفلاين دايمًا، مجاني
   الخزانات: items, purchases, sales, expenses, advances, settings, audit
   ============================================ */

const DB = (function () {
  'use strict';

  const DB_NAME = 'zogaga_db';
  const DB_VERSION = 1;

  let dbPromise = null;

  // تعريف الخزانات والفهارس
  const STORES = {
    items: {
      keyPath: 'id', autoIncrement: true,
      indexes: [
        { name: 'sku', keyPath: 'sku', unique: true },
        { name: 'barcode', keyPath: 'barcode', unique: false },
        { name: 'name', keyPath: 'name', unique: false }
      ]
    },
    purchases: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'date', keyPath: 'date', unique: false }] },
    sales:     { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'date', keyPath: 'date', unique: false }] },
    expenses:  { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'date', keyPath: 'date', unique: false }] },
    advances:  { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'date', keyPath: 'date', unique: false }] },
    settings:  { keyPath: 'key', autoIncrement: false, indexes: [] },
    audit:     { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'ts', keyPath: 'ts', unique: false }] }
  };

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        Object.keys(STORES).forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            const def = STORES[name];
            const store = db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: def.autoIncrement });
            (def.indexes || []).forEach((idx) => {
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    // === CRUD عام ===
    async add(store, obj)  { const s = await tx(store, 'readwrite'); return wrap(s.add(obj)); },
    async put(store, obj)  { const s = await tx(store, 'readwrite'); return wrap(s.put(obj)); },
    async get(store, key)  { const s = await tx(store, 'readonly');  return wrap(s.get(key)); },
    async all(store)       { const s = await tx(store, 'readonly');  return wrap(s.getAll()); },
    async del(store, key)  { const s = await tx(store, 'readwrite'); return wrap(s.delete(key)); },
    async clear(store)     { const s = await tx(store, 'readwrite'); return wrap(s.clear()); },
    async count(store)     { const s = await tx(store, 'readonly');  return wrap(s.count()); },

    // === إعدادات (key-value) ===
    async getSetting(key) {
      const s = await tx('settings', 'readonly');
      const r = await wrap(s.get(key));
      return r ? r.value : null;
    },
    async setSetting(key, value) {
      const s = await tx('settings', 'readwrite');
      return wrap(s.put({ key: key, value: value }));
    },

    // === سجل التدقيق (أمن: كل حركة متسجلة بدليل) ===
    async log(action, details) {
      try {
        return await this.add('audit', { action: action, details: details || '', ts: Date.now() });
      } catch (e) { console.warn('audit log failed:', e); }
    },

    // === نسخة احتياطية: تصدير كل الخزانات ككائن واحد ===
    async exportAll() {
      const out = { _exported_at: new Date().toISOString(), _version: DB_VERSION };
      const names = Object.keys(STORES);
      for (let i = 0; i < names.length; i++) {
        out[names[i]] = await this.all(names[i]);
      }
      return out;
    },

    // === استيراد نسخة احتياطية (replace=true يمسح الحالي الأول) ===
    async importAll(data, replace) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const names = Object.keys(STORES);
        const t = db.transaction(names, 'readwrite');
        names.forEach((name) => {
          const store = t.objectStore(name);
          if (replace) store.clear();
          (data[name] || []).forEach((obj) => store.put(obj));
        });
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
      });
    }
  };
})();

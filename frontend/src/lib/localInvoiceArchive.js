const DB_NAME = 'revv_local_archive';
const STORE_NAME = 'settings';
const HANDLE_KEY = 'invoice_archive_directory_handle';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('indexedDB get failed'));
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('indexedDB put failed'));
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('indexedDB delete failed'));
  });
}

function cleanName(text, fallback = 'Unknown') {
  const safe = String(text || '').replace(/[^\w.-]+/g, ' ').trim();
  return safe || fallback;
}

async function canWrite(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission !== 'function') return true;
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return true;
  if (typeof handle.requestPermission !== 'function') return false;
  const requested = await handle.requestPermission({ mode: 'readwrite' });
  return requested === 'granted';
}

async function getSavedDirectoryHandle() {
  try {
    return await idbGet(HANDLE_KEY);
  } catch {
    return null;
  }
}

export function isLocalArchiveSupported() {
  return typeof window !== 'undefined'
    && typeof window.showDirectoryPicker === 'function'
    && typeof indexedDB !== 'undefined';
}

export async function chooseLocalArchiveDirectory() {
  if (!isLocalArchiveSupported()) throw new Error('Local archive is not supported in this browser');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(HANDLE_KEY, handle);
  return { name: handle.name || 'selected-folder' };
}

export async function clearLocalArchiveDirectory() {
  await idbDelete(HANDLE_KEY);
}

export async function getLocalArchiveStatus() {
  if (!isLocalArchiveSupported()) {
    return { supported: false, configured: false, folder_name: null };
  }
  const handle = await getSavedDirectoryHandle();
  return {
    supported: true,
    configured: !!handle,
    folder_name: handle?.name || null,
  };
}

async function ensureDir(parent, name) {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function saveInvoiceBlobToLocalArchive({ blob, fileName, shopName, roNumber, invoiceDate } = {}) {
  if (!blob) return { saved: false, reason: 'missing_blob' };
  if (!isLocalArchiveSupported()) return { saved: false, reason: 'unsupported' };

  const rootHandle = await getSavedDirectoryHandle();
  if (!rootHandle) return { saved: false, reason: 'not_configured' };
  if (!(await canWrite(rootHandle))) return { saved: false, reason: 'permission_denied' };

  const now = invoiceDate ? new Date(invoiceDate) : new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  const revvDir = await ensureDir(rootHandle, 'REVV');
  const shopDir = await ensureDir(revvDir, cleanName(shopName, 'Shop'));
  const invoicesDir = await ensureDir(shopDir, 'Invoices');
  const yearDir = await ensureDir(invoicesDir, yyyy);
  const monthDir = await ensureDir(yearDir, mm);

  const roTag = cleanName(roNumber, 'RO');
  const dateTag = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, '0')}`;
  const desiredName = cleanName(fileName || `invoice-${roTag}.pdf`, `invoice-${roTag}.pdf`).replace(/\.pdf$/i, '');
  const finalName = `${dateTag}-${desiredName}.pdf`;

  const fileHandle = await monthDir.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  return {
    saved: true,
    path: `REVV/${cleanName(shopName, 'Shop')}/Invoices/${yyyy}/${mm}/${finalName}`,
  };
}


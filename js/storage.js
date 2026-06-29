const SANCTUARY_DB      = 'sanctuary-db';
const SANCTUARY_DB_VER  = 1;
const STORE_FILES       = 'files';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SANCTUARY_DB, SANCTUARY_DB_VER);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_FILES)) {
                db.createObjectStore(STORE_FILES);
            }
        };
        req.onsuccess  = e => resolve(e.target.result);
        req.onerror    = () => reject(req.error);
    });
}

async function storeFile(key, dataUrl) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, 'readwrite');
        tx.objectStore(STORE_FILES).put(dataUrl, key);
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
    });
}

async function retrieveFile(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_FILES, 'readonly');
        const req = tx.objectStore(STORE_FILES).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

async function removeFile(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, 'readwrite');
        tx.objectStore(STORE_FILES).delete(key);
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
    });
}

function getVaultMeta() {
    try {
        const raw = localStorage.getItem('sanctuary-vault');
        if (raw) return JSON.parse(raw);
    } catch {}
    return { folders: [], documents: [] };
}

function saveVaultMeta(meta) {
    localStorage.setItem('sanctuary-vault', JSON.stringify(meta));
}

function genId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

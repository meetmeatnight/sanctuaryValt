const SANCTUARY_DB      = 'sanctuary-db';
const SANCTUARY_DB_VER  = 1;
const STORE_FILES       = 'files';

// Tracks in-flight Firestore pushes so logout() can wait for them before wiping local
// storage — otherwise a file/meta write still in flight when someone signs out could be
// lost for good (local copy wiped, cloud copy never arrived).
let _pendingSyncs = [];

function _trackSync(promise) {
    _pendingSyncs.push(promise);
    promise.finally(() => { _pendingSyncs = _pendingSyncs.filter(p => p !== promise); });
}

async function flushPendingSyncs() {
    await Promise.allSettled(_pendingSyncs);
}

// The real safety gate before any local wipe: confirms the current metadata and every
// document's file are actually present in Firestore — not just "a push was attempted."
// Returns false (never throws) if anything can't be confirmed, so the caller can choose
// to skip wiping rather than risk destroying something that never made it to the cloud.
async function ensureFullySynced() {
    if (typeof initFirebase !== 'function') return true; // no Firebase configured — nothing to verify
    try {
        const fbOk = await initFirebase();
        if (!fbOk) return false;

        const meta = getVaultMeta();
        await fbPushMeta(meta, true); // strict — throws if this write fails

        for (const doc of meta.documents) {
            if (!doc.storageKey) continue;
            let exists = await fbFileManifestExists(doc.storageKey);
            if (!exists) {
                const rawData = await retrieveFile(doc.storageKey);
                if (!rawData) return false; // not even available locally — can't back it up
                await fbPushFile(doc.storageKey, rawData);
                exists = await fbFileManifestExists(doc.storageKey);
                if (!exists) return false;
            }
        }
        return true;
    } catch (e) {
        console.error('[storage] ensureFullySynced failed:', e);
        return false;
    }
}

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

// ── File storage (IndexedDB + Firebase Storage mirror) ────────────────────────

async function storeFile(key, data) {
    // Save to local IndexedDB immediately
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, 'readwrite');
        tx.objectStore(STORE_FILES).put(data, key);
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
    });
    // Mirror to Firebase in background (fire-and-forget)
    if (typeof fbPushFile === 'function') {
        _trackSync(fbPushFile(key, data).catch(e => console.error('[storage] fbPushFile:', e)));
    }
}

async function retrieveFile(key) {
    // Try local IndexedDB first (instant)
    const db    = await openDB();
    const local = await new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_FILES, 'readonly');
        const req = tx.objectStore(STORE_FILES).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
    });
    if (local !== null) return local;

    // Not found locally — fetch from Firebase (other device uploaded it)
    if (typeof fbPullFile === 'function') {
        const remote = await fbPullFile(key);
        if (remote) {
            // Cache locally so next open is instant
            _storeFileLocal(key, remote).catch(() => {});
            return remote;
        }
    }
    return null;
}

// Internal: save to IndexedDB without triggering another Firebase push
async function _storeFileLocal(key, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, 'readwrite');
        tx.objectStore(STORE_FILES).put(data, key);
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
    });
}

async function removeFile(key) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, 'readwrite');
        tx.objectStore(STORE_FILES).delete(key);
        tx.oncomplete = resolve;
        tx.onerror    = () => reject(tx.error);
    });
    if (typeof fbDeleteFile === 'function') {
        fbDeleteFile(key).catch(e => console.error('[storage] fbDeleteFile:', e));
    }
}

// ── Metadata (localStorage + Firestore mirror) ────────────────────────────────

function getVaultMeta() {
    try {
        const raw = localStorage.getItem('sanctuary-vault');
        if (raw) return JSON.parse(raw);
    } catch {}
    return { folders: [], documents: [] };
}

function saveVaultMeta(meta) {
    localStorage.setItem('sanctuary-vault', JSON.stringify(meta));
    // Mirror to Firestore in background
    if (typeof fbPushMeta === 'function') {
        _trackSync(fbPushMeta(meta).catch(e => console.error('[storage] fbPushMeta:', e)));
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function genId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

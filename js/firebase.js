// firebase.js — cross-device sync via Firestore only (no Firebase Storage required)
// Files are split into 500 KB base64 chunks and stored as Firestore documents.
// Everything is encrypted BEFORE it reaches Firestore — the server only sees ciphertext.

let _fb = null;

const CHUNK_SIZE = 500 * 1024; // 500 KB binary per chunk → ~667 KB base64 (well under 1 MB doc limit)

function isFirebaseConfigured() {
    return !!(CONFIG.firebaseConfig && CONFIG.firebaseConfig.apiKey
           && CONFIG.firebaseEmail   && CONFIG.firebasePassword);
}

async function initFirebase() {
    if (_fb) return true;
    if (!isFirebaseConfigured()) return false;

    try {
        const [
            { initializeApp },
            { getAuth, signInWithEmailAndPassword },
            { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit }
        ] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
        ]);

        const app  = initializeApp(CONFIG.firebaseConfig);
        const auth = getAuth(app);
        const db   = getFirestore(app);

        await signInWithEmailAndPassword(auth, CONFIG.firebaseEmail, CONFIG.firebasePassword);

        _fb = { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit };
        console.log('[firebase] connected (Firestore-only mode)');
        return true;
    } catch (err) {
        console.error('[firebase] init failed — falling back to local storage:', err.message);
        return false;
    }
}

// ── Metadata ──────────────────────────────────────────────────────────────────

async function fbPushMeta(meta) {
    if (!_fb) return;
    try {
        await _fb.setDoc(_fb.doc(_fb.db, 'vault', 'meta'), JSON.parse(JSON.stringify(meta)));
    } catch (e) { console.error('[firebase] fbPushMeta:', e); }
}

async function fbPullMeta() {
    if (!_fb) return null;
    try {
        const snap = await _fb.getDoc(_fb.doc(_fb.db, 'vault', 'meta'));
        return snap.exists() ? snap.data() : null;
    } catch (e) { console.error('[firebase] fbPullMeta:', e); return null; }
}

// ── File storage (chunked into Firestore docs) ────────────────────────────────

function _toBase64(bytes) {
    let binary = '';
    const len = bytes.length;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function _fromBase64(b64) {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function fbPushFile(key, data) {
    if (!_fb) return;
    try {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
        const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

        // Write all chunks in parallel
        const writes = [];
        for (let i = 0; i < totalChunks; i++) {
            const chunk  = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const b64    = _toBase64(chunk);
            writes.push(_fb.setDoc(_fb.doc(_fb.db, 'files', key + '_' + i), { d: b64 }));
        }
        // Write manifest last so a partial upload is never treated as complete
        writes.push(_fb.setDoc(_fb.doc(_fb.db, 'files', key), { n: totalChunks, s: bytes.length }));
        await Promise.all(writes);
    } catch (e) { console.error('[firebase] fbPushFile:', e); }
}

async function fbPullFile(key) {
    if (!_fb) return null;
    try {
        const manifest = await _fb.getDoc(_fb.doc(_fb.db, 'files', key));
        if (!manifest.exists()) return null;

        const { n: totalChunks, s: totalSize } = manifest.data();

        // Fetch all chunks in parallel
        const snaps = await Promise.all(
            Array.from({ length: totalChunks }, (_, i) =>
                _fb.getDoc(_fb.doc(_fb.db, 'files', key + '_' + i))
            )
        );

        // Reassemble
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const snap of snaps) {
            const chunk = _fromBase64(snap.data().d);
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result.buffer;
    } catch (e) { console.error('[firebase] fbPullFile:', e); return null; }
}

// ── Site background (plaintext — shown pre-login, so it can't live inside the encrypted vault) ──

async function fbPushBackground(dataUrl) {
    if (!_fb) return;
    try {
        await _fb.setDoc(_fb.doc(_fb.db, 'settings', 'background'), { image: dataUrl });
    } catch (e) { console.error('[firebase] fbPushBackground:', e); }
}

async function fbPullBackground() {
    if (!_fb) return null;
    try {
        const snap = await _fb.getDoc(_fb.doc(_fb.db, 'settings', 'background'));
        return snap.exists() ? snap.data().image : null;
    } catch (e) { console.error('[firebase] fbPullBackground:', e); return null; }
}

async function fbDeleteBackground() {
    if (!_fb) return;
    try {
        await _fb.deleteDoc(_fb.doc(_fb.db, 'settings', 'background'));
    } catch (e) { console.error('[firebase] fbDeleteBackground:', e); }
}

// Reusable gallery of past backgrounds — separate from the "current" pointer above,
// so resetting to default or switching photos never loses previously used ones.
async function fbAddBackgroundHistory(id, dataUrl) {
    if (!_fb) return;
    try {
        await _fb.setDoc(_fb.doc(_fb.db, 'backgrounds', id), { image: dataUrl, at: Date.now() });
    } catch (e) { console.error('[firebase] fbAddBackgroundHistory:', e); }
}

async function fbGetBackgroundHistory(max) {
    if (!_fb) return [];
    try {
        const q = _fb.query(
            _fb.collection(_fb.db, 'backgrounds'),
            _fb.orderBy('at', 'desc'),
            _fb.limit(max || 12)
        );
        const snap = await _fb.getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('[firebase] fbGetBackgroundHistory:', e); return []; }
}

async function fbDeleteBackgroundHistoryEntry(id) {
    if (!_fb) return;
    try {
        await _fb.deleteDoc(_fb.doc(_fb.db, 'backgrounds', id));
    } catch (e) { console.error('[firebase] fbDeleteBackgroundHistoryEntry:', e); }
}

// ── Login history (admin panel) ────────────────────────────────────────────

async function fbLogLogin(entry) {
    if (!_fb) return;
    try {
        const ref = _fb.doc(_fb.collection(_fb.db, 'logins')); // auto-generated ID
        await _fb.setDoc(ref, entry);
    } catch (e) { console.error('[firebase] fbLogLogin:', e); }
}

async function fbGetLogins(max) {
    if (!_fb) return [];
    try {
        const q = _fb.query(
            _fb.collection(_fb.db, 'logins'),
            _fb.orderBy('at', 'desc'),
            _fb.limit(max || 200)
        );
        const snap = await _fb.getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (e) { console.error('[firebase] fbGetLogins:', e); return []; }
}

async function fbDeleteFile(key) {
    if (!_fb) return;
    try {
        const manifest = await _fb.getDoc(_fb.doc(_fb.db, 'files', key));
        if (!manifest.exists()) return;
        const { n: totalChunks } = manifest.data();
        const deletes = Array.from({ length: totalChunks }, (_, i) =>
            _fb.deleteDoc(_fb.doc(_fb.db, 'files', key + '_' + i))
        );
        deletes.push(_fb.deleteDoc(_fb.doc(_fb.db, 'files', key)));
        await Promise.all(deletes);
    } catch (e) { console.error('[firebase] fbDeleteFile:', e); }
}

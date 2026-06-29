// AES-256-GCM file encryption, keyed from the user's password via PBKDF2.
// Key lives only in sessionStorage — cleared when the tab closes.

const _PBKDF2_SALT = new TextEncoder().encode('sanctuary-vault-v1');

async function deriveKey(password) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: _PBKDF2_SALT, iterations: 200000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function saveKeyToSession(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem('vaultKey', _bufToB64(raw));
}

async function loadKeyFromSession() {
    const b64 = sessionStorage.getItem('vaultKey');
    if (!b64) return null;
    try {
        const raw = _b64ToBuf(b64);
        return crypto.subtle.importKey(
            'raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
    } catch { return null; }
}

// Returns ArrayBuffer: 12-byte IV prepended to ciphertext
async function encryptBuf(key, buf) {
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return out.buffer;
}

// Accepts ArrayBuffer with IV prepended
async function decryptBuf(key, buf) {
    const arr = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
    const iv  = arr.slice(0, 12);
    const ct  = arr.slice(12);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

// ── Format helpers ────────────────────────────────────────────────────────────

function dataUrlToArrayBuffer(dataUrl) {
    return _b64ToBuf(dataUrl.split(',')[1]);
}

function arrayBufferToDataUrl(buf, mimeType) {
    return 'data:' + mimeType + ';base64,' + _bufToB64(buf);
}

function extToMime(ext) {
    return ({
        pdf:  'application/pdf',
        jpg:  'image/jpeg',
        jpeg: 'image/jpeg',
        png:  'image/png',
        gif:  'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp:  'image/bmp',
    })[ext] || 'application/octet-stream';
}

// ── Private ───────────────────────────────────────────────────────────────────

function _bufToB64(buf) {
    const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
}

function _b64ToBuf(b64) {
    const str   = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
}

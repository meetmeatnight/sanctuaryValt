const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function hashPassword(password) {
    const buf     = new TextEncoder().encode(password);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function login(password) {
    if (!password) return false;

    const hash = await hashPassword(password);

    // ── Regular login: view-only. Encryption key is derived directly from
    // the password, exactly as before — existing files keep decrypting fine.
    if (CONFIG.passwordHash && CONFIG.passwordHash !== 'REPLACE_WITH_YOUR_PASSWORD_HASH'
        && hash === CONFIG.passwordHash) {
        const encKey = await deriveKey(password);
        await saveKeyToSession(encKey);
        return _finishLogin('user');
    }

    // ── Admin login: upload/delete/login-history access. The admin password
    // never sees the regular password, so instead of deriving its own
    // (different) file key, it unwraps CONFIG.adminWrappedKey — the real
    // vault key, pre-encrypted with the admin password by setup.html — so
    // admin and regular logins end up sharing the exact same decryption key.
    if (CONFIG.adminPasswordHash && CONFIG.adminWrappedKey && hash === CONFIG.adminPasswordHash) {
        try {
            const adminKey   = await deriveKey(password);
            const wrappedBuf = _b64ToBuf(CONFIG.adminWrappedKey);
            const masterRaw  = await decryptBuf(adminKey, wrappedBuf);
            sessionStorage.setItem('vaultKey', _bufToB64(masterRaw));
        } catch (e) {
            console.warn('Admin credential misconfigured (adminWrappedKey). See js/config.js');
            return false;
        }
        return _finishLogin('admin');
    }

    return false;
}

async function _finishLogin(role) {
    // Auth token = SHA-256(vaultKey + salt).
    // Knowing CONFIG.passwordHash does NOT let you compute this — you must know the plaintext
    // password to derive vaultKey first. Copying the hash from config.js is therefore useless.
    const vaultKeyB64 = sessionStorage.getItem('vaultKey');
    const authToken   = await hashPassword(vaultKeyB64 + ':sanctuary-auth:');
    sessionStorage.setItem('auth',   authToken);
    sessionStorage.setItem('authAt', Date.now().toString());
    sessionStorage.setItem('role',   role);
    return { role };
}

async function isAuthenticated() {
    const stored   = sessionStorage.getItem('auth');
    const vaultKey = sessionStorage.getItem('vaultKey');

    if (!stored || !vaultKey) return false;
    if (stored.length !== 64 || !/^[0-9a-f]{64}$/.test(stored)) return false;

    // Re-derive expected token from the stored vaultKey and verify.
    // Note: an attacker CAN craft a matching (auth, vaultKey) pair with arbitrary values,
    // but a fake vaultKey won't decrypt any files — so bypassing the gate gives nothing.
    // The content is independently protected by AES-256-GCM encryption.
    const expected = await hashPassword(vaultKey + ':sanctuary-auth:');
    if (stored !== expected) return false;

    const authAt = parseInt(sessionStorage.getItem('authAt') || '0', 10);
    if (authAt > 0 && Date.now() - authAt > SESSION_TTL) {
        sessionStorage.clear();
        return false;
    }

    return true;
}

function getRole() {
    return sessionStorage.getItem('role') === 'admin' ? 'admin' : 'user';
}

function isAdmin() {
    return getRole() === 'admin';
}

// Best-effort, human-readable "browser on OS" label for the login-history panel.
// Not a security boundary — just enough to tell devices apart at a glance.
function getDeviceLabel() {
    const ua = navigator.userAgent || '';

    let browser = 'Unknown browser';
    if (/Edg\//.test(ua))                              browser = 'Edge';
    else if (/OPR\//.test(ua) || /Opera/.test(ua))      browser = 'Opera';
    else if (/Firefox\//.test(ua))                      browser = 'Firefox';
    else if (/Chrome\//.test(ua))                       browser = 'Chrome';
    else if (/Safari\//.test(ua))                       browser = 'Safari';

    let os = 'Unknown OS';
    if (/Windows/.test(ua))                             os = 'Windows';
    else if (/iPhone|iPad|iPod/.test(ua))                os = 'iOS';
    else if (/Android/.test(ua))                         os = 'Android';
    else if (/Mac OS X/.test(ua))                        os = 'macOS';
    else if (/Linux/.test(ua))                           os = 'Linux';

    return `${browser} on ${os}`;
}

// The name typed on the login screen, remembered per browser so it doesn't
// have to be retyped — shown next to the role in the admin login-history panel.
function getLoginName() {
    return localStorage.getItem('sanctuary-login-name') || '';
}

function setLoginName(name) {
    if (name) localStorage.setItem('sanctuary-login-name', name);
}

// Best-effort IP + approximate location via a free, keyless IP-geolocation API.
// Never blocks login — failures (offline, ad-blocker, rate limit) just omit the fields.
async function getIpInfo() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('https://ipwho.is/', { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || data.success === false) return null;
        return {
            ip:       data.ip || '',
            location: [data.city, data.region, data.country].filter(Boolean).join(', ')
        };
    } catch {
        return null;
    }
}

function _hasFirebaseConfig() {
    return !!(CONFIG.firebaseConfig && CONFIG.firebaseConfig.apiKey && CONFIG.firebaseEmail && CONFIG.firebasePassword);
}

// Wipes everything cached on this device (vault metadata, background settings, cached
// file bytes, session) whenever the visitor isn't currently authenticated, so nothing
// lingers without a valid login. Firestore is untouched — next successful login re-syncs
// it all back down. Only runs when Firebase sync is actually configured: otherwise this
// device's storage IS the only copy of the vault, and wiping it would destroy it for good.
//
// Before wiping anything, this waits for in-flight syncs and then actually VERIFIES every
// document's file is confirmed present in Firestore (ensureFullySynced, in storage.js) —
// not just "a push was attempted." If that can't be confirmed, the wipe is skipped entirely
// (only the session is cleared) rather than risk destroying something that never made it
// to the cloud. This exists because that exact scenario has already caused real data loss.
async function clearLocalVaultDataIfSignedOut() {
    if (!_hasFirebaseConfig()) return;

    // Nothing local to protect on a device/container that has never cached anything here —
    // e.g. a freshly added "Add to Home Screen" icon, which gets its own empty storage
    // sandbox separate from regular Safari. Proceeding anyway let ensureFullySynced() push
    // that empty state to Firestore as "confirmed synced," overwriting real data before
    // anyone even logged in. Only bother verifying/wiping when there's actually something here.
    const hasLocalCache = localStorage.getItem('sanctuary-vault') !== null
        || localStorage.getItem('sanctuary-custom-bg') !== null
        || localStorage.getItem('sanctuary-bg-history') !== null;
    if (!hasLocalCache) return;

    if (typeof flushPendingSyncs === 'function') {
        await Promise.race([flushPendingSyncs(), new Promise(r => setTimeout(r, 5000))]);
    }

    if (typeof ensureFullySynced === 'function') {
        const synced = await Promise.race([
            ensureFullySynced(),
            new Promise(resolve => setTimeout(() => resolve(false), 8000))
        ]).catch(() => false);
        if (!synced) {
            console.warn('[wipe] Could not confirm everything is backed up to the cloud yet — skipping the local wipe this time.');
            return;
        }
    }

    localStorage.clear();
    sessionStorage.clear();
    try {
        await new Promise(resolve => {
            const req = indexedDB.deleteDatabase('sanctuary-db');
            req.onsuccess = resolve;
            req.onerror   = resolve;
            req.onblocked = resolve;
        });
    } catch { /* best-effort */ }
}

async function logout() {
    await clearLocalVaultDataIfSignedOut();
    sessionStorage.clear(); // still clear even in local-only mode, or if the wipe above was skipped
    window.location.href = 'index.html';
}

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function hashPassword(password) {
    const buf     = new TextEncoder().encode(password);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function login(password) {
    if (!password || !CONFIG.passwordHash || CONFIG.passwordHash === 'REPLACE_WITH_YOUR_PASSWORD_HASH') {
        console.warn('Password hash not configured. See js/config.js');
        return false;
    }

    const hash = await hashPassword(password);
    if (hash !== CONFIG.passwordHash) return false;

    // Derive the AES encryption key from the plaintext password (PBKDF2, 200k iterations).
    // This key CANNOT be computed from CONFIG.passwordHash alone.
    const encKey = await deriveKey(password);
    await saveKeyToSession(encKey); // stores base64(rawKey) as 'vaultKey'

    // Auth token = SHA-256(vaultKey + salt).
    // Knowing CONFIG.passwordHash does NOT let you compute this — you must know the plaintext
    // password to derive vaultKey first. Copying the hash from config.js is therefore useless.
    const vaultKeyB64 = sessionStorage.getItem('vaultKey');
    const authToken   = await hashPassword(vaultKeyB64 + ':sanctuary-auth:');
    sessionStorage.setItem('auth',   authToken);
    sessionStorage.setItem('authAt', Date.now().toString());

    return true;
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

function logout() {
    sessionStorage.clear(); // clears auth, vaultKey, authAt
    window.location.href = 'index.html';
}

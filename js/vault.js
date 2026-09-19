let currentFolderId = null; // null = root
let vaultMeta       = { folders: [], documents: [] };
let staticDocs      = [];

const COVER_CYCLE = ['cover-1','cover-2','cover-3','cover-4','cover-5','cover-6'];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function initVault() {
    // Apply config background immediately (inline style resolves URL relative to document, not CSS file)
    if (CONFIG.backgroundImage) applyBgLayer(CONFIG.backgroundImage, CONFIG.backgroundPosition);
    // Admin-set global background overrides it, if one's been chosen (cached locally, refreshed below)
    const cachedCustomBg   = localStorage.getItem('sanctuary-custom-bg');
    const cachedCustomBgPos = localStorage.getItem('sanctuary-custom-bg-position') || 'center';
    if (cachedCustomBg) applyBgLayer(cachedCustomBg, cachedCustomBgPos);

    if (CONFIG.siteTitle) {
        document.title = CONFIG.siteTitle;
        const brand = document.querySelector('.brand-title');
        if (brand) brand.textContent = CONFIG.siteTitle;
    }
    if (CONFIG.welcomeMessage) {
        const el = document.getElementById('vault-desc');
        if (el) el.textContent = CONFIG.welcomeMessage;
    }

    // Load static docs from documents.json (same-origin — fast, no need to wait on Firebase for this)
    try {
        const res = await fetch('documents.json', { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            staticDocs = (data.documents || []).map(d => ({ ...d, _static: true, folderId: null }));
        }
    } catch {}

    // Render immediately from whatever's already cached locally, instead of leaving the
    // page on "Loading…" for the whole Firebase round-trip. Cloud sync (below) runs in the
    // background afterward and only re-renders if it actually finds something different.
    vaultMeta = getVaultMeta();
    await purgeExpiredTrash();
    await applyStoredBackground();

    try { setupFolderModal();     } catch (e) { console.error('[init] setupFolderModal:', e); }
    try { setupUploadModal();     } catch (e) { console.error('[init] setupUploadModal:', e); }
    try { setupComposeModal();    } catch (e) { console.error('[init] setupComposeModal:', e); }
    try { setupDeleteModal();     } catch (e) { console.error('[init] setupDeleteModal:', e); }
    try { setupMoveModal();       } catch (e) { console.error('[init] setupMoveModal:', e); }
    try { setupTrashModal();      } catch (e) { console.error('[init] setupTrashModal:', e); }
    try { setupPageSheetBodyClass(); } catch (e) { console.error('[init] setupPageSheetBodyClass:', e); }
    try { setupAdminPanel();      } catch (e) { console.error('[init] setupAdminPanel:', e); }
    try { setupBackgroundModal(); } catch (e) { console.error('[init] setupBackgroundModal:', e); }
    try { setupProfileMenu();     } catch (e) { console.error('[init] setupProfileMenu:', e); }
    try { setupBottomNav();       } catch (e) { console.error('[init] setupBottomNav:', e); }
    try { setupViewToggle();      } catch (e) { console.error('[init] setupViewToggle:', e); }
    applyRolePermissions();
    logLoginOnce();
    renderBreadcrumb();
    renderGrid();

    // Sync with Firebase in the background — doesn't block the first paint above.
    // Only re-renders if the cloud actually has something different from what's cached.
    if (typeof initFirebase === 'function') {
        const cachedCustomBg = localStorage.getItem('sanctuary-custom-bg');
        initFirebase().then(async fbOk => {
            if (!fbOk) return;

            const [cloudMeta, cloudBg, cloudBgHistory] = await Promise.all([
                fbPullMeta().catch(() => null),
                fbPullBackground().catch(() => null),
                fbGetBackgroundHistory().catch(() => [])
            ]);

            let contentChanged = false;
            if (cloudMeta) {
                // A folder/document created here may not have made it to Firestore yet
                // (closed the tab mid-upload, a dropped connection — pushes are fire-and-forget
                // and don't retry). Blindly adopting cloud as-is would silently erase it the
                // moment this device reconnects. Keep anything local-only and push it back up.
                const localMetaBefore = getVaultMeta();
                const cloudDocIds     = new Set((cloudMeta.documents || []).map(d => d.id));
                const cloudFolderIds  = new Set((cloudMeta.folders   || []).map(f => f.id));
                const localOnlyDocs    = (localMetaBefore.documents || []).filter(d => !cloudDocIds.has(d.id));
                const localOnlyFolders = (localMetaBefore.folders   || []).filter(f => !cloudFolderIds.has(f.id));

                let mergedMeta = cloudMeta;
                if (localOnlyDocs.length || localOnlyFolders.length) {
                    mergedMeta = {
                        folders:   [...(cloudMeta.folders   || []), ...localOnlyFolders],
                        documents: [...(cloudMeta.documents || []), ...localOnlyDocs]
                    };
                    fbPushMeta(mergedMeta).catch(() => {});
                }

                localStorage.setItem('sanctuary-vault', JSON.stringify(mergedMeta));
                vaultMeta = getVaultMeta();
                contentChanged = true;
            } else {
                // First time connecting to Firebase — push existing local data up
                const localMeta = getVaultMeta();
                if (localMeta.documents.length || localMeta.folders.length) {
                    fbPushMeta(localMeta).catch(() => {});
                }
            }

            if (cloudBg && cloudBg.image !== cachedCustomBg) {
                localStorage.setItem('sanctuary-custom-bg', cloudBg.image);
                localStorage.setItem('sanctuary-custom-bg-position', cloudBg.position || 'center');
                applyBgLayer(cloudBg.image, cloudBg.position || 'center');
            }
            if (cloudBgHistory && cloudBgHistory.length) {
                saveBackgroundHistoryLocal(cloudBgHistory);
            }

            if (contentChanged) {
                await purgeExpiredTrash();
                await applyStoredBackground(); // a personal wallpaper pick may reference a doc that just arrived
                renderBreadcrumb();
                renderGrid();
            }
        }).catch(e => console.error('[init] background Firebase sync failed:', e));
    }
}

// ── Role permissions ─────────────────────────────────────────────────────────

function applyRolePermissions() {
    const admin = isAdmin();
    const btnFolder    = document.getElementById('btn-new-folder');
    const btnUpload    = document.getElementById('btn-upload');
    const navWrite     = document.getElementById('nav-write');
    const navBg        = document.getElementById('nav-background');
    const navHistory   = document.getElementById('nav-history');
    const btnTrash     = document.getElementById('btn-trash');
    if (btnFolder)  btnFolder.hidden  = !admin;
    if (btnUpload)  btnUpload.hidden  = !admin;
    if (navWrite)   navWrite.hidden   = !admin;
    if (navBg)      navBg.hidden      = !admin;
    if (navHistory) navHistory.hidden = !admin;
    if (btnTrash)   btnTrash.hidden   = !admin;
}

// ── Profile page (opened from the bottom nav's Profile tab) ─────────────────

function setupProfileMenu() {
    const page = document.getElementById('modal-profile');
    const trigger = document.getElementById('nav-profile');
    if (!page || !trigger) return;

    const closeBtn = document.getElementById('profile-modal-close');
    const nameEl   = document.getElementById('profile-modal-name');
    const roleEl   = document.getElementById('profile-modal-role');
    const avatarLg = document.getElementById('profile-avatar-lg');

    const initial = (getLoginName() || '').trim().charAt(0).toUpperCase() || (isAdmin() ? 'A' : 'U');
    if (avatarLg) avatarLg.textContent = initial;

    trigger.addEventListener('click', () => {
        if (nameEl) nameEl.textContent = getLoginName() || (isAdmin() ? 'Admin' : 'Guest');
        if (roleEl) roleEl.textContent = isAdmin() ? 'Admin' : 'Viewer';
        closeAllPageSheets();
        page.hidden = false;
    });

    closeBtn.addEventListener('click', () => { page.hidden = true; });
}

// Closes any open top-level page-sheet before switching to another one from the
// bottom nav, so only one is ever showing (the Trash page, opened from inside
// Profile rather than the nav, is intentionally left alone by this).
function closeAllPageSheets() {
    document.querySelectorAll('.page-sheet').forEach(el => { el.hidden = true; });
}

// Which bottom-nav item should be highlighted while a given page-sheet is open.
// Trash has no nav item of its own (it's reached from inside Profile), so it keeps
// Profile highlighted rather than lighting up nothing.
const SHEET_NAV_MAP = {
    'modal-compose':    'nav-write',
    'modal-background': 'nav-background',
    'modal-admin':      'nav-history',
    'modal-profile':    'nav-profile',
    'modal-trash':      'nav-profile'
};

function setActiveNavItem(navId) {
    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.toggle('is-active', el.id === navId));
}

// Keeps body.sheet-open AND the bottom nav's highlighted tab in sync with whichever
// .page-sheet is actually visible, regardless of which one opened or closed it —
// covers Trash opening/closing on top of Profile too, not just the nav-level sheets.
function setupPageSheetBodyClass() {
    const sheets = document.querySelectorAll('.page-sheet');
    const sync = () => {
        const openSheet = Array.from(sheets).find(el => !el.hidden);
        document.body.classList.toggle('sheet-open', !!openSheet);
        setActiveNavItem(openSheet ? (SHEET_NAV_MAP[openSheet.id] || 'nav-collection') : 'nav-collection');
    };
    sheets.forEach(el => new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden'] }));
    sync();
}

// ── Bottom Nav (mobile only — hidden on desktop via CSS) ────────────────────

function setupBottomNav() {
    const navCollection = document.getElementById('nav-collection');
    if (navCollection) navCollection.addEventListener('click', () => { closeAllPageSheets(); navigateTo(null); });
    // nav-write is wired by setupComposeModal(), nav-background by setupBackgroundModal(),
    // nav-history by setupAdminPanel(), nav-profile by setupProfileMenu()
}

// ── View toggle (grid / list) — a personal display preference, not role-gated ──

function setupViewToggle() {
    const gridBtn = document.getElementById('view-grid-btn');
    const listBtn = document.getElementById('view-list-btn');
    const grid    = document.getElementById('docs-grid');
    if (!gridBtn || !listBtn || !grid) return;

    const apply = mode => {
        grid.classList.toggle('list-mode', mode === 'list');
        gridBtn.classList.toggle('is-active', mode === 'grid');
        listBtn.classList.toggle('is-active', mode === 'list');
        localStorage.setItem('sanctuary-view-mode', mode);
    };

    gridBtn.addEventListener('click', () => apply('grid'));
    listBtn.addEventListener('click', () => apply('list'));
    apply(localStorage.getItem('sanctuary-view-mode') === 'list' ? 'list' : 'grid');
}

// Records this session's login (name, role, device, IP, location) once, for the admin login-history panel.
async function logLoginOnce() {
    if (sessionStorage.getItem('loginLogged') === '1') return;
    sessionStorage.setItem('loginLogged', '1');
    if (typeof fbLogLogin !== 'function') return;

    const ipInfo = await getIpInfo(); // null if offline/blocked — logged in without it
    fbLogLogin({
        at:       Date.now(),
        role:     getRole(),
        name:     getLoginName(),
        device:   getDeviceLabel(),
        ip:       ipInfo?.ip || '',
        location: ipInfo?.location || ''
    }).catch(() => {});
}

// Sets background directly on .bg-layer so URL resolves relative to document, not stylesheet
// CONFIG.backgroundPosition is hand-tuned for CONFIG.backgroundImage specifically (keeps its
// subject in frame). Any other photo's framing is unknown, so it only applies to that one photo —
// everything else (admin's custom background, a personal per-doc wallpaper) centers by default.
function applyBgLayer(src, position) {
    if (!src) return;
    const layer = document.querySelector('.bg-layer');
    if (!layer) return;
    layer.style.backgroundImage =
        'linear-gradient(rgba(14,8,16,.72),rgba(14,8,16,.72)), url("' + src.replace(/"/g, '\\"') + '")';
    layer.style.backgroundPosition = position || 'center';
}

// Loads vault background from IndexedDB (if user has set one) and applies it
async function applyStoredBackground() {
    const bgKey = localStorage.getItem('sanctuary-bg');
    if (!bgKey) return;
    const doc = vaultMeta.documents.find(d => d.storageKey === bgKey);
    if (!doc) return;
    try {
        const rawData = await retrieveFile(doc.storageKey);
        if (!rawData) return;
        const key = await loadKeyFromSession();
        let src;
        if (doc.encrypted && key) {
            const dec = await decryptBuf(key, rawData);
            src = arrayBufferToDataUrl(dec, extToMime(doc.type));
        } else if (!doc.encrypted) {
            src = rawData;
        }
        if (src) applyBgLayer(src);
    } catch {}
}

// Saves an uploaded image as the vault background
async function setAsBackground(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    try {
        const rawData = await retrieveFile(doc.storageKey);
        if (!rawData) return;
        const key = await loadKeyFromSession();
        let src;
        if (doc.encrypted && key) {
            const dec = await decryptBuf(key, rawData);
            src = arrayBufferToDataUrl(dec, extToMime(doc.type));
        } else if (!doc.encrypted) {
            src = rawData;
        }
        if (!src) return;
        localStorage.setItem('sanctuary-bg', doc.storageKey);
        applyBgLayer(src);
        const btn = document.querySelector(`.card-bg-btn[data-doc-id="${CSS.escape(docId)}"]`);
        if (btn) { btn.textContent = '✓ Set'; setTimeout(() => { btn.textContent = '⊞ Wallpaper'; }, 1500); }
    } catch (err) {
        console.error('[bg] setAsBackground failed:', err);
    }
}

// ── Site Background (admin-managed, plaintext, synced across devices) ───────

// Downscales a photo for use as a full-screen background and returns a JPEG data URL.
// Not encrypted — this is shown on the gate page, before anyone has entered a password.
async function _resizeImageDataUrl(plainBuf, mime, maxDim, quality) {
    const blob = new Blob([plainBuf], { type: mime });
    const url  = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload  = () => resolve(el);
            el.onerror = reject;
            el.src = url;
        });
        const scale  = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Local cache of the background gallery — replaced wholesale from Firestore when reachable
// (same pattern as vaultMeta), so it still works, self-contained, in local-only mode.
const BG_HISTORY_MAX = 12;

function getBackgroundHistory() {
    try {
        const raw = localStorage.getItem('sanctuary-bg-history');
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveBackgroundHistoryLocal(list) {
    localStorage.setItem('sanctuary-bg-history', JSON.stringify(list.slice(0, BG_HISTORY_MAX)));
}

// Upserts by image so repositioning an already-used photo updates its entry
// instead of adding a duplicate with a different focal point.
function _upsertBackgroundHistory(image, position) {
    const history = getBackgroundHistory();
    const idx = history.findIndex(h => h.image === image);
    let id;
    if (idx !== -1) {
        id = history[idx].id;
        history[idx] = { ...history[idx], position, at: Date.now() };
    } else {
        id = genId();
        history.unshift({ id, image, position, at: Date.now() });
    }
    saveBackgroundHistoryLocal(history);
    return id;
}

function setupBackgroundModal() {
    const btn        = document.getElementById('nav-background');
    const modal      = document.getElementById('modal-background');
    if (!btn || !modal) return;

    const closeBtn    = document.getElementById('background-modal-close');
    const previewWrap = document.getElementById('bg-preview-wrap');
    const preview     = document.getElementById('bg-preview');
    const marker      = document.getElementById('bg-preview-marker');
    const fileInput   = document.getElementById('bg-file-input');
    const zoneText    = document.getElementById('bg-upload-zone-text');
    const zone        = document.getElementById('bg-upload-zone');
    const errorEl     = document.getElementById('background-error');
    const saveBtn     = document.getElementById('background-save');
    const resetBtn    = document.getElementById('background-reset');
    const historyGrid = document.getElementById('bg-history-grid');

    let pendingDataUrl = null;
    let pendingPosition = 'center';
    const currentSrc = () => localStorage.getItem('sanctuary-custom-bg') || CONFIG.backgroundImage || '';

    const setMarker = position => {
        if (!marker) return;
        const parts = (position || 'center').split(' ');
        const x = parts[0] === 'center' ? 50 : (parseFloat(parts[0]) || 50);
        const y = (!parts[1] || parts[1] === 'center') ? 50 : (parseFloat(parts[1]) || 50);
        marker.style.left = x + '%';
        marker.style.top  = y + '%';
        marker.hidden = false;
    };

    previewWrap.addEventListener('click', e => {
        const rect = preview.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
        pendingPosition = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
        setMarker(pendingPosition);
    });

    const renderHistory = () => {
        if (!historyGrid) return;
        const history = getBackgroundHistory();
        const current = localStorage.getItem('sanctuary-custom-bg');

        if (!history.length) {
            historyGrid.innerHTML = '<p class="bg-history-empty">No previous backgrounds yet.</p>';
            return;
        }

        historyGrid.innerHTML = history.map(h => `
            <div class="bg-history-thumb${h.image === current ? ' is-current' : ''}" data-id="${escHtml(h.id)}">
                <img src="${escHtml(h.image)}" alt="" draggable="false">
                <button class="bg-history-thumb-del" data-id="${escHtml(h.id)}" title="Remove">✕</button>
            </div>
        `).join('');

        historyGrid.querySelectorAll('.bg-history-thumb').forEach(el => {
            el.addEventListener('click', e => {
                if (e.target.closest('.bg-history-thumb-del')) return;
                const entry = history.find(h => h.id === el.dataset.id);
                if (entry) selectFromHistory(entry);
            });
        });
        historyGrid.querySelectorAll('.bg-history-thumb-del').forEach(delBtn => {
            delBtn.addEventListener('click', async e => {
                e.stopPropagation();
                const remaining = getBackgroundHistory().filter(h => h.id !== delBtn.dataset.id);
                saveBackgroundHistoryLocal(remaining);
                if (typeof fbDeleteBackgroundHistoryEntry === 'function') {
                    await fbDeleteBackgroundHistoryEntry(delBtn.dataset.id).catch(() => {});
                }
                renderHistory();
            });
        });
    };

    const selectFromHistory = async entry => {
        const position = entry.position || 'center';
        localStorage.setItem('sanctuary-custom-bg', entry.image);
        localStorage.setItem('sanctuary-custom-bg-position', position);
        applyBgLayer(entry.image, position);
        preview.src = entry.image;
        pendingDataUrl  = null;
        pendingPosition = position;
        setMarker(position);
        if (typeof fbPushBackground === 'function') await fbPushBackground(entry.image, position).catch(() => {});
        showToast('✓  Background updated');
        renderHistory();
    };

    const openModal = () => {
        pendingDataUrl = null;
        fileInput.value = '';
        if (zoneText) zoneText.textContent = '↑  Choose a photo…';
        if (zone) zone.classList.remove('has-file');
        if (errorEl) errorEl.hidden = true;
        preview.src = currentSrc();
        pendingPosition = localStorage.getItem('sanctuary-custom-bg-position')
            || (currentSrc() === CONFIG.backgroundImage ? (CONFIG.backgroundPosition || 'center') : 'center');
        setMarker(pendingPosition);
        renderHistory();
        closeAllPageSheets();
        modal.hidden = false;
    };
    btn.addEventListener('click', openModal);

    fileInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const buf  = dataUrlToArrayBuffer(ev.target.result);
                const mime = extToMime(file.name.split('.').pop().toLowerCase());
                pendingDataUrl  = await _resizeImageDataUrl(buf, mime, 1600, 0.78);
                pendingPosition = 'center'; // new photo — old focal point wouldn't mean anything on it
                preview.src = pendingDataUrl;
                setMarker(pendingPosition);
                if (zoneText) zoneText.textContent = '✓  ' + file.name;
                if (zone) zone.classList.add('has-file');
                if (errorEl) errorEl.hidden = true;
            } catch (err) {
                console.error('[background] could not process image:', err);
                if (errorEl) { errorEl.textContent = 'Could not read that image.'; errorEl.hidden = false; }
            }
        };
        reader.readAsDataURL(file);
    });

    const closeModal = () => { modal.hidden = true; };
    closeBtn.addEventListener('click', closeModal);

    saveBtn.addEventListener('click', async () => {
        const image = pendingDataUrl || currentSrc();
        if (!image) { closeModal(); return; }
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
            const id = _upsertBackgroundHistory(image, pendingPosition);

            localStorage.setItem('sanctuary-custom-bg', image);
            localStorage.setItem('sanctuary-custom-bg-position', pendingPosition);
            applyBgLayer(image, pendingPosition);

            if (typeof fbPushBackground === 'function') await fbPushBackground(image, pendingPosition).catch(() => {});
            if (typeof fbAddBackgroundHistory === 'function') await fbAddBackgroundHistory(id, image, pendingPosition).catch(() => {});

            showToast('✓  Background updated');
            closeModal();
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
        }
    });

    resetBtn.addEventListener('click', async () => {
        localStorage.removeItem('sanctuary-custom-bg');
        localStorage.removeItem('sanctuary-custom-bg-position');
        applyBgLayer(CONFIG.backgroundImage, CONFIG.backgroundPosition);
        preview.src = CONFIG.backgroundImage || '';
        pendingDataUrl  = null;
        pendingPosition = CONFIG.backgroundPosition || 'center';
        setMarker(pendingPosition);
        if (typeof fbDeleteBackground === 'function') await fbDeleteBackground().catch(() => {});
        showToast('Background reset to default');
        renderHistory();
    });
}

// ── Compose Letter (paste text → a romantic, mobile-readable PDF) ───────────
// Page is sized like a phone screen so PDF viewers that fit-to-width render
// the text comfortably large — no pinch-zoom needed to read it.

const LETTER_PAGE_W = 400;
const LETTER_PAGE_H = 700;
const LETTER_MARGIN = 42;
const LETTER_CREAM   = [238, 224, 208];
const LETTER_AMBER   = [212, 168, 112];

// Drawn, not typed — dingbat characters like ❧ aren't in the standard PDF fonts'
// character set and render as garbage, so the ornament is a small vector heart instead.
function _drawHeart(doc, cx, cy, size, color) {
    doc.setFillColor(...color);
    const r = size * 0.28;
    doc.circle(cx - r, cy - r * 0.3, r, 'F');
    doc.circle(cx + r, cy - r * 0.3, r, 'F');
    doc.triangle(
        cx - r * 1.9, cy - r * 0.15,
        cx + r * 1.9, cy - r * 0.15,
        cx, cy + size * 0.62,
        'F'
    );
}

function _dataUrlMimeToJsPdfFormat(dataUrl) {
    const m = /^data:image\/(\w+)/.exec(dataUrl || '');
    return m ? m[1].toUpperCase().replace('JPG', 'JPEG') : 'JPEG';
}

// Reuses whichever background is currently active (admin's custom one, or the bundled
// default) so the letter looks like it belongs to the same site instead of a blank page.
async function _loadCurrentBackgroundDataUrl() {
    const custom = localStorage.getItem('sanctuary-custom-bg');
    if (custom) return custom;
    if (!CONFIG.backgroundImage) return null;
    try {
        const res = await fetch(CONFIG.backgroundImage);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const ext = CONFIG.backgroundImage.split('.').pop().toLowerCase();
        return arrayBufferToDataUrl(buf, extToMime(ext));
    } catch {
        return null;
    }
}

function _drawLetterPageBackground(doc, bgDataUrl) {
    const w = LETTER_PAGE_W, h = LETTER_PAGE_H;
    if (bgDataUrl) {
        try {
            doc.addImage(bgDataUrl, _dataUrlMimeToJsPdfFormat(bgDataUrl), 0, 0, w, h, undefined, 'FAST');
        } catch {
            doc.setFillColor(26, 14, 22);
            doc.rect(0, 0, w, h, 'F');
        }
    } else {
        // No photo configured — a soft rose-to-dark gradient stands in for one.
        const bands = 60;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            doc.setFillColor(
                Math.round(90 + (14 - 90) * t),
                Math.round(37 + (8  - 37) * t),
                Math.round(53 + (16 - 53) * t)
            );
            doc.rect(0, (h / bands) * i, w, h / bands + 1, 'F');
        }
    }
    // Dark veil for text contrast — the same treatment the site uses over its own background.
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.6 }));
    doc.setFillColor(14, 8, 16);
    doc.rect(0, 0, w, h, 'F');
    doc.restoreGraphicsState();
}

async function generateLetterPdf(title, bodyText) {
    if (typeof window.jspdf === 'undefined') throw new Error('PDF library failed to load. Check your internet connection.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: [LETTER_PAGE_W, LETTER_PAGE_H] });
    const bgDataUrl  = await _loadCurrentBackgroundDataUrl();
    const contentW   = LETTER_PAGE_W - LETTER_MARGIN * 2;

    let y = 0;
    const newPage = first => {
        if (!first) doc.addPage();
        _drawLetterPageBackground(doc, bgDataUrl);
        y = LETTER_MARGIN;
    };
    newPage(true);

    _drawHeart(doc, LETTER_PAGE_W / 2, y + 10, 16, LETTER_AMBER);
    y += 42;

    doc.setFont('times', 'bolditalic');
    doc.setFontSize(24);
    doc.setTextColor(...LETTER_CREAM);
    doc.splitTextToSize(title || 'For You', contentW).forEach(line => {
        doc.text(line, LETTER_PAGE_W / 2, y, { align: 'center' });
        y += 30;
    });

    y += 6;
    doc.setDrawColor(...LETTER_AMBER);
    doc.setLineWidth(0.75);
    doc.line(LETTER_PAGE_W / 2 - 40, y, LETTER_PAGE_W / 2 + 40, y);
    y += 34;

    const bodyFontSize = 15;
    const lineHeight    = bodyFontSize * 1.65;
    doc.setFont('times', 'normal');
    doc.setFontSize(bodyFontSize);
    doc.setTextColor(...LETTER_CREAM);

    (bodyText || '').split(/\n{2,}/).forEach(para => {
        doc.splitTextToSize(para.trim(), contentW).forEach(line => {
            if (y > LETTER_PAGE_H - LETTER_MARGIN) newPage(false);
            doc.text(line, LETTER_MARGIN, y);
            y += lineHeight;
        });
        y += lineHeight * 0.6;
    });

    if (y > LETTER_PAGE_H - LETTER_MARGIN - 30) newPage(false);
    _drawHeart(doc, LETTER_PAGE_W / 2, y + 12, 14, LETTER_AMBER);

    return doc;
}

// Saves the generated letter into the vault exactly like an uploaded PDF —
// same encryption, same cover-thumbnail pipeline.
async function _saveLetterToVault(pdfDoc, title) {
    const plainBuf = pdfDoc.output('arraybuffer');
    const key = await loadKeyFromSession();

    let storageData, encrypted = false;
    if (key) {
        storageData = await encryptBuf(key, plainBuf);
        encrypted   = true;
    } else {
        storageData = arrayBufferToDataUrl(plainBuf, 'application/pdf');
    }

    const id         = genId();
    const storageKey = id + '.pdf';
    await storeFile(storageKey, storageData);

    let thumbFields = {};
    try {
        const thumbBuf = await _thumbFromPdf(plainBuf);
        if (thumbBuf) {
            thumbFields = key
                ? { thumb: _bufToB64(await encryptBuf(key, thumbBuf)), thumbEncrypted: true }
                : { thumb: _bufToB64(thumbBuf), thumbEncrypted: false };
        }
    } catch (e) {
        console.warn('[compose] thumbnail generation failed:', e);
    }

    const docMeta = {
        id,
        title:       title || 'A Letter',
        description: 'Written with love',
        type:        'pdf',
        folderId:    currentFolderId,
        storageKey,
        encrypted,
        date:        formatDate(Date.now()),
        coverClass:  COVER_CYCLE[vaultMeta.documents.length % COVER_CYCLE.length],
        visible:     false, // hidden from the regular login until admin allows it
        ...thumbFields
    };

    vaultMeta.documents.push(docMeta);
    saveVaultMeta(vaultMeta);
    renderGrid();
}

function setupComposeModal() {
    const btn   = document.getElementById('nav-write');
    const modal = document.getElementById('modal-compose');
    if (!btn || !modal) return;

    const closeBtn    = document.getElementById('compose-modal-close');
    const titleInput  = document.getElementById('compose-title');
    const textInput   = document.getElementById('compose-text');
    const errorEl     = document.getElementById('compose-error');
    const downloadBtn = document.getElementById('compose-download');
    const saveBtn     = document.getElementById('compose-save');

    const openModal = () => {
        titleInput.value = '';
        textInput.value  = '';
        if (errorEl) errorEl.hidden = true;
        closeAllPageSheets();
        modal.hidden = false;
        setTimeout(() => titleInput.focus(), 60);
    };
    btn.addEventListener('click', openModal);

    const closeModal = () => { modal.hidden = true; };
    closeBtn.addEventListener('click', closeModal);

    const validate = () => {
        if (!textInput.value.trim()) {
            errorEl.textContent = 'Write something first.';
            errorEl.hidden = false;
            return false;
        }
        errorEl.hidden = true;
        return true;
    };

    downloadBtn.addEventListener('click', async () => {
        if (!validate()) return;
        downloadBtn.disabled    = true;
        downloadBtn.textContent = 'Preparing…';
        try {
            const pdf = await generateLetterPdf(titleInput.value.trim(), textInput.value);
            pdf.save((titleInput.value.trim() || 'letter') + '.pdf');
        } catch (e) {
            console.error('[compose] download failed:', e);
            errorEl.textContent = 'Could not generate the PDF: ' + (e?.message || 'unknown error');
            errorEl.hidden = false;
        } finally {
            downloadBtn.disabled    = false;
            downloadBtn.textContent = 'Download PDF';
        }
    });

    saveBtn.addEventListener('click', async () => {
        if (!validate()) return;
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
            const title = titleInput.value.trim() || 'A Letter';
            const pdf   = await generateLetterPdf(title, textInput.value);
            await _saveLetterToVault(pdf, title);
            showToast('✓  Saved — hidden until you tap "Hidden" to allow others to see it');
            closeModal();
        } catch (e) {
            console.error('[compose] save failed:', e);
            errorEl.textContent = 'Could not save to the vault: ' + (e?.message || 'unknown error');
            errorEl.hidden = false;
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save to Vault';
        }
    });
}

// ── Breadcrumb ──────────────────────────────────────────────────────────────

function renderBreadcrumb() {
    const nav = document.getElementById('breadcrumb');

    if (currentFolderId === null) {
        nav.hidden = true;
        return;
    }

    const path = [];
    let fid = currentFolderId;
    while (fid) {
        const folder = vaultMeta.folders.find(f => f.id === fid);
        if (!folder) break;
        path.unshift(folder);
        fid = folder.parentId;
    }

    const seps   = '<span class="crumb-sep" aria-hidden="true">›</span>';
    const crumbs = path.map((f, i) => {
        const isLast = i === path.length - 1;
        return `<button class="crumb${isLast ? ' crumb-active' : ''}" data-fid="${escHtml(f.id)}">${escHtml(f.name)}</button>`;
    }).join(seps);

    nav.innerHTML = `<button class="crumb" id="crumb-root">Collection</button>${seps}${crumbs}`;
    nav.hidden = false;

    document.getElementById('crumb-root').addEventListener('click', () => navigateTo(null));
    nav.querySelectorAll('.crumb[data-fid]').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.fid));
    });
}

function navigateTo(folderId) {
    currentFolderId = folderId;
    renderBreadcrumb();
    renderGrid();
}

// ── Grid ────────────────────────────────────────────────────────────────────

function renderGrid() {
    const grid  = document.getElementById('docs-grid');
    const admin = isAdmin();

    let subFolders = vaultMeta.folders.filter(f => f.parentId === currentFolderId && !f.deletedAt);
    let userDocs   = vaultMeta.documents.filter(d => d.folderId === currentFolderId && !d.deletedAt);
    if (!admin) {
        // Regular login only sees what admin has explicitly allowed.
        subFolders = subFolders.filter(f => f.visible !== false);
        userDocs   = userDocs.filter(d => d.visible !== false);
    }
    const visibleStatic = currentFolderId === null ? staticDocs : [];

    if (!subFolders.length && !userDocs.length && !visibleStatic.length) {
        const msg = currentFolderId
            ? 'This folder is empty. Upload a document or create a subfolder.'
            : 'No documents yet. Upload a file or create a folder to get started.';
        grid.innerHTML = `<p class="empty-state">${msg}</p>`;
        return;
    }

    grid.innerHTML =
        subFolders.map(renderFolderCard).join('') +
        [...visibleStatic, ...userDocs].map(renderDocCard).join('');

    hydrateThumbnails();

    // Folder: navigate on card click, but not if an action button was clicked
    grid.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.folder-del-btn') || e.target.closest('.folder-visibility-btn')) return;
            navigateTo(card.dataset.fid);
        });
    });
    grid.querySelectorAll('.folder-del-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); deleteFolder(btn.dataset.fid); });
    });
    grid.querySelectorAll('.folder-visibility-btn[data-fid]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); toggleFolderVisibility(btn.dataset.fid); });
    });
    grid.querySelectorAll('.doc-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.card-action-del') || e.target.closest('.card-action-visibility') || e.target.closest('.card-action-move')) return;
            openDoc(card.dataset.docId);
        });
    });
    grid.querySelectorAll('.card-bg-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); setAsBackground(btn.dataset.docId); });
    });
    grid.querySelectorAll('.card-action-del[data-doc-id]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); deleteDoc(btn.dataset.docId); });
    });
    grid.querySelectorAll('.card-action-visibility[data-doc-id]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); toggleDocVisibility(btn.dataset.docId); });
    });
    grid.querySelectorAll('.card-action-move[data-doc-id]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openMoveModal(btn.dataset.docId); });
    });
}

function renderFolderCard(folder) {
    const count  = countFolderContents(folder.id);
    const hint   = count === 1 ? '1 item' : `${count} items`;
    const admin  = isAdmin();
    const hidden = folder.visible === false;
    return `
        <article class="folder-card" data-fid="${escHtml(folder.id)}">
            <div class="folder-main">
                <div class="folder-icon">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 8C2 6.9 2.9 6 4 6H9.2L11 8H20C21.1 8 22 8.9 22 10V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V8Z" fill="currentColor" opacity="0.25"/>
                        <path d="M2 10C2 8.9 2.9 8 4 8H20C21.1 8 22 8.9 22 10V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="currentColor"/>
                    </svg>
                </div>
                <div class="folder-info">
                    <h3 class="folder-name">${escHtml(folder.name)}</h3>
                    <span class="folder-meta">${escHtml(hint)} · ${escHtml(folder.date || '')}</span>
                </div>
                <span class="folder-arrow">›</span>
            </div>
            ${admin ? `
                <div class="folder-actions">
                    <button class="card-action-btn folder-visibility-btn${hidden ? ' is-hidden' : ''}" data-fid="${escHtml(folder.id)}" title="Toggle visibility for the regular login">${hidden ? '🙈 Hidden' : '👁 Shown'}</button>
                    <button class="card-action-btn card-action-del folder-del-btn" data-fid="${escHtml(folder.id)}">Delete</button>
                </div>
            ` : ''}
        </article>
    `.trim();
}

function countFolderContents(fid) {
    return vaultMeta.folders.filter(f => f.parentId === fid && !f.deletedAt).length +
           vaultMeta.documents.filter(d => d.folderId === fid && !d.deletedAt).length;
}

const IMAGE_TYPES = new Set(['jpg','jpeg','png','gif','webp','avif','bmp']);

function renderDocCard(doc) {
    const typeLabel  = (doc.type || 'file').toUpperCase();
    const coverClass = doc.coverClass || 'cover-1';
    // Docs uploaded before the thumbnail feature existed have no doc.thumb yet — the
    // placeholder still renders for any thumbnailable type so hydrateThumbnails() can
    // backfill one for them the first time this card is seen, not just for new uploads.
    const canThumbnail = !doc._static && (IMAGE_TYPES.has(doc.type || '') || doc.type === 'pdf');
    const coverImg   = doc.coverImage
        ? `<img src="${escHtml(doc.coverImage)}" alt="" draggable="false">`
        : (canThumbnail ? `<img class="card-thumb-img" data-doc-id="${escHtml(doc.id)}" alt="" draggable="false" hidden>` : '');
    const admin      = isAdmin();
    const hidden     = doc.visible === false;
    return `
        <article class="doc-card" data-doc-id="${escHtml(doc.id)}">
            <div class="card-cover ${escHtml(coverClass)}">
                ${coverImg}
                <span class="cover-type">${escHtml(typeLabel)}</span>
                ${!doc._static && IMAGE_TYPES.has(doc.type || '') ? `<button class="card-bg-btn" data-doc-id="${escHtml(doc.id)}" title="Set as wallpaper">⊞ Wallpaper</button>` : ''}
            </div>
            <div class="card-info">
                <h3 class="card-title">${escHtml(doc.title || 'Untitled')}</h3>
                <p class="card-desc">${escHtml(doc.description || '')}</p>
                <div class="card-footer">
                    <span class="card-date">${escHtml(doc.date || '')}</span>
                    ${!doc._static && admin ? `
                        <div class="card-actions">
                            <button class="card-action-btn card-action-visibility${hidden ? ' is-hidden' : ''}" data-doc-id="${escHtml(doc.id)}" title="Toggle visibility for the regular login">${hidden ? '🙈 Hidden' : '👁 Shown'}</button>
                            <button class="card-action-btn card-action-move" data-doc-id="${escHtml(doc.id)}" title="Move to another folder">📁 Move</button>
                            <button class="card-action-btn card-action-del" data-doc-id="${escHtml(doc.id)}">Delete</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        </article>
    `.trim();
}

function openDoc(id) {
    window.location.href = `viewer.html?id=${encodeURIComponent(id)}`;
}

// ── New Folder Modal ─────────────────────────────────────────────────────────

function setupFolderModal() {
    const modal   = document.getElementById('modal-folder');
    const input   = document.getElementById('folder-name-input');
    const btnNew  = document.getElementById('btn-new-folder');
    const btnCancel = document.getElementById('modal-folder-cancel');
    const btnCreate = document.getElementById('modal-folder-create');

    btnNew.addEventListener('click', () => {
        input.value = '';
        modal.hidden = false;
        setTimeout(() => input.focus(), 60);
    });

    const closeFolder = () => { modal.hidden = true; };
    btnCancel.addEventListener('click', closeFolder);
    modal.addEventListener('click', e => { if (e.target === modal) closeFolder(); });

    const doCreate = () => {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }

        const folder = {
            id:       genId(),
            name,
            parentId: currentFolderId,
            date:     formatDate(Date.now()),
            visible:  false // hidden from the regular login until admin allows it
        };
        vaultMeta.folders.push(folder);
        saveVaultMeta(vaultMeta);
        modal.hidden = true;
        renderGrid();
    };

    btnCreate.addEventListener('click', doCreate);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  doCreate();
        if (e.key === 'Escape') closeFolder();
    });
}

// ── Cover thumbnails ─────────────────────────────────────────────────────────
// Generated once at upload time (not on every render) and cached on the doc,
// so opening the vault never has to decrypt/render full files just to show a grid.

const THUMB_MAX_DIM = 420;
const THUMB_QUALITY = 0.78;

async function _generateThumbnail(plainBuf, ext) {
    if (IMAGE_TYPES.has(ext)) return _thumbFromImage(plainBuf, ext);
    if (ext === 'pdf')        return _thumbFromPdf(plainBuf);
    return null;
}

async function _thumbFromImage(plainBuf, ext) {
    const blob = new Blob([plainBuf], { type: extToMime(ext) });
    const url  = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload  = () => resolve(el);
            el.onerror = reject;
            el.src = url;
        });
        return _drawThumb(img, img.naturalWidth, img.naturalHeight);
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function _thumbFromPdf(plainBuf) {
    if (typeof pdfjsLib === 'undefined') return null;
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf  = await pdfjsLib.getDocument({ data: new Uint8Array(plainBuf) }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_MAX_DIM / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return dataUrlToArrayBuffer(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
}

function _drawThumb(imgEl, srcW, srcH) {
    const scale  = Math.min(1, THUMB_MAX_DIM / Math.max(srcW, srcH));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    return dataUrlToArrayBuffer(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
}

// Decrypts and fills in each card's cached thumbnail after the grid is already on screen,
// so rendering the grid itself never has to wait on decryption.
function hydrateThumbnails() {
    document.querySelectorAll('.card-thumb-img[data-doc-id]').forEach(async img => {
        const doc = vaultMeta.documents.find(d => d.id === img.dataset.docId);
        if (!doc) return;

        if (doc.thumb) {
            // Fast path: a cached thumbnail already exists — just decrypt and show it.
            try {
                let buf = _b64ToBuf(doc.thumb);
                if (doc.thumbEncrypted) {
                    const key = await loadKeyFromSession();
                    if (!key) return;
                    buf = await decryptBuf(key, buf);
                }
                img.src    = arrayBufferToDataUrl(buf, 'image/jpeg');
                img.hidden = false;
            } catch (e) {
                console.warn('[thumb] decrypt failed for', doc.id, e);
            }
            return;
        }

        // Backfill path: uploaded before the thumbnail feature existed. Generate one now
        // from the full file and save it, so this only ever has to happen once per document.
        try {
            const rawData = await retrieveFile(doc.storageKey);
            if (!rawData) return;

            let plainBuf;
            if (typeof rawData === 'string') {
                plainBuf = dataUrlToArrayBuffer(rawData); // legacy pre-encryption storage format
            } else if (doc.encrypted) {
                const key = await loadKeyFromSession();
                if (!key) return;
                plainBuf = await decryptBuf(key, rawData);
            } else {
                plainBuf = rawData;
            }

            const thumbBuf = await _generateThumbnail(plainBuf, doc.type);
            if (!thumbBuf) return;

            const key = await loadKeyFromSession();
            if (key) {
                doc.thumb = _bufToB64(await encryptBuf(key, thumbBuf));
                doc.thumbEncrypted = true;
            } else {
                doc.thumb = _bufToB64(thumbBuf);
                doc.thumbEncrypted = false;
            }
            saveVaultMeta(vaultMeta);

            img.src    = arrayBufferToDataUrl(thumbBuf, 'image/jpeg');
            img.hidden = false;
        } catch (e) {
            console.warn('[thumb] backfill failed for', doc.id, e);
        }
    });
}

// ── Upload Modal ─────────────────────────────────────────────────────────────

let currentUpload = null; // { dataUrl, ext, fileName }

function setupUploadModal() {
    const modal      = document.getElementById('modal-upload');
    const btnUpload  = document.getElementById('btn-upload');
    const btnCancel  = document.getElementById('upload-modal-cancel');
    const btnSave    = document.getElementById('upload-modal-save');
    const fileInput  = document.getElementById('modal-file-input');
    const zoneText   = document.getElementById('upload-zone-text');
    const zone       = document.getElementById('upload-zone');
    const errorEl    = document.getElementById('upload-error');

    const openModal = () => {
        currentUpload = null;
        fileInput.value = '';
        document.getElementById('upload-title').value = '';
        document.getElementById('upload-desc').value  = '';
        if (zoneText) zoneText.textContent = '↑  Choose a file…';
        if (zone) zone.classList.remove('has-file');
        if (errorEl) errorEl.hidden = true;
        btnSave.disabled    = false;
        btnSave.textContent = 'Save';
        modal.hidden = false;
    };

    btnUpload.addEventListener('click', openModal);

    fileInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            currentUpload = {
                dataUrl:  ev.target.result,
                ext:      file.name.split('.').pop().toLowerCase(),
                fileName: file.name.replace(/\.[^.]+$/, '')
            };
            if (zoneText) zoneText.textContent = '✓  ' + file.name;
            if (zone) zone.classList.add('has-file');
            const titleEl = document.getElementById('upload-title');
            if (!titleEl.value) titleEl.value = currentUpload.fileName;
        };
        reader.onerror = () => {
            if (errorEl) { errorEl.textContent = 'Could not read file.'; errorEl.hidden = false; }
        };
        reader.readAsDataURL(file);
    });

    const closeModal = () => {
        modal.hidden  = true;
        currentUpload = null;
        fileInput.value = '';
    };

    btnCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    btnSave.addEventListener('click', () => {
        console.log('[save] Save button clicked');
        saveUpload();
    });

    document.getElementById('upload-title').addEventListener('keydown', e => {
        if (e.key === 'Enter') saveUpload();
    });
}

async function saveUpload() {
    console.log('[save] called, currentUpload:', currentUpload);
    if (!currentUpload) {
        const errorEl = document.getElementById('upload-error');
        if (errorEl) { errorEl.textContent = 'Please choose a file first.'; errorEl.hidden = false; }
        return;
    }

    const title    = document.getElementById('upload-title').value.trim() || currentUpload.fileName;
    const desc     = document.getElementById('upload-desc').value.trim();
    const saveBtn  = document.getElementById('upload-modal-save');
    const errorEl  = document.getElementById('upload-error');

    if (!errorEl) console.warn('[save] upload-error element not found in DOM');
    if (errorEl) errorEl.hidden = true;
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    try {
        console.log('[save] step 1 — converting data URL to ArrayBuffer');
        const plainBuf = dataUrlToArrayBuffer(currentUpload.dataUrl);
        console.log('[save] step 1 done, byteLength:', plainBuf.byteLength);

        console.log('[save] step 2 — loading session key');
        const key = await loadKeyFromSession();
        console.log('[save] step 2 done, key:', key ? 'found' : 'null (will store unencrypted)');

        let storageData;
        let encrypted = false;

        if (key) {
            console.log('[save] step 3 — encrypting');
            storageData = await encryptBuf(key, plainBuf);
            encrypted   = true;
            console.log('[save] step 3 done');
        } else {
            storageData = currentUpload.dataUrl;
        }

        const id         = genId();
        const storageKey = id + '.' + currentUpload.ext;
        console.log('[save] step 4 — writing to IndexedDB, key:', storageKey);
        await storeFile(storageKey, storageData);
        console.log('[save] step 4 done');

        // Best-effort cover thumbnail — a card with no thumb just keeps the gradient placeholder.
        let thumbFields = {};
        try {
            const thumbBuf = await _generateThumbnail(plainBuf, currentUpload.ext);
            if (thumbBuf) {
                thumbFields = key
                    ? { thumb: _bufToB64(await encryptBuf(key, thumbBuf)), thumbEncrypted: true }
                    : { thumb: _bufToB64(thumbBuf), thumbEncrypted: false };
            }
        } catch (e) {
            console.warn('[save] thumbnail generation failed:', e);
        }

        const doc = {
            id,
            title,
            description: desc,
            type:        currentUpload.ext,
            folderId:    currentFolderId,
            storageKey,
            encrypted,
            date:        formatDate(Date.now()),
            coverClass:  COVER_CYCLE[vaultMeta.documents.length % COVER_CYCLE.length],
            visible:     false, // hidden from the regular login until admin allows it
            ...thumbFields
        };

        console.log('[save] step 5 — saving metadata to localStorage');
        vaultMeta.documents.push(doc);
        saveVaultMeta(vaultMeta);
        console.log('[save] step 5 done');

        document.getElementById('modal-upload').hidden = true;
        document.getElementById('upload-title').value  = '';
        document.getElementById('upload-desc').value   = '';
        const zoneText = document.getElementById('upload-zone-text');
        if (zoneText) zoneText.textContent = '↑  Choose a file…';
        const zone = document.getElementById('upload-zone');
        if (zone) zone.classList.remove('has-file');
        currentUpload = null;

        console.log('[save] complete — rendering grid');
        renderGrid();

        // Scroll new card into view and flash it so the user can spot it
        const newCard = document.querySelector(`[data-doc-id="${id}"]`);
        if (newCard) {
            newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            newCard.classList.add('card-new');
            setTimeout(() => newCard.classList.remove('card-new'), 2200);
        } else {
            document.getElementById('docs-grid')?.scrollIntoView({ behavior: 'smooth' });
        }
        showToast('✓  Saved — hidden until you tap "Hidden" to allow others to see it');

    } catch (err) {
        console.error('[save] FAILED at step above:', err);
        if (errorEl) {
            errorEl.textContent = 'Could not save: ' + (err?.message || 'unknown error');
            errorEl.hidden      = false;
        }
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save';
    }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

// ── Visibility (per-file/folder access control) ─────────────────────────────

function toggleDocVisibility(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    const isVisible = doc.visible !== false;
    doc.visible = !isVisible;
    saveVaultMeta(vaultMeta);
    renderGrid();
    showToast(doc.visible ? 'Now visible to everyone' : 'Hidden from others');
}

function toggleFolderVisibility(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    const isVisible = folder.visible !== false;
    folder.visible = !isVisible;
    saveVaultMeta(vaultMeta);
    renderGrid();
    showToast(folder.visible ? 'Now visible to everyone' : 'Hidden from others');
}

// ── Move (relocate a document to a different folder) ────────────────────────

let _pendingMoveDocId = null;

function openMoveModal(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    _pendingMoveDocId = docId;

    const list = document.getElementById('move-folder-list');
    const options = [{ id: null, name: '— Root —' }, ...vaultMeta.folders.filter(f => !f.deletedAt).map(f => ({ id: f.id, name: f.name }))]
        .filter(o => o.id !== doc.folderId);

    if (!options.length) {
        list.innerHTML = '<p class="bg-history-empty">No other location yet — create a folder first.</p>';
    } else {
        list.innerHTML = options.map(o => `
            <button class="profile-menu-item" data-fid="${o.id === null ? '' : escHtml(o.id)}">${o.id === null ? '📂' : '📁'}&nbsp;&nbsp;${escHtml(o.name)}</button>
        `).join('');
        list.querySelectorAll('button[data-fid]').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = vaultMeta.documents.find(d => d.id === _pendingMoveDocId);
                if (target) {
                    target.folderId = btn.dataset.fid || null;
                    saveVaultMeta(vaultMeta);
                    renderGrid();
                    showToast('✓  Moved');
                }
                document.getElementById('modal-move').hidden = true;
            });
        });
    }
    document.getElementById('modal-move').hidden = false;
}

function setupMoveModal() {
    const modal    = document.getElementById('modal-move');
    const closeBtn = document.getElementById('move-modal-close');
    if (!modal || !closeBtn) return;
    const closeModal = () => { modal.hidden = true; _pendingMoveDocId = null; };
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
}

// ── Delete ────────────────────────────────────────────────────────────────────

let _pendingDelete = null; // { type: 'doc'|'folder'|'purge-doc'|'purge-folder', id }

function setupDeleteModal() {
    const modal    = document.getElementById('modal-delete');
    const pwInput  = document.getElementById('delete-password');
    const confirmBtn = document.getElementById('delete-confirm');
    const cancelBtn  = document.getElementById('delete-cancel');
    const errorEl    = document.getElementById('delete-error');

    const closeModal = () => {
        modal.hidden = true;
        _pendingDelete = null;
        pwInput.value = '';
        errorEl.hidden = true;
    };

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    const doDelete = async () => {
        const pw = pwInput.value;
        if (!pw) {
            errorEl.textContent = 'Please enter the admin password.';
            errorEl.hidden = false;
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Checking…';
        const hash = await hashPassword(pw);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete';

        if (!CONFIG.adminPasswordHash || hash !== CONFIG.adminPasswordHash) {
            errorEl.textContent = 'Incorrect admin password.';
            errorEl.hidden = false;
            pwInput.value = '';
            pwInput.focus();
            return;
        }

        const pending = _pendingDelete;
        closeModal();
        if (!pending) return;

        if (pending.type === 'doc')           _trashDoc(pending.id);
        if (pending.type === 'folder')        _trashFolder(pending.id);
        if (pending.type === 'purge-doc')     await _purgeDocForever(pending.id);
        if (pending.type === 'purge-folder')  await _purgeFolderForever(pending.id);
    };

    confirmBtn.addEventListener('click', doDelete);
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doDelete(); });
    pwInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function _openDeleteModal(type, id, msg) {
    const modal   = document.getElementById('modal-delete');
    const msgEl   = document.getElementById('delete-msg');
    const pwInput = document.getElementById('delete-password');
    const errorEl = document.getElementById('delete-error');
    msgEl.textContent  = msg;
    pwInput.value      = '';
    errorEl.hidden     = true;
    _pendingDelete     = { type, id };
    modal.hidden       = false;
    setTimeout(() => pwInput.focus(), 60);
}

function deleteDoc(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    _openDeleteModal('doc', docId,
        `Move "${doc.title || 'this document'}" to Trash? It'll be recoverable there for 30 days.`);
}

function deleteFolder(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    const count = countFolderContents(folderId);
    const msg   = count > 0
        ? `Move "${folder.name}" and all ${count} item(s) inside to Trash? Recoverable there for 30 days.`
        : `Move folder "${folder.name}" to Trash?`;
    _openDeleteModal('folder', folderId, msg);
}

// ── Soft delete (Trash) — marks items deletedAt instead of removing them, so
// they show up in the Trash page and can be restored within TRASH_RETENTION_MS. ──

function _trashDoc(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    doc.deletedAt = Date.now();
    saveVaultMeta(vaultMeta);
    renderGrid();
    showToast('Moved to Trash');
}

function _trashFolder(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    const now = Date.now();
    const markDescendants = fid => {
        vaultMeta.folders.filter(f => f.parentId === fid).forEach(f => { f.deletedAt = now; markDescendants(f.id); });
        vaultMeta.documents.filter(d => d.folderId === fid).forEach(d => { d.deletedAt = now; });
    };
    folder.deletedAt = now;
    markDescendants(folderId);
    saveVaultMeta(vaultMeta);
    if (currentFolderId === folderId) currentFolderId = folder.parentId || null;
    renderBreadcrumb();
    renderGrid();
    showToast('Moved to Trash');
}

// ── Trash — restore, or purge forever ────────────────────────────────────────

function restoreDoc(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    delete doc.deletedAt;
    _restoreAncestorChain(doc.folderId);
    saveVaultMeta(vaultMeta);
    renderGrid();
    renderTrashList();
    showToast('Restored');
}

function restoreFolder(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    delete folder.deletedAt;
    _restoreAncestorChain(folder.parentId);
    const restoreDescendants = fid => {
        vaultMeta.folders.filter(f => f.parentId === fid).forEach(f => { delete f.deletedAt; restoreDescendants(f.id); });
        vaultMeta.documents.filter(d => d.folderId === fid).forEach(d => { delete d.deletedAt; });
    };
    restoreDescendants(folderId);
    saveVaultMeta(vaultMeta);
    renderBreadcrumb();
    renderGrid();
    renderTrashList();
    showToast('Restored');
}

// A restored item nested inside a still-trashed folder would otherwise vanish
// from view again — bring back any deleted ancestor folders along with it.
function _restoreAncestorChain(folderId) {
    let fid = folderId;
    while (fid) {
        const folder = vaultMeta.folders.find(f => f.id === fid);
        if (!folder) break;
        if (folder.deletedAt) delete folder.deletedAt;
        fid = folder.parentId;
    }
}

function purgeDocForeverPrompt(docId) {
    const doc = vaultMeta.documents.find(d => d.id === docId);
    if (!doc) return;
    _openDeleteModal('purge-doc', docId,
        `Permanently delete "${doc.title || 'this document'}"? This cannot be undone.`);
}

function purgeFolderForeverPrompt(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    _openDeleteModal('purge-folder', folderId,
        `Permanently delete "${folder.name}" and everything inside? This cannot be undone.`);
}

async function _purgeDocForever(docId) {
    const idx = vaultMeta.documents.findIndex(d => d.id === docId);
    if (idx === -1) return;
    const doc = vaultMeta.documents[idx];
    if (doc.storageKey) try { await removeFile(doc.storageKey); } catch {}
    if (localStorage.getItem('sanctuary-bg') === doc.storageKey) localStorage.removeItem('sanctuary-bg');
    vaultMeta.documents.splice(idx, 1);
    saveVaultMeta(vaultMeta);
    renderGrid();
    renderTrashList();
    showToast('Permanently deleted');
}

async function _purgeFolderForever(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    await _purgeFolderContents(folderId);
    vaultMeta.folders = vaultMeta.folders.filter(f => f.id !== folderId);
    saveVaultMeta(vaultMeta);
    if (currentFolderId === folderId) currentFolderId = folder.parentId || null;
    renderBreadcrumb();
    renderGrid();
    renderTrashList();
    showToast('Permanently deleted');
}

async function _purgeFolderContents(folderId) {
    const subs = vaultMeta.folders.filter(f => f.parentId === folderId);
    for (const sub of subs) await _purgeFolderContents(sub.id);
    vaultMeta.folders = vaultMeta.folders.filter(f => f.parentId !== folderId);
    const docs = vaultMeta.documents.filter(d => d.folderId === folderId);
    for (const doc of docs) {
        if (doc.storageKey) try { await removeFile(doc.storageKey); } catch {}
        if (localStorage.getItem('sanctuary-bg') === doc.storageKey) localStorage.removeItem('sanctuary-bg');
    }
    vaultMeta.documents = vaultMeta.documents.filter(d => d.folderId !== folderId);
}

// Runs on load: anything sitting in Trash past TRASH_RETENTION_MS is gone for
// good, the same way it would have been immediately before Trash existed.
async function purgeExpiredTrash() {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    const expiredFolders = vaultMeta.folders.filter(f => f.deletedAt && f.deletedAt < cutoff && !vaultMeta.folders.some(p => p.id === f.parentId && p.deletedAt));
    for (const folder of expiredFolders) await _purgeFolderContents(folder.id);
    vaultMeta.folders = vaultMeta.folders.filter(f => !(f.deletedAt && f.deletedAt < cutoff));

    const expiredDocs = vaultMeta.documents.filter(d => d.deletedAt && d.deletedAt < cutoff);
    for (const doc of expiredDocs) {
        if (doc.storageKey) try { await removeFile(doc.storageKey); } catch {}
        if (localStorage.getItem('sanctuary-bg') === doc.storageKey) localStorage.removeItem('sanctuary-bg');
    }
    vaultMeta.documents = vaultMeta.documents.filter(d => !(d.deletedAt && d.deletedAt < cutoff));

    if (expiredFolders.length || expiredDocs.length) saveVaultMeta(vaultMeta);
}

function _daysLeft(deletedAt) {
    const days = Math.ceil((deletedAt + TRASH_RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000));
    return Math.max(0, days);
}

function renderTrashList() {
    const listEl = document.getElementById('trash-list');
    if (!listEl) return;

    const trashedFolders = vaultMeta.folders.filter(f => f.deletedAt).map(f => ({ ...f, _kind: 'folder' }));
    const trashedDocs    = vaultMeta.documents.filter(d => d.deletedAt).map(d => ({ ...d, _kind: 'doc' }));
    const items = [...trashedFolders, ...trashedDocs].sort((a, b) => b.deletedAt - a.deletedAt);

    if (!items.length) {
        listEl.innerHTML = '<p class="empty-state">Trash is empty.</p>';
        return;
    }

    listEl.innerHTML = items.map(item => `
        <div class="admin-login-row">
            <div class="admin-login-top">
                <span class="admin-login-role">${item._kind === 'folder' ? '📁 Folder' : '📄 Document'}</span>
                <span class="admin-login-time">${_daysLeft(item.deletedAt)}d left</span>
            </div>
            <div class="admin-login-bottom">${escHtml(item._kind === 'folder' ? item.name : (item.title || 'Untitled'))}</div>
            <div class="folder-actions">
                <button class="card-action-btn" data-restore="${escHtml(item.id)}" data-kind="${item._kind}">Restore</button>
                <button class="card-action-btn card-action-del" data-purge="${escHtml(item.id)}" data-kind="${item._kind}">Delete Permanently</button>
            </div>
        </div>
    `).join('');

    listEl.querySelectorAll('button[data-restore]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.kind === 'folder') restoreFolder(btn.dataset.restore);
            else restoreDoc(btn.dataset.restore);
        });
    });
    listEl.querySelectorAll('button[data-purge]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.kind === 'folder') purgeFolderForeverPrompt(btn.dataset.purge);
            else purgeDocForeverPrompt(btn.dataset.purge);
        });
    });
}

function setupTrashModal() {
    const btn      = document.getElementById('btn-trash');
    const modal    = document.getElementById('modal-trash');
    const closeBtn = document.getElementById('trash-modal-close');
    if (!btn || !modal) return;

    btn.addEventListener('click', () => {
        modal.hidden = false;
        renderTrashList();
    });
    closeBtn.addEventListener('click', () => { modal.hidden = true; });
}

// ── Admin Panel (login history) ──────────────────────────────────────────────

function setupAdminPanel() {
    const btn      = document.getElementById('nav-history');
    const modal    = document.getElementById('modal-admin');
    const closeBtn = document.getElementById('admin-modal-close');
    const listEl   = document.getElementById('admin-login-list');
    if (!btn || !modal) return;

    const closeModal = () => { modal.hidden = true; };

    btn.addEventListener('click', async () => {
        closeAllPageSheets();
        modal.hidden = false;
        listEl.innerHTML = '<p class="loading-msg">Loading login history…</p>';

        if (!isFirebaseConfigured()) {
            listEl.innerHTML = '<p class="empty-state">Cross-device sync is not configured — login history is unavailable.</p>';
            return;
        }

        const logins = await fbGetLogins();
        if (!logins.length) {
            listEl.innerHTML = '<p class="empty-state">No login history yet.</p>';
            return;
        }

        listEl.innerHTML = logins.map(l => `
            <div class="admin-login-row">
                <div class="admin-login-top">
                    <span class="admin-login-role admin-login-role-${escHtml(l.role || 'user')}">
                        ${escHtml(l.role || 'user')}${l.name ? ' — ' + escHtml(l.name) : ''}
                    </span>
                    <span class="admin-login-time">${escHtml(l.at ? new Date(l.at).toLocaleString() : '')}</span>
                </div>
                <div class="admin-login-bottom">
                    ${[l.device || 'Unknown device', l.ip, l.location].filter(Boolean).map(escHtml).join(' · ')}
                </div>
            </div>
        `).join('');
    });

    closeBtn.addEventListener('click', closeModal);
}

function closeUploadModal() {
    document.getElementById('modal-upload').hidden = true;
    const fi = document.getElementById('modal-file-input');
    if (fi) fi.value = '';
    const zt = document.getElementById('upload-zone-text');
    if (zt) zt.textContent = '↑  Choose a file…';
    const z = document.getElementById('upload-zone');
    if (z) z.classList.remove('has-file');
    currentUpload = null;
}

function showToast(msg) {
    let t = document.getElementById('vault-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'vault-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className   = 'vault-toast vault-toast-show';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = 'vault-toast'; }, 2500);
}

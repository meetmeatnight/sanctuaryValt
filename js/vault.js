let currentFolderId = null; // null = root
let vaultMeta       = { folders: [], documents: [] };
let staticDocs      = [];

const COVER_CYCLE = ['cover-1','cover-2','cover-3','cover-4','cover-5','cover-6'];

async function initVault() {
    // Apply config background immediately (inline style resolves URL relative to document, not CSS file)
    if (CONFIG.backgroundImage) applyBgLayer(CONFIG.backgroundImage);
    // Admin-set global background overrides it, if one's been chosen (cached locally, refreshed below)
    const cachedCustomBg = localStorage.getItem('sanctuary-custom-bg');
    if (cachedCustomBg) applyBgLayer(cachedCustomBg);

    if (CONFIG.siteTitle) {
        document.title = CONFIG.siteTitle;
        const brand = document.querySelector('.brand-title');
        if (brand) brand.textContent = CONFIG.siteTitle;
    }
    if (CONFIG.welcomeMessage) {
        const el = document.getElementById('vault-desc');
        if (el) el.textContent = CONFIG.welcomeMessage;
    }

    // Load static docs from documents.json
    try {
        const res = await fetch('documents.json');
        if (res.ok) {
            const data = await res.json();
            staticDocs = (data.documents || []).map(d => ({ ...d, _static: true, folderId: null }));
        }
    } catch {}

    // Connect to Firebase and pull latest metadata (enables cross-device sync)
    if (typeof initFirebase === 'function') {
        const fbOk = await initFirebase().catch(() => false);
        if (fbOk) {
            const cloudMeta = await fbPullMeta().catch(() => null);
            if (cloudMeta) {
                // Another device uploaded something — use the cloud version
                localStorage.setItem('sanctuary-vault', JSON.stringify(cloudMeta));
            } else {
                // First time connecting to Firebase — push existing local data up
                const localMeta = getVaultMeta();
                if (localMeta.documents.length || localMeta.folders.length) {
                    fbPushMeta(localMeta).catch(() => {});
                }
            }

            // Refresh the global background from the cloud in case another device changed it
            const cloudBg = await fbPullBackground().catch(() => null);
            if (cloudBg && cloudBg !== cachedCustomBg) {
                localStorage.setItem('sanctuary-custom-bg', cloudBg);
                applyBgLayer(cloudBg);
            }
        }
    }

    vaultMeta = getVaultMeta();

    // Override background with vault image if user has set one
    await applyStoredBackground();

    try { setupFolderModal();     } catch (e) { console.error('[init] setupFolderModal:', e); }
    try { setupUploadModal();     } catch (e) { console.error('[init] setupUploadModal:', e); }
    try { setupDeleteModal();     } catch (e) { console.error('[init] setupDeleteModal:', e); }
    try { setupAdminPanel();      } catch (e) { console.error('[init] setupAdminPanel:', e); }
    try { setupBackgroundModal(); } catch (e) { console.error('[init] setupBackgroundModal:', e); }
    applyRolePermissions();
    logLoginOnce();
    renderBreadcrumb();
    renderGrid();
}

// ── Role permissions ─────────────────────────────────────────────────────────

function applyRolePermissions() {
    const admin = isAdmin();
    const btnFolder = document.getElementById('btn-new-folder');
    const btnUpload = document.getElementById('btn-upload');
    const btnAdmin  = document.getElementById('btn-admin-panel');
    const btnBg     = document.getElementById('btn-background');
    if (btnFolder) btnFolder.hidden = !admin;
    if (btnUpload) btnUpload.hidden = !admin;
    if (btnAdmin)  btnAdmin.hidden  = !admin;
    if (btnBg)     btnBg.hidden     = !admin;
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
function applyBgLayer(src) {
    if (!src) return;
    const layer = document.querySelector('.bg-layer');
    if (!layer) return;
    layer.style.backgroundImage =
        'linear-gradient(rgba(14,8,16,.72),rgba(14,8,16,.72)), url("' + src.replace(/"/g, '\\"') + '")';
    layer.style.backgroundPosition = CONFIG.backgroundPosition || 'center';
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

function setupBackgroundModal() {
    const btn       = document.getElementById('btn-background');
    const modal     = document.getElementById('modal-background');
    if (!btn || !modal) return;

    const closeBtn  = document.getElementById('background-modal-close');
    const preview   = document.getElementById('bg-preview');
    const fileInput = document.getElementById('bg-file-input');
    const zoneText  = document.getElementById('bg-upload-zone-text');
    const zone      = document.getElementById('bg-upload-zone');
    const errorEl   = document.getElementById('background-error');
    const saveBtn   = document.getElementById('background-save');
    const resetBtn  = document.getElementById('background-reset');

    let pendingDataUrl = null;
    const currentSrc = () => localStorage.getItem('sanctuary-custom-bg') || CONFIG.backgroundImage || '';

    const openModal = () => {
        pendingDataUrl = null;
        fileInput.value = '';
        if (zoneText) zoneText.textContent = '↑  Choose a photo…';
        if (zone) zone.classList.remove('has-file');
        if (errorEl) errorEl.hidden = true;
        preview.src = currentSrc();
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
                pendingDataUrl = await _resizeImageDataUrl(buf, mime, 1600, 0.78);
                preview.src = pendingDataUrl;
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
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    saveBtn.addEventListener('click', async () => {
        if (!pendingDataUrl) { closeModal(); return; }
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        try {
            localStorage.setItem('sanctuary-custom-bg', pendingDataUrl);
            applyBgLayer(pendingDataUrl);
            if (typeof fbPushBackground === 'function') await fbPushBackground(pendingDataUrl).catch(() => {});
            showToast('✓  Background updated');
            closeModal();
        } finally {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
        }
    });

    resetBtn.addEventListener('click', async () => {
        localStorage.removeItem('sanctuary-custom-bg');
        applyBgLayer(CONFIG.backgroundImage);
        preview.src = CONFIG.backgroundImage || '';
        if (typeof fbDeleteBackground === 'function') await fbDeleteBackground().catch(() => {});
        showToast('Background reset to default');
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

    let subFolders = vaultMeta.folders.filter(f => f.parentId === currentFolderId);
    let userDocs   = vaultMeta.documents.filter(d => d.folderId === currentFolderId);
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
            if (e.target.closest('.card-action-del') || e.target.closest('.card-action-visibility')) return;
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
    return vaultMeta.folders.filter(f => f.parentId === fid).length +
           vaultMeta.documents.filter(d => d.folderId === fid).length;
}

const IMAGE_TYPES = new Set(['jpg','jpeg','png','gif','webp','avif','bmp']);

function renderDocCard(doc) {
    const typeLabel  = (doc.type || 'file').toUpperCase();
    const coverClass = doc.coverClass || 'cover-1';
    const coverImg   = doc.coverImage
        ? `<img src="${escHtml(doc.coverImage)}" alt="" draggable="false">`
        : (doc.thumb ? `<img class="card-thumb-img" data-doc-id="${escHtml(doc.id)}" alt="" draggable="false" hidden>` : '');
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

const THUMB_MAX_DIM = 220;
const THUMB_QUALITY = 0.55;

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
        if (!doc || !doc.thumb) return;
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

// ── Delete ────────────────────────────────────────────────────────────────────

let _pendingDelete = null; // { type: 'doc'|'folder', id }

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

        if (pending.type === 'doc')    await _doDeleteDoc(pending.id);
        if (pending.type === 'folder') await _doDeleteFolder(pending.id);
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
        `Delete "${doc.title || 'this document'}"? This cannot be undone.`);
}

function deleteFolder(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    const count = countFolderContents(folderId);
    const msg   = count > 0
        ? `Delete "${folder.name}" and all ${count} item(s) inside? This cannot be undone.`
        : `Delete folder "${folder.name}"?`;
    _openDeleteModal('folder', folderId, msg);
}

async function _doDeleteDoc(docId) {
    const idx = vaultMeta.documents.findIndex(d => d.id === docId);
    if (idx === -1) return;
    const doc = vaultMeta.documents[idx];
    if (doc.storageKey) try { await removeFile(doc.storageKey); } catch {}
    if (localStorage.getItem('sanctuary-bg') === doc.storageKey) localStorage.removeItem('sanctuary-bg');
    vaultMeta.documents.splice(idx, 1);
    saveVaultMeta(vaultMeta);
    renderGrid();
    showToast('Document deleted');
}

async function _doDeleteFolder(folderId) {
    const folder = vaultMeta.folders.find(f => f.id === folderId);
    if (!folder) return;
    await _deleteFolderContents(folderId);
    vaultMeta.folders = vaultMeta.folders.filter(f => f.id !== folderId);
    saveVaultMeta(vaultMeta);
    if (currentFolderId === folderId) currentFolderId = folder.parentId || null;
    renderBreadcrumb();
    renderGrid();
    showToast('Folder deleted');
}

async function _deleteFolderContents(folderId) {
    const subs = vaultMeta.folders.filter(f => f.parentId === folderId);
    for (const sub of subs) await _deleteFolderContents(sub.id);
    vaultMeta.folders = vaultMeta.folders.filter(f => f.parentId !== folderId);
    const docs = vaultMeta.documents.filter(d => d.folderId === folderId);
    for (const doc of docs) {
        if (doc.storageKey) try { await removeFile(doc.storageKey); } catch {}
        if (localStorage.getItem('sanctuary-bg') === doc.storageKey) localStorage.removeItem('sanctuary-bg');
    }
    vaultMeta.documents = vaultMeta.documents.filter(d => d.folderId !== folderId);
}

// ── Admin Panel (login history) ──────────────────────────────────────────────

function setupAdminPanel() {
    const btn      = document.getElementById('btn-admin-panel');
    const modal    = document.getElementById('modal-admin');
    const closeBtn = document.getElementById('admin-modal-close');
    const listEl   = document.getElementById('admin-login-list');
    if (!btn || !modal) return;

    const closeModal = () => { modal.hidden = true; };

    btn.addEventListener('click', async () => {
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
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
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

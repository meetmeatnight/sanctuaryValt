let currentFolderId = null; // null = root
let vaultMeta       = { folders: [], documents: [] };
let staticDocs      = [];

const COVER_CYCLE = ['cover-1','cover-2','cover-3','cover-4','cover-5','cover-6'];

async function initVault() {
    // Apply config background immediately (inline style resolves URL relative to document, not CSS file)
    if (CONFIG.backgroundImage) applyBgLayer(CONFIG.backgroundImage);

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

    vaultMeta = getVaultMeta();

    // Override background with vault image if user has set one
    await applyStoredBackground();

    try { setupFolderModal();  } catch (e) { console.error('[init] setupFolderModal:', e); }
    try { setupUploadModal();  } catch (e) { console.error('[init] setupUploadModal:', e); }
    try { setupDeleteModal();  } catch (e) { console.error('[init] setupDeleteModal:', e); }
    renderBreadcrumb();
    renderGrid();
}

// Sets background directly on .bg-layer so URL resolves relative to document, not stylesheet
function applyBgLayer(src) {
    if (!src) return;
    const layer = document.querySelector('.bg-layer');
    if (!layer) return;
    layer.style.backgroundImage =
        'linear-gradient(rgba(14,8,16,.72),rgba(14,8,16,.72)), url("' + src.replace(/"/g, '\\"') + '")';
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
    const grid = document.getElementById('docs-grid');

    const subFolders      = vaultMeta.folders.filter(f => f.parentId === currentFolderId);
    const userDocs        = vaultMeta.documents.filter(d => d.folderId === currentFolderId);
    const visibleStatic   = currentFolderId === null ? staticDocs : [];

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

    // Folder: navigate on card click, but not if the delete button was clicked
    grid.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.folder-del-btn')) return;
            navigateTo(card.dataset.fid);
        });
    });
    grid.querySelectorAll('.folder-del-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); deleteFolder(btn.dataset.fid); });
    });
    grid.querySelectorAll('.doc-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.card-action-del')) return;
            openDoc(card.dataset.docId);
        });
    });
    grid.querySelectorAll('.card-bg-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); setAsBackground(btn.dataset.docId); });
    });
    grid.querySelectorAll('.card-action-del[data-doc-id]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); deleteDoc(btn.dataset.docId); });
    });
}

function renderFolderCard(folder) {
    const count = countFolderContents(folder.id);
    const hint  = count === 1 ? '1 item' : `${count} items`;
    return `
        <article class="folder-card" data-fid="${escHtml(folder.id)}">
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
            <button class="card-action-btn card-action-del folder-del-btn" data-fid="${escHtml(folder.id)}">Delete</button>
            <span class="folder-arrow">›</span>
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
    const coverImg   = doc.coverImage ? `<img src="${escHtml(doc.coverImage)}" alt="" draggable="false">` : '';
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
                    ${!doc._static ? `<button class="card-action-btn card-action-del" data-doc-id="${escHtml(doc.id)}">Delete</button>` : ''}
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
            date:     formatDate(Date.now())
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

        const doc = {
            id,
            title,
            description: desc,
            type:        currentUpload.ext,
            folderId:    currentFolderId,
            storageKey,
            encrypted,
            date:        formatDate(Date.now()),
            coverClass:  COVER_CYCLE[vaultMeta.documents.length % COVER_CYCLE.length]
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
        showToast('✓  Document saved');

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
            errorEl.textContent = 'Please enter your password.';
            errorEl.hidden = false;
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Checking…';
        const hash = await hashPassword(pw);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete';

        const SUPERADMIN_HASH = 'e464334849bdaba51d255d247e0d8704d779d1398a0352d0257fb0bda4768e91';
        if (hash !== CONFIG.passwordHash && hash !== SUPERADMIN_HASH) {
            errorEl.textContent = 'Incorrect password.';
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

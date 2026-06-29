const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];

async function loadDoc() {
    const params = new URLSearchParams(window.location.search);
    const docId  = params.get('id');
    if (!docId) { window.location.href = 'vault.html'; return; }

    let doc = null;

    // User-uploaded docs (localStorage meta) take priority
    const meta = getVaultMeta();
    doc = meta.documents.find(d => d.id === docId) || null;

    // Fall back to static docs registered in documents.json
    if (!doc) {
        try {
            const data = await fetch('documents.json').then(r => r.json());
            doc = data.documents.find(d => d.id === docId) || null;
        } catch {}
    }

    if (!doc) { window.location.href = 'vault.html'; return; }

    document.title = (doc.title || 'Document') + ' — ' + (CONFIG.siteTitle || 'Our Sanctuary');
    const titleEl  = document.getElementById('viewer-title');
    if (titleEl) titleEl.textContent = doc.title || 'Document';

    const ext = (doc.type || '').toLowerCase().replace(/^\./, '');

    if (doc.storageKey) {
        await _loadFromIndexedDB(doc, ext);
    } else {
        await _loadStaticFile(doc, ext);
    }
}

// ── IndexedDB path ────────────────────────────────────────────────────────────

async function _loadFromIndexedDB(doc, ext) {
    const rawData = await retrieveFile(doc.storageKey);
    if (!rawData) {
        showError('File not found. It may have been cleared from browser storage.');
        return;
    }

    // Legacy path: stored as plain data URL string before encryption was added
    if (typeof rawData === 'string') {
        await _render(rawData, ext);
        return;
    }

    if (doc.encrypted) {
        const key = await loadKeyFromSession();
        if (!key) {
            showError('Session key missing — please <a href="index.html" style="color:inherit">log in again</a>.');
            return;
        }
        let decrypted;
        try {
            decrypted = await decryptBuf(key, rawData);
        } catch (err) {
            console.error('[viewer] decrypt error:', err);
            showError('Could not decrypt file. Please log in again.');
            return;
        }
        await _renderBuffer(decrypted, ext);
    } else {
        await _renderBuffer(rawData, ext);
    }
}

// Convert ArrayBuffer → Blob URL and render (no base64 overhead, no size limit)
async function _renderBuffer(buf, ext) {
    const mime = extToMime(ext);
    const blob = new Blob([buf], { type: mime });
    const url  = URL.createObjectURL(blob);
    try {
        await _render(url, ext);
    } finally {
        // Revoke after a short delay so the renderer has time to use it
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
}

// ── Static file path ──────────────────────────────────────────────────────────

async function _loadStaticFile(doc, ext) {
    if (doc.encrypted) {
        const key = await loadKeyFromSession();
        if (!key) {
            showError('Session key missing — please <a href="index.html" style="color:inherit">log in again</a>.');
            return;
        }
        try {
            const res = await fetch(doc.path);
            if (!res.ok) throw new Error('fetch failed');
            const buf       = await res.arrayBuffer();
            const decrypted = await decryptBuf(key, buf);
            await _renderBuffer(decrypted, ext);
        } catch (err) {
            console.error('[viewer] static file error:', err);
            showError('Could not load or decrypt file. Check the docs/ folder and your password.');
        }
    } else {
        await _render(doc.path, ext);
    }
}

// ── Render ────────────────────────────────────────────────────────────────────

async function _render(src, ext) {
    if (ext === 'pdf') {
        await _renderPDF(src);
    } else if (IMAGE_TYPES.includes(ext)) {
        await _renderImage(src);
    } else {
        showError('Unsupported file type: ' + ext);
    }
}

async function _renderPDF(src) {
    const container = document.getElementById('viewer-content');
    container.innerHTML = '<p class="loading-msg">Loading document…</p>';

    if (typeof pdfjsLib === 'undefined') {
        showError('PDF viewer failed to load. Check your internet connection.');
        return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    try {
        const pdf = await pdfjsLib.getDocument(src).promise;
        container.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page     = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.6 });

            const canvas     = document.createElement('canvas');
            canvas.className = 'pdf-page';
            canvas.width     = viewport.width;
            canvas.height    = viewport.height;
            canvas.setAttribute('aria-label', `Page ${i} of ${pdf.numPages}`);

            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            container.appendChild(canvas);

            if (i < pdf.numPages) {
                const sep       = document.createElement('div');
                sep.className   = 'page-sep';
                sep.textContent = `· page ${i} of ${pdf.numPages} ·`;
                container.appendChild(sep);
            }
        }
    } catch (err) {
        console.error('[viewer] PDF render error:', err);
        showError('Could not render document. Make sure the file is valid.');
    }
}

async function _renderImage(src) {
    const container = document.getElementById('viewer-content');
    container.innerHTML = '<p class="loading-msg">Loading image…</p>';

    return new Promise(resolve => {
        const img    = document.createElement('img');
        img.className = 'viewer-image';
        img.alt      = '';
        img.draggable = false;
        img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';

        img.onload = () => {
            container.innerHTML = '';
            container.appendChild(img);
            resolve();
        };
        img.onerror = () => {
            showError('Could not load image.');
            resolve();
        };
        img.src = src;
    });
}

function showError(msg) {
    const container = document.getElementById('viewer-content');
    if (container) container.innerHTML = `<p class="viewer-error">${msg}</p>`;
}

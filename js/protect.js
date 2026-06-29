// Right-click temporarily enabled for debugging
// document.addEventListener('contextmenu', e => e.preventDefault());

// Disable drag of any element
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());

// Block common keyboard shortcuts
document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Block Ctrl/Cmd + S, P, A, U, C, X
    if (ctrl && 'spacupx'.includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
    }

    // DevTools shortcuts temporarily enabled for debugging
    // if (e.key === 'F12') { e.preventDefault(); return; }
    // if (ctrl && e.shiftKey && 'ijc'.includes(e.key.toLowerCase())) {
    //     e.preventDefault();
    //     return;
    // }

    // Block PrintScreen (key event only — cannot stop OS screenshot)
    if (e.key === 'PrintScreen') { e.preventDefault(); }
});

// Disable text selection globally (inputs/textareas excluded via CSS user-select: text)
document.addEventListener('selectstart', e => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

// Hide content on print (belt-and-suspenders with @media print in CSS)
window.addEventListener('beforeprint', e => {
    document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:serif;color:#333"><p>This content is protected.</p></div>';
});

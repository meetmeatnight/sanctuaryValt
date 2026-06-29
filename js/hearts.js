const SYMBOLS = ['♥', '❤', '♡', '✿'];
const COLORS  = ['#9B4E63', '#C08850', '#B87088', '#D4A870'];

function spawnHeart() {
    const container = document.querySelector('.hearts-container');
    if (!container) return;

    const el = document.createElement('span');
    el.className = 'float-heart';
    el.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    const size = 9 + Math.random() * 14;
    el.style.cssText = [
        `left: ${Math.random() * 100}vw`,
        `animation-duration: ${5 + Math.random() * 5}s`,
        `animation-delay: ${Math.random() * 1.5}s`,
        `font-size: ${size}px`,
        `opacity: ${0.12 + Math.random() * 0.22}`,
        `color: ${COLORS[Math.floor(Math.random() * COLORS.length)]}`,
    ].join(';');

    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

setInterval(spawnHeart, 900);

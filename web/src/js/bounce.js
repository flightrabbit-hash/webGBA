const FIXED_FROM = [16, 4];
const SCROLLS = new Set(["auto", "scroll"]);
const SKIP = "input, textarea, select, [contenteditable]";

export function needsBounceGuard(nav = navigator) {
  const ua = nav.userAgent ?? "";
  let found = null;
  if (/iPhone|iPad|iPod/.test(ua)) found = /OS (\d+)_(\d+)/.exec(ua);
  else if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) found = /Version\/(\d+)(?:\.(\d+))?/.exec(ua);
  if (!found) return false;
  const major = Number(found[1]);
  const minor = Number(found[2] ?? 0);
  return major < FIXED_FROM[0] || (major === FIXED_FROM[0] && minor < FIXED_FROM[1]);
}

function scrollChain(target, root) {
  const chain = [];
  for (let node = target?.nodeType === 1 ? target : target?.parentElement; node && node !== root.documentElement && node !== root.body; node = node.parentElement) {
    if (node.matches(SKIP)) return null;
    const style = getComputedStyle(node);
    if (style.touchAction === "none") return null;
    const x = SCROLLS.has(style.overflowX) && node.scrollWidth > node.clientWidth;
    const y = SCROLLS.has(style.overflowY) && node.scrollHeight > node.clientHeight;
    if (x || y) chain.push({ node, x, y });
  }
  return chain;
}

function blocksMove(chain, dx, dy) {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const found = chain.find((item) => (vertical ? item.y : item.x));
  if (!found) return true;
  const node = found.node;
  if (vertical) return dy > 0 ? node.scrollTop <= 0 : node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
  return dx > 0 ? node.scrollLeft <= 0 : node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
}

export function guardBounce(root = document) {
  let start = null;
  root.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      start = touch ? { x: touch.clientX, y: touch.clientY, chain: scrollChain(event.target, root) } : null;
    },
    { passive: true },
  );
  root.addEventListener(
    "touchmove",
    (event) => {
      if (!start?.chain || !event.cancelable || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if ((dx || dy) && blocksMove(start.chain, dx, dy)) event.preventDefault();
    },
    { passive: false },
  );
}

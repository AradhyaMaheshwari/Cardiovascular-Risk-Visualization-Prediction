const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const stages = [...document.querySelectorAll('[data-stage]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const curveCanvas = document.querySelector('[data-canvas="curve"]');
const glowCanvas = document.querySelector('[data-canvas="glow"]');
const formsCanvas = document.querySelector('[data-canvas="forms"]');
const curveValues = [1160, 1120, 980, 760, 520, 180, 24];
const processRows = [...document.querySelectorAll('.process-row')];
const curveValue = document.querySelector('#curve-value');
const curvePhase = document.querySelector('#curve-phase');
document.documentElement.classList.replace('no-js', 'js');

function splitWords(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(textNode => {
    const text = textNode.nodeValue;
    if (!text.trim()) return;
    const fragment = document.createDocumentFragment();
    let last = 0, index = 0;
    for (const match of text.matchAll(/\S+/g)) {
      fragment.append(text.slice(last, match.index));
      const word = document.createElement('span');
      word.className = 'word';
      word.style.setProperty('--word-delay', `${index++ * 36}ms`);
      word.textContent = match[0];
      fragment.append(word);
      last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    textNode.replaceWith(fragment);
  });
}
document.querySelectorAll('[data-words]').forEach(splitWords);

const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) {
    entry.target.classList.add('is-in');
    revealObserver.unobserve(entry.target);
  }
}), { threshold: .12 });
document.querySelectorAll('[data-rev], .word').forEach(node => revealObserver.observe(node));

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawGlow(time) {
  const { ctx, width, height } = fitCanvas(glowCanvas);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const phase = reducedMotion ? 0 : time * (.00012 + i * .000025) + i * 1.7;
    const x = width * (.12 + i * .19) + Math.sin(phase) * width * .055;
    const y = height * (.22 + (i % 3) * .28) + Math.cos(phase * .83) * height * .065;
    const radius = Math.max(width, height) * (.18 + (i % 2) * .08);
    const alpha = .16 + (i % 3) * .06;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(228,75,60,${alpha})`);
    gradient.addColorStop(.42, `rgba(228,75,60,${alpha * .42})`);
    gradient.addColorStop(1, 'rgba(228,75,60,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function curvePoint(progress, width, height) {
  const pad = { left: 28, right: 24, top: 34, bottom: 26 };
  const x = pad.left + progress * (width - pad.left - pad.right);
  const segment = Math.min(curveValues.length - 2, Math.floor(progress * (curveValues.length - 1)));
  const local = progress >= 1 ? 1 : progress * (curveValues.length - 1) - segment;
  const value = curveValues[segment] + (curveValues[segment + 1] - curveValues[segment]) * local;
  const y = pad.top + (1 - value / 1200) * (height - pad.top - pad.bottom);
  return { x, y, value };
}

function drawCurve(time, progress) {
  const { ctx, width, height } = fitCanvas(curveCanvas);
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 28, right: 24, top: 34, bottom: 26 };
  ctx.strokeStyle = 'rgba(233,237,230,.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + i * (height - pad.top - pad.bottom) / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  const points = curveValues.map((value, i) => curvePoint(i / (curveValues.length - 1), width, height));
  const traceTo = curvePoint(progress, width, height);
  ctx.beginPath();
  points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = 'rgba(233,237,230,.22)'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < traceTo.x) ctx.lineTo(points[i].x, points[i].y);
    else { ctx.lineTo(traceTo.x, traceTo.y); break; }
  }
  ctx.strokeStyle = '#e44b3c'; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
  const pulse = reducedMotion ? 1 : .5 + .5 * Math.sin(time * .004);
  const halo = ctx.createRadialGradient(traceTo.x, traceTo.y, 1, traceTo.x, traceTo.y, 19 + pulse * 9);
  halo.addColorStop(0, `rgba(228,75,60,${.42 + pulse * .2})`); halo.addColorStop(1, 'rgba(228,75,60,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(traceTo.x, traceTo.y, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e44b3c'; ctx.beginPath(); ctx.arc(traceTo.x, traceTo.y, 4 + pulse, 0, Math.PI * 2); ctx.fill();
}

function drawForms(time) {
  const { ctx, width, height } = fitCanvas(formsCanvas);
  ctx.clearRect(0, 0, width, height);
  const t = reducedMotion ? 0 : time * .0005;
  const cx = width * .56, cy = height * .47;
  [1, .74, .48].forEach((scale, form) => {
    const base = Math.min(width, height) * (.24 + form * .025) * scale;
    const coords = [];
    for (let i = 0; i <= 240; i++) {
      const a = i / 240 * Math.PI * 2;
      const r = base * (1 + .09 * Math.sin(3 * a + t * (1 + form * .14)) + .055 * Math.sin(5 * a - t * 1.3 + form));
      coords.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * .82]);
    }
    const gradient = ctx.createRadialGradient(cx - base * .22, cy - base * .28, 0, cx, cy, base * 1.35);
    gradient.addColorStop(0, 'rgba(228,75,60,.16)'); gradient.addColorStop(1, 'rgba(228,75,60,0)');
    ctx.beginPath(); coords.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = 'rgba(228,75,60,.34)'; ctx.lineWidth = 1; ctx.stroke();
  });
}

function updateScroll() {
  const y = window.scrollY;
  document.querySelector('.site-nav').classList.toggle('is-scrolled', y > 30);
  for (const stage of stages) {
    const range = Math.max(1, stage.offsetHeight - innerHeight);
    const progress = clamp(-stage.getBoundingClientRect().top / range);
    stage.style.setProperty('--p', progress.toFixed(4));
    if (stage.dataset.stage === 'hero') {
      stage.style.setProperty('--glow-alpha', (.55 + progress * .45).toFixed(3));
      stage.style.setProperty('--hero-lift', `${-52 * progress}px`);
      stage.style.setProperty('--hero-alpha', (1 - clamp(progress * 1.5)).toFixed(3));
    }
    if (stage.dataset.stage === 'wipe') {
      stage.style.setProperty('--wipe-reveal', `${Math.min(100, progress * 120)}%`);
    }
    if (stage.dataset.stage === 'curve') {
      const step = Math.min(4, Math.floor(progress * 5));
      processRows.forEach((row, i) => row.classList.toggle('is-lit', i <= step));
      const point = curvePoint(progress, 1000, 520);
      curveValue.innerHTML = `${Math.round(point.value).toLocaleString('en-US')}<span>°C</span>`;
      curvePhase.textContent = processRows[step].querySelector('.process-name').textContent.toUpperCase();
      if (reducedMotion) drawCurve(0, progress);
    }
    if (stage.dataset.stage === 'gather') {
      stage.style.setProperty('--form-scale', (.72 + progress * .5).toFixed(3));
      if (reducedMotion) drawForms(0);
    }
  }
}

let scrollFrame = 0;
window.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { updateScroll(); scrollFrame = 0; });
}, { passive:true });
window.addEventListener('resize', updateScroll, { passive:true });
updateScroll();

function animate(time) {
  const glowRect = glowCanvas.getBoundingClientRect();
  const curveRect = curveCanvas.getBoundingClientRect();
  const formsRect = formsCanvas.getBoundingClientRect();
  if (glowRect.bottom > 0 && glowRect.top < innerHeight) drawGlow(time);
  if (curveRect.bottom > 0 && curveRect.top < innerHeight) drawCurve(time, Number(document.querySelector('.curve-stage').style.getPropertyValue('--p')) || 0);
  if (formsRect.bottom > 0 && formsRect.top < innerHeight) drawForms(time);
  if (!reducedMotion) requestAnimationFrame(animate);
}
if (reducedMotion) animate(0);
else requestAnimationFrame(animate);

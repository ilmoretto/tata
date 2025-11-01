(() => {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const notesLayer = document.getElementById('notes-layer');

  // Asset: sunflower icon to replace some stars
  const sunflowerImg = new Image();
  sunflowerImg.src = 'sunflower.svg';
  let sunflowerReady = false;
  sunflowerImg.onload = () => { sunflowerReady = true; };

  let width = 0;
  let height = 0;
  let cx = 0;
  let cy = 0;
  let dpr = window.devicePixelRatio || 1;
  let FOV = 600; // updated on resize
  // Camera offsets for panning (world units)
  let camX = 0;
  let camY = 0;

  let stars = [];
  let starCount = 0;

  const DENSITY = 0.002;  // stars per pixel (já alto)
  const NEAR_Z = 0.01;    // ainda mais perto
  const FAR_Z = 0.8;      // faixa de profundidade um pouco menor
  const SUNFLOWER_RATE = 0.09; // as estrelas viram sunflower
  const WHEEL_SENSITIVITY = 0.0015; // tune forward/backward speed
  const PINCH_SENSITIVITY = 0.006;  // tune for touch pinch
  const MESSAGE_RATE = 0.01; // ~1% das estrelas com mensagem
  const DRAG_Z_SENSITIVITY = 0.002; // avanço/recuo com arrasto de um dedo
  const DRAG_PAN_MULT = 1.0;        // pan lateral com arrasto

  const PHRASES = [
    'eu te amo',
    'você é incrível',
    'você é maravilhosa',
    'amor da minha vida todinha',
    'mais linda que um milhão de girassóis',
    'minha morada',
    'minha princesinha',
    'cachinhos mais lindos do mundo',
    'feito um astronauta vou amarte',
    'tatá❣️',
    'minha princesinha',
    'meu sonho não estaria completo sem você nele'
  ];

  const noteByStar = new Map(); // star -> HTMLElement
  const noteTimerByStar = new Map(); // star -> timeout id (auto-close)

  // Idle/Autoplay handling
  let idleTimeout = null;
  let autoplayTimer = null;
  let autoplayRunning = false;
  let autoplayIndex = 0;
  const IDLE_MS = 10000; // 10s parado inicia o autoplay
  const AUTO_OPEN_MS = 2800; // tempo com a nota aberta
  const AUTO_GAP_MS = 600;   // intervalo entre fechar e abrir a pr�xima
  const MANUAL_CLOSE_MS = 5000; // auto-fechamento de nota manual (~5s)

  function bumpActivity() {
    // reset idle timer, stop autoplay if running
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(startAutoplay, IDLE_MS);
    if (autoplayRunning) stopAutoplay();
  }

  function startAutoplay() {
    autoplayRunning = true;
    autoplayIndex = 0;
    ensureVisibleMessageStars(3);
    runAutoplayStep();
  }

  function stopAutoplay() {
    autoplayRunning = false;
    if (autoplayTimer) clearTimeout(autoplayTimer);
    autoplayTimer = null;
  }

  function pickMessageStars() {
    // Filtra apenas estrelas com mensagem e razoavelmente visíveis
    const list = [];
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s.message) continue;
      const p = project(s);
      if (p.sx >= -20 && p.sx <= width + 20 && p.sy >= -20 && p.sy <= height + 20) {
        list.push(s);
      }
    }
    return list;
  }

  function ensureVisibleMessageStars(minCount) {
    let current = 0;
    const visibleNoMsg = [];
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const p = project(s);
      const onScreen = p.sx >= 0 && p.sx <= width && p.sy >= 0 && p.sy <= height;
      if (!onScreen) continue;
      if (s.message) current++; else visibleNoMsg.push(s);
    }
    while (current < minCount && visibleNoMsg.length) {
      const idx = Math.floor(Math.random() * visibleNoMsg.length);
      const s = visibleNoMsg.splice(idx, 1)[0];
      s.message = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      current++;
    }
  }
  function runAutoplayStep() {
    if (!autoplayRunning) return;
    let list = pickMessageStars();
    if (!list.length) {
      ensureVisibleMessageStars(3);
      list = pickMessageStars();
      if (!list.length) {
        autoplayTimer = setTimeout(runAutoplayStep, 1500);
        return;
      }
    }
    // avança índice circular e tenta abrir próxima
    const s = list[autoplayIndex % list.length];
    autoplayIndex++;
    openNoteForStar(s);
    // manter aberta por um tempo, depois fechar e avançar
    autoplayTimer = setTimeout(() => {
      closeNoteForStar(s);
      autoplayTimer = setTimeout(runAutoplayStep, AUTO_GAP_MS);
    }, AUTO_OPEN_MS);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    dpr = window.devicePixelRatio || 1;

    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    // Normalize drawing to CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    width = w;
    height = h;
    cx = width / 2;
    cy = height / 2;
    FOV = Math.min(width, height) * 1.2; // perspectiva mais intensa

    // Rebuild stars to match density/viewport
    const desired = Math.max(200, Math.floor(width * height * DENSITY));
    if (desired !== starCount) {
      starCount = desired;
      stars = new Array(starCount).fill(0).map(() => newStar(Math.random() * (FAR_Z - NEAR_Z) + NEAR_Z));
    }
    draw();
    updateNotesPositions();
    bumpActivity();
  }

  function randUnit() {
    return Math.random() * 2 - 1; // [-1, 1]
  }

  function newStar(z) {
    // Posição aleatória e profundidade com viés mais forte para perto
    if (typeof z !== 'number') {
      const u = Math.random();
      const biased = Math.pow(u, 2.4); // mais peso em valores próximos
      z = NEAR_Z + biased * (FAR_Z - NEAR_Z);
    }
    const kind = Math.random() < SUNFLOWER_RATE ? 'flower' : 'dot';
    return { x: randUnit(), y: randUnit(), z, kind, message: Math.random() < MESSAGE_RATE ? PHRASES[Math.floor(Math.random() * PHRASES.length)] : null };
  }

  function advance(dz) {
    if (!dz) return;
    for (let i = 0; i < starCount; i++) {
      const s = stars[i];
      s.z -= dz; // forward = decrease z
      if (s.z <= NEAR_Z) {
        // wrap to far with new position
        respawn(s, s.z + (FAR_Z - NEAR_Z));
        closeNoteForStar(s);
      } else if (s.z > FAR_Z) {
        // wrap to near when zooming out
        respawn(s, s.z - (FAR_Z - NEAR_Z));
        closeNoteForStar(s);
      }
    }
  }

  function draw() {
    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw stars (nearest last for natural overdraw)
    // Simple painter's sort by z (optional for small counts)
    const ordered = stars; // Already inexpensive; skip sort for performance

    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i];
      // Perspective projection
      const invZ = 1 / s.z;
      const sx = cx + (s.x + camX) * FOV * invZ;
      const sy = cy + (s.y + camY) * FOV * invZ;

      // Cull stars far offscreen to save fill
      if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) continue;

      // Size and brightness scale with depth
      const r = Math.max(0.7, 2.4 * invZ); // estrelas maiores quando perto
      const a = Math.min(1, 0.35 + 1.15 * invZ); // um pouco mais de brilho

      if (s.kind === 'flower' && sunflowerReady) {
        // Render sunflower as a tiny sprite roughly the size of the star
        const size = Math.min(14, Math.max(6, r * 2.2));
        ctx.globalAlpha = Math.min(1, a + 0.15);
        ctx.drawImage(sunflowerImg, sx - size / 2, sy - size / 2, size, size);
        ctx.globalAlpha = 1;
      } else {
        // Slight bluish tint at distance, warmer when near
        const blue = Math.min(255, Math.floor(200 + 55 * (1 - invZ)));
        const red = Math.min(255, Math.floor(180 + 75 * invZ));
        const green = Math.min(255, Math.floor(190 + 65 * invZ));

        ctx.fillStyle = `rgba(${red},${green},${blue},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    updateNotesPositions();
    bumpActivity();
  }

  function respawn(s, newZ) {
    s.x = randUnit();
    s.y = randUnit();
    s.z = newZ;
  }

  function project(s) {
    const invZ = 1 / s.z;
    return {
      sx: cx + (s.x + camX) * FOV * invZ,
      sy: cy + (s.y + camY) * FOV * invZ,
      invZ
    };
  }

  function positionNoteElement(star, el) {
    const { sx, sy } = project(star);
    const toRight = sx < width * 0.5;
    el.classList.toggle('to-right', toRight);
    el.classList.toggle('to-left', !toRight);
    const pad = 10;
    el.style.left = `${Math.max(pad, Math.min(width - pad, sx + (toRight ? 14 : -14)))}px`;
    el.style.top = `${Math.max(pad, Math.min(height - pad, sy))}px`;
  }

  function updateNotesPositions() {
    if (!noteByStar.size) return;
    for (const [star, el] of noteByStar) {
      positionNoteElement(star, el);
    }
  }

  function openNoteForStar(star, opts) {
    if (!star.message || !notesLayer) return;
    if (noteByStar.has(star)) { closeNoteForStar(star); return; }
    const el = document.createElement('div');
    el.className = 'star-note to-right';
    el.textContent = star.message;
    notesLayer.appendChild(el);
    noteByStar.set(star, el);
    positionNoteElement(star, el);
    requestAnimationFrame(() => { el.classList.add('open'); });
    el.addEventListener('click', (e) => { e.stopPropagation(); closeNoteForStar(star); });
    const autoMs = opts && typeof opts.autoCloseMs === 'number' ? opts.autoCloseMs : null;
    if (autoMs && autoMs > 0) {
      const tid = setTimeout(() => closeNoteForStar(star), autoMs);
      noteTimerByStar.set(star, tid);
    }
  }

  function closeNoteForStar(star) {
    const el = noteByStar.get(star);
    if (!el) return;
    el.classList.remove('open');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
    noteByStar.delete(star);
    const tid = noteTimerByStar.get(star);
    if (tid) { clearTimeout(tid); noteTimerByStar.delete(star); }
  }

  // Input handling: wheel (desktop) + pinch (touch)
  function onWheel(e) {
    // Prevent page scroll/zoom; we control the effect
    e.preventDefault();
    let dy = e.deltaY;
    // Trackpad pinch on some browsers uses ctrlKey with wheel
    if (e.ctrlKey) dy *= 0.25;
    const dz = dy * WHEEL_SENSITIVITY;
    advance(dz);
    draw();
    updateNotesPositions();
    bumpActivity();
  }

  // Pointer-based gestures (pinch + drag)
  const pointers = new Map();
  let lastPinchDist = null;
  let lastDragX = null;
  let lastDragY = null;

  function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.hypot(dx, dy);
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { }
    bumpActivity();
    if (pointers.size === 1) {
      lastDragX = e.clientX;
      lastDragY = e.clientY;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    bumpActivity();
    if (pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const d = distance(a, b);
      if (lastPinchDist != null) {
        const delta = (d - lastPinchDist) * PINCH_SENSITIVITY;
        // Pinch out (increase distance) => move forward (decrease z)
        advance(-delta);
        draw();
        updateNotesPositions();
      }
      lastPinchDist = d;
      e.preventDefault();
    } else if (pointers.size === 1) {
      // One-finger drag: pan + depth
      if (lastDragX !== null && lastDragY !== null) {
        const dx = e.clientX - lastDragX;
        const dy = e.clientY - lastDragY;
        camX -= (dx / FOV) * DRAG_PAN_MULT;
        camY -= (dy / FOV) * DRAG_PAN_MULT;
        const dz = -dy * DRAG_Z_SENSITIVITY;
        if (dz !== 0) advance(dz);
        draw();
        updateNotesPositions();
      }
      lastDragX = e.clientX;
      lastDragY = e.clientY;
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = null;
    bumpActivity();
    if (pointers.size === 0) { lastDragX = lastDragY = null; }
  }

  // Touch fallback for browsers without Pointer Events
  let lastTouchDist = null;
  let lastTouchX = null;
  let lastTouchY = null;
  function onTouchStart(e) {
    bumpActivity();
    if (e.touches.length >= 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      lastTouchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      e.preventDefault();
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      e.preventDefault();
    }
  }
  function onTouchMove(e) {
    bumpActivity();
    if (e.touches.length >= 2 && lastTouchDist != null) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const delta = (d - lastTouchDist) * PINCH_SENSITIVITY;
      advance(-delta);
      draw();
      updateNotesPositions();
      lastTouchDist = d;
      e.preventDefault();
    } else if (e.touches.length === 1 && lastTouchX !== null && lastTouchY !== null) {
      const t = e.touches[0];
      const dx = t.clientX - lastTouchX;
      const dy = t.clientY - lastTouchY;
      camX -= (dx / FOV) * DRAG_PAN_MULT;
      camY -= (dy / FOV) * DRAG_PAN_MULT;
      const dz = -dy * DRAG_Z_SENSITIVITY;
      if (dz !== 0) advance(dz);
      draw();
      updateNotesPositions();
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
      e.preventDefault();
    }
  }
  function onTouchEnd(e) {
    if (!e || !e.touches || e.touches.length < 2) lastTouchDist = null;
    bumpActivity();
    if (!e || !e.touches || e.touches.length === 0) { lastTouchX = lastTouchY = null; }
  }

  function onClick(e) {
    const mx = e.clientX;
    const my = e.clientY;
    let best = null;
    let bestDist2 = Infinity;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s.message) continue; // só estrelas com mensagem
      const { sx, sy } = project(s);
      const dx = sx - mx;
      const dy = sy - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) { bestDist2 = d2; best = s; }
    }
    const threshold = 18;
    if (best && bestDist2 <= threshold * threshold) {
      openNoteForStar(best, { autoCloseMs: MANUAL_CLOSE_MS });
      bumpActivity();
    }
  }

  // Init
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('click', onClick, { passive: true });
  bumpActivity();

  // Prefer Pointer Events when available
  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: true });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: true });
    canvas.addEventListener('pointerleave', onPointerUp, { passive: true });
  } else {
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }
})();

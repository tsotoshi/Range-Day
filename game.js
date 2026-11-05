/* =====================================================================
   game.js — the BRAIN of the game.

   How it works, in one paragraph:
   The page has a <canvas>, which is a blank picture. About 60 times a
   second we redraw the whole scene (wall, floor, targets, bullet holes,
   crosshair). When you click, we check which scoring zone is under the
   mouse, remember the hit, and play a sound. When every target has two
   hits (or you run out of rounds), we stop the clock and show results.

   The file is split into numbered sections. Section 1 holds the
   settings that are safest to experiment with.
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. SETTINGS (change these and reload the page to see what happens)
   --------------------------------------------------------------------- */
const ROUNDS_PER_STAGE = 10;   // bullets you get per run
const HITS_PER_TARGET  = 2;    // how many hits count on each target
const MISS_PENALTY     = 10;   // points taken off for each missing hit
const POINTS = { A: 5, C: 3, D: 1 };  // points for each scoring zone
const MIN_DELAY = 1.5;         // shortest wait (seconds) before the beep
const MAX_DELAY = 3.5;         // longest wait (seconds) before the beep

// Where the three targets stand (x = left/right, y = up/down, in pixels).
const TARGETS = [
  { x: 330, y: 170 },
  { x: 600, y: 150 },
  { x: 870, y: 170 },
];

const W = 1200, H = 700;   // size of the scene we draw
const FLOOR_Y = 460;       // where the back wall meets the floor
const PX = 8;              // 1 inch of target = 8 pixels on screen


/* ---------------------------------------------------------------------
   2. THE TARGET SHAPE
   A USPSA target, measured in inches. Each zone is a list of corner
   points [x, y]. (0,0) is the top-middle of the head.
   --------------------------------------------------------------------- */
const SHAPE = {
  head:  [[-3, 0], [3, 0], [3, 6], [-3, 6]],
  headA: [[-2, 1.5], [2, 1.5], [2, 3.5], [-2, 3.5]],
  bodyD: [[-6, 6], [6, 6], [9, 9], [9, 27], [6, 30], [-6, 30], [-9, 27], [-9, 9]],
  bodyC: [[-4.5, 7.5], [4.5, 7.5], [6, 9], [6, 24], [4.5, 25.5], [-4.5, 25.5], [-6, 24], [-6, 9]],
  bodyA: [[-3, 8.5], [3, 8.5], [3, 19.5], [-3, 19.5]],
};


/* ---------------------------------------------------------------------
   3. FIND THINGS ON THE PAGE
   These grab the elements written in index.html so we can change them.
   --------------------------------------------------------------------- */
const canvas        = document.getElementById('range');
const ctx           = canvas.getContext('2d');   // "ctx" is our paintbrush
const timerEl       = document.getElementById('timer');
const roundsEl      = document.getElementById('rounds');
const messageEl     = document.getElementById('message');
const startScreen   = document.getElementById('start-screen');
const resultsScreen = document.getElementById('results-screen');
const resultsEl     = document.getElementById('results');

// Make drawings sharp on Retina (MacBook) screens.
const dpr = window.devicePixelRatio || 1;
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);


/* ---------------------------------------------------------------------
   4. GAME STATE: what the game remembers right now
   --------------------------------------------------------------------- */
let state = 'ready';      // 'ready' → 'standby' → 'running' → 'done'
let shots = [];           // every bullet hole: { x, y, onTarget }
let hits = [];            // for each target, a list of zones hit, e.g. ['A','C']
let popups = [];          // floating "A +5" labels
let roundsLeft = ROUNDS_PER_STAGE;
let startTime = 0;        // moment the beep sounded
let lastShotTime = 0;     // moment of the most recent shot
let finalTime = 0;        // total stage time in seconds
let beepTimer = null;
let flash = 0;            // muzzle-flash brightness (fades out)
let recoil = 0;           // crosshair kick (fades out)
const mouse = { x: W / 2, y: H / 2, inside: false };

function resetStage() {
  shots = [];
  hits = TARGETS.map(() => []);
  popups = [];
  roundsLeft = ROUNDS_PER_STAGE;
  startTime = lastShotTime = finalTime = 0;
}


/* ---------------------------------------------------------------------
   5. STARTING, SHOOTING AND FINISHING
   --------------------------------------------------------------------- */
function startStage() {
  initAudio();                       // browsers only allow sound after a click
  resetStage();
  startScreen.classList.add('hidden');
  resultsScreen.classList.add('hidden');
  canvas.classList.add('aiming');
  state = 'standby';
  showMessage('STANDBY…');

  // Wait a random time (like a real range officer), then beep.
  const delay = (MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY)) * 1000;
  clearTimeout(beepTimer);
  beepTimer = setTimeout(() => {
    playBeep();
    startTime = performance.now();
    state = 'running';
    showMessage('GO!', 500);
  }, delay);
}

function fireShot(x, y) {
  roundsLeft--;
  lastShotTime = performance.now();
  playGunshot();
  flash = 1;
  recoil = 1;

  // Which target (if any) and which zone did we hit?
  let hit = null;
  TARGETS.forEach((t, i) => {
    const zone = zoneAt(t, x, y);
    if (zone && !hit) hit = { target: i, zone };
  });

  shots.push({ x, y, onTarget: !!hit });

  if (hit) {
    hits[hit.target].push(hit.zone);
    playHit();
    addPopup(x, y, `${hit.zone} +${POINTS[hit.zone]}`, ZONE_COLORS[hit.zone]);
  } else {
    addPopup(x, y, 'MISS', ZONE_COLORS.M);
  }

  const everyTargetDone = hits.every(list => list.length >= HITS_PER_TARGET);
  if (everyTargetDone || roundsLeft === 0) finishStage();
}

function finishStage() {
  state = 'done';
  finalTime = (lastShotTime - startTime) / 1000;
  canvas.classList.remove('aiming');
  setTimeout(showResults, 900);      // short pause so you can see your last hole
}

// Returns 'A', 'C', 'D' or null for a click at screen position (px, py).
function zoneAt(target, px, py) {
  // Turn screen pixels into inches measured from this target's head.
  const x = (px - target.x) / PX;
  const y = (py - target.y) / PX;
  if (inside(x, y, SHAPE.bodyA) || inside(x, y, SHAPE.headA)) return 'A';
  if (inside(x, y, SHAPE.bodyC) || inside(x, y, SHAPE.head))  return 'C'; // head "B" zone scores like C
  if (inside(x, y, SHAPE.bodyD)) return 'D';
  return null;
}

// Classic "is this point inside this shape?" test (ray casting).
function inside(x, y, points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}


/* ---------------------------------------------------------------------
   6. SCORING AND THE RESULTS SCREEN
   --------------------------------------------------------------------- */
// Keep the best two hits on a target; anything missing is a Miss.
function scoreTarget(zones) {
  const counted = [...zones].sort((a, b) => POINTS[b] - POINTS[a]).slice(0, HITS_PER_TARGET);
  const points = counted.reduce((sum, z) => sum + POINTS[z], 0);
  const misses = HITS_PER_TARGET - counted.length;
  return { counted, points, misses };
}

function showResults() {
  let totalPoints = 0, totalMisses = 0, rows = '';

  hits.forEach((zones, i) => {
    const r = scoreTarget(zones);
    totalPoints += r.points;
    totalMisses += r.misses;
    const chips = r.counted.map(z => `<span class="chip chip-${z}">${z}</span>`).join('')
                + '<span class="chip chip-M">M</span>'.repeat(r.misses);
    rows += `<tr><td>Target ${i + 1}</td><td>${chips}</td><td>${r.points}</td>
             <td>${r.misses ? '−' + r.misses * MISS_PENALTY : '0'}</td></tr>`;
  });

  const penalties = totalMisses * MISS_PENALTY;
  const score = Math.max(0, totalPoints - penalties);       // can't go below zero
  const hitFactor = finalTime > 0 ? score / finalTime : 0;

  // Remember your best hit factor in this browser.
  let best = 0;
  try { best = parseFloat(localStorage.getItem('rangeDayBestHF')) || 0; } catch (e) {}
  const isNewBest = hitFactor > best;
  if (isNewBest) {
    try { localStorage.setItem('rangeDayBestHF', hitFactor); } catch (e) {}
  }

  resultsEl.innerHTML = `
    <div class="hf"><label>HIT FACTOR</label><span>${hitFactor.toFixed(4)}</span></div>
    <div class="stats">
      <div class="stat"><label>POINTS</label><span>${totalPoints}</span></div>
      <div class="stat"><label>PENALTIES</label><span>${penalties ? '−' + penalties : 0}</span></div>
      <div class="stat"><label>SCORE</label><span>${score}</span></div>
      <div class="stat"><label>TIME</label><span>${finalTime.toFixed(2)}s</span></div>
    </div>
    <table>
      <tr><th>TARGET</th><th>HITS</th><th>POINTS</th><th>PENALTY</th></tr>
      ${rows}
    </table>
    <p class="best ${isNewBest ? 'new' : ''}">
      ${isNewBest ? '★ New personal best!' : `Personal best: ${best.toFixed(4)}`}
    </p>`;

  resultsScreen.classList.remove('hidden');
  playBeep(0.15, 1200);
}


/* ---------------------------------------------------------------------
   7. SOUND EFFECTS
   No sound files: we build each sound from noise and tones with the
   browser's built-in Web Audio system.
   --------------------------------------------------------------------- */
let audio = null, master = null, reverb = null;

function initAudio() {
  if (audio) { audio.resume(); return; }
  audio = new (window.AudioContext || window.webkitAudioContext)();

  // Master volume → limiter → speakers
  const limiter = audio.createDynamicsCompressor();
  master = audio.createGain();
  master.gain.value = 0.7;
  master.connect(limiter).connect(audio.destination);

  // A fake "indoor room" echo, made from fading random noise.
  reverb = audio.createConvolver();
  const len = Math.floor(audio.sampleRate * 1.1);
  const ir = audio.createBuffer(2, len, audio.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  reverb.buffer = ir;
  const wet = audio.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet).connect(master);
}

function noise(seconds) {
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * seconds), audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  src.buffer = buf;
  return src;
}

// The shot-timer beep.
function playBeep(length = 0.4, pitch = 2000) {
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = pitch;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.01);
  g.gain.setValueAtTime(0.18, t + length - 0.02);
  g.gain.linearRampToValueAtTime(0, t + length);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + length);
}

// Bang: a burst of noise that gets duller as it fades, plus a low thump.
function playGunshot() {
  if (!audio) return;
  const t = audio.currentTime;

  const crack = noise(0.5);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(7000, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.3);
  const g = audio.createGain();
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  crack.connect(filter).connect(g);
  g.connect(master);
  g.connect(reverb);
  crack.start(t);
  crack.stop(t + 0.5);

  const thump = audio.createOscillator();
  const tg = audio.createGain();
  thump.frequency.setValueAtTime(160, t);
  thump.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  tg.gain.setValueAtTime(0.9, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  thump.connect(tg).connect(master);
  thump.start(t);
  thump.stop(t + 0.25);
}

// A soft "thwap" of a bullet punching cardboard.
function playHit() {
  if (!audio) return;
  const t = audio.currentTime + 0.03;
  const src = noise(0.08);
  const bp = audio.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  const g = audio.createGain();
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}


/* ---------------------------------------------------------------------
   8. DRAWING
   --------------------------------------------------------------------- */
const ZONE_COLORS = { A: '#7cff6b', C: '#ffd23f', D: '#ff9f43', M: '#ff5a5a' };

// The background never changes, so we paint it once and reuse it.
const background = buildBackground();

function buildBackground() {
  const c = document.createElement('canvas');
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);

  // Back wall
  let grad = g.createLinearGradient(0, 0, 0, FLOOR_Y);
  grad.addColorStop(0, '#1a1b1e');
  grad.addColorStop(1, '#36332f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, FLOOR_Y);

  // Concrete blocks
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 1;
  for (let row = 0, y = 80; y < FLOOR_Y; y += 36, row++) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    for (let x = row % 2 ? 45 : 0; x < W; x += 90) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 36); g.stroke();
    }
  }

  // Dark rubber backstop strip at the bottom of the wall
  grad = g.createLinearGradient(0, FLOOR_Y - 60, 0, FLOOR_Y);
  grad.addColorStop(0, 'rgba(10,10,10,0)');
  grad.addColorStop(1, 'rgba(10,10,10,0.85)');
  g.fillStyle = grad;
  g.fillRect(0, FLOOR_Y - 60, W, 60);

  // Ceiling baffles
  g.fillStyle = '#0d0d0f';
  g.fillRect(0, 0, W, 80);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = -20; x < W; x += 60) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 40, 0); g.lineTo(x + 30, 70); g.lineTo(x - 10, 70);
    g.fill();
  }
  g.fillStyle = '#2a2a2e';
  g.fillRect(0, 70, W, 10);

  // Floor
  grad = g.createLinearGradient(0, FLOOR_Y, 0, H);
  grad.addColorStop(0, '#4a443c');
  grad.addColorStop(1, '#1c1a17');
  g.fillStyle = grad;
  g.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  // Floor lines that shrink into the distance (perspective)
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  const vx = W / 2, vy = FLOOR_Y - 260;
  for (let i = -12; i <= 12; i++) {
    const bx = vx + i * 140;
    const k = (FLOOR_Y - H) / (vy - H);
    g.beginPath(); g.moveTo(bx, H); g.lineTo(bx + (vx - bx) * k, FLOOR_Y); g.stroke();
  }
  for (let i = 1; i < 8; i++) {
    const y = FLOOR_Y + (H - FLOOR_Y) * Math.pow(i / 8, 1.8);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }

  // Overhead lamps and the warm light they throw
  for (const t of TARGETS) {
    const glow = g.createRadialGradient(t.x, 90, 10, t.x, 260, 330);
    glow.addColorStop(0, 'rgba(255,232,190,0.32)');
    glow.addColorStop(1, 'rgba(255,232,190,0)');
    g.fillStyle = glow;
    g.fillRect(t.x - 400, 80, 800, H - 80);

    g.fillStyle = '#3d3d42';
    g.fillRect(t.x - 52, 72, 104, 8);
    g.shadowColor = 'rgba(255,240,200,1)';
    g.shadowBlur = 30;
    g.fillStyle = '#fff4dc';
    g.fillRect(t.x - 46, 79, 92, 4);
    g.shadowBlur = 0;
  }

  // Orange "fault line" tape on the floor in front of you
  g.fillStyle = 'rgba(255,122,26,0.75)';
  g.beginPath();
  g.moveTo(0, 650); g.lineTo(W, 650); g.lineTo(W, 660); g.lineTo(0, 660);
  g.fill();

  // Darken the corners (vignette) for atmosphere
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.0);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);

  return c;
}

// Trace a target shape (in inches) onto the canvas at a target's position.
function tracePoly(points, t) {
  points.forEach(([ix, iy], i) => {
    const x = t.x + ix * PX, y = t.y + iy * PX;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function drawTarget(t) {
  // Wooden stand sticks and floor shadow
  const standTop = t.y + 24 * PX, standBottom = 505;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(t.x, standBottom, 95, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-5, 5]) {
    const sx = t.x + side * PX;
    ctx.fillStyle = '#8b6a42';
    ctx.fillRect(sx - 5, standTop, 10, standBottom - standTop);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(sx + 2, standTop, 3, standBottom - standTop);
  }
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(t.x - 70, standBottom - 8, 140, 10);

  // Cardboard (head + body), with a soft drop shadow
  const grad = ctx.createLinearGradient(0, t.y, 0, t.y + 30 * PX);
  grad.addColorStop(0, '#dbb684');
  grad.addColorStop(1, '#b38957');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = grad;
  ctx.beginPath();
  tracePoly(SHAPE.head, t);
  tracePoly(SHAPE.bodyD, t);
  ctx.fill();
  ctx.restore();

  // Cardboard texture: faint vertical corrugation lines
  ctx.save();
  ctx.beginPath();
  tracePoly(SHAPE.head, t);
  tracePoly(SHAPE.bodyD, t);
  ctx.clip();
  ctx.strokeStyle = 'rgba(90,60,25,0.07)';
  for (let x = t.x - 9 * PX; x < t.x + 9 * PX; x += 4) {
    ctx.beginPath(); ctx.moveTo(x, t.y); ctx.lineTo(x, t.y + 30 * PX); ctx.stroke();
  }
  ctx.restore();

  // Outline
  ctx.strokeStyle = 'rgba(80,50,20,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  tracePoly(SHAPE.head, t);
  tracePoly(SHAPE.bodyD, t);
  ctx.stroke();

  // Dotted "perforated" scoring-zone lines
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(85,55,25,0.65)';
  ctx.lineWidth = 1.2;
  for (const zone of [SHAPE.headA, SHAPE.bodyC, SHAPE.bodyA]) {
    ctx.beginPath();
    tracePoly(zone, t);
    ctx.stroke();
  }
  ctx.restore();

  // Faint zone letters
  ctx.fillStyle = 'rgba(85,55,25,0.4)';
  ctx.font = 'bold 15px -apple-system, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', t.x, t.y + 14 * PX);
  ctx.fillText('C', t.x, t.y + 22.5 * PX);
  ctx.fillText('D', t.x - 7.5 * PX, t.y + 18 * PX);
  ctx.fillText('D', t.x + 7.5 * PX, t.y + 18 * PX);
  ctx.font = 'bold 11px -apple-system, Helvetica, Arial, sans-serif';
  ctx.fillText('A', t.x, t.y + 2.5 * PX);
}

function drawHoles() {
  for (const s of shots) {
    if (s.onTarget) {
      ctx.fillStyle = 'rgba(70,42,18,0.55)';   // torn cardboard ring
      circle(s.x, s.y, 5.5);
      ctx.fillStyle = '#120b06';               // the hole
      circle(s.x, s.y, 3.4);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; // chip in the backstop
      circle(s.x, s.y, 6);
      ctx.fillStyle = '#0a0a0b';
      circle(s.x, s.y, 3);
    }
  }
}

function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function addPopup(x, y, text, color) {
  popups.push({ x, y, text, color, born: performance.now() });
}

function drawPopups(now) {
  popups = popups.filter(p => now - p.born < 900);
  ctx.save();
  ctx.font = 'bold 22px -apple-system, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  for (const p of popups) {
    const age = (now - p.born) / 900;           // 0 → 1
    ctx.globalAlpha = 1 - age;
    const y = p.y - 22 - age * 30;              // float upward
    ctx.strokeText(p.text, p.x, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.restore();
}

function drawCrosshair() {
  if (!mouse.inside || (state !== 'standby' && state !== 'running')) return;
  const x = mouse.x, y = mouse.y - recoil * 14;   // kicks up when you fire
  ctx.save();
  for (const [color, width] of [['rgba(0,0,0,0.7)', 4], ['#ff3b3b', 2]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.moveTo(x - 28, y); ctx.lineTo(x - 7, y);
    ctx.moveTo(x + 7, y);  ctx.lineTo(x + 28, y);
    ctx.moveTo(x, y - 28); ctx.lineTo(x, y - 7);
    ctx.moveTo(x, y + 7);  ctx.lineTo(x, y + 28);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff3b3b';
  circle(x, y, 1.8);
  ctx.restore();
}

function updateHud(now) {
  let seconds = 0;
  if (state === 'running') seconds = (now - startTime) / 1000;
  if (state === 'done') seconds = finalTime;
  timerEl.textContent = seconds.toFixed(2);
  roundsEl.textContent = roundsLeft;
}


/* ---------------------------------------------------------------------
   9. THE GAME LOOP: redraw everything, about 60 times a second
   --------------------------------------------------------------------- */
function loop(now) {
  ctx.drawImage(background, 0, 0, W, H);
  TARGETS.forEach(drawTarget);
  drawHoles();
  drawPopups(now);

  if (flash > 0.01) {                           // muzzle flash
    ctx.fillStyle = `rgba(255,215,150,${flash * 0.14})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawCrosshair();
  updateHud(now);

  flash *= 0.8;
  recoil *= 0.8;
  requestAnimationFrame(loop);
}


/* ---------------------------------------------------------------------
   10. LISTEN FOR THE PLAYER (mouse and buttons)
   --------------------------------------------------------------------- */
let messageTimer = null;
function showMessage(text, hideAfterMs) {
  messageEl.textContent = text;
  messageEl.classList.add('show');
  clearTimeout(messageTimer);
  if (hideAfterMs) messageTimer = setTimeout(() => messageEl.classList.remove('show'), hideAfterMs);
}

// Convert the mouse position on screen into scene coordinates.
function updateMouse(e) {
  const r = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - r.left) * W) / r.width;
  mouse.y = ((e.clientY - r.top) * H) / r.height;
  mouse.inside = true;
}

canvas.addEventListener('pointermove', updateMouse);
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('pointerdown', e => {
  updateMouse(e);
  if (state === 'standby') { showMessage('WAIT FOR THE BEEP!'); return; }
  if (state === 'running') fireShot(mouse.x, mouse.y);
});

document.getElementById('start-btn').addEventListener('click', startStage);
document.getElementById('restart-btn').addEventListener('click', startStage);

resetStage();
requestAnimationFrame(loop);

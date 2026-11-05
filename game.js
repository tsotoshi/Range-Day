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

// The 2011 pistol at the bottom of the screen
const GUN_SIZE   = 1.6;        // make the gun bigger or smaller
const HAND_COLOR = '#c8926c';  // skin tone of the hands
const HAND_LIGHT = '#dcaa86';  // highlight
const HAND_SHADE = '#9c6b4b';  // shadow
const SLEEVE_COLOR = '#2c3440'; // shirt sleeves
const HAS_OPTIC  = true;       // true = red dot optic, false = iron sights
const DOT_COLOR  = '#ff2a2a';  // colour of the dot (try '#33ff66' for green)

const NO_SHOOT_PENALTY = 10;   // points lost for each hit on a white no-shoot

// The stages. Each one lists where its targets stand (x = left/right,
// y = up/down, in pixels) and any white no-shoot targets you must NOT hit.
// To make a new stage, copy one of these blocks and change the numbers.
const STAGES = [
  {
    name: 'Stage 1', title: 'Three Targets',
    targets:  [{ x: 330, y: 170 }, { x: 600, y: 150 }, { x: 870, y: 170 }],
    noShoots: [],
  },
  {
    name: 'Stage 2', title: 'No-Shoot',
    targets:  [{ x: 330, y: 170 }, { x: 600, y: 150 }, { x: 870, y: 170 }],
    noShoots: [{ x: 662, y: 185 }],   // stands in front of the middle target
  },
  {
    name: 'Stage 3', title: 'Mixed Targets',
    targets: [
      { x: 330, y: 170 },
      { x: 600, y: 150, tuxedo: true },   // black sides = hard cover
      { x: 870, y: 215, scale: 0.6 },     // a smaller target (60% size)
    ],
    noShoots: [{ x: 268, y: 205 }],       // stands in front of target 1
  },
];
const LAMPS = [330, 600, 870];  // left/right position of the overhead lights

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
  // A "tuxedo" target has both sides painted black, leaving a strip down
  // the middle. Black paint means hard cover: it stops the bullet.
  // The strip is 6 inches wide (x from -3 to 3), the same width as the A zone.
  // Change the 3s to make it wider or tighter.
  tuxLeft:  [[-10, 6], [-3, 6], [-3, 31], [-10, 31]],
  tuxRight: [[3, 6], [10, 6], [10, 31], [3, 31]],
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
let stageIndex = 0;        // which stage is being played (0 = Stage 1)
let stage = STAGES[0];
let state = 'ready';      // 'ready' → 'standby' → 'running' → 'done'
let shots = [];           // every bullet hole: { x, y, onTarget }
let hits = [];            // for each target, a list of zones hit, e.g. ['A','C']
let noShootHits = 0;      // how many times you hit a no-shoot
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
  hits = stage.targets.map(() => []);
  noShootHits = 0;
  popups = [];
  roundsLeft = ROUNDS_PER_STAGE;
  startTime = lastShotTime = finalTime = 0;
}


/* ---------------------------------------------------------------------
   5. STARTING, SHOOTING AND FINISHING
   --------------------------------------------------------------------- */
function chooseStage(i) {
  stageIndex = i;
  stage = STAGES[i];
  document.getElementById('stage-label').textContent = `${stage.name} · ${stage.title}`;
  startStage();
}

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
  gun.kick = 1;
  ejectBrass();
  playBrass();

  // Which target (if any) and which zone did we hit?
  let hit = null;
  stage.targets.forEach((t, i) => {
    const zone = zoneAt(t, x, y);
    if (zone && !hit) hit = { target: i, zone };
  });

  // Did the bullet go through a white no-shoot? A no-shoot is not "hard
  // cover", so the bullet can hit it AND the target behind it.
  const hitNoShoot = stage.noShoots.some(ns => zoneAt(ns, x, y));

  // Black paint on a tuxedo target is hard cover: the bullet stops there,
  // so it doesn't score.
  const hitHardCover = !!hit && hit.zone === 'HC';
  if (hitHardCover) hit = null;

  shots.push({ x, y, onTarget: !!hit || hitNoShoot || hitHardCover });

  if (hitNoShoot) {
    noShootHits++;
    playNoShoot();
    addPopup(x, y - 26, `NO-SHOOT −${NO_SHOOT_PENALTY}`, ZONE_COLORS.M);
  }
  if (hit) {
    hits[hit.target].push(hit.zone);
    playHit();
    addPopup(x, y, `${hit.zone} +${POINTS[hit.zone]}`, ZONE_COLORS[hit.zone]);
  } else if (hitHardCover) {
    playHit();
    addPopup(x, y, 'HARD COVER', '#eef1f4');
  } else if (!hitNoShoot) {
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

// Returns 'A', 'C', 'D', 'HC' (hard cover) or null for a click at (px, py).
function zoneAt(target, px, py) {
  // Turn screen pixels into inches measured from this target's head.
  // A smaller target (scale below 1) has fewer pixels per inch.
  const size = PX * (target.scale || 1);
  const x = (px - target.x) / size;
  const y = (py - target.y) / size;

  let zone = null;
  if (inside(x, y, SHAPE.bodyA) || inside(x, y, SHAPE.headA))      zone = 'A';
  else if (inside(x, y, SHAPE.bodyC) || inside(x, y, SHAPE.head))  zone = 'C'; // head "B" zone scores like C
  else if (inside(x, y, SHAPE.bodyD))                              zone = 'D';

  const onBlackPaint = inside(x, y, SHAPE.tuxLeft) || inside(x, y, SHAPE.tuxRight);
  if (zone && target.tuxedo && onBlackPaint) return 'HC';
  return zone;
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

  if (stage.noShoots.length) {
    const chips = '<span class="chip chip-NS">NS</span>'.repeat(noShootHits) || '—';
    rows += `<tr><td>No-shoot</td><td>${chips}</td><td>—</td>
             <td>${noShootHits ? '−' + noShootHits * NO_SHOOT_PENALTY : '0'}</td></tr>`;
  }

  const penalties = totalMisses * MISS_PENALTY + noShootHits * NO_SHOOT_PENALTY;
  const score = Math.max(0, totalPoints - penalties);       // can't go below zero
  const hitFactor = finalTime > 0 ? score / finalTime : 0;

  // Remember your best hit factor in this browser.
  // Each stage keeps its own personal best.
  const bestKey = stageIndex === 0 ? 'rangeDayBestHF' : 'rangeDayBestHF-' + stageIndex;
  let best = 0;
  try { best = parseFloat(localStorage.getItem(bestKey)) || 0; } catch (e) {}
  const isNewBest = hitFactor > best;
  if (isNewBest) {
    try { localStorage.setItem(bestKey, hitFactor); } catch (e) {}
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

  document.querySelector('#results-screen h2').textContent = `${stage.name} Complete`;
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

// A low buzzer for hitting a no-shoot.
function playNoShoot() {
  if (!audio) return;
  const t = audio.currentTime + 0.05;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 140;
  g.gain.setValueAtTime(0.2, t);
  g.gain.setValueAtTime(0.2, t + 0.25);
  g.gain.linearRampToValueAtTime(0, t + 0.3);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.3);
}

// Two little "tinks" as the empty case lands on the floor.
function playBrass() {
  if (!audio) return;
  for (const [delay, pitch] of [[0.5, 3800], [0.62, 4700]]) {
    const t = audio.currentTime + delay + Math.random() * 0.05;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.frequency.value = pitch;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.13);
  }
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
  for (const lampX of LAMPS) {
    const glow = g.createRadialGradient(lampX, 90, 10, lampX, 260, 330);
    glow.addColorStop(0, 'rgba(255,232,190,0.32)');
    glow.addColorStop(1, 'rgba(255,232,190,0)');
    g.fillStyle = glow;
    g.fillRect(lampX - 400, 80, 800, H - 80);

    g.fillStyle = '#3d3d42';
    g.fillRect(lampX - 52, 72, 104, 8);
    g.shadowColor = 'rgba(255,240,200,1)';
    g.shadowBlur = 30;
    g.fillStyle = '#fff4dc';
    g.fillRect(lampX - 46, 79, 92, 4);
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
    const size = PX * (t.scale || 1);
    const x = t.x + ix * size, y = t.y + iy * size;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// Draws one target. white = true draws a white no-shoot instead of cardboard.
function drawTarget(t, white = false) {
  const scale = t.scale || 1;
  const P = PX * scale;          // pixels per inch for THIS target
  // Wooden stand sticks and floor shadow
  const standTop = t.y + 24 * P, standBottom = 505;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(t.x, standBottom, 95 * scale, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-5, 5]) {
    const sx = t.x + side * P;
    ctx.fillStyle = '#8b6a42';
    ctx.fillRect(sx - 5, standTop, 10, standBottom - standTop);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(sx + 2, standTop, 3, standBottom - standTop);
  }
  ctx.fillStyle = '#2a2622';
  ctx.fillRect(t.x - 70 * scale, standBottom - 8, 140 * scale, 10);

  // Cardboard (head + body), with a soft drop shadow
  const grad = ctx.createLinearGradient(0, t.y, 0, t.y + 30 * P);
  grad.addColorStop(0, white ? '#f6f4ee' : '#dbb684');
  grad.addColorStop(1, white ? '#d6d2c8' : '#b38957');
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
  ctx.strokeStyle = white ? 'rgba(0,0,0,0.04)' : 'rgba(90,60,25,0.07)';
  for (let x = t.x - 9 * P; x < t.x + 9 * P; x += 4) {
    ctx.beginPath(); ctx.moveTo(x, t.y); ctx.lineTo(x, t.y + 30 * P); ctx.stroke();
  }
  ctx.restore();

  // Outline
  ctx.strokeStyle = white ? 'rgba(90,90,90,0.6)' : 'rgba(80,50,20,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  tracePoly(SHAPE.head, t);
  tracePoly(SHAPE.bodyD, t);
  ctx.stroke();

  // Dotted "perforated" scoring-zone lines
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = white ? 'rgba(120,120,120,0.5)' : 'rgba(85,55,25,0.65)';
  ctx.lineWidth = 1.2;
  for (const zone of [SHAPE.headA, SHAPE.bodyC, SHAPE.bodyA]) {
    ctx.beginPath();
    tracePoly(zone, t);
    ctx.stroke();
  }
  ctx.restore();

  // Tuxedo: paint both sides black (clipped to the target's outline)
  if (t.tuxedo) {
    ctx.save();
    ctx.beginPath();
    tracePoly(SHAPE.head, t);
    tracePoly(SHAPE.bodyD, t);
    ctx.clip();
    ctx.fillStyle = '#141414';
    ctx.beginPath();
    tracePoly(SHAPE.tuxLeft, t);
    tracePoly(SHAPE.tuxRight, t);
    ctx.fill();
    ctx.restore();
  }

  // Faint zone letters (no-shoots don't get them)
  if (white) return;
  ctx.fillStyle = 'rgba(85,55,25,0.4)';
  ctx.font = `bold ${Math.round(15 * scale)}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', t.x, t.y + 14 * P);
  ctx.fillText('C', t.x, t.y + 22.5 * P);
  if (!t.tuxedo) {               // on a tuxedo the D sides are painted over
    ctx.fillText('D', t.x - 7.5 * P, t.y + 18 * P);
    ctx.fillText('D', t.x + 7.5 * P, t.y + 18 * P);
  }
  ctx.font = `bold ${Math.round(11 * scale)}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.fillText('A', t.x, t.y + 2.5 * P);
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
   8b. THE 2011 PISTOL
   Drawn in code, seen from behind as if you're holding it. Every shape
   below is measured in pixels from the top of the front sight, then
   the whole drawing is moved to the gun's position and scaled up.
   --------------------------------------------------------------------- */
const gun = { x: W / 2, y: 520, kick: 0 };   // kick: 1 right after a shot → 0
let brass = [];                               // flying empty cases

function updateGun() {
  // Follow the aim, a little behind it so the gun feels heavy.
  const aimY = Math.min(Math.max(mouse.y + 170, 440), 560);
  gun.x += (mouse.x - gun.x) * 0.3;
  gun.y += (aimY - gun.y) * 0.3;
  gun.kick *= 0.82;
}

function fillPoly(points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A rounded, softly shaded shape for hands and thumbs.
function skin(cx, cy, rx, ry, rotation, dark) {
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, 2, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, HAND_LIGHT);
  g.addColorStop(1, dark ? HAND_SHADE : HAND_COLOR);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,15,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawGun() {
  ctx.save();
  ctx.translate(gun.x, gun.y - gun.kick * 45);                         // recoil lifts the gun
  ctx.rotate(((gun.x - W / 2) / W) * 0.12 - gun.kick * 0.08);          // slight tilt
  ctx.scale(GUN_SIZE, GUN_SIZE);

  // Muzzle flash, out past the front of the gun (drawn first, so it's behind)
  if (gun.kick > 0.55) {
    const f = 0.6 + 0.4 * (gun.kick - 0.55) / 0.45;
    const g = ctx.createRadialGradient(0, -28, 0, 0, -28, 80 * f);
    g.addColorStop(0, 'rgba(255,255,230,0.95)');
    g.addColorStop(0.3, 'rgba(255,200,90,0.8)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -40, 50 * f, 85 * f, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Forearms reaching down to the bottom corners, with shirt sleeves
  for (const arm of [
    [[-56, 160], [-12, 170], [-80, 440], [-270, 440]],    // left arm
    [[-8, 166], [40, 158], [240, 440], [50, 440]],        // right arm
  ]) {
    const g = ctx.createLinearGradient(0, 160, 0, 360);
    g.addColorStop(0, HAND_COLOR);
    g.addColorStop(1, HAND_SHADE);
    ctx.fillStyle = g;
    fillPoly(arm);
    ctx.save();
    ctx.beginPath();
    arm.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.clip();
    ctx.fillStyle = SLEEVE_COLOR;
    ctx.fillRect(-400, 330, 800, 200);
    ctx.restore();
  }

  // Slide: the top surface catches the light, the back face is darker
  ctx.fillStyle = '#4b4e54';
  fillPoly([[-27, 2], [27, 2], [31, 9], [-31, 9]]);
  const steel = ctx.createLinearGradient(0, 8, 0, 60);
  steel.addColorStop(0, '#35383d');
  steel.addColorStop(1, '#18191c');
  ctx.fillStyle = steel;
  roundRect(-31, 8, 62, 52, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';                           // rear serrations
  ctx.lineWidth = 1;
  for (let y = 14; y < 56; y += 3.5) {
    ctx.beginPath(); ctx.moveTo(-26, y); ctx.lineTo(26, y); ctx.stroke();
  }
  ctx.fillStyle = '#2a2c30';                                             // firing-pin stop
  roundRect(-8, 22, 16, 28, 3);
  ctx.fill();

  if (HAS_OPTIC) {
    drawOptic();
  } else {
    // Front sight (far away, seen through the rear notch) with a red fiber-optic dot
    ctx.fillStyle = '#101112';
    ctx.fillRect(-3, -6, 6, 10);
    ctx.save();
    ctx.shadowColor = '#ff2a2a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff4a3a';
    circle(0, -3, 2.3);
    ctx.restore();

    // Rear sight: a black block with a square notch
    ctx.fillStyle = '#0d0e0f';
    fillPoly([[-23, -6], [-5.5, -6], [-5.5, 4], [5.5, 4], [5.5, -6], [23, -6], [24, 10], [-24, 10]]);

  }

  // Frame under the slide, cocked hammer, and the big 2011 beavertail
  ctx.fillStyle = '#1f2023';
  ctx.fillRect(-26, 58, 52, 12);
  ctx.fillStyle = '#3c3f44';
  roundRect(-7, 48, 14, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#1a1b1e';
  circle(0, 54, 2.6);
  const bt = ctx.createLinearGradient(0, 62, 0, 90);
  bt.addColorStop(0, '#5a5d63');
  bt.addColorStop(1, '#2a2b2f');
  ctx.fillStyle = bt;
  ctx.beginPath();
  ctx.moveTo(-31, 63);
  ctx.quadraticCurveTo(0, 74, 31, 63);
  ctx.lineTo(28, 76);
  ctx.quadraticCurveTo(0, 94, -28, 76);
  ctx.closePath();
  ctx.fill();

  // Support (left) hand: its heel presses on the left side of the grip
  let g = ctx.createLinearGradient(-60, 0, -10, 0);
  g.addColorStop(0, HAND_SHADE);
  g.addColorStop(1, HAND_COLOR);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-24, 88);
  ctx.bezierCurveTo(-44, 86, -60, 104, -60, 128);
  ctx.bezierCurveTo(-60, 150, -54, 164, -52, 172);
  ctx.lineTo(-10, 174);
  ctx.bezierCurveTo(-18, 150, -24, 120, -24, 88);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,15,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Strong (right) hand: the web sits high under the beavertail
  g = ctx.createLinearGradient(-30, 0, 52, 0);
  g.addColorStop(0, HAND_LIGHT);
  g.addColorStop(0.55, HAND_COLOR);
  g.addColorStop(1, HAND_SHADE);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-28, 80);
  ctx.quadraticCurveTo(0, 98, 28, 78);           // web of the hand
  ctx.bezierCurveTo(44, 84, 52, 104, 50, 126);   // back of the hand
  ctx.bezierCurveTo(48, 146, 42, 158, 38, 168);  // down to the wrist
  ctx.lineTo(-8, 170);
  ctx.bezierCurveTo(-22, 150, -32, 118, -28, 80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,50,25,0.18)';      // a soft tendon line
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, 100); ctx.quadraticCurveTo(24, 130, 22, 160); ctx.stroke();

  // Thumbs: both point forward along the left side of the frame
  for (const [cx, cy, rx, ry, rot] of [[-44, 90, 11, 14, 0.5], [-36, 70, 10, 15, 0.35]]) {
    skin(cx, cy, rx, ry, rot, false);
    ctx.fillStyle = 'rgba(255,228,214,0.55)';    // thumbnail
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy - ry * 0.45, rx * 0.55, ry * 0.32, rot, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// A red dot optic on the back of the slide, seen from behind.
function drawOptic() {
  // Mounting plate on the slide
  ctx.fillStyle = '#141517';
  ctx.fillRect(-24, 1, 48, 8);

  // Housing with a window cut out of it ("evenodd" leaves the hole empty)
  const body = ctx.createLinearGradient(0, -42, 0, 8);
  body.addColorStop(0, '#3a3d42');
  body.addColorStop(1, '#141517');
  ctx.fillStyle = body;
  roundRect(-26, -42, 52, 50, 7);
  ctx.moveTo(-19, -35);
  ctx.lineTo(-19, -3);
  ctx.lineTo(19, -3);
  ctx.lineTo(19, -35);
  ctx.closePath();
  ctx.fill('evenodd');

  // Adjustment buttons on the side
  ctx.fillStyle = '#2a2c30';
  roundRect(25, -28, 4, 12, 1.5);
  ctx.fill();

  // Tinted glass and a soft reflection
  ctx.fillStyle = 'rgba(120,170,210,0.16)';
  ctx.fillRect(-19, -35, 38, 32);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-19, -35, 38, 32);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  fillPoly([[-19, -20], [-4, -35], [6, -35], [-19, -10]]);
  ctx.restore();

  // The glowing dot
  ctx.save();
  ctx.shadowColor = DOT_COLOR;
  ctx.shadowBlur = 10;
  ctx.fillStyle = DOT_COLOR;
  circle(0, -19, 2.2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  circle(0, -19, 0.9);
  ctx.restore();
}

function ejectBrass() {
  brass.push({
    x: gun.x + 40, y: gun.y - 10,
    vx: 4 + Math.random() * 3, vy: -9 - Math.random() * 3,
    rot: 0, spin: 0.35 + Math.random() * 0.3,
    born: performance.now(),
  });
}

function drawBrass(now) {
  brass = brass.filter(b => now - b.born < 1500 && b.y < H + 20);
  for (const b of brass) {
    b.vy += 0.6;                 // gravity
    b.x += b.vx;
    b.y += b.vy;
    b.rot += b.spin;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.fillStyle = '#d6a637';
    ctx.fillRect(-3, -7, 6, 14);
    ctx.fillStyle = '#f5d67e';   // shine
    ctx.fillRect(-3, -7, 2, 14);
    ctx.fillStyle = '#8a6420';   // rim
    ctx.fillRect(-3, 5, 6, 2);
    ctx.restore();
  }
}


/* ---------------------------------------------------------------------
   9. THE GAME LOOP: redraw everything, about 60 times a second
   --------------------------------------------------------------------- */
function loop(now) {
  ctx.drawImage(background, 0, 0, W, H);
  stage.targets.forEach(t => drawTarget(t));
  stage.noShoots.forEach(ns => drawTarget(ns, true));   // in front of the targets
  drawHoles();
  drawPopups(now);
  updateGun();
  drawBrass(now);
  drawGun();

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

// Each stage button on the start screen has data-stage="0", "1", ...
document.querySelectorAll('[data-stage]').forEach(btn =>
  btn.addEventListener('click', () => chooseStage(Number(btn.dataset.stage))));
document.getElementById('menu-btn').addEventListener('click', () => {
  state = 'ready';
  resetStage();
  resultsScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
});
document.getElementById('restart-btn').addEventListener('click', startStage);

resetStage();
requestAnimationFrame(loop);

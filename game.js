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
const GUN_SIZE   = 1.3;        // make the gun bigger or smaller
const HAS_OPTIC  = true;       // true = red dot optic, false = iron sights
const DOT_COLOR  = '#ff2a2a';  // colour of the dot (try '#33ff66' for green)

const NO_SHOOT_PENALTY = 10;   // points lost for each hit on a white no-shoot

// Online leaderboard (Supabase). Paste your Project URL and "anon public"
// key here (Supabase → Project Settings → API). Leave them as '' to turn
// the leaderboard off — the game works fine without it.
const LEADERBOARD_URL = 'https://gfybimpuyzbwxhxhikpt.supabase.co';
const LEADERBOARD_KEY = 'sb_publishable_KIsjKLERCZHNllKXuOn1Uw_Ef9f3ADB';  // public by design

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
const submitForm    = document.getElementById('submit-form');
const nameInput     = document.getElementById('player-name');
const submitBtn     = document.getElementById('submit-btn');
const submitStatus  = document.getElementById('submit-status');
const leaderboardEl = document.getElementById('leaderboard');
const boardScreen   = document.getElementById('board-screen');
const boardListEl   = document.getElementById('board-list');

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

  // Remember this run so it can be sent to the online leaderboard.
  lastResult = {
    stage: stageIndex,
    hit_factor: Math.round(hitFactor * 10000) / 10000,
    score, penalties,
    time: Math.round(finalTime * 100) / 100,
  };
  prepareLeaderboard();
}


/* ---------------------------------------------------------------------
   6b. ONLINE LEADERBOARD
   Scores are stored in a free Supabase database. We talk to it with
   plain fetch() calls. If it's not set up, or the internet is down,
   the game just carries on without it.
   --------------------------------------------------------------------- */
const leaderboardOn = !!(LEADERBOARD_URL && LEADERBOARD_KEY);
let lastResult = null;     // the run shown on the results screen
let submitted = false;     // stops the same run being sent twice

function apiHeaders() {
  return {
    apikey: LEADERBOARD_KEY,
    Authorization: `Bearer ${LEADERBOARD_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Top 10 scores for one stage, best hit factor first.
async function fetchLeaderboard(stageNum) {
  const url = `${LEADERBOARD_URL}/rest/v1/range_scores?select=id,name,hit_factor,time` +
              `&stage=eq.${stageNum}&order=hit_factor.desc,created_at.asc&limit=10`;
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`Leaderboard error ${res.status}`);
  return res.json();
}

// Send one run. Returns the new row (so we can highlight it).
async function submitScore(name, result) {
  const res = await fetch(`${LEADERBOARD_URL}/rest/v1/range_scores`, {
    method: 'POST',
    headers: { ...apiHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ name, ...result }),
  });
  if (!res.ok) throw new Error(`Submit error ${res.status}`);
  return (await res.json())[0];
}

// Stops names like "<script>" from turning into real HTML.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLeaderboard(rows, highlightId) {
  if (!rows.length) return '<p class="board-note">No scores yet. Be the first!</p>';
  const body = rows.map((r, i) => `
    <tr class="${r.id === highlightId ? 'me' : ''}">
      <td>${i + 1}</td><td class="board-name">${escapeHtml(r.name)}</td>
      <td>${Number(r.hit_factor).toFixed(4)}</td><td>${Number(r.time).toFixed(2)}s</td>
    </tr>`).join('');
  return `<table class="board"><tr><th>#</th><th>SHOOTER</th><th>HF</th><th>TIME</th></tr>${body}</table>`;
}

// Fill an element with a stage's top 10 (or an "offline" note).
async function loadBoardInto(el, stageNum, highlightId) {
  el.innerHTML = '<p class="board-note">Loading leaderboard…</p>';
  try {
    el.innerHTML = renderLeaderboard(await fetchLeaderboard(stageNum), highlightId);
  } catch (e) {
    el.innerHTML = '<p class="board-note">Leaderboard offline.</p>';
  }
}

// Called each time the results screen opens.
function prepareLeaderboard() {
  if (!leaderboardOn) return;
  submitted = false;
  submitStatus.textContent = '';
  const canSubmit = lastResult.hit_factor > 0;
  submitForm.classList.toggle('hidden', !canSubmit);
  submitBtn.disabled = !canSubmit;
  leaderboardEl.classList.remove('hidden');
  loadBoardInto(leaderboardEl, lastResult.stage);
}

async function handleSubmit(e) {
  e.preventDefault();
  if (submitted || !lastResult) return;
  const name = nameInput.value.trim().slice(0, 16);
  if (!name) { submitStatus.textContent = 'Type a name first.'; nameInput.focus(); return; }
  try { localStorage.setItem('rangeDayName', name); } catch (err) {}

  submitted = true;
  submitBtn.disabled = true;
  submitStatus.textContent = 'Sending…';
  try {
    const row = await submitScore(name, lastResult);
    submitStatus.textContent = 'Score posted!';
    loadBoardInto(leaderboardEl, lastResult.stage, row && row.id);
  } catch (err) {
    submitted = false;
    submitBtn.disabled = false;
    submitStatus.textContent = 'Could not reach the leaderboard. Try again.';
  }
}

// The "Leaderboards" screen reached from the start menu.
function showBoardScreen(stageNum) {
  startScreen.classList.add('hidden');
  boardScreen.classList.remove('hidden');
  document.querySelectorAll('[data-board]').forEach(b =>
    b.classList.toggle('secondary', Number(b.dataset.board) !== stageNum));
  loadBoardInto(boardListEl, stageNum);
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
  const aimY = Math.min(Math.max(mouse.y + 120, 380), 500);
  // Place the gun so its muzzle sits just below your aim point.
  const muzzle = P(0, 1.2, 6);
  gun.x += (mouse.x - muzzle[0] * GUN_SIZE * 0.85 - gun.x) * 0.3;
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

// ---- A tiny 3D camera ---------------------------------------------------
// The gun is described in real inches: x = right, y = up, z = forward
// (toward the targets). (0, 0, 0) is the bottom of the slide at its back
// end. P() turns one of those 3D points into a 2D point on the screen, the
// way a camera would: things further away look smaller and closer to the
// middle. Your eye is a little behind, above and to the left of the gun.
// focal sets how big the gun looks.
const EYE = { x: -10, y: 5, z: -18, focal: 1100 };
function rawP(x, y, z) {
  const dz = z - EYE.z;
  return [((x - EYE.x) * EYE.focal) / dz, (-(y - EYE.y) * EYE.focal) / dz];
}
function P(x, y, z) {
  const [sx, sy] = rawP(x, y, z);
  const [ax, ay] = rawP(0, 1.2, 0);          // keep the back of the slide at (0, 8)
  return [sx - ax, sy - ay + 8];
}
const pxPerInch = z => EYE.focal / (z - EYE.z);  // how big 1 inch looks at depth z

// Draw a box: its left side, top and back (the three faces you can see).
function box(x0, x1, y0, y1, z0, z1, left, top, back) {
  ctx.fillStyle = left;
  fillPoly([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)]);
  ctx.fillStyle = top;
  fillPoly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
  ctx.fillStyle = back;
  fillPoly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)]);
}

function line3(a, b) {
  const A = P(...a), B = P(...b);
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
}

function drawGun() {
  ctx.save();
  ctx.translate(gun.x, gun.y - gun.kick * 45);                         // recoil lifts the gun
  ctx.rotate(((gun.x - W / 2) / W) * 0.12 - gun.kick * 0.08);          // slight tilt
  ctx.scale(GUN_SIZE, GUN_SIZE);

  // Muzzle flash at the front of the gun (drawn first, so the gun covers its base)
  if (gun.kick > 0.55) {
    const f = 0.6 + 0.4 * (gun.kick - 0.55) / 0.45;
    const [mx, my] = P(0, 0.6, 6.4);
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, 80 * f);
    g.addColorStop(0, 'rgba(255,255,230,0.95)');
    g.addColorStop(0.3, 'rgba(255,200,90,0.8)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(mx, my - 20 * f, 50 * f, 80 * f, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Frame: the dust cover under the slide, and the grip
  box(-0.5, 0.5, -0.6, 0, 0, 5.9, '#2b2e32', '#2b2e32', '#212326');
  box(-0.6, 0.6, -5.2, -0.6, -0.2, 1.7, '#26282c', '#26282c', '#1c1e21');   // grip
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';                               // grip texture
  for (let y = -1.0; y > -5.0; y -= 0.25) line3([-0.6, y, -0.1], [-0.6, y, 1.6]);
  box(-0.75, 0.75, -6.0, -5.2, -0.4, 1.9, '#2e3035', '#3a3d42', '#232529');  // magwell
  ctx.strokeStyle = '#1c1e21';                                         // trigger guard
  ctx.lineWidth = 0.22 * pxPerInch(2.4);
  ctx.beginPath();
  for (const [i, [y, z]] of [[-0.6, 1.7], [-1.7, 1.9], [-1.9, 2.7], [-0.6, 3.0]].entries()) {
    const [sx, sy] = P(-0.4, y, z);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  // Front sight near the muzzle
  box(-0.06, 0.06, 1.2, 1.45, 5.6, 5.8, '#101112', '#1a1b1d', '#0c0d0e');

  // Slide, with cocking serrations on the side and back
  box(-0.47, 0.47, 0, 1.2, 0, 6.0, '#3a3d43', '#4c5056', '#2b2e33');
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  for (let z = 0.25; z < 1.3; z += 0.12) line3([-0.47, 0.15, z], [-0.47, 1.05, z]);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let y = 0.12; y < 1.15; y += 0.07) line3([-0.42, y, 0], [0.42, y, 0]);
  ctx.fillStyle = '#25272b';                                           // firing-pin stop
  fillPoly([P(-0.13, 0.1, 0), P(0.13, 0.1, 0), P(0.13, 0.75, 0), P(-0.13, 0.75, 0)]);

  // Sights on top of the slide
  if (HAS_OPTIC) drawOptic();
  else box(-0.4, 0.4, 1.2, 1.5, 0.05, 0.45, '#141517', '#1c1d20', '#0e0f10');  // rear sight

  // Cocked hammer and the big 2011 beavertail
  box(-0.12, 0.12, 0.02, 0.32, -0.22, 0, '#34373c', '#44474d', '#26282c');
  box(-0.42, 0.42, -0.46, -0.34, -0.42, 0, '#2c2e33', '#3c3f45', '#232529');

  ctx.restore();
}

// A red dot optic on the back of the slide.
function drawOptic() {
  const x0 = -0.48, x1 = 0.48, y0 = 1.2, y1 = 2.15, z0 = 0.2, z1 = 1.7;
  ctx.fillStyle = '#25272b';                                           // left side
  fillPoly([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)]);
  ctx.fillStyle = '#34373c';                                           // top
  fillPoly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
  ctx.fillStyle = '#2c2e33';                                           // button on the side
  fillPoly([P(x0 - 0.02, 1.55, 0.6), P(x0 - 0.02, 1.8, 0.6), P(x0 - 0.02, 1.8, 0.9), P(x0 - 0.02, 1.55, 0.9)]);

  // Back face with the window cut out ("evenodd" leaves the hole empty)
  const wx = 0.36, wy0 = 1.32, wy1 = 2.03;
  const outer = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)];
  const inner = [P(-wx, wy0, z0), P(-wx, wy1, z0), P(wx, wy1, z0), P(wx, wy0, z0)];
  ctx.beginPath();
  [outer, inner].forEach(shape => {
    shape.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  });
  const body = ctx.createLinearGradient(0, outer[2][1], 0, outer[0][1]);
  body.addColorStop(0, '#3a3d42');
  body.addColorStop(1, '#16171a');
  ctx.fillStyle = body;
  ctx.fill('evenodd');

  // Tinted glass, a reflection, and the glowing dot
  ctx.save();
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(120,170,210,0.16)';
  ctx.fill();
  const [lx, ly] = inner[0], [rx, ry] = inner[2];
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  fillPoly([[lx, ly - (ly - ry) * 0.5], [lx + (rx - lx) * 0.35, ry], [lx + (rx - lx) * 0.6, ry], [lx, ly - (ly - ry) * 0.15]]);
  ctx.restore();
  const [dx, dy] = P(0, (wy0 + wy1) / 2, z0);
  ctx.save();
  ctx.shadowColor = DOT_COLOR;
  ctx.shadowBlur = 10;
  ctx.fillStyle = DOT_COLOR;
  circle(dx, dy, 2.2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  circle(dx, dy, 0.9);
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

// Online leaderboard buttons (hidden when the leaderboard isn't set up).
if (leaderboardOn) {
  try { nameInput.value = localStorage.getItem('rangeDayName') || ''; } catch (e) {}
  submitForm.addEventListener('submit', handleSubmit);
  document.getElementById('boards-btn').classList.remove('hidden');
  document.getElementById('boards-btn').addEventListener('click', () => showBoardScreen(0));
  document.querySelectorAll('[data-board]').forEach(btn =>
    btn.addEventListener('click', () => showBoardScreen(Number(btn.dataset.board))));
  document.getElementById('board-back-btn').addEventListener('click', () => {
    boardScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
  });
}

resetStage();
requestAnimationFrame(loop);

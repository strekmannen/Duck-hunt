const gameArea = document.getElementById("gameArea");
const duckEl = document.getElementById("duck");
const scoreEl = document.getElementById("score");
const waveEl = document.getElementById("wave");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const highscoreBtn = document.getElementById("highscoreBtn");
const highscorePanelEl = document.getElementById("highscorePanel");
const lifeIcons = Array.from(document.querySelectorAll(".life-icon"));
const playerFirstNameEl = document.getElementById("playerFirstName");
const playerLastNameEl = document.getElementById("playerLastName");
const playerEmailEl = document.getElementById("playerEmail");
const highscoreListEl = document.getElementById("highscoreList");

// Fill these from your Supabase project settings.
const SUPABASE_URL = "https://uxgvqoelwizzzrorixxt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jaisPo_vFHa2PZBewk40JA_wA1Glqfj";

const DUCK_START_SPEED = 3.1;
const DUCK_MIN_AXIS_SPEED = 0.75;
const DUCK_BASE_SIZE = 84;
const DUCK_MIN_SIZE = 46;
const WAVE_SIZE_STEP = 3;
const START_LIVES = 3;
const SQUISH_DELAY_MS = 1000;
const BASE_POINTS_PER_HIT = 10;
const MAX_SPEED_BONUS = 24;
const COMBO_STREAK_STEP = 5;
const COMBO_STEP_BONUS = 10;
const DUCKS_PER_WAVE = 6;
const WAVE_SPEED_STEP = 0.45;
const CROSS_ENTRY_MARGIN_RATIO = 0.18;
const REDIRECT_CANDIDATES = 7;
const MIN_REDIRECT_ANGLE_DELTA = 0.7;
const MIN_ENTRY_GAP_RATIO = 0.2;
const SIDE_VARIATION_CHANCE = 0.82;
const EDGE_LANE_WEIGHT = 12;
const CENTER_LANE_WEIGHT = 0.12;
const PLAYER_PROFILE_KEY = "badeand_player_profile_v1";
const HIGHSCORE_LIMIT = 10;
const SESSION_CREATE_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/create_game_session`;
const REGISTER_HIT_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/register_hit`;

const duck = {
  x: 240,
  y: 160,
  size: DUCK_BASE_SIZE,
  speed: DUCK_START_SPEED,
  vx: 1.2,
  vy: 1.2,
  state: "whole"
};
let score = 0;
let lives = START_LIVES;
let running = true;
let roundId = 0;
let squishTimeoutId = null;
let currentGameSessionId = null;
let comboStreak = 0;
let wave = 1;
let hitsInWave = 0;
let totalHits = 0;
let lastRedirectAngle = null;
let lastEntry = null;
let lastTravelBandKey = "";
let lastDuckSpawnAtMs = 0;
let animationFrameId = null;

function isSupabaseConfigured() {
  return SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.length > 20;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function areProfileFieldsValid() {
  return (
    playerFirstNameEl.checkValidity() &&
    playerLastNameEl.checkValidity() &&
    playerEmailEl.checkValidity()
  );
}

function toDisplayName(firstName, lastName) {
  const safeFirst = (firstName || "").trim();
  const safeLast = (lastName || "").trim();
  if (!safeFirst && !safeLast) return "Ukjent";
  if (!safeLast) return safeFirst;
  const lastInitial = safeLast.charAt(0).toUpperCase();
  const first = safeFirst || "Ukjent";
  return `${first} ${lastInitial}.`;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function savePlayerProfile() {
  const profile = {
    firstName: (playerFirstNameEl.value || "").trim(),
    lastName: (playerLastNameEl.value || "").trim(),
    email: (playerEmailEl.value || "").trim()
  };
  localStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile));
}

function loadPlayerProfile() {
  try {
    const raw = localStorage.getItem(PLAYER_PROFILE_KEY);
    if (!raw) return;
    const profile = JSON.parse(raw);
    if (profile && typeof profile === "object") {
      playerFirstNameEl.value = profile.firstName || "";
      playerLastNameEl.value = profile.lastName || "";
      playerEmailEl.value = profile.email || "";
    }
  } catch {
    // ignore invalid local profile
  }
}

function renderHighscoreItems(items) {
  if (!items.length) {
    highscoreListEl.innerHTML = "<li>Ingen highscores enda</li>";
    return;
  }

  highscoreListEl.innerHTML = items
    .slice(0, HIGHSCORE_LIMIT)
    .map((entry) => {
      const publicName = entry.display_name || entry.displayName || "Ukjent";
      return `<li>${publicName} - ${entry.score}</li>`;
    })
    .join("");
}

async function fetchGlobalHighscores() {
  const selectCols = "display_name,score,updated_at";
  const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=${selectCols}&order=score.desc,updated_at.asc&limit=${HIGHSCORE_LIMIT}`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!response.ok) throw new Error("Could not fetch global leaderboard");
  return response.json();
}

async function createGameSession() {
  if (!isSupabaseConfigured()) return null;
  const response = await fetch(SESSION_CREATE_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`create_game_session failed: ${details}`);
  }
  const payload = await response.json();
  if (typeof payload === "string" && payload.length > 10) return payload;
  if (payload && typeof payload === "object" && typeof payload.session_id === "string") {
    return payload.session_id;
  }
  throw new Error("create_game_session returned unexpected payload");
}

async function ensureGameSession() {
  if (currentGameSessionId) return currentGameSessionId;
  currentGameSessionId = await createGameSession();
  return currentGameSessionId;
}

async function loadAndRenderHighscores(options = {}) {
  if (!isSupabaseConfigured()) {
    highscoreListEl.innerHTML = "<li>Global highscore er ikke konfigurert.</li>";
    return;
  }
  try {
    const items = await fetchGlobalHighscores();
    renderHighscoreItems(items);
  } catch {
    highscoreListEl.innerHTML = "<li>Kunne ikke hente global highscore akkurat nå.</li>";
  }
}

async function registerHitForCurrentSession() {
  if (!currentGameSessionId) {
    throw new Error("game session missing or expired");
  }
  const response = await fetch(REGISTER_HIT_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_session_id: currentGameSessionId
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`register_hit failed: ${details}`);
  }
  const payload = await response.json();
  if (typeof payload === "number") return payload;
  if (payload && typeof payload === "object" && typeof payload.register_hit === "number") {
    return payload.register_hit;
  }
  throw new Error("register_hit returned unexpected payload");
}

async function saveScoreForCurrentPlayer() {
  const firstName = (playerFirstNameEl.value || "").trim();
  const lastName = (playerLastNameEl.value || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const email = (playerEmailEl.value || "").trim().toLowerCase();
  const isValid =
    firstName.length > 0 &&
    lastName.length > 0 &&
    isValidEmail(email);
  if (!isValid) return { saved: false, reason: "missing_profile" };
  const displayName = toDisplayName(firstName, lastName);
  if (!isSupabaseConfigured()) {
    return { saved: false, reason: "global_not_configured" };
  }

  try {
    if (!currentGameSessionId) {
      currentGameSessionId = await createGameSession();
    }
  } catch (error) {
    const msg = String(error?.message || "");
    return { saved: false, reason: "missing_session", details: msg };
  }

  try {
    const emailHash = await sha256(email);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_score`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_session_id: currentGameSessionId,
        p_email_hash: emailHash,
        p_display_name: displayName,
        p_full_name: fullName,
        p_email: email,
        p_client_score: score
      })
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`submit_score failed: ${details}`);
    }
    await loadAndRenderHighscores();
    return { saved: true, scope: "global" };
  } catch (error) {
    console.warn("Global score save failed.", error);
    const msg = String(error.message || "");
    if (msg.includes("score exceeds allowed pace")) {
      return { saved: false, reason: "score_rejected" };
    }
    if (msg.includes("submit_score(")) {
      return { saved: false, reason: "sql_not_updated", details: msg };
    }
    if (msg.includes("game session missing or expired")) {
      return { saved: false, reason: "missing_session", details: msg };
    }
    return { saved: false, reason: "global_save_failed", details: msg };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pickRandomSide() {
  const sides = ["left", "right", "top", "bottom"];
  return sides[Math.floor(Math.random() * sides.length)];
}

function setDuckVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;
  duck.vx = Math.cos(angle) * speed;
  duck.vy = Math.sin(angle) * speed;
  if (Math.abs(duck.vx) < DUCK_MIN_AXIS_SPEED) duck.vx = Math.sign(duck.vx || 1) * DUCK_MIN_AXIS_SPEED;
  if (Math.abs(duck.vy) < DUCK_MIN_AXIS_SPEED) duck.vy = Math.sign(duck.vy || 1) * DUCK_MIN_AXIS_SPEED;
}

function setDuckVelocityToward(targetX, targetY, speed) {
  const dx = targetX - duck.x;
  const dy = targetY - duck.y;
  const distance = Math.hypot(dx, dy) || 1;
  duck.vx = (dx / distance) * speed;
  duck.vy = (dy / distance) * speed;
  if (Math.abs(duck.vx) < DUCK_MIN_AXIS_SPEED) duck.vx = Math.sign(duck.vx || 1) * DUCK_MIN_AXIS_SPEED;
  if (Math.abs(duck.vy) < DUCK_MIN_AXIS_SPEED) duck.vy = Math.sign(duck.vy || 1) * DUCK_MIN_AXIS_SPEED;
  keepDuckSpeed();
}

function keepDuckSpeed() {
  const current = Math.hypot(duck.vx, duck.vy) || 1;
  const target = duck.speed;
  duck.vx = (duck.vx / current) * target;
  duck.vy = (duck.vy / current) * target;
}

function applyDuckSprite() {
  duckEl.classList.toggle("flat", duck.state === "flat");
}

function updateLivesIcons() {
  lifeIcons.forEach((icon, idx) => {
    icon.classList.toggle("lost", idx >= lives);
  });
}

function render() {
  duckEl.style.left = `${duck.x}px`;
  duckEl.style.top = `${duck.y}px`;
  const wholeSize = duck.size;
  const flatWidth = duck.size * 1.35;
  const flatHeight = duck.size * 0.9;
  duckEl.style.width = duck.state === "flat" ? `${flatWidth}px` : `${wholeSize}px`;
  duckEl.style.height = duck.state === "flat" ? `${flatHeight}px` : `${wholeSize}px`;
  scoreEl.textContent = String(score);
  waveEl.textContent = String(wave);
  updateLivesIcons();
  applyDuckSprite();
}

function createFloatingPoints(points, streakLabel) {
  const floating = document.createElement("div");
  floating.className = "floating-points";
  const pointsEl = document.createElement("div");
  pointsEl.className = "floating-points-score";
  pointsEl.textContent = `+${points}p`;
  if (streakLabel) {
    const streakEl = document.createElement("div");
    streakEl.className = "floating-points-streak";
    streakEl.textContent = streakLabel;
    floating.append(streakEl);
  }
  floating.append(pointsEl);
  const left = duck.x + duck.size / 2;
  const top = duck.y - 6;
  floating.style.left = `${left}px`;
  floating.style.top = `${top}px`;
  gameArea.appendChild(floating);
  setTimeout(() => {
    floating.remove();
  }, 1250);
}

function calculateSpeedBonus(reactionMs) {
  const maxRewardWindowMs = 1200;
  if (reactionMs <= 0) return MAX_SPEED_BONUS;
  if (reactionMs >= maxRewardWindowMs) return 0;
  const normalized = 1 - reactionMs / maxRewardWindowMs;
  return Math.max(0, Math.min(MAX_SPEED_BONUS, Math.round(normalized * MAX_SPEED_BONUS)));
}

function calculateComboStepBonus(streak) {
  if (streak <= 0 || streak % COMBO_STREAK_STEP !== 0) return 0;
  const streakTier = Math.floor(streak / COMBO_STREAK_STEP);
  return COMBO_STEP_BONUS * streakTier;
}

function speedForWave(waveNumber) {
  return DUCK_START_SPEED + Math.max(0, waveNumber - 1) * WAVE_SPEED_STEP;
}

function sizeForWave(waveNumber) {
  return Math.max(DUCK_MIN_SIZE, DUCK_BASE_SIZE - Math.max(0, waveNumber - 1) * WAVE_SIZE_STEP);
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function angleDelta(a, b) {
  const fullTurn = Math.PI * 2;
  const raw = Math.abs(a - b) % fullTurn;
  return raw > Math.PI ? fullTurn - raw : raw;
}

function pickEntryCoord(minCoord, maxCoord, lastCoord) {
  if (!Number.isFinite(lastCoord)) return randomInRange(minCoord, maxCoord);
  const range = Math.max(1, maxCoord - minCoord);
  const minGap = range * MIN_ENTRY_GAP_RATIO;
  let chosen = randomInRange(minCoord, maxCoord);
  for (let i = 0; i < 5; i += 1) {
    if (Math.abs(chosen - lastCoord) >= minGap) return chosen;
    chosen = randomInRange(minCoord, maxCoord);
  }
  return chosen;
}

function pickTravelBand(axisMax, axisTag) {
  const bands = [
    { key: `${axisTag}-low`, min: 0.05, max: 0.28, edge: true },
    { key: `${axisTag}-mid`, min: 0.36, max: 0.64, edge: false },
    { key: `${axisTag}-high`, min: 0.72, max: 0.95, edge: true }
  ];

  let totalWeight = 0;
  const weighted = bands.map((band) => {
    let weight = band.edge ? EDGE_LANE_WEIGHT : CENTER_LANE_WEIGHT;
    if (band.key === lastTravelBandKey) weight *= 0.25;
    totalWeight += weight;
    return { band, weight };
  });

  let pick = Math.random() * totalWeight;
  let chosen = weighted[0].band;
  for (const entry of weighted) {
    pick -= entry.weight;
    if (pick <= 0) {
      chosen = entry.band;
      break;
    }
  }

  lastTravelBandKey = chosen.key;
  return [
    axisMax * chosen.min,
    Math.max(axisMax * chosen.min, axisMax * chosen.max)
  ];
}

function chooseEntrySideFromExit(exitSide) {
  if (Math.random() >= SIDE_VARIATION_CHANCE) {
    if (exitSide === "left") return "right";
    if (exitSide === "right") return "left";
    if (exitSide === "top") return "bottom";
    return "top";
  }
  if (exitSide === "left" || exitSide === "right") {
    return Math.random() < 0.5 ? "top" : "bottom";
  }
  return Math.random() < 0.5 ? "left" : "right";
}

function redirectDuckAcrossScreen(exitSide) {
  const areaWidth = gameArea.clientWidth;
  const areaHeight = gameArea.clientHeight;
  const maxX = Math.max(0, areaWidth - duck.size);
  const maxY = Math.max(0, areaHeight - duck.size);
  const marginX = maxX * CROSS_ENTRY_MARGIN_RATIO;
  const marginY = maxY * CROSS_ENTRY_MARGIN_RATIO;
  const entrySide = chooseEntrySideFromExit(exitSide);

  let targetXMin = marginX;
  let targetXMax = Math.max(marginX, maxX - marginX);
  let targetYMin = marginY;
  let targetYMax = Math.max(marginY, maxY - marginY);

  if (entrySide === "left") {
    const [laneYMin, laneYMax] = pickTravelBand(maxY, "y");
    duck.x = -duck.size;
    duck.y = pickEntryCoord(laneYMin, laneYMax, lastEntry?.side === "left" ? lastEntry.coord : NaN);
    targetXMin = maxX * 0.6;
    targetXMax = Math.max(targetXMin, maxX * 0.95);
    targetYMin = laneYMin;
    targetYMax = laneYMax;
  } else if (entrySide === "right") {
    const [laneYMin, laneYMax] = pickTravelBand(maxY, "y");
    duck.x = areaWidth;
    duck.y = pickEntryCoord(laneYMin, laneYMax, lastEntry?.side === "right" ? lastEntry.coord : NaN);
    targetXMin = maxX * 0.05;
    targetXMax = Math.max(targetXMin, maxX * 0.4);
    targetYMin = laneYMin;
    targetYMax = laneYMax;
  } else if (entrySide === "top") {
    const [laneXMin, laneXMax] = pickTravelBand(maxX, "x");
    duck.x = pickEntryCoord(laneXMin, laneXMax, lastEntry?.side === "top" ? lastEntry.coord : NaN);
    duck.y = -duck.size;
    targetYMin = maxY * 0.6;
    targetYMax = Math.max(targetYMin, maxY * 0.95);
    targetXMin = laneXMin;
    targetXMax = laneXMax;
  } else if (entrySide === "bottom") {
    const [laneXMin, laneXMax] = pickTravelBand(maxX, "x");
    duck.x = pickEntryCoord(laneXMin, laneXMax, lastEntry?.side === "bottom" ? lastEntry.coord : NaN);
    duck.y = areaHeight;
    targetYMin = maxY * 0.05;
    targetYMax = Math.max(targetYMin, maxY * 0.4);
    targetXMin = laneXMin;
    targetXMax = laneXMax;
  }
  lastEntry = {
    side: entrySide,
    coord: entrySide === "left" || entrySide === "right" ? duck.y : duck.x
  };

  let bestTarget = null;
  let bestDelta = -1;
  for (let i = 0; i < REDIRECT_CANDIDATES; i += 1) {
    const candidateX = randomInRange(targetXMin, targetXMax);
    const candidateY = randomInRange(targetYMin, targetYMax);
    const candidateAngle = Math.atan2(candidateY - duck.y, candidateX - duck.x);
    if (lastRedirectAngle === null) {
      bestTarget = { x: candidateX, y: candidateY, angle: candidateAngle };
      break;
    }
    const delta = angleDelta(candidateAngle, lastRedirectAngle);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestTarget = { x: candidateX, y: candidateY, angle: candidateAngle };
      if (delta >= MIN_REDIRECT_ANGLE_DELTA) break;
    }
  }

  const fallbackTargetX = randomInRange(targetXMin, targetXMax);
  const fallbackTargetY = randomInRange(targetYMin, targetYMax);
  const chosen = bestTarget || {
    x: fallbackTargetX,
    y: fallbackTargetY,
    angle: Math.atan2(fallbackTargetY - duck.y, fallbackTargetX - duck.x)
  };
  lastRedirectAngle = chosen.angle;
  setDuckVelocityToward(chosen.x, chosen.y, duck.speed);
}

function spawnDuckOutsideScreen() {
  redirectDuckAcrossScreen(pickRandomSide());
}

function endGame() {
  running = false;
  const finalScore = score;
  if (!areProfileFieldsValid()) {
    messageEl.textContent = `Game over! Du fikk ${finalScore} poeng. Fyll inn fornavn, etternavn og e-post for highscore.`;
    return;
  }

  savePlayerProfile();
  saveScoreForCurrentPlayer().then((result) => {
    if (!result.saved) {
      if (result.reason === "missing_session") {
        messageEl.textContent = "Resultat ble ikke lagret: mangler gyldig spillsesjon i Supabase.";
        return;
      }
      if (result.reason === "score_rejected") {
        messageEl.textContent = "Resultatet ble avvist av anti-cheat-kontroll.";
        return;
      }
      if (result.reason === "sql_not_updated") {
        messageEl.textContent = "Resultatet ble ikke lagret: oppdater Supabase SQL (submit_score-signatur).";
        return;
      }
      if (result.reason === "global_not_configured") {
        messageEl.textContent = "Resultatet ble ikke lagret: Supabase er ikke konfigurert i frontend.";
        return;
      }
      if (result.details) {
        messageEl.textContent = `Resultatet ble ikke lagret i Supabase: ${result.details.slice(0, 140)}`;
        return;
      }
      messageEl.textContent = "Resultatet kunne ikke lagres akkurat nå. Prøv igjen neste runde.";
      return;
    }
    messageEl.textContent = `Game over! Du fikk ${finalScore} poeng. Resultat lagret i highscore.`;
  });
}

function handleDuckHit() {
  if (!running || duck.state !== "whole") return;
  if (squishTimeoutId) clearTimeout(squishTimeoutId);

  const thisRound = roundId;
  ensureGameSession()
    .then(() => registerHitForCurrentSession())
    .then((serverHitsCount) => {
      totalHits = Number.isFinite(serverHitsCount) ? serverHitsCount : totalHits + 1;
      comboStreak += 1;
      const reactionMs = Math.max(0, performance.now() - lastDuckSpawnAtMs);
      const speedBonus = calculateSpeedBonus(reactionMs);
      const comboBonus = calculateComboStepBonus(comboStreak);
      const earnedPoints = BASE_POINTS_PER_HIT + speedBonus + comboBonus;
      score += earnedPoints;
      const reachedNewWave = totalHits > 0 && totalHits % DUCKS_PER_WAVE === 0;
      wave = Math.floor(totalHits / DUCKS_PER_WAVE) + 1;
      hitsInWave = totalHits % DUCKS_PER_WAVE;
      duck.speed = speedForWave(wave);
      duck.size = sizeForWave(wave);
      duck.state = "flat";
      const streakLabel = comboBonus > 0 ? `${comboStreak}x streak +${comboBonus}p` : "";
      createFloatingPoints(earnedPoints, streakLabel);
      const statusParts = [`SQUICH! +${earnedPoints} poeng`];
      if (comboBonus > 0) {
        statusParts.push(`${comboStreak}x streak +${comboBonus}p`);
      }
      if (reachedNewWave) {
        statusParts.push(`Wave ${wave}!`);
      } else if (comboBonus === 0) {
        statusParts.push(`reaksjon ${Math.round(reactionMs)}ms`);
      }
      messageEl.textContent = statusParts.join(" | ");
      render();

      squishTimeoutId = setTimeout(() => {
        if (!running || thisRound !== roundId) return;
        duck.state = "whole";
        spawnDuckOutsideScreen();
        lastDuckSpawnAtMs = performance.now();
        messageEl.textContent = `Ny and i farta! Wave ${wave} (${hitsInWave}/${DUCKS_PER_WAVE})`;
        render();
      }, SQUISH_DELAY_MS);
    })
    .catch((error) => {
      console.warn("Hit rejected by anti-cheat.", error);
      const msg = String(error.message || "");
      if (msg.includes("create_game_session failed")) {
        messageEl.textContent = "Anti-cheat er ikke klar. Kjør oppdatert SQL i Supabase.";
        currentGameSessionId = null;
        return;
      }
      if (msg.includes("register_hit failed")) {
        messageEl.textContent = "Treff kunne ikke verifiseres. Sjekk at register_hit finnes i Supabase.";
        currentGameSessionId = null;
        return;
      }
      if (msg.includes("hit rate too high")) {
        messageEl.textContent = "Treff avvist: for rask treff-rate.";
        return;
      }
      messageEl.textContent = "Treff avvist av anti-cheat-kontroll.";
    });
}

function handleMiss() {
  if (!running || duck.state !== "whole") return;
  lives -= 1;
  comboStreak = 0;
  if (lives <= 0) {
    lives = 0;
    render();
    endGame();
    return;
  }
  messageEl.textContent = `Bom! Du har ${lives} liv igjen.`;
  render();
}

function tick() {
  if (!running) {
    animationFrameId = null;
    return;
  }

  if (duck.state === "whole") {
    keepDuckSpeed();
    duck.x += duck.vx;
    duck.y += duck.vy;
    const areaWidth = gameArea.clientWidth;
    const areaHeight = gameArea.clientHeight;
    let exitedSide = null;

    if (duck.x > areaWidth) {
      exitedSide = "right";
    } else if (duck.x < -duck.size) {
      exitedSide = "left";
    } else if (duck.y > areaHeight) {
      exitedSide = "bottom";
    } else if (duck.y < -duck.size) {
      exitedSide = "top";
    }

    if (exitedSide) {
      redirectDuckAcrossScreen(exitedSide);
    }
  }

  render();
  animationFrameId = requestAnimationFrame(tick);
}

function startGame() {
  roundId += 1;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (squishTimeoutId) {
    clearTimeout(squishTimeoutId);
    squishTimeoutId = null;
  }
  score = 0;
  lives = START_LIVES;
  running = true;
  currentGameSessionId = null;
  comboStreak = 0;
  totalHits = 0;
  lastRedirectAngle = null;
  lastEntry = null;
  lastTravelBandKey = "";
  wave = 1;
  hitsInWave = 0;
  duck.speed = speedForWave(wave);
  duck.size = sizeForWave(wave);
  duck.state = "whole";
  spawnDuckOutsideScreen();
  lastDuckSpawnAtMs = performance.now();
  messageEl.textContent = "Trykk rett på anda for å knuse! Wave 1 starter.";
  render();
  animationFrameId = requestAnimationFrame(tick);

  if (isSupabaseConfigured()) {
    ensureGameSession()
      .then((sessionId) => {
        currentGameSessionId = sessionId;
      })
      .catch((error) => {
        console.warn("Could not create anti-cheat game session.", error);
      });
  }
}

duckEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  handleDuckHit();
});

gameArea.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (!event.target.closest("#duck")) {
    handleMiss();
  }
});

window.addEventListener("resize", () => {
  duck.x = clamp(duck.x, 0, gameArea.clientWidth - duck.size);
  duck.y = clamp(duck.y, 0, gameArea.clientHeight - duck.size);
  render();
});

restartBtn.addEventListener("click", startGame);
highscoreBtn.addEventListener("click", () => {
  highscorePanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
});
playerFirstNameEl.addEventListener("input", savePlayerProfile);
playerLastNameEl.addEventListener("input", savePlayerProfile);
playerEmailEl.addEventListener("input", savePlayerProfile);

loadPlayerProfile();
loadAndRenderHighscores();
startGame();

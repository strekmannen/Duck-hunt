const gameArea = document.getElementById("gameArea");
const duckEl = document.getElementById("duck");
const scoreEl = document.getElementById("score");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const highscoreBtn = document.getElementById("highscoreBtn");
const highscorePanelEl = document.getElementById("highscorePanel");
const highscoreModeInfoEl = document.getElementById("highscoreModeInfo");
const lifeIcons = Array.from(document.querySelectorAll(".life-icon"));
const playerFirstNameEl = document.getElementById("playerFirstName");
const playerLastNameEl = document.getElementById("playerLastName");
const playerEmailEl = document.getElementById("playerEmail");
const submitScoreBtn = document.getElementById("submitScoreBtn");
const highscoreListEl = document.getElementById("highscoreList");

// Fill these from your Supabase project settings.
const SUPABASE_URL = "https://uxgvqoelwizzzrorixxt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jaisPo_vFHa2PZBewk40JA_wA1Glqfj";

const DUCK_START_SPEED = 3.1;
const DUCK_SPEED_STEP = 0.525;
const DUCK_MIN_AXIS_SPEED = 0.75;
const DUCK_SWERVE_CHANCE_BASE = 0.015;
const DUCK_SWERVE_CHANCE_GROWTH = 0.003;
const DUCK_SWERVE_STRENGTH = 0.34;
const DUCK_WAVE_BASE = 0.35;
const DUCK_WAVE_GROWTH = 0.08;
const DUCK_PASSIVE_ACCEL_BASE = 0.0035;
const DUCK_PASSIVE_ACCEL_SCORE_GAIN = 0.00045;
const START_LIVES = 3;
const SQUISH_DELAY_MS = 1000;
const PLAYER_PROFILE_KEY = "badeand_player_profile_v1";
const HIGHSCORE_LIMIT = 10;

const duck = {
  x: 240,
  y: 160,
  size: 84,
  speed: DUCK_START_SPEED,
  vx: 1.2,
  vy: 1.2,
  state: "whole",
  wavePhase: Math.random() * Math.PI * 2,
  waveDirection: Math.random() < 0.5 ? -1 : 1
};
let score = 0;
let lives = START_LIVES;
let running = true;
let roundId = 0;
let squishTimeoutId = null;
let lastFinishedScore = null;

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

async function loadAndRenderHighscores(options = {}) {
  if (!isSupabaseConfigured()) {
    highscoreListEl.innerHTML = "<li>Global highscore er ikke konfigurert.</li>";
    updateHighscoreModeText("global");
    return;
  }
  try {
    const items = await fetchGlobalHighscores();
    renderHighscoreItems(items);
    updateHighscoreModeText("global");
  } catch {
    highscoreListEl.innerHTML = "<li>Kunne ikke hente global highscore akkurat nå.</li>";
    updateHighscoreModeText("global");
  }
}

function updateHighscoreModeText(scope) {
  highscoreModeInfoEl.textContent = `Vanlig visning (${scope}): fornavn + etternavn initial. Admin-side: /admin`;
}

async function saveScoreForCurrentPlayer(finalScore) {
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

  if (isSupabaseConfigured()) {
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
          p_email_hash: emailHash,
          p_display_name: displayName,
          p_full_name: fullName,
          p_email: email,
          p_score: finalScore
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
      return { saved: false, reason: "global_save_failed" };
    }
  }
  return { saved: false, reason: "global_not_configured" };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomPosition(spriteSize) {
  const maxX = Math.max(0, gameArea.clientWidth - spriteSize);
  const maxY = Math.max(0, gameArea.clientHeight - spriteSize);
  return {
    x: Math.floor(Math.random() * (maxX + 1)),
    y: Math.floor(Math.random() * (maxY + 1))
  };
}

function placeDuck() {
  const pos = randomPosition(duck.size);
  duck.x = pos.x;
  duck.y = pos.y;
}

function setDuckVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;
  duck.vx = Math.cos(angle) * speed;
  duck.vy = Math.sin(angle) * speed;
  if (Math.abs(duck.vx) < DUCK_MIN_AXIS_SPEED) duck.vx = Math.sign(duck.vx || 1) * DUCK_MIN_AXIS_SPEED;
  if (Math.abs(duck.vy) < DUCK_MIN_AXIS_SPEED) duck.vy = Math.sign(duck.vy || 1) * DUCK_MIN_AXIS_SPEED;
}

function keepDuckSpeed() {
  const current = Math.hypot(duck.vx, duck.vy) || 1;
  const target = duck.speed;
  duck.vx = (duck.vx / current) * target;
  duck.vy = (duck.vy / current) * target;
}

function applyUnpredictableMovement() {
  duck.speed += DUCK_PASSIVE_ACCEL_BASE + score * DUCK_PASSIVE_ACCEL_SCORE_GAIN;

  duck.wavePhase += 0.16 + score * 0.012;
  const waveIntensity = DUCK_WAVE_BASE + score * DUCK_WAVE_GROWTH;
  const waveX = Math.sin(duck.wavePhase) * waveIntensity;
  const waveY = Math.cos(duck.wavePhase * 1.25) * waveIntensity;
  duck.vx += waveX * 0.018 * duck.waveDirection;
  duck.vy += waveY * 0.018;

  const swerveChance = Math.min(0.22, DUCK_SWERVE_CHANCE_BASE + score * DUCK_SWERVE_CHANCE_GROWTH);
  if (Math.random() < swerveChance) {
    const turn = (Math.random() * 2 - 1) * DUCK_SWERVE_STRENGTH;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const nextVx = duck.vx * cos - duck.vy * sin;
    const nextVy = duck.vx * sin + duck.vy * cos;
    duck.vx = nextVx;
    duck.vy = nextVy;
    if (Math.random() < 0.25) duck.waveDirection *= -1;
  }

  keepDuckSpeed();
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
  scoreEl.textContent = String(score);
  updateLivesIcons();
  applyDuckSprite();
}

function endGame() {
  running = false;
  const finalScore = score;
  lastFinishedScore = finalScore;
  messageEl.textContent = `Game over! Du knuste ${finalScore} and(er).`;
  messageEl.textContent = `Game over! Du knuste ${finalScore} and(er). Trykk "Send inn resultat" for highscore.`;
}

function handleDuckHit() {
  if (!running || duck.state !== "whole") return;
  if (squishTimeoutId) clearTimeout(squishTimeoutId);

  const thisRound = roundId;
  score += 1;
  duck.speed += DUCK_SPEED_STEP;
  duck.state = "flat";
  messageEl.textContent = "SQUICH! Anda ble flat!";
  render();

  squishTimeoutId = setTimeout(() => {
    if (!running || thisRound !== roundId) return;
    duck.state = "whole";
    placeDuck();
    setDuckVelocity(duck.speed);
    messageEl.textContent = "Ny and i farta!";
    render();
  }, SQUISH_DELAY_MS);
}

function handleMiss() {
  if (!running || duck.state !== "whole") return;
  lives -= 1;
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
  if (!running) return;

  if (duck.state === "whole") {
    applyUnpredictableMovement();
    duck.x += duck.vx;
    duck.y += duck.vy;
    const maxDuckX = gameArea.clientWidth - duck.size;
    const maxDuckY = gameArea.clientHeight - duck.size;

    if (duck.x <= 0 || duck.x >= maxDuckX) {
      duck.x = clamp(duck.x, 0, maxDuckX);
      duck.vx *= -1;
    }
    if (duck.y <= 0 || duck.y >= maxDuckY) {
      duck.y = clamp(duck.y, 0, maxDuckY);
      duck.vy *= -1;
    }
  }

  render();
  requestAnimationFrame(tick);
}

function startGame() {
  roundId += 1;
  if (squishTimeoutId) {
    clearTimeout(squishTimeoutId);
    squishTimeoutId = null;
  }
  score = 0;
  lives = START_LIVES;
  running = true;
  lastFinishedScore = null;
  duck.speed = DUCK_START_SPEED;
  duck.state = "whole";
  duck.wavePhase = Math.random() * Math.PI * 2;
  duck.waveDirection = Math.random() < 0.5 ? -1 : 1;
  placeDuck();
  setDuckVelocity(duck.speed);
  messageEl.textContent = "Trykk rett på anda for å knuse!";
  render();
  requestAnimationFrame(tick);
}

async function handleScoreSubmit() {
  if (!areProfileFieldsValid()) {
    playerFirstNameEl.reportValidity();
    playerLastNameEl.reportValidity();
    playerEmailEl.reportValidity();
    messageEl.textContent = "Alle felt er obligatoriske: fornavn, etternavn og gyldig e-post.";
    return;
  }

  if (lastFinishedScore === null) {
    messageEl.textContent = "Spill ferdig en runde for å sende inn resultat.";
    return;
  }
  savePlayerProfile();
  const result = await saveScoreForCurrentPlayer(lastFinishedScore);
  if (!result.saved) {
    if (result.reason === "global_not_configured") {
      messageEl.textContent = "Global highscore er ikke konfigurert.";
      return;
    }
    if (result.reason === "global_save_failed") {
      messageEl.textContent = "Kunne ikke sende til global highscore akkurat nå. Prøv igjen.";
      return;
    }
    messageEl.textContent = "Alle felt er obligatoriske: fornavn, etternavn og gyldig e-post.";
    return;
  }
  messageEl.textContent = `Resultat ${lastFinishedScore} sendt inn til global highscore.`;
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
submitScoreBtn.addEventListener("click", handleScoreSubmit);
playerFirstNameEl.addEventListener("input", savePlayerProfile);
playerLastNameEl.addEventListener("input", savePlayerProfile);
playerEmailEl.addEventListener("input", savePlayerProfile);

loadPlayerProfile();
loadAndRenderHighscores();
startGame();

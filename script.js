const gameArea = document.getElementById("gameArea");
const duckEl = document.getElementById("duck");
const scoreEl = document.getElementById("score");
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
const DUCK_SPEED_STEP = 0.2625;
const DUCK_MIN_AXIS_SPEED = 0.75;
const START_LIVES = 3;
const SQUISH_DELAY_MS = 1000;
const PLAYER_PROFILE_KEY = "badeand_player_profile_v1";
const HIGHSCORE_LIMIT = 10;
const SESSION_CREATE_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/create_game_session`;
const REGISTER_HIT_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/register_hit`;

const duck = {
  x: 240,
  y: 160,
  size: 84,
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
  if (!currentGameSessionId) return { saved: false, reason: "missing_session" };

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
          p_session_id: currentGameSessionId,
          p_email_hash: emailHash,
          p_display_name: displayName,
          p_full_name: fullName,
          p_email: email
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
      if (msg.includes("game session missing or expired")) {
        return { saved: false, reason: "missing_session" };
      }
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
  if (!areProfileFieldsValid()) {
    messageEl.textContent = `Game over! Du knuste ${finalScore} and(er). Fyll inn fornavn, etternavn og e-post for highscore.`;
    return;
  }

  savePlayerProfile();
  saveScoreForCurrentPlayer().then((result) => {
    if (!result.saved) {
      if (result.reason === "missing_session") {
        messageEl.textContent = "Resultat ble ikke lagret: spilltoken mangler/utlopt.";
        return;
      }
      if (result.reason === "score_rejected") {
        messageEl.textContent = "Resultatet ble avvist av anti-cheat-kontroll.";
        return;
      }
      messageEl.textContent = "Resultatet kunne ikke lagres akkurat nå. Prøv igjen neste runde.";
      return;
    }
    messageEl.textContent = `Game over! Du knuste ${finalScore} and(er). Resultat lagret i highscore.`;
  });
}

function handleDuckHit() {
  if (!running || duck.state !== "whole") return;
  if (squishTimeoutId) clearTimeout(squishTimeoutId);

  const thisRound = roundId;
  ensureGameSession()
    .then(() => registerHitForCurrentSession())
    .then((serverScore) => {
      score = serverScore;
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
    keepDuckSpeed();
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
  currentGameSessionId = null;
  duck.speed = DUCK_START_SPEED;
  duck.state = "whole";
  placeDuck();
  setDuckVelocity(duck.speed);
  messageEl.textContent = "Trykk rett på anda for å knuse!";
  render();
  requestAnimationFrame(tick);

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

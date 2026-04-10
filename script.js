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

const DUCK_START_SPEED = 1.8;
const DUCK_SPEED_STEP = 0.35;
const DUCK_MAX_SPEED = 8;
const START_LIVES = 3;
const SQUISH_DELAY_MS = 1000;
const HIGHSCORE_KEY = "badeand_highscores_v1";
const PLAYER_PROFILE_KEY = "badeand_player_profile_v1";
const HIGHSCORE_LIMIT = 10;
const ADMIN_ROUTE = "/admin";

const duck = { x: 240, y: 160, size: 84, speed: DUCK_START_SPEED, vx: 1.2, vy: 1.2, state: "whole" };
let score = 0;
let lives = START_LIVES;
let running = true;
let roundId = 0;
let squishTimeoutId = null;
let lastFinishedScore = null;
const adminMode =
  window.location.pathname.toLowerCase().endsWith(ADMIN_ROUTE) ||
  window.location.hash.toLowerCase() === "#/admin";

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

function getLocalHighscores() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalHighscores(items) {
  localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(items));
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
      const fullName = entry.full_name || entry.fullName || "-";
      const email = entry.email || "-";
      if (adminMode) {
        return `<li>${fullName} | ${email} | ${entry.score}</li>`;
      }
      return `<li>${publicName} - ${entry.score}</li>`;
    })
    .join("");
}

async function fetchGlobalHighscores() {
  const selectCols = adminMode
    ? "display_name,full_name,email,score,updated_at"
    : "display_name,score,updated_at";
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

async function loadAndRenderHighscores() {
  if (isSupabaseConfigured()) {
    try {
      const items = await fetchGlobalHighscores();
      renderHighscoreItems(items);
      updateHighscoreModeText("global");
      return;
    } catch {
      // fall back to local
    }
  }
  const local = getLocalHighscores()
    .sort((a, b) => b.score - a.score || (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(0, HIGHSCORE_LIMIT);
  renderHighscoreItems(local);
  updateHighscoreModeText("local");
}

function updateHighscoreModeText(scope) {
  if (adminMode) {
    highscoreModeInfoEl.textContent = `Admin-visning (${scope}): fullt navn, e-post og score.`;
  } else {
    highscoreModeInfoEl.textContent = `Vanlig visning (${scope}): fornavn + etternavn initial.`;
  }
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
      if (!response.ok) throw new Error("submit_score failed");
      await loadAndRenderHighscores();
      return { saved: true, scope: "global" };
    } catch {
      // fall back to local if API is unavailable
    }
  }

  const highscores = getLocalHighscores();
  const idx = highscores.findIndex((item) => item.email === email);
  const now = Date.now();
  if (idx === -1) {
    highscores.push({ email, firstName, lastName, fullName, displayName, score: finalScore, updatedAt: now });
  } else {
    highscores[idx].firstName = firstName;
    highscores[idx].lastName = lastName;
    highscores[idx].fullName = fullName;
    highscores[idx].displayName = displayName;
    highscores[idx].email = email;
    highscores[idx].score = Math.max(highscores[idx].score, finalScore);
    highscores[idx].updatedAt = now;
  }
  setLocalHighscores(highscores);
  await loadAndRenderHighscores();
  return { saved: true, scope: "local" };
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
  if (Math.abs(duck.vx) < 0.45) duck.vx = Math.sign(duck.vx || 1) * 0.45;
  if (Math.abs(duck.vy) < 0.45) duck.vy = Math.sign(duck.vy || 1) * 0.45;
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
  duck.speed = Math.min(DUCK_MAX_SPEED, duck.speed + DUCK_SPEED_STEP);
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
  placeDuck();
  setDuckVelocity(duck.speed);
  messageEl.textContent = "Trykk rett pa anda for a knuse!";
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
    messageEl.textContent = "Spill ferdig en runde for a sende inn resultat.";
    return;
  }
  savePlayerProfile();
  const result = await saveScoreForCurrentPlayer(lastFinishedScore);
  if (!result.saved) {
    messageEl.textContent = "Alle felt er obligatoriske: fornavn, etternavn og gyldig e-post.";
    return;
  }
  if (result.scope === "global") {
    messageEl.textContent = `Resultat ${lastFinishedScore} sendt inn til global highscore.`;
  } else {
    messageEl.textContent = `Resultat ${lastFinishedScore} lagret lokalt.`;
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
submitScoreBtn.addEventListener("click", handleScoreSubmit);
playerFirstNameEl.addEventListener("input", savePlayerProfile);
playerLastNameEl.addEventListener("input", savePlayerProfile);
playerEmailEl.addEventListener("input", savePlayerProfile);

loadPlayerProfile();
loadAndRenderHighscores();
startGame();

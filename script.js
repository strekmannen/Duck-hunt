const gameArea = document.getElementById("gameArea");
const duckEl = document.getElementById("duck");
const scoreEl = document.getElementById("score");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const lifeIcons = Array.from(document.querySelectorAll(".life-icon"));
const playerNameEl = document.getElementById("playerName");
const playerEmailEl = document.getElementById("playerEmail");
const highscoreListEl = document.getElementById("highscoreList");

const DUCK_START_SPEED = 1.8;
const DUCK_SPEED_STEP = 0.35;
const DUCK_MAX_SPEED = 8;
const START_LIVES = 3;
const SQUISH_DELAY_MS = 1000;
const HIGHSCORE_KEY = "badeand_highscores_v1";
const HIGHSCORE_LIMIT = 10;

const duck = { x: 240, y: 160, size: 84, speed: DUCK_START_SPEED, vx: 1.2, vy: 1.2, state: "whole" };
let score = 0;
let lives = START_LIVES;
let running = true;
let roundId = 0;
let squishTimeoutId = null;

function getHighscores() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setHighscores(items) {
  localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(items));
}

function toDisplayName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Ukjent";
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

function renderHighscores() {
  const items = getHighscores()
    .sort((a, b) => b.score - a.score || (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(0, HIGHSCORE_LIMIT);

  if (items.length === 0) {
    highscoreListEl.innerHTML = "<li>Ingen highscores enda</li>";
    return;
  }

  highscoreListEl.innerHTML = items
    .map((entry) => `<li>${entry.displayName} - ${entry.score}</li>`)
    .join("");
}

function updateHighscoreForCurrentPlayer(finalScore) {
  const fullName = (playerNameEl.value || "").trim();
  const email = (playerEmailEl.value || "").trim().toLowerCase();
  const isValid = fullName.length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!isValid) return false;

  const displayName = toDisplayName(fullName);
  const highscores = getHighscores();
  const idx = highscores.findIndex((item) => item.email === email);
  const now = Date.now();

  if (idx === -1) {
    highscores.push({ email, fullName, displayName, score: finalScore, updatedAt: now });
  } else {
    highscores[idx].fullName = fullName;
    highscores[idx].displayName = displayName;
    if (finalScore > highscores[idx].score) {
      highscores[idx].score = finalScore;
    }
    highscores[idx].updatedAt = now;
  }

  setHighscores(highscores);
  renderHighscores();
  return true;
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
  const saved = updateHighscoreForCurrentPlayer(score);
  if (saved) {
    messageEl.textContent = `Game over! Du squichet ${score} and(er). Highscore oppdatert.`;
  } else {
    messageEl.textContent = `Game over! Du squichet ${score} and(er). Fyll inn navn + e-post for highscore.`;
  }
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
  duck.speed = DUCK_START_SPEED;
  duck.state = "whole";
  placeDuck();
  setDuckVelocity(duck.speed);
  messageEl.textContent = "Trykk rett pa anda for a squiche!";
  render();
  requestAnimationFrame(tick);
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

renderHighscores();
startGame();

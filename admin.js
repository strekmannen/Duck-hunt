const SUPABASE_URL = "https://uxgvqoelwizzzrorixxt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_jaisPo_vFHa2PZBewk40JA_wA1Glqfj";
const HIGHSCORE_LIMIT = 50;

const loginPanelEl = document.getElementById("loginPanel");
const adminPanelEl = document.getElementById("adminPanel");
const adminEmailEl = document.getElementById("adminEmail");
const adminPasswordEl = document.getElementById("adminPassword");
const loginBtn = document.getElementById("loginBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");
const adminMessageEl = document.getElementById("adminMessage");
const adminHighscoreListEl = document.getElementById("adminHighscoreList");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setLoggedInUi(isLoggedIn) {
  loginPanelEl.hidden = isLoggedIn;
  adminPanelEl.hidden = !isLoggedIn;
}

function renderAdminScores(items) {
  if (!items.length) {
    adminHighscoreListEl.innerHTML = "<li>Ingen highscores enda</li>";
    return;
  }

  adminHighscoreListEl.innerHTML = "";
  items.forEach((entry) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = `${entry.full_name} | ${entry.email} | ${entry.score} `;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Slett";
    deleteBtn.dataset.emailHash = entry.email_hash;
    deleteBtn.className = "submit-score-btn";
    deleteBtn.style.marginLeft = "0.5rem";
    deleteBtn.style.padding = "0.25rem 0.5rem";

    li.appendChild(text);
    li.appendChild(deleteBtn);
    adminHighscoreListEl.appendChild(li);
  });
}

async function loadAdminHighscores() {
  adminMessageEl.textContent = "Laster highscore...";
  const { data, error } = await supabaseClient
    .from("leaderboard")
    .select("email_hash,full_name,email,score,updated_at")
    .order("score", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(HIGHSCORE_LIMIT);

  if (error) {
    adminMessageEl.textContent = "Kunne ikke hente highscore. Sjekk at RLS/policies er satt.";
    adminHighscoreListEl.innerHTML = "<li>Feil ved lasting</li>";
    return;
  }

  renderAdminScores(data || []);
  adminMessageEl.textContent = "Innlogget som admin.";
}

async function login() {
  const email = (adminEmailEl.value || "").trim();
  const password = adminPasswordEl.value || "";
  if (!email || !password) {
    adminMessageEl.textContent = "Fyll inn e-post og passord.";
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    adminMessageEl.textContent = `Innlogging feilet: ${error.message}`;
    console.error("Admin login error:", error);
    return;
  }

  setLoggedInUi(true);
  await loadAdminHighscores();
}

async function forgotPassword() {
  const email = (adminEmailEl.value || "").trim();
  if (!email) {
    adminMessageEl.textContent = "Skriv inn e-post først for å motta reset-lenke.";
    return;
  }

  const redirectTo = `${window.location.origin}/admin`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    adminMessageEl.textContent = `Kunne ikke sende reset-link: ${error.message}`;
    return;
  }

  adminMessageEl.textContent = "Reset-lenke sendt til e-postadressen din.";
}

async function logout() {
  await supabaseClient.auth.signOut();
  setLoggedInUi(false);
  adminHighscoreListEl.innerHTML = "";
  adminMessageEl.textContent = "Logget ut.";
}

async function deleteHighscore(emailHash) {
  if (!emailHash) return;
  const confirmed = window.confirm("Er du sikker på at du vil slette denne highscorescoren?");
  if (!confirmed) return;

  const { error } = await supabaseClient.rpc("delete_highscore_entry", {
    p_email_hash: emailHash
  });
  if (error) {
    adminMessageEl.textContent = `Kunne ikke slette score: ${error.message}`;
    return;
  }

  adminMessageEl.textContent = "Highscore slettet.";
  await loadAdminHighscores();
}

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  const isLoggedIn = Boolean(data.session);
  setLoggedInUi(isLoggedIn);
  if (isLoggedIn) {
    await loadAdminHighscores();
  } else {
    adminMessageEl.textContent = "Logg inn for å se full highscore.";
  }
}

loginBtn.addEventListener("click", login);
forgotPasswordBtn.addEventListener("click", forgotPassword);
logoutBtn.addEventListener("click", logout);
adminHighscoreListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const emailHash = target.dataset.emailHash;
  await deleteHighscore(emailHash);
});
init();

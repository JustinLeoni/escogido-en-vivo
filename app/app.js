'use strict';

/* visor de errores en desarrollo */
window.addEventListener('error', e => { console.error(e); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); });

/* ═ LIDOM · Leones del Escogido — app en vivo v1 ═ */

const TEAM = { id: 671, name: 'Leones del Escogido', abbrev: 'LEO' };
const RD_TZ = 'America/Santo_Domingo';
const SEASON_START = '2026-10-01';
const SEASON_END = '2027-02-15';
const API = 'https://statsapi.mlb.com/api/v1/';

const ABBR = { 667:'AGU', 668:'TOR', 669:'EST', 670:'GIG', 671:'LEO', 672:'LIC', 673:'', 674:'' };
const NAMES = { 667:'Águilas Cibaeñas', 668:'Toros del Este', 669:'Estrellas Orientales', 670:'Gigantes del Cibao', 671:'Leones del Escogido', 672:'Tigres del Licey' };
const LIDOM_IDS = new Set(Object.keys(NAMES).map(Number));

const SETTINGS_KEY = 'escogido.settings.v1';
const CACHE_KEY = 'escogido.data.v1';
const STD_KEY = 'escogido.std.v1';

const els = {};
 ['hero-tag','hero-state','scoreboard','away-abbrev','away-score','home-abbrev','home-score',
  'inning','countdown','hero-meta','line-row','h-info','e-info','bases-tag','btn-live',
  'scoreboard-legend','player-section','player-embed','player-tag','player-links','btn-fullscreen','btn-swap',
  'list-upcoming','list-results','standings-body',
  'laya-section','laya-box',
  'btn-install','btn-refresh','clock','toast','splash'
 ].forEach(id => els[id] = document.getElementById(id));

let data = null;
let liveGame = null;
let countdownTimer = null;
let livePollTimer = null;

/* helpers */
const $timeRD = iso => new Date(iso).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', timeZone: RD_TZ });
const $dateShort = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
const abbrOf = n => ABBR[n] || (typeof n === 'string' ? n.slice(0,3).toUpperCase() : '—');
const nameOf = t => NAMES[t.id] || t.name;
const isMyGame = g => LIDOM_IDS.has(g.teams.away.team.id) && LIDOM_IDS.has(g.teams.home.team.id) && (g.teams.away.team.id === TEAM.id || g.teams.home.team.id === TEAM.id);
const myTeam = g => g.teams.away.team.id === TEAM.id ? g.teams.away : g.teams.home;
const oppTeam = g => g.teams.away.team.id === TEAM.id ? g.teams.home : g.teams.away;
const flatten = dates => (dates || []).flatMap(d => d.games.map(g => ({ ...g, date: d.date })));
const FINAL_STATES = new Set(['Final', 'Game Final']);

function toast(msg){
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2400);
}

async function api(path){
  const url = path.startsWith('v1.1/') ? API.replace('/api/v1/', '/api/' + path.replace(/^v1\.1\//, 'v1.1/')) : API + path;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

async function loadData(force){
  const todayKey = new Date().toISOString().slice(0,10);
  const saved = force ? null : JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  let sched, today;
  if (saved && saved.day === todayKey && saved.sched?.dates?.length){
    sched = saved.sched; today = saved.today;
  } else {
    [ sched, today ] = await Promise.all([
      api(`schedule?sportId=17&teamId=${TEAM.id}&startDate=${SEASON_START}&endDate=${SEASON_END}`),
      api(`schedule?sportId=17&startDate=${todayKey}&endDate=${todayKey}`)
    ]);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ day: todayKey, sched, today }));
  }
  return { sched, today };
}

/* hero */
function renderHero(){
  const allToday = flatten(data.today.dates).filter(isMyGame);
  const mineToday = allToday.find(isMyGame);
  const scheduled = flatten(data.sched.dates).filter(g => g.status.detailedState === 'Scheduled');

  if (!mineToday){
    const next = scheduled[0];
    els['hero-state'].innerHTML = next
      ? 'HOY NO HAY<br><span class="live" style="font-size:.38em">JUEGO DEL REY ▾</span>'
      : 'FUERA DE<br><span class="live" style="font-size:.38em">TEMPORADA</span>';
    els.scoreboard.classList.add('hidden');
    els['line-row'].classList.add('hidden');
    els['scoreboard-legend'].classList.add('hidden');
    els['btn-live'].classList.add('hidden');
    els.countdown.classList.remove('hidden');
    els.countdown.innerHTML = next
      ? `<span>${fmtCountdown(next.gameDate)}</span><small>vs ${oppTeam(next).team.name} · ${$timeRD(next.gameDate)} hora RD · ${(next.venue.name || '').replace('Estadio ','')}</small>`
      : '16 OCT 27';
    els['hero-meta'].textContent = next ? `◆ PRÓXIMO: ${oppTeam(next).team.name.toUpperCase()} · ${$dateShort(next.date).toUpperCase()}` : '';
    setLiveGame(null);
    return;
  }
  renderGame(mineToday);
}

function renderGame(g){
  const st = g.status.detailedState;
  const away = g.teams.away, home = g.teams.home;
  els['hero-meta'].textContent = `◆ ${$dateShort(g.date).toUpperCase()} · ${(g.venue.name || '').replace('Estadio ','').toUpperCase()} · ${$timeRD(g.gameDate)} HORA RD`;
  els.countdown.classList.add('hidden');
  els.scoreboard.classList.remove('hidden');
  els['away-abbrev'].textContent = abbrOf(away.team.id) + (away.team.id === TEAM.id ? ' ★' : '');
  els['home-abbrev'].textContent = abbrOf(home.team.id) + (home.team.id === TEAM.id ? ' ★' : '');

  if (g.status.abstractGameState === 'Live'){
    els['hero-state'].innerHTML = '<span class="live-dot"></span><span class="live">EN VIVO</span>';
    els['away-score'].textContent = away.score ?? 0;
    els['home-score'].textContent = home.score ?? 0;
    els['line-row'].classList.remove('hidden');
    els['scoreboard-legend'].classList.remove('hidden');
    els['btn-live'].classList.remove('hidden');
    setLiveGame(g);
    return;
  }
  setLiveGame(null);

  if (g.status.abstractGameState === 'Final' || FINAL_STATES.has(st)){
    els['hero-state'].innerHTML = 'FINAL';
    els['away-score'].textContent = away.score ?? 0;
    els['home-score'].textContent = home.score ?? 0;
    els.inning.textContent = '—';
    els['h-info'].textContent = '—'; els['e-info'].textContent = '—'; els['bases-tag'].textContent = '';
    return;
  }

  els['hero-state'].innerHTML = 'HOY JUEGA<br><span class="live" style="font-size:.4em">EL MATÓN ⚾</span>';
  els['away-score'].textContent = '—'; els['home-score'].textContent = '—';
  els.inning.textContent = 'VS';
  els['h-info'].textContent = '—'; els['e-info'].textContent = '—'; els['bases-tag'].textContent = '';
  els.countdown.classList.remove('hidden');
  els.countdown.innerHTML = `<span id="countdown-val">${fmtCountdown(g.gameDate)}</span><small>VS ${oppTeam(g).team.name} · ${(g.venue.name || '').replace('Estadio ','')}</small>`;
  startCountdown(g);
  els['btn-live'].classList.remove('hidden');
}

function fmtCountdown(iso){
  let s = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  return (d ? d + ' D · ' : '') + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

function startCountdown(g){
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const el = document.getElementById('countdown-val');
    if (!el){ clearInterval(countdownTimer); return; }
    el.textContent = fmtCountdown(g.gameDate);
  }, 20000);
}

/* feed en vivo */
function setLiveGame(g){
  liveGame = g;
  clearInterval(livePollTimer);
  if (g) pollLive(g), livePollTimer = setInterval(() => pollLive(g), 30000);
  renderPlayerIfNeeded();
}

/* reproductor automático: se enciende solo durante el juego */

async function pollLive(g){
  try {
    const feed = await api(`v1.1/game/${g.gamePk}/feed/live`);
    applyFeed(feed);
  } catch { /* sin conexión */ }
}

function applyFeed(feed){
  const ls = feed.liveData?.linescore;
  if (!ls) return;
  const g = liveGame; if (!g) return;
  const inn = ls.currentInningOrdinal ? (ls.currentInning + 'ª') : '';
  els.inning.textContent = inn ? ((ls.inningHalf === 'top' ? 'ALTA ' : 'BAJA ') + inn) : '—';
  els['away-score'].textContent = ls.teams?.away?.runs ?? '–';
  els['home-score'].textContent = ls.teams?.home?.runs ?? '–';
  els['h-info'].textContent = `${ls.teams?.home?.hits ?? '–'} / ${ls.teams?.away?.hits ?? '–'}`;
  els['e-info'].textContent = `${ls.teams?.home?.errors ?? '–'} / ${ls.teams?.away?.errors ?? '–'}`;
  const outs = ls.outs ?? 0;
  const batter = ls.offense?.batter?.fullName;
  els['bases-tag'].innerHTML =
    (outs ? `<span class="bases-chip">${outs} OUT${outs > 1 ? 'S' : ''}</span>` : '') +
    (batter ? `<span class="bases-chip">AL BATE: ${batter.toUpperCase()}</span>` : '');
}

/* listas */
function renderLists(){
  const games = flatten(data.sched.dates);
  const now = Date.now();
  const upcoming = games.filter(g => g.status.detailedState === 'Scheduled' && new Date(g.gameDate) > now).slice(0, 6);
  const done = games.filter(g => FINAL_STATES.has(g.status.detailedState) || FINAL_STATES.has('Game Final') && FINAL_STATES.has(g.status.detailedState || 'Final')).slice(-4).reverse();

  els['list-upcoming'].innerHTML = upcoming.length ? upcoming.map(rowUpcoming).join('') : rowEmpty('Sin juegos programados aún.');
  els['list-results'].innerHTML = done.length ? done.map(rowResult).join('') : rowEmpty('Aún no hay resultados esta temporada.');
}

function rowUpcoming(g){
  const opp = oppTeam(g).team;
  const homeAway = g.teams.home.team.id === TEAM.id ? 'VS' : '@';
  const arena = (g.venue.name || '').replace('Estadio ','');
  return `<div class="row">
    <div class="row-date">${$dateShort(g.date)}</div>
    <div class="row-main"><b class="me">LEO</b> <span class="vs">${homeAway}</span> <b>${abbrOf(opp.id)}</b><span class="small">${nameOf(opp).toUpperCase()} · ${arena} · ${$timeRD(g.gameDate)} RD</span></div>
    <div class="row-time">${$timeRD(g.gameDate)}</div>
  </div>`;
}

function rowResult(g){
  const opp = oppTeam(g).team;
  const w = !!myTeam(g).isWinner;
  const meScore = myTeam(g).score ?? '–';
  const oppScore = oppTeam(g).score ?? '–';
  return `<div class="row">
    <div class="row-date">${$dateShort(g.date)}</div>
    <div class="row-main"><b class="me">LEO</b> ${w ? '<span style="color:#4ade80">GANA</span>' : '<span style="color:#ff6b65">PIERDE</span>'} <span class="vs">VS</span> <b>${abbrOf(opp.id)}</b></div>
    <div class="row-score ${w ? 'me-win' : 'me-loss'}"><span class="t1" style="color:${w ? '#4aff7d' : '#ffb3b0'}">${meScore}</span>–<span>${oppScore}</span></div>
  </div>`;
}

const rowEmpty = t => `<div class="row"><div class="row-main" style="color:var(--tx-3)">${t}</div></div>`;

/* posiciones */
async function renderStandings(force){
  const todayKey = new Date().toISOString().slice(0,10);
  const cached = force ? null : JSON.parse(localStorage.getItem(STD_KEY) || 'null');
  if (cached && cached.day === todayKey){ drawStandings(cached.table); return; }
  try{
    const ids = [...LIDOM_IDS];
    const all = await Promise.all(ids.map(id => api(`schedule?sportId=17&teamId=${id}&startDate=2026-10-16&endDate=${todayKey}`)));
    const finals = [...new Map(
      all.flatMap(d => flatten(d.dates))
        .filter(g => LIDOM_IDS.has(g.teams.away.team.id) && LIDOM_IDS.has(g.teams.home.team.id) && g.status.abstractGameState === 'Final')
        .map(g => [g.gamePk, g])
    ).values()];
    const t = {};
    for (const id of LIDOM_IDS) t[id] = { g:0, w:0, l:0 };
    for (const g of finals){
      const a = g.teams.away, h = g.teams.home;
      t[a.team.id].g++; t[h.team.id].g++;
      if (a.isWinner){ t[a.team.id].w++; t[h.team.id].l++; }
      else { t[h.team.id].w++; t[a.team.id].l++; }
    }
    const table = Object.entries(t).map(([id, v]) => ({ id: Number(id), name: nameOf({ id: Number(id) }), ...v })).sort((x,y) => y.w - x.w);
    localStorage.setItem(STD_KEY, JSON.stringify({ day: todayKey, table }));
    drawStandings(table);
  } catch { drawStandings([]); }
}

function drawStandings(table){
  const body = els['standings-body'];
  if (!table?.length){ body.innerHTML = `<tr><td class="l" colspan="5">Temporada 2026-27…</td></tr>`; return; }
  const f = table[0];
  body.innerHTML = table.map((t, i) => `<tr class="${t.id === TEAM.id ? 'me' : ''}">
      <td class="l">${t.name}</td>
      <td>${t.g}</td><td>${t.w}</td><td>${t.l}</td>
      <td>${i === 0 ? '—' : ((f.w - t.w) + (t.l - f.l)) / 2}</td>
    </tr>`).join('');
}

/* reproductor automático — fuentes oficiales verificadas (canal ID de YouTube) */
const OFFICIAL_SOURCES = [
  { id: 'UCF8EeDFLnGcD5-SRFS4Eyiw', name: 'La Cueva Roja · Abriendo Sports' },  // derechos digitales LEO 2026-27
  { id: 'UCtwRRpKOd3a62LCW8z1MwPQ', name: 'Escogido Baseball Club' },           // canal oficial del club
  { id: 'UCodG7MOVMjh3lpV47EUTnMA', name: 'Tigres del Licey' },                 // club anfitrión cuando LEO visita
];
const LINK_FALLBACKS = [
  ['MLB · LIDOM EN VIVO ↗', 'https://www.mlb.com/ligas-invernales'],
  ['LIDOM.COM ↗', 'https://lidom.com/'],
];

let streamData = null;
let candidates = [];      // [{videoId, label}]
let candIdx = -1;
let player = null;
let playerFailed = false;
let candTimer = null;

const PLAYER_OVERLAY_READY = '<div class="player-loading"><div class="spinner"></div><div class="micro-label">BUSCANDO SEÑAL OFICIAL…</div></div>';

function renderSources(){
  els['player-links'].innerHTML = LINK_FALLBACKS.map(([t,u]) => `<a class="src-pill" href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
}

async function loadStream(){
  try{
    const res = await fetch('data/stream.json?v=' + Date.now(), { cache: 'no-store' });
    if (res.ok){
      streamData = await res.json();
      renderLaya(streamData?.laya);
    }
  } catch { /* sin stream.json local: sigue con canales */ }
}

function buildCandidates(){
  candidates = [];
  if (streamData?.live && streamData?.source?.videoId){
    candidates.push({ videoId: streamData.source.videoId, label: streamData.source.channelName });
    (streamData.alternates || []).forEach(a => {
      if (a.videoId && a.videoId !== streamData.source.videoId) candidates.push({ videoId: a.videoId, label: a.channel });
    });
  }
  return candidates;
}

/* YouTube IFrame API */
function ensureYT(cb){
  if (window.YT?.Player){ cb(); return; }
  if (!document.getElementById('yt-api-script')){
    const s = document.createElement('script');
    s.id = 'yt-api-script'; s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
  let tries = 0;
  const t = setInterval(() => {
    if (window.YT?.Player){ clearInterval(t); cb(); }
    else if (++tries > 100){ clearInterval(t); nextCandidate(); }   // 20 s sin API: probemos otra
  }, 200);
}

function playCandidate(i){
  if (!candidates.length){ embedChannelLive(); return; }
  candIdx = i % candidates.length;
  const c = candidates[candIdx];
  els['player-tag'].textContent = '✳ EN VIVO · ' + c.label.toUpperCase();
  els['player-embed'].innerHTML = PLAYER_OVERLAY_READY + '<div id="yt-host"></div>';
  els['player-links'].innerHTML = LINK_FALLBACKS.map(([t,u]) => `<a class="src-pill" href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
  clearTimeout(candTimer);
  ensureYT(() => {
    if (player){ player.destroy(); player = null; }
    let gotPlaying = false;
    player = new YT.Player('yt-host', {
      videoId: c.videoId,
      playerVars: { autoplay: 1, mute: 0, rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          player.playVideo();
          candTimer = setTimeout(() => { if (!gotPlaying) nextCandidate(); }, 12000);
        },
        onStateChange: e => { if (e.data === 1){ gotPlaying = true; clearTimeout(candTimer); } },
        onError: () => { clearTimeout(candTimer); nextCandidate(); },
      },
    });
  });
}

function nextCandidate(){
  playCandidate(candIdx + 1);
}

/* si no hay videoId conocido: clasicos canales (embed live_stream del canal) */
function embedChannelLive(){
  candIdx = -2;
  const ch = OFFICIAL_SOURCES[0].id;
  els['player-embed'].innerHTML = PLAYER_OVERLAY_READY +
    `<iframe class="player-frame" src="https://www.youtube.com/embed/live_stream?channel=${ch}&autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="En vivo"></iframe>`;
}

function playerStatus(msg){
  els['player-embed'].innerHTML = `<div class="empty"><div style="font-size:32px">🔴</div><div>${msg}</div><div style="font-size:11px;letter-spacing:.14em">ESCUELA OFICIAL ↓</div></div>`;
  els['player-links'].innerHTML = LINK_FALLBACKS.map(([t,u]) => `<a class="src-pill" href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
  candIdx = -1;
}

function renderPlayerIfNeeded(){
  const live = liveGame && liveGame.status.abstractGameState === 'Live';
  if (live){
    els['player-section'].classList.remove('hidden');
    if (candIdx < 0){
      candidates = buildCandidates();
      playCandidate(0);
    }
  } else {
    els['player-section'].classList.add('hidden');
    candIdx = -1;
    clearTimeout(candTimer);
    if (player){ player.destroy?.(); player = null; }
    playerStatus('Sin juego en vivo ahora mismo. Cuando empiece, la señal se enciende sola.');
  }
}

els['btn-swap'].onclick = () => {
  candidates = candidates.length ? candidates : buildCandidates();
  if (!candidates.length && OFFICIAL_SOURCES.length){ embedChannelLive(); return; }
  nextCandidate();
};

els['btn-fullscreen'].onclick = () => {
  const el = els['player-embed'];
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) req.call(el);
};

/* gráficas Laya: análisis del juego precomputado por el watcher, siempre visible */
const PROY_LABELS = {
  victoria: ['Favorito para ganar', 'El juego le conviene al Escogido'],
  candela:  ['Candela · juego parejo', 'El marcador se puede decidir en el final'],
  derrota:  ['Juego difícil', 'El rival llega mejor en este momento'],
};
function momentoWord(m){
  if (m < 25) return 'El rival tiene el control';
  if (m < 45) return 'El Escogido va por debajo';
  if (m < 65) return 'Juego parejo, sin ventaja clara';
  if (m < 88) return 'El Escogido va arriba';
  return 'El Escogido está aplastando';
}
function probRow(label, val, win){
  const pct = Math.round(Math.max(0, Math.min(1, Number(val) || 0)) * 100);
  return `<div class="p-row ${win ? 'win' : ''}"><span>${label}</span><div class="p-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
}
function renderLaya(laya){
  const box = els['laya-box'];
  if (!box) return;
  if (!laya || (!laya.proyeccion && laya.momento == null)){
    box.innerHTML = `<div class="estado-tag">SIN JUEGO QUE LEER</div>
      <div style="margin-top:10px;color:var(--tx-2);font-size:13px">Laya activa su análisis cuando el Escogido tiene juego programado, en juego o finalizado. Se actualiza solo cada 15 minutos.</div>`;
    return;
  }
  const modo = laya.modo || (laya.momento != null ? 'live' : 'pre');
  const modoTag = modo === 'live' ? 'JUEGO EN CURSO · LECTURA EN VIVO' : 'PREVIA DEL JUEGO';
  const m = typeof laya.momento === 'number' ? Math.max(0, Math.min(100, Math.round(laya.momento))) : null;
  const proj = laya.proyeccion || {};
  const probs = (typeof proj.probabilities === 'object' && proj.probabilities) || {};
  const one = c => (PROY_LABELS[c] || [c, c])[0];

  box.innerHTML = `
    <div class="estado-tag">${modoTag}</div>
    <div class="laya-grid">
      <div class="laya-card">
        <div class="micro-label">MOMENTO · ¿QUÉ TAN FUERTE VA EL ESCOGIDO?</div>
        ${m !== null ? `
          <div class="laya-big">${m}<span style="font-size:.4em;color:var(--tx-3)">/100</span></div>
          <div class="laya-word">${momentoWord(m)}</div>
          <div class="laya-bar"><i style="width:${m}%"></i></div>` :
          `<div style="color:var(--tx-2);font-size:13px">El momento se mide en vivo, cuando el juego avanza. Ahora mismo el análisis es la proyección de la tarjeta de al lado.</div>`}
      </div>
      <div class="laya-card">
        <div class="micro-label">PROYECCIÓN · ¿CÓMO PUEDE ACABAR?</div>
        ${proj.choice ? `
          <div class="laya-word" style="font-size:15px;font-weight:700;color:var(--tx);text-transform:none;letter-spacing:0">${one(proj.choice)}</div>
          <div class="laya-prob">
            ${probRow('GANA EL ESCOGIDO', probs.victoria ?? (proj.choice === 'victoria' ? 1 : 0), proj.choice === 'victoria')}
            ${probRow('JUEGO DE CANDELA', probs.candela ?? (proj.choice === 'candela' ? 1 : 0), proj.choice === 'candela')}
            ${probRow('GANA EL RIVAL', probs.derrota ?? (proj.choice === 'derrota' ? 1 : 0), proj.choice === 'derrota')}
          </div>` :
          `<div style="color:var(--tx-2);font-size:13px">En el próximo chequeo Laya completa la proyección del juego.</div>`}
      </div>
    </div>`;
}

/* acciones */
els['btn-live'].onclick = () => { els['player-section'].classList.remove('hidden'); els['player-section'].scrollIntoView({ behavior:'smooth' }); };
els['btn-refresh'].onclick = async () => {
  els['btn-refresh'].innerHTML = '⟳ …';
  try{
    data = await loadData(true);
    renderHero(); renderLists(); await renderStandings(true); renderSources(); loadStream();    toast('Datos al día ✓');
  } catch { toast('Sin conexión · datos guardados'); }
  els['btn-refresh'].innerHTML = '⟳ Actualizar';
};

/* instalar */
let prompt2 = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt2 = e; els['btn-install'].classList.remove('hidden'); });
els['btn-install'].onclick = async () => { if (!prompt2) return; prompt2.prompt(); await prompt2.userChoice; prompt2 = null; els['btn-install'].classList.add('hidden'); };
if (window.matchMedia('(display-mode: standalone)').matches) els['btn-install'].classList.add('hidden');

/* tema claro/oscuro AUTOMÁTICO según el teléfono (sin selector) */
const mqLight = window.matchMedia('(prefers-color-scheme: light)');
function applyTheme(){
  const color = mqLight.matches ? '#FAFAFA' : '#0A0A0A';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', color));
}
mqLight.addEventListener('change', applyTheme);
applyTheme();

/* reloj */
function tickClock(){ els.clock.textContent = `· ${new Date().toLocaleTimeString('es-DO', { timeZone: RD_TZ, hour:'2-digit', minute:'2-digit' })} RD`; }
setInterval(tickClock, 30000); tickClock();

/* boot */
async function boot(){
  const t0 = performance.now();
  const hideSplash = () => {
    const wait = Math.max(0, 260 - (performance.now() - t0));
    setTimeout(() => {
      const s = els.splash;
      if (s){ s.classList.add('done'); setTimeout(() => s.remove(), 450); }
    }, wait);
  };
  try {
    try { data = await loadData(); }
    catch {
      data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!data){ els['hero-state'].textContent = 'SIN CONEXIÓN'; toast('Sin conexión 1ª vez: conecta redes'); return; }
      toast('Offline · datos guardados');
    }
    els['hero-tag'].textContent = `◆ ${TEAM.name.toUpperCase()} ◆ LIDOM 26-27`;
    await loadStream();            // decisiones del watcher: señal + gráficas
    renderSources(); renderLists(); renderStandings();
    renderHero(); renderPlayerIfNeeded();

    /* vigilar cambio de estado del juego de hoy */
    setInterval(async () => {
      try{
        const todayKey = new Date().toISOString().slice(0,10);
        const d = await api(`schedule?sportId=17&startDate=${todayKey}&endDate=${todayKey}`);
        data.today = d;
        localStorage.setItem(CACHE_KEY, JSON.stringify({ day: todayKey, sched: data.sched, today: d }));
        const mine = flatten(d.dates).find(isMyGame);
        if (mine && mine.status.detailedState !== 'In Progress' || !liveGame) renderHero();
      } catch { /* ok */ }
    }, 90000);
  } finally { hideSplash(); }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && liveGame) pollLive(liveGame);
});

boot();

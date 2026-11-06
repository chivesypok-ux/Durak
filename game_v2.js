'use strict';
// ===== Дурак (подкидной), 36 карт. Движок + UI =====
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];
const RED = s => s === '♥' || s === '♦';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const other = p => (p === 'me' ? 'bot' : 'me');
let FAST = false;      // для тестов
let AUTO_ME = false;   // для тестов: за игрока играет тот же бот
let UI = null;         // функции отрисовки

let S = null;          // состояние партии
let busy = false;      // идёт ход бота

function newDeck() {
  const d = [];
  for (const s of SUITS) RANKS.forEach((r, i) => d.push({ s, r: i, id: s + i }));
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const isTrump = c => c.s === S.trump;
const beats = (a, d) => (a.s === d.s && d.r > a.r) || (d.s === S.trump && a.s !== S.trump);

function startGame() {
  const deck = newDeck();
  const trumpCard = deck[0];
  S = { deck, trump: trumpCard.s, trumpCard, hands: { me: [], bot: [] }, table: [], limit: 6,
        attacker: 'me', defender: 'bot', phase: 'attack', selected: null, over: null, msg: '' };
  for (let i = 0; i < 6; i++) { S.hands.me.push(S.deck.pop()); S.hands.bot.push(S.deck.pop()); }
  const low = p => Math.min(99, ...S.hands[p].filter(isTrump).map(c => c.r));
  const lm = low('me'), lb = low('bot');
  S.attacker = lm === lb ? (Math.random() < .5 ? 'me' : 'bot') : (lm < lb ? 'me' : 'bot');
  S.defender = other(S.attacker);
  S.limit = Math.min(6, S.hands[S.defender].length);
  S.msg = S.attacker === 'me' ? 'Вы ходите первым (у вас младший козырь)' : 'Первым ходит бот';
  render(); setTimeout(tick, 0);
}

function allowedAttack(c) {
  if (S.table.length >= S.limit) return false;
  if (!S.table.length) return true;
  return S.table.some(p => p.a.r === c.r || (p.d && p.d.r === c.r));
}
const undefended = () => S.table.filter(p => !p.d);

function remove(hand, c) { const i = hand.findIndex(x => x.id === c.id); if (i >= 0) hand.splice(i, 1); }

function playAttack(p, c) {
  remove(S.hands[p], c); S.table.push({ a: c, d: null });
  S.phase = 'defend'; S.selected = null; render();
}
function playDefend(p, c, pair) {
  remove(S.hands[p], c); pair.d = c; S.selected = null;
  S.phase = 'attack'; render();
}
function throwIn(p, c) { remove(S.hands[p], c); S.table.push({ a: c, d: null }); render(); }

function refill(p) { while (S.hands[p].length < 6 && S.deck.length) S.hands[p].push(S.deck.pop()); }

function checkOver() {
  if (S.deck.length) return false;
  const m = S.hands.me.length, b = S.hands.bot.length;
  if (m && b) return false;
  S.over = !m && !b ? 'draw' : !m ? 'me' : 'bot';
  S.phase = 'over';
  S.msg = S.over === 'draw' ? 'Ничья' : S.over === 'me' ? 'Вы выиграли! 🎉' : 'Вы остались «дураком» 🤡';
  stat(S.over); render(); return true;
}

function endBout() {                    // «бито»
  const a = S.attacker, d = S.defender;
  S.table = []; refill(a); refill(d);
  if (checkOver()) return;
  S.attacker = d; S.defender = a; S.phase = 'attack';
  S.limit = Math.min(6, S.hands[S.defender].length);
  S.msg = S.attacker === 'me' ? 'Бито. Ваш ход' : 'Бито. Ходит бот';
  render(); setTimeout(tick, 0);
}
function finishTake() {                 // защитник забирает
  const a = S.attacker, d = S.defender;
  for (const p of S.table) { S.hands[d].push(p.a); if (p.d) S.hands[d].push(p.d); }
  S.table = []; refill(a);
  if (checkOver()) return;
  S.phase = 'attack';
  S.limit = Math.min(6, S.hands[S.defender].length);
  S.msg = d === 'me' ? 'Вы взяли карты. Ходит бот' : 'Бот взял карты. Ваш ход';
  render(); setTimeout(tick, 0);
}

// ---- ИИ ----
const cost = c => (isTrump(c) ? 100 : 0) + c.r;
function aiAttack(p) {
  const hand = S.hands[p];
  const ok = hand.filter(allowedAttack);
  if (!S.table.length) return ok.sort((x, y) => cost(x) - cost(y))[0];
  const cheap = ok.filter(c => !isTrump(c) || (S.deck.length === 0 && c.r < 5)).sort((x, y) => cost(x) - cost(y));
  return cheap[0] || null;
}
function aiDefend(p, pair) {
  const opts = S.hands[p].filter(c => beats(pair.a, c)).sort((x, y) => cost(x) - cost(y));
  const c = opts[0];
  if (!c) return null;
  if (isTrump(c) && c.r >= 6 && S.deck.length > 4 && !isTrump(pair.a)) return null; // дорого — берём
  return c;
}
function aiThrow(p) {
  const ok = S.hands[p].filter(c => allowedAttack(c) && !isTrump(c)).sort((x, y) => cost(x) - cost(y));
  return ok[0] || null;
}

async function tick() {
  if (busy || !S || S.over) return;
  busy = true;
  try {
    for (;;) {
      if (S.over) break;
      const bot = p => p === 'bot' || AUTO_ME;
      if (S.phase === 'attack' && bot(S.attacker)) {
        await sleep(FAST ? 0 : 650);
        const c = aiAttack(S.attacker);
        if (c) { playAttack(S.attacker, c); }
        else if (S.table.length) { S.msg = S.attacker === 'bot' ? 'Бот: бито' : 'Бито'; busy = false; endBout(); return; }
        else break;
      } else if (S.phase === 'defend' && bot(S.defender)) {
        await sleep(FAST ? 0 : 800);
        const pair = undefended()[0];
        const c = aiDefend(S.defender, pair);
        if (c) playDefend(S.defender, c, pair);
        else { S.phase = 'throwin'; S.msg = S.defender === 'bot' ? 'Бот берёт — можно подкинуть' : 'Беру'; render(); }
      } else if (S.phase === 'throwin' && bot(S.attacker)) {
        await sleep(FAST ? 0 : 500);
        const c = aiThrow(S.attacker);
        if (c && S.table.length < S.limit) throwIn(S.attacker, c);
        else { finishTake(); return; }
      } else break;
    }
  } finally { busy = false; render(); }
}

// ---- действия игрока ----
function clickCard(c) {
  if (!S || S.over || busy) return;
  if (S.phase === 'attack' && S.attacker === 'me' && allowedAttack(c)) { playAttack('me', c); setTimeout(tick, 0); }
  else if (S.phase === 'defend' && S.defender === 'me') {
    const pair = S.selected && !S.selected.d ? S.selected : undefended()[0];
    if (pair && beats(pair.a, c)) { playDefend('me', c, pair); setTimeout(tick, 0); }
  } else if (S.phase === 'throwin' && S.attacker === 'me' && allowedAttack(c)) throwIn('me', c);
}
function clickPair(pair) { if (S && S.phase === 'defend' && S.defender === 'me' && !pair.d) { S.selected = pair; render(); } }
function btnBeat() { if (S && S.phase === 'attack' && S.attacker === 'me' && S.table.length && !busy) { S.msg = 'Бито'; endBout(); } }
function btnTake() { if (S && S.phase === 'defend' && S.defender === 'me' && !busy) { S.phase = 'throwin'; S.msg = 'Беру…'; render(); setTimeout(tick, 0); } }
function btnDone() { if (S && S.phase === 'throwin' && S.attacker === 'me' && !busy) finishTake(); }

// ---- статистика ----
function stat(r) {
  try {
    const k = 'durak_stat', v = JSON.parse(localStorage.getItem(k) || '{"w":0,"l":0,"d":0}');
    if (r === 'me') v.w++; else if (r === 'bot') v.l++; else v.d++;
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
}
function readStat() { try { return JSON.parse(localStorage.getItem('durak_stat') || '{"w":0,"l":0,"d":0}'); } catch (e) { return { w: 0, l: 0, d: 0 }; } }


// ---- рубашки ----
const BACKS = [
  { name: 'Классика', css: 'repeating-linear-gradient(45deg,#2b4f9b 0 6px,#35609f 6px 12px)' },
  { name: 'Казино', svg: '<rect width="100" height="140" fill="#6d0f21"/><g stroke="#e8c35a" stroke-width="1" opacity=".55">' + Array.from({ length: 16 }, (_, i) => `<path d="M${i * 12 - 40} 0 L${i * 12 + 60} 140 M${i * 12 + 60} 0 L${i * 12 - 40} 140"/>`).join('') + '</g><rect x="5" y="5" width="90" height="130" rx="4" fill="none" stroke="#e8c35a" stroke-width="2"/><circle cx="50" cy="70" r="20" fill="#6d0f21" stroke="#e8c35a" stroke-width="2"/><text x="50" y="80" font-size="28" text-anchor="middle" fill="#e8c35a">♠</text>' },
  { name: 'Ретро-пин-ап', svg: '<rect width="100" height="140" fill="#8c1d2c"/><rect x="5" y="5" width="90" height="130" rx="4" fill="none" stroke="#e8c35a" stroke-width="2"/><g fill="#f4e3c1"><circle cx="50" cy="38" r="8"/><path d="M41 36 Q42 24 52 26 Q60 27 59 38 Q56 31 50 31 Q44 31 41 36Z" fill="#3a1218"/><path d="M43 49 Q50 45 57 49 L55 66 Q50 69 45 66Z"/><path d="M45 66 Q50 71 55 66 L76 110 Q50 122 24 110Z"/><path d="M43 52 Q34 60 38 70 L41 69 Q39 62 45 58Z"/><path d="M57 52 Q66 58 63 68 L60 66 Q61 60 55 57Z"/></g><text x="50" y="132" font-size="9" text-anchor="middle" fill="#e8c35a" letter-spacing="2">PIN-UP</text>' },
  { name: 'Коты', svg: '<rect width="100" height="140" fill="#1f2a44"/><rect x="5" y="5" width="90" height="130" rx="4" fill="none" stroke="#f2b84b" stroke-width="2"/><g fill="#0d1426"><path d="M28 62 L30 38 L44 52Z"/><path d="M72 62 L70 38 L56 52Z"/><ellipse cx="50" cy="74" rx="24" ry="22"/></g><g fill="#f2b84b"><ellipse cx="41" cy="72" rx="4" ry="5.5"/><ellipse cx="59" cy="72" rx="4" ry="5.5"/></g><g fill="#0d1426"><ellipse cx="41" cy="72" rx="1.3" ry="4.5"/><ellipse cx="59" cy="72" rx="1.3" ry="4.5"/></g><path d="M47 82 L53 82 L50 86Z" fill="#e87ba4"/><g stroke="#f4e3c1" stroke-width="1" fill="none"><path d="M36 84 L18 80 M36 87 L18 90 M64 84 L82 80 M64 87 L82 90"/></g><g fill="#f2b84b" opacity=".8"><circle cx="18" cy="20" r="2"/><circle cx="82" cy="24" r="2"/><circle cx="20" cy="120" r="2"/><circle cx="80" cy="116" r="2"/></g>' },
  { name: 'Космос', svg: '<rect width="100" height="140" fill="#0b1030"/>' + Array.from({ length: 28 }, (_, i) => `<circle cx="${(i * 37) % 94 + 3}" cy="${(i * 53) % 134 + 3}" r="${i % 3 ? .8 : 1.5}" fill="#fff" opacity="${.5 + (i % 4) * .12}"/>`).join('') + '<circle cx="50" cy="70" r="20" fill="#e8884a"/><path d="M33 62 Q50 56 67 64 M31 74 Q50 70 69 78" stroke="#c4602a" stroke-width="3" fill="none"/><ellipse cx="50" cy="70" rx="36" ry="9" fill="none" stroke="#e8c35a" stroke-width="2.5" transform="rotate(-18 50 70)" stroke-dasharray="0"/><rect x="5" y="5" width="90" height="130" rx="4" fill="none" stroke="#6a78d6" stroke-width="2"/>' },
];
let backIdx = 0;
function applyBack() {
  const b = BACKS[backIdx];
  const v = b.css ? b.css : `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" preserveAspectRatio="none">' + b.svg + '</svg>')}") center/100% 100%`;
  document.documentElement.style.setProperty('--backimg', v);
  const el = document.getElementById('backname'); if (el) el.textContent = (backIdx + 1) + '/' + BACKS.length;
}
function nextBack() {
  backIdx = (backIdx + 1) % BACKS.length;
  try { localStorage.setItem('durak_back', String(backIdx)); } catch (e) {}
  applyBack();
}

// ---- отрисовка ----
function cardEl(c, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (RED(c.s) ? ' red' : '') + (opts.cls ? ' ' + opts.cls : '');
  el.innerHTML = `<b>${RANKS[c.r]}<i>${c.s}</i></b><span>${c.s}</span><b class="br">${RANKS[c.r]}<i>${c.s}</i></b>`;
  if (opts.onclick) el.onclick = opts.onclick;
  return el;
}
const backEl = cls => { const e = document.createElement('div'); e.className = 'card back ' + (cls || ''); return e; };

function render() {
  if (!UI || !S || typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  // бот
  const bh = $('bot'); bh.innerHTML = '';
  S.hands.bot.forEach(() => bh.appendChild(backEl('sm')));
  $('botcnt').textContent = S.hands.bot.length;
  // колода
  const dk = $('deck'); dk.innerHTML = '';
  if (S.deck.length) {
    const t = cardEl(S.trumpCard, { cls: 'trumpcard' }); dk.appendChild(t);
    if (S.deck.length > 1) { const b = backEl('deckback'); dk.appendChild(b); }
  } else { const t = document.createElement('div'); t.className = 'trumpsuit' + (RED(S.trump) ? ' red' : ''); t.textContent = S.trump; dk.appendChild(t); }
  $('decknum').textContent = (S.deck.length ? S.deck.length + ' · ' : '') + 'козырь ' + S.trump;
  // стол
  const tb = $('table'); tb.innerHTML = '';
  S.table.forEach(p => {
    const w = document.createElement('div'); w.className = 'pair' + (S.selected === p ? ' sel' : '');
    w.appendChild(cardEl(p.a, { onclick: () => clickPair(p) }));
    if (p.d) { const d = cardEl(p.d, { cls: 'def' }); w.appendChild(d); }
    tb.appendChild(w);
  });
  // рука игрока
  const mh = $('me'); mh.innerHTML = '';
  const sorted = [...S.hands.me].sort((a, b) => (isTrump(a) - isTrump(b)) || a.s.localeCompare(b.s) || a.r - b.r);
  sorted.forEach(c => {
    let ok = false;
    if (S.phase === 'attack' && S.attacker === 'me') ok = allowedAttack(c);
    else if (S.phase === 'throwin' && S.attacker === 'me') ok = allowedAttack(c);
    else if (S.phase === 'defend' && S.defender === 'me') { const pr = (S.selected && !S.selected.d) ? S.selected : undefended()[0]; ok = !!pr && beats(pr.a, c); }
    mh.appendChild(cardEl(c, { cls: ok ? 'ok' : 'no', onclick: () => clickCard(c) }));
  });
  // кнопки и статус
  const showBeat = S.phase === 'attack' && S.attacker === 'me' && S.table.length && !busy;
  const showTake = S.phase === 'defend' && S.defender === 'me' && !busy;
  const showDone = S.phase === 'throwin' && S.attacker === 'me' && !busy;
  $('btnBeat').style.display = showBeat ? '' : 'none';
  $('btnTake').style.display = showTake ? '' : 'none';
  $('btnDone').style.display = showDone ? '' : 'none';
  let hint = S.msg;
  if (!S.over) {
    if (S.phase === 'attack' && S.attacker === 'me') hint = S.table.length ? 'Подкиньте карту той же масти-значения или нажмите «Бито»' : 'Ваш ход: выберите карту';
    else if (S.phase === 'defend' && S.defender === 'me') hint = 'Отбейте карту или нажмите «Беру»';
    else if (S.phase === 'throwin' && S.attacker === 'me') hint = 'Бот берёт. Подкиньте карты или нажмите «Готово»';
    else if (S.attacker === 'bot' && S.phase === 'attack') hint = 'Ходит бот…';
    else if (S.defender === 'bot' && S.phase === 'defend') hint = 'Бот думает…';
  }
  $('status').textContent = hint;
  $('role').textContent = S.over ? '' : (S.attacker === 'me' ? '⚔️ Вы атакуете' : '🛡 Вы защищаетесь');
  $('newgame').style.display = S.over ? '' : 'none';
  const st = readStat(); $('stat').textContent = `Победы ${st.w} · Пор. ${st.l}`;
}

if (typeof document !== 'undefined') {
  UI = true;
  window.addEventListener('DOMContentLoaded', () => {
    try { backIdx = (parseInt(localStorage.getItem('durak_back') || '0', 10) || 0) % BACKS.length; } catch (e) {}
    applyBack(); document.getElementById('backbtn').onclick = nextBack;
    document.getElementById('btnBeat').onclick = btnBeat;
    document.getElementById('btnTake').onclick = btnTake;
    document.getElementById('btnDone').onclick = btnDone;
    document.getElementById('newgame').onclick = startGame;
    document.getElementById('restart').onclick = () => { if (confirm('Начать новую партию?')) startGame(); };
    try { const tg = window.Telegram && Telegram.WebApp; if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor && tg.setHeaderColor('#0f5132'); tg.setBackgroundColor && tg.setBackgroundColor('#0f5132'); } } catch (e) {}
    startGame();
  });
}
if (typeof module !== 'undefined') module.exports = { startGame, tick, get busy() { return busy; }, get S() { return S; }, set FAST(v) { FAST = v; }, set AUTO_ME(v) { AUTO_ME = v; } };

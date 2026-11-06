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
  const st = readStat(); $('stat').textContent = `Победы ${st.w} · Поражения ${st.l}`;
}

if (typeof document !== 'undefined') {
  UI = true;
  window.addEventListener('DOMContentLoaded', () => {
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

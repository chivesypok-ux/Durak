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
  { name: 'Клетка', svg: '<rect width="100" height="140" fill="#d9e0c8"/><g fill="#9db598" opacity=".75">' + Array.from({ length: 8 }, (_, i) => `<rect x="${i * 14 - 4}" y="0" width="7" height="140"/><rect x="0" y="${i * 20 - 4}" width="100" height="7"/>`).join('') + '</g><g stroke="#6e8b6a" stroke-width=".8" opacity=".8">' + Array.from({ length: 8 }, (_, i) => `<path d="M${i * 14 - .5} 0V140M${i * 14 + 6.5} 0V140M0 ${i * 20 - .5}H100M0 ${i * 20 + 6.5}H100"/>`).join('') + '</g><rect x="3" y="3" width="94" height="134" rx="3" fill="none" stroke="#f3f1e6" stroke-width="2"/>' },
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
  try { localStorage.setItem('durak_back3', String(backIdx)); } catch (e) {}
  applyBack();
}


// ---- лица карт: картинки и расстановка мастей ----
const PIPS = {
  4: [[.3,.17],[.7,.17],[.3,.83],[.7,.83]],
  5: [[.3,.17],[.7,.17],[.5,.5],[.3,.83],[.7,.83]],
  6: [[.3,.17],[.7,.17],[.3,.5],[.7,.5],[.3,.83],[.7,.83]],
  7: [[.3,.17],[.7,.17],[.5,.33],[.3,.5],[.7,.5],[.3,.83],[.7,.83]],
  8: [[.3,.17],[.7,.17],[.5,.33],[.3,.5],[.7,.5],[.5,.67],[.3,.83],[.7,.83]],
  9: [[.3,.14],[.7,.14],[.3,.38],[.7,.38],[.5,.5],[.3,.62],[.7,.62],[.3,.86],[.7,.86]],
  10: [[.3,.14],[.7,.14],[.5,.26],[.3,.38],[.7,.38],[.3,.62],[.7,.62],[.5,.74],[.3,.86],[.7,.86]],
};
function courtFigure(kind, red, suit) {
  const OUT = '#1b1b1b', SKIN = '#f4d5ab', GOLD = '#e6b43c', BLUE = '#2d5aa8';
  const ROBE = red ? '#c62828' : '#2b2b2b', ACC = red ? BLUE : '#c62828', HAIR = kind === 'К' ? '#d9d9d9' : '#6b4423';
  const sw = 'stroke="' + OUT + '" stroke-width=".9" stroke-linejoin="round"';
  let s = '';
  if (kind === 'К') s += `<line x1="50" y1="9" x2="50" y2="44" stroke="${GOLD}" stroke-width="2"/><circle cx="50" cy="8" r="3.3" fill="${GOLD}" ${sw}/>`;
  if (kind === 'Д') s += `<path d="M18 19Q17 5 30 5Q43 5 42 19L45 40Q39 38 38.5 30Q38 13 30 13Q22 13 21.5 30Q21 38 15 40Z" fill="${HAIR}" ${sw}/>`;
  s += `<path d="M5 48Q7 33 30 31Q53 33 55 48Z" fill="${ROBE}" ${sw}/>`;
  s += `<path d="M14 48Q16 38 30 36Q44 38 46 48" fill="${ACC}" ${sw}/><path d="M10 44Q30 35 50 44" stroke="${GOLD}" stroke-width="2" fill="none"/>`;
  s += `<rect x="26" y="27" width="8" height="7" fill="${SKIN}" ${sw}/>`;
  if (kind === 'В') s += `<path d="M20.5 22Q20 12 30 12Q40 12 39.5 22L39.5 26Q36 18 30 18Q24 18 20.5 26Z" fill="${HAIR}" ${sw}/>`;
  s += `<ellipse cx="30" cy="22" rx="8.5" ry="10" fill="${SKIN}" ${sw}/>`;
  if (kind === 'К') s += `<path d="M21.5 23Q21 37 30 38.5Q39 37 38.5 23Q35 29 30 29Q25 29 21.5 23Z" fill="${HAIR}" ${sw}/><path d="M25 26Q30 24 35 26" stroke="${OUT}" stroke-width="1.2" fill="none"/>`;
  s += `<ellipse cx="26.5" cy="20.5" rx="1.1" ry="1.4" fill="${OUT}"/><ellipse cx="33.5" cy="20.5" rx="1.1" ry="1.4" fill="${OUT}"/><path d="M30 21.5L29 25.5L31 25.5" stroke="${OUT}" stroke-width=".7" fill="none"/>`;
  if (kind !== 'К') s += `<path d="M27.5 28Q30 29.8 32.5 28" stroke="#b03a3a" stroke-width="1" fill="none"/>`;
  if (kind === 'К') s += `<path d="M19 12L20 1L25.5 7L30 -1L34.5 7L40 1L41 12Z" fill="${GOLD}" ${sw}/><circle cx="30" cy="9" r="1.6" fill="${ACC}"/>`;
  if (kind === 'Д') s += `<path d="M22 11L23 3L27 7L30 1L33 7L37 3L38 11Z" fill="${GOLD}" ${sw}/><circle cx="30" cy="8.5" r="1.4" fill="${ACC}"/><g fill="${GOLD}" ${sw}><circle cx="25" cy="35.5" r="1.4"/><circle cx="30" cy="37" r="1.4"/><circle cx="35" cy="35.5" r="1.4"/></g>`;
  if (kind === 'В') s += `<path d="M20 15Q22 4 32 5Q42 6 41 15Q30 10 20 15Z" fill="${ROBE}" ${sw}/><path d="M36 7Q47 -1 55 9Q46 6 39 11Z" fill="${GOLD}" ${sw}/><circle cx="31" cy="9" r="1.4" fill="${GOLD}"/>`;
  s += `<text x="10" y="15" font-size="9" text-anchor="middle" fill="${red ? '#c62828' : '#1b1b1b'}">${suit}</text>`;
  return s;
}
function faceSVG(c) {
  const rank = RANKS[c.r], red = RED(c.s);
  const col = red ? '#c62828' : '#1b1b1b';
  if (rank === 'В' || rank === 'Д' || rank === 'К') {
    const f = courtFigure(rank, red, c.s);
    return `<svg viewBox="0 0 60 100" preserveAspectRatio="xMidYMid meet"><rect x="1" y="1" width="58" height="98" rx="3" fill="#fff8e6" stroke="#c9a24a" stroke-width="1"/><g>${f}</g><g transform="rotate(180 30 50)">${f}</g><line x1="3" y1="50" x2="57" y2="50" stroke="#c9a24a" stroke-width=".6"/></svg>`;
  }
  if (rank === 'Т') return `<svg viewBox="0 0 60 100"><text x="30" y="64" font-size="46" text-anchor="middle" fill="${col}">${c.s}</text></svg>`;
  const pts = PIPS[+rank];
  const pips = pts.map(([x, y]) => `<text x="${x * 60}" y="${y * 100 + 6}" font-size="17" text-anchor="middle" fill="${col}"${y > .5 ? ` transform="rotate(180 ${x * 60} ${y * 100})"` : ''}>${c.s}</text>`).join('');
  return `<svg viewBox="0 0 60 100">${pips}</svg>`;
}

// ---- отрисовка ----
function cardEl(c, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (RED(c.s) ? ' red' : '') + (opts.cls ? ' ' + opts.cls : '');
  el.innerHTML = `<b>${RANKS[c.r]}<i>${c.s}</i></b><span class="face">${faceSVG(c)}</span><b class="br">${RANKS[c.r]}<i>${c.s}</i></b>`;
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
  $('decknum').innerHTML = '<small>ПОДКИДНОЙ</small><br><b class="' + (RED(S.trump) ? 'rd' : '') + '">' + S.trump + ' ' + S.deck.length + '</b>';
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
    try { backIdx = (parseInt(localStorage.getItem('durak_back3') || '0', 10) || 0) % BACKS.length; } catch (e) {}
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

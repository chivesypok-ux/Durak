'use strict';
// ===== Дурак: подкидной / переводной, 2 или 3 игрока. Движок + UI =====
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];
const RED = s => s === '♥' || s === '♦';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = { me: 'Вы', bot: 'Бот', b1: 'Бот 1', b2: 'Бот 2' };
let FAST = false, AUTO_ME = false, UI = null;
let CFG = { n: 2, mode: 'pod' };      // n: 2|3, mode: 'pod' подкидной | 'per' переводной
let PL = ['me', 'bot'];
let S = null, busy = false;
const isBot = p => p !== 'me' || AUTO_ME;

function newDeck() {
  const d = [];
  for (const s of SUITS) RANKS.forEach((r, i) => d.push({ s, r: i, id: s + i }));
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const isTrump = c => c.s === S.trump;
const beats = (a, d) => (a.s === d.s && d.r > a.r) || (d.s === S.trump && a.s !== S.trump);
const alive = () => PL.filter(p => !S.out.includes(p));
function nextActive(p) {             // следующий по кругу, не вышедший из игры, не p
  let i = PL.indexOf(p);
  for (let k = 0; k < PL.length; k++) { i = (i + 1) % PL.length; const q = PL[i]; if (q !== p && !S.out.includes(q)) return q; }
  return null;
}
function throwers() {               // кто может подкидывать: по кругу от атакующего, кроме защитника
  const res = []; let i = PL.indexOf(S.attacker);
  for (let k = 0; k < PL.length; k++, i = (i + 1) % PL.length) {
    const q = PL[i]; if (q !== S.defender && !S.out.includes(q)) res.push(q);
  }
  return res;
}

function startGame(cfg) {
  if (cfg) CFG = Object.assign({}, cfg);
  PL = CFG.n === 3 ? ['me', 'b1', 'b2'] : ['me', 'bot'];
  const deck = newDeck();
  const trumpCard = deck[0];
  S = { deck, trump: trumpCard.s, trumpCard, hands: {}, table: [], limit: 6, attacker: 'me', defender: 'bot', actor: 'me',
        passed: {}, phase: 'attack', selected: null, over: null, out: [], msg: '', cfg: Object.assign({}, CFG) };
  PL.forEach(p => S.hands[p] = []);
  for (let i = 0; i < 6; i++) PL.forEach(p => S.hands[p].push(S.deck.pop()));
  const low = p => Math.min(99, ...S.hands[p].filter(isTrump).map(c => c.r));
  let best = 99, firsts = [];
  PL.forEach(p => { const l = low(p); if (l < best) { best = l; firsts = [p]; } else if (l === best) firsts.push(p); });
  S.attacker = firsts[Math.floor(Math.random() * firsts.length)];
  S.defender = nextActive(S.attacker);
  S.limit = Math.min(6, S.hands[S.defender].length);
  S.actor = S.attacker;
  S.msg = S.attacker === 'me' ? 'Вы ходите первым' + (best < 99 ? ' (младший козырь)' : '') : NAMES[S.attacker] + ' ходит первым';
  render(); setTimeout(tick, 0);
}

function allowedAttack(c) {
  if (S.table.length >= S.limit) return false;
  if (!S.table.length) return true;
  return S.table.some(p => p.a.r === c.r || (p.d && p.d.r === c.r));
}
const undefended = () => S.table.filter(p => !p.d);
function remove(hand, c) { const i = hand.findIndex(x => x.id === c.id); if (i >= 0) hand.splice(i, 1); }

function canTransfer(p, c) {
  if (S.cfg.mode !== 'per' || S.phase !== 'defend' || S.defender !== p) return false;
  if (!S.table.length || S.table.some(x => x.d)) return false;
  if (c.r !== S.table[0].a.r) return false;
  const nd = nextActive(p);
  return !!nd && S.hands[nd].length >= S.table.length + 1;
}
function doTransfer(p, c) {
  const nd = nextActive(p);
  remove(S.hands[p], c); S.table.push({ a: c, d: null });
  S.attacker = p; S.defender = nd; S.selected = null; S.passed = {}; S.phase = 'defend';
  S.limit = Math.min(6, S.hands[nd].length);
  S.msg = (p === 'me' ? 'Вы перевели' : NAMES[p] + ' переводит') + ' → ' + (nd === 'me' ? 'вам' : NAMES[nd]);
  setActor(); render();
}

function playAttack(p, c) {
  remove(S.hands[p], c); S.table.push({ a: c, d: null });
  S.phase = 'defend'; S.selected = null; S.passed = {}; setActor(); render();
}
function throwIn(p, c) { remove(S.hands[p], c); S.table.push({ a: c, d: null }); S.passed = {}; setActor(); render(); }
function playDefend(p, c, pair) {
  remove(S.hands[p], c); pair.d = c; S.selected = null;
  if (!undefended().length) {
    S.phase = 'attack'; S.passed = {};
    if (S.table.length >= S.limit || !S.hands[S.defender].length) { endBout(); return; }
  }
  setActor(); render();
}
function pass(p) { S.passed[p] = true; setActor(); render(); }

function setActor() {
  if (S.over) return;
  if (S.phase === 'defend') { S.actor = S.defender; return; }
  if (!S.table.length) { S.actor = S.attacker; return; }
  for (const p of throwers()) {
    if (S.passed[p] || !S.hands[p].length) continue;
    if (!isBot(p) && !S.hands[p].some(allowedAttack)) continue;   // у игрока нечего подкинуть
    if (!S.hands[p].some(allowedAttack)) continue;
    S.actor = p; return;
  }
  S.actor = null;
  if (S.phase === 'attack') endBout(); else finishTake();
}

function refillAll() {
  const order = []; let i = PL.indexOf(S.attacker);
  for (let k = 0; k < PL.length; k++, i = (i + 1) % PL.length) order.push(PL[i]);
  const ord = order.filter(p => p !== S.defender).concat([S.defender]);
  for (const p of ord) while (S.hands[p].length < 6 && S.deck.length) S.hands[p].push(S.deck.pop());
}
function finishRound(d, tookCards) {
  refillAll();
  PL.forEach(p => { if (!S.out.includes(p) && !S.hands[p].length && !S.deck.length) S.out.push(p); });
  const left = alive();
  if (left.length <= 1) {
    const loser = left[0] || null;
    S.over = !loser ? 'draw' : loser === 'me' ? 'bot' : 'me';
    S.phase = 'over'; S.actor = null;
    S.msg = !loser ? 'Ничья' : loser === 'me' ? 'Вы остались «дураком» 🤡' : (S.out.includes('me') ? 'Вы выиграли! 🎉 Дурак: ' + NAMES[loser] : 'Вы выиграли! 🎉');
    stat(S.over); render(); return;
  }
  S.attacker = tookCards ? nextActive(d) : (S.out.includes(d) ? nextActive(d) : d);
  S.defender = nextActive(S.attacker);
  S.limit = Math.min(6, S.hands[S.defender].length);
  S.phase = 'attack'; S.passed = {}; S.actor = S.attacker; S.selected = null;
}
function endBout() {                    // «бито»
  const d = S.defender;
  S.table = [];
  finishRound(d, false);
  if (!S.over) S.msg = S.attacker === 'me' ? 'Бито. Ваш ход' : 'Бито. Ходит ' + NAMES[S.attacker];
  render();
}
function finishTake() {                 // защитник забирает
  const d = S.defender;
  for (const p of S.table) { S.hands[d].push(p.a); if (p.d) S.hands[d].push(p.d); }
  S.table = [];
  finishRound(d, true);
  if (!S.over) S.msg = (d === 'me' ? 'Вы взяли карты. ' : NAMES[d] + ' взял карты. ') + (S.attacker === 'me' ? 'Ваш ход' : 'Ходит ' + NAMES[S.attacker]);
  render();
}

// ---- ИИ ----
const cost = c => (isTrump(c) ? 100 : 0) + c.r;
function aiLead(p) {
  const hand = S.hands[p];
  return [...hand].sort((x, y) => cost(x) - cost(y))[0];
}
function aiThrow(p) {
  const ok = S.hands[p].filter(c => allowedAttack(c) && (!isTrump(c) || (S.deck.length === 0 && c.r < 5))).sort((x, y) => cost(x) - cost(y));
  return ok[0] || null;
}
function aiDefend(p, pair) {
  const opts = S.hands[p].filter(c => beats(pair.a, c)).sort((x, y) => cost(x) - cost(y));
  const c = opts[0];
  if (!c) return null;
  if (isTrump(c) && c.r >= 6 && S.deck.length > 4 && !isTrump(pair.a)) return null;
  return c;
}
function aiTransfer(p) {
  const cs = S.hands[p].filter(c => !isTrump(c) && canTransfer(p, c)).sort((x, y) => cost(x) - cost(y));
  return cs[0] && Math.random() < .8 ? cs[0] : null;
}

async function tick() {
  if (busy || !S || S.over) return;
  busy = true;
  try {
    let guard = 0;
    for (;;) {
      if (S.over || guard++ > 400) break;
      const a = S.actor;
      if (!a || !isBot(a)) break;
      if (S.phase === 'defend') {
        await sleep(FAST ? 0 : 800);
        const tr = aiTransfer(a);
        if (tr) { doTransfer(a, tr); continue; }
        const pair = undefended()[0];
        const c = aiDefend(a, pair);
        if (c) playDefend(a, c, pair);
        else { S.phase = 'throwin'; S.passed = {}; S.msg = NAMES[a] + ' берёт' + (S.attacker === 'me' || throwers().includes('me') ? ' — можно подкинуть' : ''); setActor(); render(); }
      } else {                      // attack / throwin: подкидывает или пасует
        await sleep(FAST ? 0 : 650);
        if (!S.table.length) {
          const c = aiLead(a); playAttack(a, c);
        } else {
          const c = aiThrow(a);
          if (c && S.table.length < S.limit) { if (S.phase === 'attack') playAttack(a, c); else throwIn(a, c); }
          else { S.msg = S.phase === 'attack' ? NAMES[a] + ': бито' : NAMES[a] + ': хватит'; pass(a); }
        }
      }
    }
  } finally { busy = false; render(); }
}

// ---- действия игрока ----
function clickCard(c) {
  if (!S || S.over || busy || S.actor !== 'me') return;
  if (S.phase === 'attack' || S.phase === 'throwin') {
    if (!allowedAttack(c)) return;
    if (S.phase === 'attack') playAttack('me', c); else throwIn('me', c);
    setTimeout(tick, 0); return;
  }
  if (S.phase === 'defend' && S.defender === 'me') {
    const pair = S.selected && !S.selected.d ? S.selected : undefended()[0];
    const canB = pair && beats(pair.a, c), canT = canTransfer('me', c);
    let transfer = false;
    if (canB && canT) transfer = confirm('Перевести карту дальше?\nОК — перевести, Отмена — отбить');
    else if (canT) transfer = true;
    else if (!canB) return;
    if (transfer) doTransfer('me', c); else playDefend('me', c, pair);
    setTimeout(tick, 0);
  }
}
function clickPair(pair) { if (S && S.phase === 'defend' && S.defender === 'me' && !pair.d) { S.selected = pair; render(); } }
function btnPass() { if (S && S.actor === 'me' && (S.phase === 'attack' || S.phase === 'throwin') && S.table.length && !busy) { S.msg = S.phase === 'attack' ? 'Бито' : 'Готово'; pass('me'); setTimeout(tick, 0); } }
function btnTake() { if (S && S.phase === 'defend' && S.defender === 'me' && !busy) { S.phase = 'throwin'; S.passed = {}; S.msg = 'Беру…'; setActor(); render(); setTimeout(tick, 0); } }

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
  // соперники
  const op = $('opps'); op.innerHTML = ''; op.className = 'opps n' + (PL.length - 1);
  PL.filter(p => p !== 'me').forEach(p => {
    const box = document.createElement('div');
    box.className = 'opp' + (S.actor === p && !S.over ? ' act' : '') + (S.out.includes(p) ? ' gone' : '');
    const h = document.createElement('div'); h.className = 'hand bot';
    S.hands[p].forEach(() => h.appendChild(backEl('sm')));
    const role = S.over ? '' : (S.attacker === p ? '⚔️ ' : '') + (S.defender === p ? '🛡 ' : '');
    const lab = document.createElement('div'); lab.className = 'olab';
    lab.textContent = role + NAMES[p] + ': ' + (S.out.includes(p) ? 'вышел' : S.hands[p].length + ' карт');
    box.appendChild(h); box.appendChild(lab); op.appendChild(box);
  });
  // колода
  const dk = $('deck'); dk.innerHTML = '';
  if (S.deck.length) {
    dk.appendChild(cardEl(S.trumpCard, { cls: 'trumpcard' }));
    if (S.deck.length > 1) dk.appendChild(backEl('deckback'));
  } else { const t = document.createElement('div'); t.className = 'trumpsuit' + (RED(S.trump) ? ' red' : ''); t.textContent = S.trump; dk.appendChild(t); }
  $('decknum').innerHTML = '<small>' + (S.cfg.mode === 'per' ? 'ПЕРЕВОДНОЙ' : 'ПОДКИДНОЙ') + '</small><br><b class="' + (RED(S.trump) ? 'rd' : '') + '">' + S.trump + ' ' + S.deck.length + '</b>';
  // стол
  const tb = $('table'); tb.innerHTML = '';
  S.table.forEach(p => {
    const w = document.createElement('div'); w.className = 'pair' + (S.selected === p ? ' sel' : '');
    w.appendChild(cardEl(p.a, { onclick: () => clickPair(p) }));
    if (p.d) w.appendChild(cardEl(p.d, { cls: 'def' }));
    tb.appendChild(w);
  });
  // рука игрока
  const mh = $('me'); mh.innerHTML = '';
  const sorted = [...S.hands.me].sort((a, b) => (isTrump(a) - isTrump(b)) || a.s.localeCompare(b.s) || a.r - b.r);
  const myTurn = S.actor === 'me' && !S.over;
  sorted.forEach(c => {
    let ok = false;
    if (myTurn && (S.phase === 'attack' || S.phase === 'throwin')) ok = allowedAttack(c);
    else if (myTurn && S.phase === 'defend') { const pr = (S.selected && !S.selected.d) ? S.selected : undefended()[0]; ok = (!!pr && beats(pr.a, c)) || canTransfer('me', c); }
    mh.appendChild(cardEl(c, { cls: ok ? 'ok' : 'no', onclick: () => clickCard(c) }));
  });
  // кнопки и статус
  const canPass = myTurn && !busy && (S.phase === 'attack' || S.phase === 'throwin') && S.table.length;
  $('btnPass').textContent = S.phase === 'throwin' ? 'Готово' : 'Бито';
  $('btnPass').style.display = canPass ? '' : 'none';
  $('btnTake').style.display = myTurn && !busy && S.phase === 'defend' ? '' : 'none';
  let hint = S.msg;
  if (!S.over) {
    if (myTurn && (S.phase === 'attack' || S.phase === 'throwin')) hint = !S.table.length ? 'Ваш ход: выберите карту' : S.phase === 'throwin' ? 'Берёт ' + NAMES[S.defender] + '. Подкиньте карты или «Готово»' : 'Подкиньте карту или нажмите «Бито»';
    else if (myTurn && S.phase === 'defend') hint = 'Отбейте карту или «Беру»' + (S.cfg.mode === 'per' && S.table.every(p => !p.d) ? ' · можно перевести картой того же достоинства' : '');
    else if (S.actor && S.actor !== 'me') hint = S.phase === 'defend' ? NAMES[S.actor] + ' думает…' : 'Ходит ' + NAMES[S.actor] + '…';
  }
  $('status').textContent = hint;
  $('role').textContent = S.over ? '' : (S.attacker === 'me' ? '⚔️ Вы атакуете' : S.defender === 'me' ? '🛡 Вы защищаетесь' : 'Вы подкидываете');
  $('newgame').style.display = S.over ? '' : 'none';
  const st = readStat(); $('stat').textContent = `Победы ${st.w} · Пор. ${st.l}`;
}

function showSetup() { document.getElementById('setup').style.display = 'flex'; }
if (typeof document !== 'undefined') {
  UI = true;
  window.addEventListener('DOMContentLoaded', () => {
    try { backIdx = (parseInt(localStorage.getItem('durak_back3') || '0', 10) || 0) % BACKS.length; } catch (e) {}
    let cfg = { n: 2, mode: 'pod' };
    try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem('durak_cfg') || '{}')); } catch (e) {}
    const paint = () => {
      document.querySelectorAll('#setup [data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n === cfg.n));
      document.querySelectorAll('#setup [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === cfg.mode));
    };
    document.querySelectorAll('#setup [data-n]').forEach(b => b.onclick = () => { cfg.n = +b.dataset.n; paint(); });
    document.querySelectorAll('#setup [data-mode]').forEach(b => b.onclick = () => { cfg.mode = b.dataset.mode; paint(); });
    document.getElementById('go').onclick = () => {
      try { localStorage.setItem('durak_cfg', JSON.stringify(cfg)); } catch (e) {}
      document.getElementById('setup').style.display = 'none'; startGame(cfg);
    };
    paint();
    applyBack(); document.getElementById('backbtn').onclick = nextBack;
    document.getElementById('btnPass').onclick = btnPass;
    document.getElementById('btnTake').onclick = btnTake;
    document.getElementById('newgame').onclick = showSetup;
    document.getElementById('restart').onclick = showSetup;
    try { const tg = window.Telegram && Telegram.WebApp; if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor && tg.setHeaderColor('#0f5132'); tg.setBackgroundColor && tg.setBackgroundColor('#0f5132'); } } catch (e) {}
    showSetup();
  });
}
if (typeof module !== 'undefined') module.exports = { startGame, tick, get busy() { return busy; }, get S() { return S; }, set FAST(v) { FAST = v; }, set AUTO_ME(v) { AUTO_ME = v; } };

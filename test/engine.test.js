// Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const cpuSeats = () => [0, 1, 2, 3].map((i) => ({ name: `P${i}`, cpu: true }));

function step(st, rng) {
  if (st.phase === 'play' && st.trickWinner >= 0) return E.apply(st, { type: 'collect' }, rng);
  if (st.phase === 'handEnd') return E.apply(st, { type: 'next' }, rng);
  const seat = st.turn;
  const a = E.cpuAction(st, seat, rng);
  const r = E.apply(st, { ...a, seat }, rng);
  if (!r.ok) throw new Error(`cpu chose illegal action ${JSON.stringify(a)}: ${r.error}`);
  return r;
}

test('deck has 32 cards worth 28 points', () => {
  const d = E.fullDeck();
  assert.strictEqual(d.length, 32);
  assert.strictEqual(new Set(d).size, 32);
  assert.strictEqual(E.sumPts(d), 28);
});

test('card ranking: J > 9 > A > 10 > K > Q > 8 > 7, trump beats led suit', () => {
  assert.ok(E.beats('JH', '9H', 'H', null));
  assert.ok(E.beats('9H', 'AH', 'H', null));
  assert.ok(E.beats('10H', 'KH', 'H', null));
  assert.ok(!E.beats('JS', '7H', 'H', null), 'off-suit never wins without trump');
  assert.ok(E.beats('7S', 'JH', 'H', 'S'), 'any trump beats the led suit');
  assert.ok(!E.beats('7S', '8S', 'H', 'S'));
  const trick = [{ seat: 0, card: 'AH' }, { seat: 1, card: 'JH' }, { seat: 2, card: '7C' }, { seat: 3, card: '9H' }];
  assert.strictEqual(E.winningIndex(trick, null), 1);
  assert.strictEqual(E.winningIndex(trick, 'C'), 2);
});

test('bidding: rotates, forced dealer bid, ends when three pass', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(1), dealer: 3 });
  assert.strictEqual(st.turn, 0);
  assert.ok(!E.apply(st, { type: 'bid', seat: 1, value: 16 }).ok, 'out of turn');
  assert.ok(!E.apply(st, { type: 'bid', seat: 0, value: 15 }).ok, 'below minimum');
  assert.ok(E.apply(st, { type: 'pass', seat: 0 }).ok);
  assert.ok(E.apply(st, { type: 'pass', seat: 1 }).ok);
  assert.ok(E.apply(st, { type: 'pass', seat: 2 }).ok);
  assert.ok(E.mustBid(st, 3));
  assert.ok(!E.apply(st, { type: 'pass', seat: 3 }).ok, 'last player cannot pass');
  const r = E.apply(st, { type: 'bid', seat: 3, value: 16 });
  assert.ok(r.ok);
  assert.strictEqual(st.phase, 'trump');
  assert.strictEqual(st.bidder, 3);
  assert.strictEqual(st.target, 16);
});

test('bidding: raising continues until only the high bidder is left', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(2), dealer: 3 });
  E.apply(st, { type: 'bid', seat: 0, value: 16 });
  E.apply(st, { type: 'bid', seat: 1, value: 18 });
  E.apply(st, { type: 'pass', seat: 2 });
  E.apply(st, { type: 'pass', seat: 3 });
  assert.strictEqual(st.turn, 0);
  E.apply(st, { type: 'bid', seat: 0, value: 19 });
  assert.strictEqual(st.turn, 1, 'passed players are skipped');
  E.apply(st, { type: 'pass', seat: 1 });
  assert.strictEqual(st.phase, 'trump');
  assert.strictEqual(st.bidder, 0);
  assert.strictEqual(st.target, 19);
});

test('a bid of 28 ends the auction at once', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(3), dealer: 3 });
  E.apply(st, { type: 'bid', seat: 0, value: 28 });
  assert.strictEqual(st.phase, 'trump');
});

test('trump stays hidden from others until revealed', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(4), dealer: 3 });
  E.apply(st, { type: 'bid', seat: 0, value: 20 });
  ['pass', 'pass', 'pass'].forEach((t, i) => E.apply(st, { type: t, seat: i + 1 }));
  const suit = E.suitOf(st.hands[0][0]);
  assert.ok(!E.apply(st, { type: 'trump', seat: 0, suit: 'X' }).ok);
  assert.ok(E.apply(st, { type: 'trump', seat: 0, suit }).ok);
  assert.strictEqual(st.hands.every((h) => h.length === 8), true);
  assert.strictEqual(E.view(st, 0).trump, suit);
  [1, 2, 3].forEach((s) => assert.strictEqual(E.view(st, s).trump, null));
  // views never leak other hands
  const v = E.view(st, 1);
  assert.deepStrictEqual(v.hand.slice().sort(), st.hands[1].slice().sort());
  assert.ok(!JSON.stringify(v).includes(JSON.stringify(st.hands[0])));
  assert.ok(!('stock' in v) && !('hands' in v));
});

test('must follow suit; reveal forces a trump when held', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(5), dealer: 3 });
  st.phase = 'play'; st.bidder = 2; st.target = 18; st.trump = 'S'; st.turn = 1;
  st.hands = [['7H'], ['8C', 'JS', 'QD'], ['9H'], ['AH']];
  st.trick = [{ seat: 0, card: 'KH' }];
  assert.deepStrictEqual(E.legalPlays(st, 1).sort(), ['8C', 'JS', 'QD'].sort(), 'void: any card');
  assert.ok(E.canReveal(st, 1));
  assert.ok(E.apply(st, { type: 'reveal', seat: 1 }).ok);
  assert.deepStrictEqual(E.legalPlays(st, 1), ['JS'], 'must trump after asking');
  assert.ok(!E.canReveal(st, 2));
  st.hands[1] = ['8C', 'JS', 'QD', '10H'];
  assert.deepStrictEqual(E.legalPlays(st, 1), ['10H'], 'follow suit first');
});

test('bidder may not lead trump before it is revealed', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(6), dealer: 3 });
  st.phase = 'play'; st.bidder = 0; st.trump = 'D'; st.turn = 0; st.trick = [];
  st.hands[0] = ['JD', '9D', '7C'];
  assert.deepStrictEqual(E.legalPlays(st, 0), ['7C']);
  st.hands[0] = ['JD', '9D'];
  assert.deepStrictEqual(E.legalPlays(st, 0), ['JD', '9D'], 'only trumps left');
});

test('pair lowers the bidding team target and raises it for opponents', () => {
  const mk = (seat) => {
    const st = E.newGame(cpuSeats(), { rng: seeded(7), dealer: 3 });
    st.phase = 'play'; st.bidder = 0; st.target = 22; st.trump = 'H'; st.revealed = true; st.turn = seat; st.trick = [];
    st.hands[seat] = ['KH', 'QH', '7C'];
    st.tricks = [];
    return st;
  };
  let st = mk(2);
  assert.ok(!E.canPair(st, 2), 'needs a trick won by the team first');
  st.tricks.push({ cards: [], winner: 0, points: 0 });
  assert.ok(E.apply(st, { type: 'pair', seat: 2 }).ok);
  assert.strictEqual(st.target, 18);
  assert.ok(!E.canPair(st, 2), 'only once');
  st = mk(1);
  st.tricks.push({ cards: [], winner: 3, points: 0 });
  E.apply(st, { type: 'pair', seat: 1 });
  assert.strictEqual(st.target, 26);
  st = mk(1); st.target = 26; st.tricks.push({ cards: [], winner: 1, points: 0 });
  E.apply(st, { type: 'pair', seat: 1 });
  assert.strictEqual(st.target, 28, 'capped at 28');
});

test('hand scoring: +1 when the bid is made, -1 when it is not', () => {
  const st = E.newGame(cpuSeats(), { rng: seeded(8), dealer: 3 });
  st.phase = 'play'; st.bidder = 1; st.target = 18; st.high = { value: 18, seat: 1 }; st.trump = 'C'; st.revealed = true;
  st.trickNo = 7; st.teamPts = [10, 15]; st.turn = 0; st.trick = [];
  st.hands = [['JH'], ['9H'], ['7H'], ['8H']];
  [0, 1, 2, 3].forEach((s) => assert.ok(E.apply(st, { type: 'play', seat: s, card: st.hands[s][0] }).ok));
  assert.strictEqual(st.trickWinner, 0);
  E.apply(st, { type: 'collect' });
  assert.strictEqual(st.phase, 'handEnd');
  assert.deepStrictEqual(st.teamPts, [15, 15]);
  assert.deepStrictEqual(st.scores, [0, -1]);
  assert.strictEqual(st.history.length, 1);
  assert.strictEqual(st.history[0].made, false);
});

test('computer players complete many full games with only legal moves', () => {
  let games = 0, hands = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed);
    const st = E.newGame(cpuSeats(), { rng });
    let guard = 0;
    while (st.phase !== 'gameOver') {
      const before = st.phase;
      step(st, rng);
      if (before === 'play' && st.phase === 'handEnd' || st.phase === 'gameOver' && before === 'play') {
        hands++;
        const r = st.history[st.history.length - 1];
        assert.strictEqual(r.points[0] + r.points[1], 28, 'all 28 points are captured each hand');
        assert.ok(r.target >= 16 && r.target <= 28);
      }
      if (st.phase === 'play') {
        const total = st.hands.reduce((a, h) => a + h.length, 0) + st.trick.length + st.tricks.length * 4;
        assert.strictEqual(total, 32);
      }
      if (++guard > 20000) throw new Error('game did not finish');
    }
    assert.ok(st.scores.some((s) => Math.abs(s) >= 6));
    assert.ok(st.winner === 0 || st.winner === 1);
    games++;
  }
  assert.strictEqual(games, 300);
  assert.ok(hands > 300);
});

test('views of a CPU game expose correct legal moves for the player to act', () => {
  const rng = seeded(99);
  const st = E.newGame(cpuSeats(), { rng });
  for (let i = 0; i < 200 && st.phase !== 'gameOver'; i++) {
    if (st.turn >= 0) {
      const v = E.view(st, st.turn);
      if (st.phase === 'play') assert.deepStrictEqual(v.legal.slice().sort(), E.legalPlays(st, st.turn).slice().sort());
      if (st.phase === 'bid') assert.ok(v.minBid >= 16);
      if (st.phase === 'trump') assert.ok(v.trumpChoices.length > 0);
    }
    step(st, rng);
  }
});

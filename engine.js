/* 29 card game: rules engine and computer players.
 *
 * Pure game logic with no DOM access, so it runs in the browser (window.E29)
 * and in Node for tests (module.exports). The host's browser owns the full
 * state; every player only ever sees view(state, seat).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.E29 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'C', 'D'];               // display order alternates colours
  const RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']; // high to low
  const POINTS = { J: 3, 9: 2, A: 1, 10: 1, K: 0, Q: 0, 8: 0, 7: 0 };
  const MIN_BID = 16, MAX_BID = 28, WIN_AT = 6, PAIR_SHIFT = 4;

  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);
  const rankIdx = (c) => RANKS.indexOf(rankOf(c));
  const pts = (c) => POINTS[rankOf(c)];
  const teamOf = (s) => s % 2;
  const nextSeat = (s) => (s + 1) % 4;
  const sumPts = (cards) => cards.reduce((a, c) => a + pts(c), 0);

  function fullDeck() {
    const d = [];
    SUITS.forEach((s) => RANKS.forEach((r) => d.push(r + s)));
    return d;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sortHand(hand, trump) {
    const order = trump ? [trump, ...SUITS.filter((s) => s !== trump)] : SUITS;
    return hand.slice().sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankIdx(a) - rankIdx(b));
  }

  // Does card c beat card b, given the led suit and the trump suit in force (or null)?
  function beats(c, b, led, trump) {
    const sc = suitOf(c), sb = suitOf(b);
    if (trump) {
      if (sc === trump && sb !== trump) return true;
      if (sb === trump && sc !== trump) return false;
    }
    if (sc === sb) return rankIdx(c) < rankIdx(b);
    return false;
  }

  function winningIndex(trick, trump) {
    const led = suitOf(trick[0].card);
    let best = 0;
    for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, trick[best].card, led, trump)) best = i;
    return best;
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------

  function newGame(seats, opts = {}) {
    const st = {
      seats: seats.slice(0, 4).map((s, i) => ({ name: String(s.name || `Player ${i + 1}`), cpu: !!s.cpu, away: false })),
      scores: [0, 0],
      dealer: Number.isInteger(opts.dealer) ? opts.dealer : 3,
      handNo: 0,
      history: [],
      winner: null,
      pairRule: opts.pairRule !== false,
      winAt: [3, 6].includes(opts.winAt) ? opts.winAt : WIN_AT,
    };
    startHand(st, opts.rng || Math.random);
    return st;
  }

  function startHand(st, rng) {
    const deck = shuffle(fullDeck(), rng || Math.random);
    st.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 4, i * 4 + 4));
    st.stock = deck.slice(16);
    st.phase = 'bid';
    st.bids = [];
    st.high = { value: 0, seat: -1 };
    st.passed = [false, false, false, false];
    st.turn = nextSeat(st.dealer);
    st.bidder = -1;
    st.target = 0;
    st.trump = null;
    st.revealed = false;
    st.revealedBy = -1;
    st.revealTrick = -1;
    st.trick = [];
    st.trickWinner = -1;
    st.trickNo = 0;
    st.tricks = [];
    st.teamPts = [0, 0];
    st.pair = null;
    st.result = null;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  function minBid(st) { return Math.max(MIN_BID, st.high.value + 1); }

  // Everyone else has passed without a bid: the last player must bid.
  function mustBid(st, seat) {
    return st.high.seat < 0 && st.passed.filter((p, i) => p && i !== seat).length === 3;
  }

  function legalPlays(st, seat) {
    if (st.phase !== 'play' || st.turn !== seat || st.trickWinner >= 0) return [];
    const hand = st.hands[seat];
    if (!st.trick.length) {
      // The bidder may not lead trumps while trump is still hidden, unless holding nothing else.
      if (seat === st.bidder && !st.revealed) {
        const other = hand.filter((c) => suitOf(c) !== st.trump);
        if (other.length) return other;
      }
      return hand.slice();
    }
    const led = suitOf(st.trick[0].card);
    const follow = hand.filter((c) => suitOf(c) === led);
    if (follow.length) return follow;
    // A player who has just asked for trump must play one if they can.
    if (st.revealed && st.revealedBy === seat && st.revealTrick === st.trickNo) {
      const tr = hand.filter((c) => suitOf(c) === st.trump);
      if (tr.length) return tr;
    }
    return hand.slice();
  }

  function canReveal(st, seat) {
    if (st.phase !== 'play' || st.turn !== seat || st.revealed || st.trickWinner >= 0 || !st.trick.length) return false;
    const led = suitOf(st.trick[0].card);
    return !st.hands[seat].some((c) => suitOf(c) === led);
  }

  function canPair(st, seat) {
    if (!st.pairRule || st.phase !== 'play' || st.turn !== seat || !st.revealed || st.pair || st.trickWinner >= 0) return false;
    const h = st.hands[seat];
    if (!h.includes('K' + st.trump) || !h.includes('Q' + st.trump)) return false;
    return st.tricks.some((t) => teamOf(t.winner) === teamOf(seat));
  }

  // ------------------------------------------------------------------
  // Actions. apply() validates, mutates st and returns { ok, events } or { ok:false, error }.
  // Events only carry public information, so they can be broadcast to everyone.
  // ------------------------------------------------------------------

  function apply(st, a, rng) {
    const fail = (error) => ({ ok: false, error });
    if (!a || typeof a !== 'object') return fail('bad action');
    const seat = a.seat;
    const ev = [];
    switch (a.type) {
      case 'bid': {
        if (st.phase !== 'bid' || st.turn !== seat || st.passed[seat]) return fail('not your bid');
        const v = a.value;
        if (!Number.isInteger(v) || v < minBid(st) || v > MAX_BID) return fail('bad bid');
        st.high = { value: v, seat };
        st.bids.push({ seat, value: v });
        ev.push({ e: 'bid', seat, value: v });
        advanceBidding(st, seat, ev);
        break;
      }
      case 'pass': {
        if (st.phase !== 'bid' || st.turn !== seat || st.passed[seat]) return fail('not your bid');
        if (mustBid(st, seat)) return fail('must bid');
        st.passed[seat] = true;
        st.bids.push({ seat, value: 0 });
        ev.push({ e: 'pass', seat });
        advanceBidding(st, seat, ev);
        break;
      }
      case 'trump': {
        if (st.phase !== 'trump' || st.bidder !== seat) return fail('not your choice');
        if (!SUITS.includes(a.suit) || !st.hands[seat].some((c) => suitOf(c) === a.suit)) return fail('bad suit');
        st.trump = a.suit;
        for (let i = 0; i < 4; i++) st.hands[i] = st.hands[i].concat(st.stock.slice(i * 4, i * 4 + 4));
        st.stock = [];
        st.phase = 'play';
        st.turn = nextSeat(st.dealer);
        ev.push({ e: 'trumpSet', seat }, { e: 'deal2' });
        break;
      }
      case 'reveal': {
        if (!canReveal(st, seat)) return fail('cannot ask for trump');
        st.revealed = true;
        st.revealedBy = seat;
        st.revealTrick = st.trickNo;
        ev.push({ e: 'reveal', seat, suit: st.trump });
        break;
      }
      case 'pair': {
        if (!canPair(st, seat)) return fail('no pair');
        const own = teamOf(seat) === teamOf(st.bidder);
        const before = st.target;
        st.target = own ? Math.max(MIN_BID, st.target - PAIR_SHIFT) : Math.min(MAX_BID, st.target + PAIR_SHIFT);
        st.pair = { seat, before, after: st.target };
        ev.push({ e: 'pair', seat, before, target: st.target });
        break;
      }
      case 'play': {
        if (!legalPlays(st, seat).includes(a.card)) return fail('illegal card');
        st.hands[seat] = st.hands[seat].filter((c) => c !== a.card);
        st.trick.push({ seat, card: a.card });
        ev.push({ e: 'play', seat, card: a.card });
        if (st.trick.length === 4) {
          const w = st.trick[winningIndex(st.trick, st.revealed ? st.trump : null)].seat;
          st.trickWinner = w;
          st.turn = -1;
          ev.push({ e: 'trickWon', seat: w, points: sumPts(st.trick.map((t) => t.card)) });
        } else {
          st.turn = nextSeat(seat);
        }
        break;
      }
      case 'collect': {   // system step after a finished trick has been shown
        if (st.phase !== 'play' || st.trickWinner < 0) return fail('nothing to collect');
        const w = st.trickWinner;
        const cards = st.trick.map((t) => t.card);
        const p = sumPts(cards);
        st.tricks.push({ cards: st.trick.slice(), winner: w, points: p });
        st.teamPts[teamOf(w)] += p;
        st.trick = [];
        st.trickWinner = -1;
        st.trickNo++;
        ev.push({ e: 'collect', seat: w, points: p });
        if (st.trickNo === 8) endHand(st, ev);
        else st.turn = w;
        break;
      }
      case 'next': {      // system step: deal the next hand
        if (st.phase !== 'handEnd') return fail('hand not over');
        st.dealer = nextSeat(st.dealer);
        st.handNo++;
        startHand(st, rng);
        ev.push({ e: 'deal' });
        break;
      }
      default:
        return fail('unknown action');
    }
    return { ok: true, events: ev };
  }

  function advanceBidding(st, seat, ev) {
    const active = [0, 1, 2, 3].filter((i) => !st.passed[i]);
    if (st.high.value === MAX_BID || (active.length === 1 && st.high.seat === active[0])) {
      st.bidder = st.high.seat;
      st.target = st.high.value;
      st.phase = 'trump';
      st.turn = st.bidder;
      ev.push({ e: 'bidWon', seat: st.bidder, value: st.target });
      return;
    }
    let s = nextSeat(seat);
    while (st.passed[s]) s = nextSeat(s);
    st.turn = s;
  }

  function endHand(st, ev) {
    const bt = teamOf(st.bidder);
    const made = st.teamPts[bt] >= st.target;
    st.scores[bt] += made ? 1 : -1;
    st.result = {
      hand: st.handNo + 1, dealer: st.dealer, bidder: st.bidder, bid: st.high.value, target: st.target,
      trump: st.trump, pair: st.pair ? st.pair.seat : -1, points: st.teamPts.slice(), made, scores: st.scores.slice(),
    };
    st.history.push(st.result);
    st.phase = 'handEnd';
    st.turn = -1;
    ev.push({ e: 'handEnd', result: st.result });
    if (st.scores[bt] >= st.winAt) st.winner = bt;
    else if (st.scores[bt] <= -st.winAt) st.winner = 1 - bt;
    if (st.winner !== null) {
      st.phase = 'gameOver';
      ev.push({ e: 'gameOver', winner: st.winner });
    }
  }

  // ------------------------------------------------------------------
  // Per-seat view: everything that seat is allowed to know.
  // ------------------------------------------------------------------

  function view(st, seat) {
    const knowsTrump = st.revealed || (seat === st.bidder && st.trump);
    const myTurn = st.turn === seat;
    return {
      you: seat,
      seats: st.seats.map((s) => ({ name: s.name, cpu: s.cpu, away: s.away })),
      phase: st.phase, handNo: st.handNo, dealer: st.dealer, turn: st.turn,
      hand: sortHand(st.hands[seat], knowsTrump ? st.trump : null),
      counts: st.hands.map((h) => h.length),
      bids: st.bids.slice(), high: { ...st.high }, passed: st.passed.slice(),
      bidder: st.bidder, target: st.target,
      trump: knowsTrump ? st.trump : null,
      revealed: st.revealed, revealedBy: st.revealedBy,
      trick: st.trick.map((t) => ({ ...t })), trickWinner: st.trickWinner, trickNo: st.trickNo,
      lastTrick: st.tricks.length ? st.tricks[st.tricks.length - 1] : null,
      tricksWon: [0, 1, 2, 3].map((i) => st.tricks.filter((t) => t.winner === i).length),
      teamPts: st.teamPts.slice(),
      pair: st.pair ? { ...st.pair } : null,
      winAt: st.winAt, pairRule: st.pairRule,
      scores: st.scores.slice(), history: st.history.map((h) => ({ ...h })), winner: st.winner,
      result: st.result,
      // what this seat can do right now
      legal: myTurn ? legalPlays(st, seat) : [],
      canReveal: canReveal(st, seat),
      canPair: canPair(st, seat),
      minBid: st.phase === 'bid' && myTurn ? minBid(st) : 0,
      mustBid: st.phase === 'bid' && myTurn && mustBid(st, seat),
      trumpChoices: st.phase === 'trump' && st.bidder === seat ? SUITS.filter((s) => st.hands[seat].some((c) => suitOf(c) === s)) : [],
    };
  }

  // ------------------------------------------------------------------
  // Computer player. Uses only what its seat could know: its own hand,
  // played cards, and trump when it chose it or after it is revealed.
  // ------------------------------------------------------------------

  function cpuAction(st, seat, rng = Math.random) {
    const hand = st.hands[seat];
    if (st.phase === 'bid') {
      const v = cpuBid(st, seat);
      return v ? { type: 'bid', value: v } : { type: 'pass' };
    }
    if (st.phase === 'trump') return { type: 'trump', suit: chooseTrump(hand) };
    if (st.phase !== 'play') return null;
    if (canPair(st, seat)) return { type: 'pair' };
    return cpuPlay(st, seat, rng);
  }

  function handStrength(hand) {
    let best = 0, bestSuit = null;
    SUITS.forEach((s) => {
      const cs = hand.filter((c) => suitOf(c) === s);
      if (!cs.length) return;
      const score = cs.length * 10 + sumPts(cs);
      if (score > best) { best = score; bestSuit = s; }
    });
    const inSuit = hand.filter((c) => suitOf(c) === bestSuit);
    const jacks = hand.filter((c) => rankOf(c) === 'J').length;
    const val = 10 + sumPts(hand) * 0.6 + inSuit.length * 1.6 + jacks * 0.8 + (inSuit.some((c) => rankOf(c) === 'J') ? 1 : 0);
    return Math.min(23, Math.floor(val));
  }

  function cpuBid(st, seat) {
    const need = minBid(st);
    if (mustBid(st, seat)) return MIN_BID;
    const max = handStrength(st.hands[seat]);
    const partnerHigh = st.high.seat >= 0 && teamOf(st.high.seat) === teamOf(seat);
    if (partnerHigh && max < need + 2) return 0;
    return need <= max ? need : 0;
  }

  function chooseTrump(hand) {
    let best = null, score = -1;
    SUITS.forEach((s) => {
      const cs = hand.filter((c) => suitOf(c) === s);
      if (!cs.length) return;
      const v = cs.length * 10 + sumPts(cs) + (7 - rankIdx(cs.reduce((a, b) => (rankIdx(a) < rankIdx(b) ? a : b)))) * 0.1;
      if (v > score) { score = v; best = s; }
    });
    return best;
  }

  function cpuPlay(st, seat, rng) {
    const hand = st.hands[seat];
    const legal = legalPlays(st, seat);
    const knownTrump = st.revealed || seat === st.bidder ? st.trump : null;
    const activeTrump = st.revealed ? st.trump : null;
    const seen = new Set();
    st.tricks.forEach((t) => t.cards.forEach((x) => seen.add(x.card)));
    st.trick.forEach((x) => seen.add(x.card));
    hand.forEach((c) => seen.add(c));
    // card is the highest of its suit still out (no unseen card ranks above it)
    const isMaster = (c) => !RANKS.slice(0, rankIdx(c)).some((r) => !seen.has(r + suitOf(c)));
    const lowest = (cards) => cards.slice().sort((a, b) => pts(a) - pts(b) || rankIdx(b) - rankIdx(a))[0];
    const highestPts = (cards) => cards.slice().sort((a, b) => pts(b) - pts(a) || rankIdx(b) - rankIdx(a))[0];
    const play = (card) => ({ type: 'play', card });

    // ---------- leading ----------
    if (!st.trick.length) {
      const masters = legal.filter((c) => isMaster(c) && pts(c) > 0 && suitOf(c) !== knownTrump);
      if (masters.length) return play(highestPts(masters));
      // bidding team with trump out: pull trumps with a master trump
      if (st.revealed && teamOf(seat) === teamOf(st.bidder)) {
        const mt = legal.filter((c) => suitOf(c) === st.trump && isMaster(c));
        if (mt.length) return play(mt[0]);
      }
      const nonTrump = legal.filter((c) => suitOf(c) !== knownTrump);
      const pool = nonTrump.length ? nonTrump : legal;
      // prefer a low card from the longest suit, avoiding pointed cards
      const bySuit = {};
      pool.forEach((c) => (bySuit[suitOf(c)] = (bySuit[suitOf(c)] || 0) + 1));
      const cheap = pool.filter((c) => pts(c) === 0);
      const cands = cheap.length ? cheap : pool;
      return play(cands.slice().sort((a, b) => bySuit[suitOf(b)] - bySuit[suitOf(a)] || pts(a) - pts(b) || rankIdx(b) - rankIdx(a))[0]);
    }

    // ---------- following ----------
    const led = suitOf(st.trick[0].card);
    const wi = winningIndex(st.trick, activeTrump);
    const win = st.trick[wi];
    const partnerWinning = teamOf(win.seat) === teamOf(seat);
    const last = st.trick.length === 3;
    const trickPts = sumPts(st.trick.map((t) => t.card));
    const winCardMaster = suitOf(win.card) === led && (!activeTrump || !st.trick.some((t) => suitOf(t.card) === activeTrump)) ? isMaster(win.card) : suitOf(win.card) === activeTrump && isMaster(win.card);
    const partnerSafe = partnerWinning && (last || winCardMaster);
    const beatsWin = (c) => beats(c, win.card, led, activeTrump);
    const feed = (cards) => {
      const nonMaster = cards.filter((c) => !(isMaster(c) && pts(c) >= 2));
      return highestPts(nonMaster.length ? nonMaster : cards);
    };

    const following = legal.some((c) => suitOf(c) === led);
    if (following) {
      if (partnerSafe) return play(feed(legal));
      const winners = legal.filter(beatsWin);
      if (!partnerWinning && winners.length) {
        const cheapest = winners.slice().sort((a, b) => rankIdx(b) - rankIdx(a))[0];
        const top = winners.slice().sort((a, b) => rankIdx(a) - rankIdx(b))[0];
        if (last) return play(winners.slice().sort((a, b) => pts(b) - pts(a) || rankIdx(b) - rankIdx(a))[0]);
        if (isMaster(top)) return play(top);
        if (trickPts >= 2) return play(cheapest);
      }
      return play(lowest(legal));
    }

    // ---------- cannot follow suit ----------
    if (canReveal(st, seat) && !partnerSafe) {
      const worth = trickPts + (last ? 0 : 1);
      if (seat === st.bidder) {
        if (hand.some((c) => suitOf(c) === st.trump) && worth >= 2) return { type: 'reveal' };
      } else if (worth >= 2 || rng() < 0.25) {
        return { type: 'reveal' };
      }
    }
    if (activeTrump && !partnerSafe) {
      const cutters = legal.filter((c) => suitOf(c) === activeTrump && beatsWin(c));
      if (cutters.length && (trickPts >= 1 || !last || legal.every((c) => suitOf(c) === activeTrump))) {
        return play(cutters.slice().sort((a, b) => rankIdx(b) - rankIdx(a))[0]);
      }
    }
    // discard: keep trumps (if known), feed partner, otherwise throw the cheapest card
    const nonTrump = legal.filter((c) => suitOf(c) !== knownTrump);
    const pool = nonTrump.length ? nonTrump : legal;
    if (partnerSafe) return play(feed(pool));
    return play(lowest(pool));
  }

  return {
    SUITS, RANKS, POINTS, MIN_BID, MAX_BID, WIN_AT,
    suitOf, rankOf, rankIdx, pts, teamOf, nextSeat, sumPts, fullDeck, sortHand, beats, winningIndex,
    newGame, startHand, apply, legalPlays, canReveal, canPair, minBid, mustBid, view,
    cpuAction, cpuBid, chooseTrump, handStrength,
  };
});

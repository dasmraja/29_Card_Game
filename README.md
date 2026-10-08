# 29 Card Game

The classic South Asian trick-taking game **29**, in the browser. Open `index.html` (or the GitHub Pages site); there is no build step.

- **Play vs computer**: you and a computer partner against two computer opponents
- **Play online with friends**: host a room, share the 5-character code or invite link, and up to 4 people play from their own browsers. Empty seats are played by the computer.
- **Animations**: dealing, cards flying to the table, trick sweeps to the winner, trump reveal, score bumps and a win celebration
- **Sound effects**, synthesised in the browser (toggle with 🔊)
- **Score history**: hand-by-hand table for the current game, plus a leaderboard and recent games saved in your browser
- Works on phones and desktops

## Rules in short

- 4 players, 2 teams (partners sit opposite). 32 cards, 7 to Ace.
- Card order in every suit: **J, 9, A, 10, K, Q, 8, 7**. Points: **J = 3, 9 = 2, A = 1, 10 = 1** (28 in total).
- Everyone gets 4 cards and bids 16–28 or passes. If the first three pass, the dealer must bid 16.
- The highest bidder secretly picks the trump suit, then 4 more cards are dealt to each player.
- Follow suit if you can. If you can't, you may **ask for trump**: it is revealed, and you must play a trump if you have one.
  Trumps only count once revealed, and the bidder may not lead trump before it is revealed.
- **Pair** (optional, on by default): after trump is revealed, the King and Queen of trump in one hand change the target by 4
  (down for the bidding team, up for the opponents), once that player's team has won a trick.
- The bidding team gains 1 game point if it takes at least its target, otherwise it loses 1. First team to +6 wins, or a team at −6 loses
  (a short ±3 game is available).

## Online play

Online rooms use [PeerJS](https://peerjs.com/) (WebRTC). The library and its free public matchmaking server only connect players;
the game then runs directly between browsers. The host's browser deals and enforces the rules, and each player's browser only ever
receives its own cards. If a player disconnects, the computer plays their seat until they rejoin with the same name and room code.

## Development

- `engine.js` holds the rules and the computer players. It has no DOM code, so it also runs in Node.
- `index.html` is the table, animations, sounds, score history and networking.
- `npm test` runs the engine tests (Node 18+, no dependencies), including hundreds of full computer-vs-computer games.

## Hosting

The workflow in `.github/workflows/pages.yml` runs the tests and deploys to GitHub Pages on every push to `main`.
Enable it once under **Settings → Pages → Source: GitHub Actions**; the game is then at
https://dasmraja.github.io/29_Card_Game/

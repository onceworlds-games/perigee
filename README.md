# Perigee

Golf on tiny worlds. Tee off from one planetoid, curve the ball round a moon, skim a gas giant to slow down and
drop it into a cup on a world you could barely see from the tee. Everyone shoots at the same time.

Play it at [onceworlds.com/play/perigee](https://onceworlds.com/play/perigee).

## How to play

Every hole is a small solar system: three to seven planetoids, some of them moving, a tee on one and a cup on
another. "Down" is whichever world is closest. The shot follows the camera: drag (or use WASD or the arrows) to turn
toward where you want to go, tilt up to loft it higher, tilt down to roll it along the ground; the loft shows beside
the power ring. Hold Shoot to charge, let go. The ball flies under the pull of every world near it, bounces, rolls, and either
drops in or comes to rest for the next stroke. A dotted preview shows the first moments of the real flight. A ball
that leaves the system, burns on lava, falls into a gas giant or a black hole costs a stroke and comes back to
where it last rested. Each hole is capped at par + 4 strokes.

Up to eight players shoot at once (other balls are ghosts). A hole ends when everyone has holed or picked up, 30
seconds after the first ball drops, or after three minutes. Lowest total wins.

### Controls

Keyboard and mouse: drag to look, WASD or the arrows turn and tilt (Shift for fine aim), Space (or press on the ball)
to charge and release to shoot, Esc cancels, the wheel or - and = zoom, R looks at the cup, 1-3 play a card, Q fires a
thruster or holds the brake mid-flight, X (twice) picks up, P replays the last shot, C watches the next player, F
cycles the preview length in solo play, Enter continues.

Touch: one finger looks around; the Shoot button charges while held; Card, Cup and Watch buttons do the rest. Pick
up, Replay and Quit sit at the left edge, out of the thumbs' way.

### Modes and settings

The clubhouse is the lobby: a course ticket with the round's settings, which the host changes and everyone sees,
and the platform's Ready strip under it. Play on the title readies you at once. The settings: Holes (3 / 6 / 9),
World (Auto ramp, Random holes built on the spot, or a pair of sibling worlds), Scoring (Strokes, Points, Speed),
Preview (Short / Long / None), Cards (Off / On) and Fill (bots to 4 or 8). With one player in the server the round
is played against par and the bots. A new player's first round opens on the friendliest hole; a world's ninth hole,
its hardest, is kept for the Tour and Practice.

Stamps in the clubhouse, for while the round waits: the Daily Hole (one new hole a day, with a streak), Practice
(any of the 72 holes, no scoring), the Tour (nine holes over three worlds with Cards on, the last of each world the
hardest) and the Locker (ball skins, trails, flags, plinks, celebrations and your ball's name, unlocked by level).

### Worlds

Pebble Belt, Binary Dance, Lava Moons, Ice Garden, Clockwork, Wormhole Alley, Black Hole Casino and Comet Run:
each with its own surfaces (meadow, dust, ice, lava, moss, metal, gas), hazards (lava, ice, bounce pads, tar, boost
rings, wormholes, a black hole) and movers (orbiting pairs, sliding worlds, comets).

### Cards

With Cards on, every player privately drafts one of three cards after each hole and plays at most one per hole:
Thruster, Magnet, Brake, Ghost, Bouncy, Sticky, Long Look, Mulligan, Heavy and Lucky Cup.

## Multiplayer

A public game on Onceworlds: the platform's lobby, settings and match cycle. The host's page runs the rules and
writes one round record to room state; every shot is a small record other pages simulate with the same
deterministic physics, so nothing about the course or the flights is streamed. A reload, a dropped connection or a
new host carries on from the room state; latecomers watch and join at the next hole.

## How it's built

Vite and three.js. `src/sim` is the pure simulation (no DOM, only `+ - * /` and `sqrt`, fixed 1/120 s steps,
quantized shots): planets, rails, the ball, the generator that builds holes from a real solution, the bots, scoring
and cards. It runs unchanged in Node (tests, the hole library, the balance harness) and in the browser. `src/render`
draws it: toon planets built from the same surface function the ball rolls on (lit by one sun, with per-world surface
detail drawn in the shader, an ink outline and atmosphere rims), a sky baked once per hole, the chase camera, the
ball, its trail and shadow, particles, and the turning solar system behind the title and the clubhouse. `src/game`
runs the round and the session, `src/ui` and `src/audio` are the screens, the HUD and the procedural sound.
`data/holes.json` holds the 72 verified holes. Each is graded by Pro and Club bots playing it; par follows that
grade (30% par 2, 45% par 3, 25% par 4) and every world is ordered easiest first. Random and Daily holes are built
on the page from their seed, a millisecond or so a frame, before they are needed.

## Running it locally

- `npm install`, then `npm run dev` for a standalone build (the game runs with a stand-in for the platform).
- `npm test`: the simulation, generator, bot, scoring, card, round and session tests (`node --test`).
- `npm run balance`: the headless balance harness (bots over every hole; `--cards` for the cards table).
- `npm run holes`: rebuilds `data/holes.json` (`node scripts/gen-holes.mjs --regrade` re-pars it from the bots).
- `npm run store` and `npm run smoke` draw with the machine's GPU (`GPU=0` for the software renderer).
- `npm run build && npm run store`: captures the store art from the game's poster scenes.
- `npm run build && npm run smoke`: a headless-Chrome run of the game with its autopilot.
- To test on a local Onceworlds platform, deploy the folder with the Onceworlds CLI after `npm run build`.

## Badges

First Cup, Slingshot, Perigee, Aerobrake, Lost In Space, Photo Finish, Under Par, Seven Days, Wild Card, Full
Course, Level 10.

## Leaderboards

`best-9` (lowest strokes over a nine-hole Strokes round with Cards off), `holes-in-one`, `daily-streak`.

## License

MIT. See `LICENSE`.

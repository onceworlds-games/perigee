// Store art from the game's own renderer: ?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>.
// Deterministic scenes, no SDK, no network; sets window.__posterReady when the frame is drawn.
import * as THREE from 'three';
import { Gfx, PALETTE } from './render/gfx.js';
import { Backdrop } from './render/backdrop.js';
import { World } from './render/world.js';
import { BallView } from './render/ball.js';
import { prepareHole, cupPos, centersAt, MAX_PLANETS } from './sim/hole.js';
import { makeBall, launchAt, stepBall, ballPos, DT, FLY, ROLL, HOLED, REST, LOST } from './sim/ball.js';
import library from '../data/holes.json';
import { drawBadge } from './ui/badges.js';

const SHOWCASE_SEED = 3728827386; // "Tail Slingshot": round a ringed giant to a cup across the system
const P = [0, 0, 0];
const C = new Float64Array(MAX_PLANETS * 3);
const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const LOOK = { body: PALETTE.cream, stripe: PALETTE.coral, trail: PALETTE.coral, flag: PALETTE.coral };
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);

/** Flies a hole's reference shot until `until(b, i)` says stop (or it ends), drawing the trail into `view`. */
function fly(h, view, until = null) {
  const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
  b.quiet = true;
  const r = h.ref;
  launchAt(h, b, r.t0, r.p[0], r.p[1], r.p[2], r.v[0], r.v[1], r.v[2], null);
  for (let i = 0; i < 120 * 40; i++) {
    stepBall(h, b);
    if (i % 2 === 0) {
      ballPos(h, b, P);
      view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT * 2, b.mode === FLY || b.mode === ROLL, 1);
    }
    if (b.mode === HOLED || b.mode === REST || b.mode === LOST) break;
    if (until && until(b, i)) break;
  }
  ballPos(h, b, P);
  view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT, b.mode === FLY || b.mode === ROLL, 1);
  return { b, p: P.slice(), t: b.t0 + b.step * DT };
}

function restOn(world, h, pid, planet, dir, index) {
  const b = makeBall(h, planet, dir);
  const view = world.ballView(pid, pid === 'me', index);
  if (pid === 'me') view.view.setLook(LOOK);
  const p = ballPos(h, b, [0, 0, 0]);
  view.view.update(h, 0, p[0], p[1], p[2], 0, 0, 0, DT, false, 1);
  return p;
}

/** Puts the camera at eye, looking at target with the given up (bypasses the chase camera). */
function place(gfx, eye, target, up, fov = 50) {
  gfx.camera.position.copy(eye);
  gfx.camera.up.copy(up).normalize();
  gfx.camera.lookAt(target);
  gfx.camera.fov = fov;
  gfx.camera.updateProjectionMatrix();
}

function centre(h, i, t = 0) {
  const c = centersAt(h, t, C);
  return new THREE.Vector3(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
}

export async function run(kind) {
  if (kind.startsWith('badge-')) {
    const id = kind.slice(6);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.style.cssText = 'position:fixed;left:0;top:0;width:256px;height:256px';
    document.body.style.background = 'transparent';
    document.getElementById('game').remove();
    document.getElementById('hud').remove();
    document.body.append(c);
    drawBadge(c.getContext('2d'), id, 256);
    window.__posterReady = true;
    return;
  }
  document.getElementById('hud').remove();
  const gfx = new Gfx(document.getElementById('game'));
  gfx.autoLevel = 2;
  gfx.applyQuality();
  gfx.shared.uTime.value = 3.1;
  const backdrop = new Backdrop(gfx, 7);
  const world = new World(gfx);
  world.setLook(LOOK);
  const show = library.holes.find((h) => h.seed === SHOWCASE_SEED) ?? library.holes.find((h) => h.world === 'comet');
  let fov = 52;
  if (kind === 'thumb1') {
    // The cover: a ball mid-arc round a ringed giant, its trail glowing back to the tee, the cup lit far ahead.
    const h = prepareHole(show);
    world.setHole(h, 41);
    const gi = h.planets.findIndex((p) => p.gas);
    const view = new BallView(gfx, LOOK, false, { trail: 320, width: num('w', 7), step: 0.3, scale: num('s', 4), cues: false });
    let past = -1;
    const after = num('after', 40);
    const me = fly(h, view, (b, i) => {
      if (past < 0 && gi >= 0 && b.passes[gi] < 6) past = i;
      return past >= 0 && i > past + after;
    });
    const pos = v(me.p);
    const giant = centre(h, gi >= 0 ? gi : h.cup.p);
    const cupWorld = centre(h, h.cup.p);
    // Beyond the giant from the cup, swung to one side and a little above its rings: the giant and its rings on
    // one side, the ball and its glowing arc across it, the cup's world and beacon far off on the other.
    const Y = new THREE.Vector3(0, 1, 0);
    if (params.get('mode') !== 'near') {
      const base = giant.clone().sub(cupWorld).setY(0).normalize();
      const yaw = (num('yaw', -38) * Math.PI) / 180;
      const pitch = (num('pitch', 14) * Math.PI) / 180;
      const dir = base.clone().applyAxisAngle(Y, yaw);
      dir.multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
      const eye = giant.clone().addScaledVector(dir, num('dist', 44));
      const target = giant.clone().lerp(pos, num('t', 0.6)).lerp(cupWorld, num('ahead', 0.12)).addScaledVector(Y, num('ty', -3));
      fov = num('fov', 50);
      place(gfx, eye, target, Y, fov);
    } else {
      // Close behind the ball, outside its curve: the ball and its arc up front, the ringed giant behind it, the
      // cup's world and its beacon beyond.
      const vel = new THREE.Vector3(me.b.vx, me.b.vy, me.b.vz).setY(0).normalize();
      const out = pos.clone().sub(giant).setY(0).normalize();
      const eye = pos.clone().addScaledVector(out, num('out', 10)).addScaledVector(vel, -num('back', 6)).addScaledVector(Y, num('up', 3));
      const target = pos.clone().lerp(giant, num('t', 0.35)).lerp(cupWorld, num('ahead', 0.05));
      fov = num('fov', 52);
      place(gfx, eye, target, Y, fov);
    }
  } else if (kind === 'thumb2') {
    // Four balls on one small meadow, shadows under them, the flag ahead.
    const data = library.holes.find((h) => h.world === 'pebble' && h.planets[h.cup.p].k === 'meadow') ?? library.holes[0];
    const h = prepareHole(data);
    world.setHole(h, 3);
    const upv = v([h.cup.dx, h.cup.dy, h.cup.dz]).normalize();
    const cup = v(cupPos(h, 0));
    const pl = h.planets[h.cup.p];
    const side = new THREE.Vector3(0, 1, 0).cross(upv).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const back = upv.clone().cross(side).normalize();
    const spots = [[0, 7.2], [1.7, 5.0], [-1.5, 3.9], [0.8, 2.4]];
    let mine = null;
    spots.forEach(([s, bk], i) => {
      const dir = upv.clone().addScaledVector(side, s / pl.R).addScaledVector(back, bk / pl.R).normalize();
      const p = restOn(world, h, i === 0 ? 'me' : `p${i}`, h.cup.p, [dir.x, dir.y, dir.z], i);
      if (i === 0) mine = v(p);
    });
    const eye = mine.clone().addScaledVector(back, num('back', 4.6)).addScaledVector(upv, num('up', 2.1)).addScaledVector(side, num('side', -1.0));
    fov = num('fov', 52);
    place(gfx, eye, mine.clone().lerp(cup, num('t', 0.55)).addScaledVector(upv, 0.6), upv, fov);
  } else if (kind === 'thumb3') {
    // Lava Moons: a ball in flight past a moon of glowing cracks.
    const data = library.holes.find((h) => h.world === 'lava' && h.planets.some((p) => p.k === 'lava') && h.grade.flight > 6) ?? library.holes.find((h) => h.world === 'lava');
    const h = prepareHole(data);
    world.setHole(h, 5);
    const li = Math.max(0, h.planets.findIndex((p) => p.kind === 'lava'));
    const view = new BallView(gfx, LOOK, false, { trail: 200, width: 2.2, step: 0.3, scale: 1.6, cues: false });
    const lava = centre(h, li);
    // Stop where the flight comes nearest the lava moon.
    let best = 1e9;
    let bestI = 240;
    {
      const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
      b.quiet = true;
      const r = h.ref;
      launchAt(h, b, r.t0, r.p[0], r.p[1], r.p[2], r.v[0], r.v[1], r.v[2], null);
      for (let i = 0; i < 120 * 30 && b.mode !== HOLED && b.mode !== REST; i++) {
        stepBall(h, b);
        const d = v(ballPos(h, b, P)).distanceTo(lava);
        if (d < best && b.mode === FLY && i > 120) {
          best = d;
          bestI = i;
        }
      }
    }
    const me = fly(h, view, (b, i) => i >= bestI);
    const pos = v(me.p);
    const vel = new THREE.Vector3(me.b.vx, me.b.vy, me.b.vz).normalize();
    const away = pos.clone().sub(lava).normalize();
    const side = new THREE.Vector3().crossVectors(vel, away).normalize();
    const eye = pos.clone().addScaledVector(vel, -num('back', 7)).addScaledVector(away, num('up', 4)).addScaledVector(side, num('side', 3));
    fov = num('fov', 60);
    place(gfx, eye, pos.clone().lerp(lava, num('toward', 0.35)), away, fov);
  } else if (kind === 'thumb4') {
    // The whole shot as an orbit diagram: the system from above, the ball's path drawn from tee to cup.
    const h = prepareHole(show);
    world.setHole(h, 41);
    const view = new BallView(gfx, LOOK, false, { trail: 420, width: 9, step: 0.45, scale: 5, cues: false });
    fly(h, view, (b) => b.mode === ROLL && b.g === h.cup.p && b.rolled > 2);
    const lo = new THREE.Vector3(1e9, 1e9, 1e9);
    const hi = new THREE.Vector3(-1e9, -1e9, -1e9);
    for (const i of [h.tee.p, h.cup.p, h.planets.findIndex((p) => p.gas)]) {
      if (i < 0) continue;
      const c = centre(h, i);
      lo.min(c);
      hi.max(c);
    }
    const focus = lo.clone().add(hi).multiplyScalar(0.5);
    const eye = focus.clone().add(new THREE.Vector3(num('ex', -30), num('ey', 62), num('ez', 70)));
    fov = num('fov', 52);
    place(gfx, eye, focus.clone().add(new THREE.Vector3(0, -6, 0)), new THREE.Vector3(0, 1, 0), fov);
  } else {
    // The icon: a cream ball with a coral stripe on top of a small orange world, on deep green.
    const data = { world: 'pebble', seed: 1, par: 2, planets: [{ k: 'dust', c: [0, 0, 0], R: 4.2, g: 11, lobes: [[0.5, 0.6, 0.6, 0.04, 4], [-0.6, 0.3, 0.7, -0.05, 6], [0.7, 0.2, -0.6, 0.06, 3]] }], tee: { p: 0, d: [0, 1, 0] }, cup: { p: 0, d: [0.4, -0.3, 0.85], r: 0.6 } };
    const h = prepareHole(data);
    world.setHole(h, 9);
    gfx.setSky(-0.55, 0.7, 0.55, 12);
    const b = makeBall(h, 0, [0, 1, 0]);
    const view = new BallView(gfx, LOOK, false, { scale: num('s', 3.2), cues: false });
    const p = ballPos(h, b, [0, 0, 0]);
    const top = v(p).addScaledVector(new THREE.Vector3(0, 1, 0), (num('s', 3.2) - 1) * 0.35);
    view.update(h, 0, top.x, top.y, top.z, 0, 0, 0, DT, false, 1);
    fov = num('fov', 38);
    place(gfx, new THREE.Vector3(num('ex', 2.5), num('ey', 7.4), num('ez', 12.5)), new THREE.Vector3(0, num('ty', 2.6), 0), new THREE.Vector3(0, 1, 0), fov);
    world.holeView.cup.visible = false;
  }
  world.holeView.update(0, 0, true);
  gfx.resize();
  gfx.camera.fov = fov;
  gfx.camera.updateProjectionMatrix();
  backdrop.update(0.016, gfx.camera.position, true);
  // A few frames so lazy shader compiles and the sky bake finish, then flag ready.
  for (let i = 0; i < 4; i++) {
    world.holeView.update(0, 0, true);
    gfx.render();
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__posterReady = true;
}

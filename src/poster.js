// Store art from the game's own renderer: ?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>.
// Deterministic scenes, no SDK, no network; sets window.__posterReady when the frame is drawn.
import * as THREE from 'three';
import { Gfx, PALETTE } from './render/gfx.js';
import { Backdrop } from './render/backdrop.js';
import { World } from './render/world.js';
import { prepareHole, cupPos } from './sim/hole.js';
import { makeBall, launchAt, stepBall, ballPos, DT, FLY, ROLL } from './sim/ball.js';
import { teeShot } from './sim/gen.js';
import library from '../data/holes.json';
import { drawBadge } from './ui/badges.js';

const holeById = (id) => library.holes.find((h) => h.id === id) ?? library.holes[0];
const P = [0, 0, 0];
const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Flies a hole's reference shot until `until(b)` says stop (or `seconds` pass), building the trail in the view. */
function fly(world, h, pid, look, seconds, until = null, offset = null) {
  const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
  b.quiet = true;
  const ref = h.ref;
  teeShot(h, b, ref.t0, offset ?? ref.dir, ref.speed);
  const view = world.ballView(pid, pid === 'me', Number(pid.slice(-1)) || 0);
  if (pid === 'me') view.view.setLook(look);
  const steps = Math.floor(seconds * 120);
  for (let i = 0; i < steps; i++) {
    stepBall(h, b);
    if (i % 2 === 0) {
      ballPos(h, b, P);
      view.view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT * 2, b.mode === FLY || b.mode === ROLL, 1);
    }
    if (until && until(b, i)) break;
  }
  ballPos(h, b, P);
  view.view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT, b.mode === FLY || b.mode === ROLL, 1);
  return { b, p: P.slice(), t: b.t0 + b.step * DT, view };
}

function restOn(world, h, pid, look, planet, dir, index) {
  const b = makeBall(h, planet, dir);
  const view = world.ballView(pid, pid === 'me', index);
  if (pid === 'me') view.view.setLook(look);
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

function unit(a) {
  return v(a).normalize();
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
  const backdrop = new Backdrop(gfx, kind === 'thumb3' ? 3 : kind === 'thumb4' ? 5 : 7);
  const world = new World(gfx);
  const look = { body: PALETTE.cream, stripe: PALETTE.coral, trail: PALETTE.coral, flag: PALETTE.coral };
  world.setLook(look);
  let t = 0;
  if (kind === 'thumb1') {
    // A ball bending round a world toward a distant cup, trail glowing.
    const data = library.holes.find((h) => h.feat === 'sling' && h.grade.flight > 7 && h.grade.flight < 16) ?? holeById('binary-4');
    const h = prepareHole(data);
    world.setHole(h, 4);
    // Stop just past the closest pass to the world the ball swings round.
    let passAt = -1;
    const me = fly(world, h, 'me', look, h.grade.flight, (b, i) => {
      let near = 1e9;
      for (let k = 0; k < h.n; k++) if (k !== h.tee.p && k !== h.cup.p && b.passes[k] < near) near = b.passes[k];
      if (passAt < 0 && near < 6.5) passAt = i;
      return passAt >= 0 && i > passAt + 70;
    });
    t = me.t;
    const cup = v(cupPos(h, t));
    const pos = v(me.p);
    const vel = new THREE.Vector3(me.b.vx, me.b.vy, me.b.vz).normalize();
    // Up: away from the nearest world; eye behind and above the ball, looking a little ahead of it.
    const up = nearestUp(h, t, me.p);
    const eye = pos.clone().addScaledVector(vel, -6).addScaledVector(up, 2.6);
    const target = pos.clone().addScaledVector(vel, 5).lerp(cup, 0.15);
    place(gfx, eye, target, up, 60);
    world.holeView.update(t, 0, true);
    for (let i = 0; i < 3; i++) world.fx.burst(me.p, [up.x, up.y, up.z], 6, { colours: [0xf3e5c3, 0xf06a5c], speed: 1, size: 1.4, decay: 0.01, spread: 1.2 });
  } else if (kind === 'thumb2') {
    // Four balls on one tiny meadow world, shadows under them, the flag ahead.
    const data = library.holes.find((h) => h.world === 'pebble' && h.planets[h.cup.p].k === 'meadow') ?? holeById('pebble-3');
    const h = prepareHole(data);
    world.setHole(h, 3);
    const d = [h.cup.dx, h.cup.dy, h.cup.dz];
    const cup = v(cupPos(h, 0));
    const pl = h.planets[h.cup.p];
    // Balls a few metres short of the cup, spread sideways.
    const upv = unit(d);
    const side = new THREE.Vector3(0, 1, 0).cross(upv).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const back = upv.clone().cross(side).normalize();
    const spots = [[0, 4.5], [1.8, 6.2], [-2.2, 7.4], [3.4, 8.8]];
    let mine = null;
    spots.forEach(([s, bk], i) => {
      const dir = upv.clone().addScaledVector(side, s / pl.R).addScaledVector(back, bk / pl.R).normalize();
      const p = restOn(world, h, i === 0 ? 'me' : `p${i}`, look, h.cup.p, [dir.x, dir.y, dir.z], i);
      if (i === 0) mine = v(p);
    });
    const eye = mine.clone().addScaledVector(back, 7).addScaledVector(upv, 3.2).addScaledVector(side, -1.5);
    place(gfx, eye, mine.clone().lerp(cup, 0.45).addScaledVector(upv, 0.4), upv, 52);
    world.holeView.update(0, 0, true);
  } else if (kind === 'thumb3') {
    // A lava moon: the ball resting on glowing rock, a bounce pad nearby, another world above.
    const data = library.holes.find((h) => h.world === 'lava' && h.planets[h.cup.p].k === 'lava') ?? library.holes.find((h) => h.world === 'lava');
    const h = prepareHole(data);
    world.setHole(h, 5);
    const lava = h.planets.findIndex((p) => p.kind === 'lava');
    const pi = lava >= 0 ? lava : h.cup.p;
    const pl = h.planets[pi];
    // Face the pad if there is one, else the cup side.
    const pad = pl.patches.find((p) => p.type === 'pad');
    const upv = pad ? new THREE.Vector3(pad.ux, pad.uy, pad.uz).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5).normalize() : unit([h.cup.dx, h.cup.dy, h.cup.dz]);
    const p = restOn(world, h, 'me', look, pi, [upv.x, upv.y, upv.z], 0);
    const mine = v(p);
    const padDir = pad ? new THREE.Vector3(pad.ux, pad.uy, pad.uz) : upv;
    const toward = padDir.clone().sub(upv).normalize();
    if (toward.lengthSq() < 0.01) toward.set(1, 0, 0);
    const eye = mine.clone().addScaledVector(toward, -6.5).addScaledVector(upv, 2.6);
    place(gfx, eye, mine.clone().addScaledVector(toward, 4).addScaledVector(upv, 0.5), upv, 55);
    world.holeView.update(0, 0, true);
    world.planets?.forEach?.(() => {});
    gfx.shared.uTime.value = 3.1;
  } else if (kind === 'thumb4') {
    // Wormhole Alley: the ball leaving a portal, the other end glowing across the gap.
    const data = library.holes.find((h) => h.feat === 'warp') ?? holeById('wormhole-4');
    const h = prepareHole(data);
    world.setHole(h, 6);
    const me = fly(world, h, 'me', look, h.grade.flight, (b) => b.warps > 0 && b.wormCool < 50);
    t = me.t;
    const pos = v(me.p);
    const vel = new THREE.Vector3(me.b.vx, me.b.vy, me.b.vz).normalize();
    const w = h.worms[0];
    const exit = v([w.b.x, w.b.y, w.b.z]);
    const entry = v([w.a.x, w.a.y, w.a.z]);
    const up = nearestUp(h, t, me.p);
    const sideways = vel.clone().cross(up).normalize();
    const eye = pos.clone().addScaledVector(sideways, 9).addScaledVector(up, 2.5).addScaledVector(vel, -2);
    place(gfx, eye, pos.clone().lerp(exit, 0.3).lerp(entry, 0.1), up, 58);
    world.holeView.update(t, 0, true);
  } else {
    // The icon: a cream ball with a coral stripe over an orange world on deep green.
    const data = { world: 'pebble', seed: 1, par: 2, planets: [{ k: 'dust', c: [0, 0, 0], R: 8, g: 11, lobes: [[0.2, 0.9, 0.3, 0.07, 4], [-0.6, 0.4, 0.5, -0.05, 6], [0.7, 0.2, -0.6, 0.09, 3]] }], tee: { p: 0, d: [0, 1, 0] }, cup: { p: 0, d: [0.4, 0.3, 0.85], r: 0.6 } };
    const h = prepareHole(data);
    world.setHole(h, 9);
    const p = restOn(world, h, 'me', look, 0, [0, 1, 0], 0);
    const mine = v(p);
    const eye = mine.clone().add(new THREE.Vector3(1.6, 1.5, 2.6));
    place(gfx, eye, mine.clone().add(new THREE.Vector3(0, -0.15, 0)), new THREE.Vector3(0, 1, 0), 36);
    world.holeView.update(0, 0, true);
    world.holeView.cup.visible = false;
  }
  backdrop.update(0.016, gfx.camera.position, true);
  world.fx.update(0.02);
  gfx.resize();
  if (kind === 'icon') {
    gfx.camera.fov = 36;
    gfx.camera.updateProjectionMatrix();
  }
  // Two frames so lazy shader compiles finish, then flag ready.
  for (let i = 0; i < 3; i++) {
    gfx.render();
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__posterReady = true;
}

function nearestUp(h, t, p) {
  const { centersAt, MAX_PLANETS } = sim;
  const c = centersAt(h, t, new Float64Array(MAX_PLANETS * 3));
  let best = 0;
  let bd = 1e18;
  for (let i = 0; i < h.n; i++) {
    const d = (p[0] - c[i * 3]) ** 2 + (p[1] - c[i * 3 + 1]) ** 2 + (p[2] - c[i * 3 + 2]) ** 2 - h.planets[i].R ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return new THREE.Vector3(p[0] - c[best * 3], p[1] - c[best * 3 + 1], p[2] - c[best * 3 + 2]).normalize();
}

import * as sim from './sim/hole.js';

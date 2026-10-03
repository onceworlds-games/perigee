// Store art from the game's own renderer: ?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>.
// Deterministic scenes, no SDK, no network; sets window.__posterReady when the frame is drawn.
import * as THREE from 'three';
import { Gfx, PALETTE } from './render/gfx.js';
import { Backdrop } from './render/backdrop.js';
import { World } from './render/world.js';
import { ChaseCamera } from './render/camera.js';
import { prepareHole, teePos, cupPos } from './sim/hole.js';
import { makeBall, launchAt, stepBall, ballPos, DT, FLY, ROLL } from './sim/ball.js';
import { teeShot } from './sim/gen.js';
import library from '../data/holes.json';
import { drawBadge } from './ui/badges.js';

const hole = (id) => prepareHole(library.holes.find((h) => h.id === id) ?? library.holes[0]);

/** Flies the hole's reference shot for `seconds`, building the trail in the view. */
function flyRef(world, h, pid, look, seconds, offsetDir = null) {
  const b = makeBall(h, h.tee.p, [h.tee.dx, h.tee.dy, h.tee.dz]);
  b.quiet = true;
  const ref = h.ref;
  let dir = ref.dir;
  if (offsetDir) dir = offsetDir;
  teeShot(h, b, ref.t0, dir, ref.speed);
  const view = world.ballView(pid, pid === 'me', Number(pid.slice(-1)) || 0);
  if (pid === 'me') view.view.setLook(look);
  const steps = Math.floor(seconds * 120);
  const P = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    stepBall(h, b);
    if (i % 2 === 0) {
      ballPos(h, b, P);
      view.view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT * 2, b.mode === FLY || b.mode === ROLL, 1);
    }
  }
  ballPos(h, b, P);
  view.view.update(h, b.t0 + b.step * DT, P[0], P[1], P[2], b.vx, b.vy, b.vz, DT, b.mode === FLY || b.mode === ROLL, 1);
  return { b, p: P.slice(), view };
}

function restOn(world, h, pid, look, dir, index) {
  const b = makeBall(h, h.cup.p, dir);
  const view = world.ballView(pid, pid === 'me', index);
  if (pid === 'me') view.view.setLook(look);
  const P = ballPos(h, b, [0, 0, 0]);
  view.view.update(h, 0, P[0], P[1], P[2], 0, 0, 0, DT, false, 1);
  return P;
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
  const backdrop = new Backdrop(gfx, kind === 'thumb3' ? 3 : 7);
  const world = new World(gfx);
  const cam = new ChaseCamera(gfx.camera);
  const look = { body: PALETTE.cream, stripe: PALETTE.coral, trail: PALETTE.coral, flag: PALETTE.coral };
  world.setLook(look);
  const up = (h) => [h.tee.dx, h.tee.dy, h.tee.dz];
  if (kind === 'thumb1') {
    // A ball arcing round a world toward a distant cup, trail glowing.
    const h = hole('binary-4');
    world.setHole(h, 4);
    const me = flyRef(world, h, 'me', look, Math.min(h.grade.flight * 0.55, 7));
    const cup = cupPos(h, me.b.t0 + me.b.step * DT);
    cam.setUp(...up(h), true);
    cam.target.set(me.p[0], me.p[1], me.p[2]);
    cam.faceToward(cup[0], cup[1], cup[2]);
    cam.pitch = 0.2;
    cam.wantDist = cam.dist = 9;
    cam.update(0.016, h, me.b.t0 + me.b.step * DT, me.p[0], me.p[1], me.p[2], me.b.vx, me.b.vy, me.b.vz, false);
    world.holeView.update(me.b.t0 + me.b.step * DT, 0, true);
  } else if (kind === 'thumb2') {
    // Four balls on one tiny meadow world, shadows under them, the flag in the distance.
    const h = hole('pebble-3');
    world.setHole(h, 3);
    const d = [h.tee.dx, h.tee.dy, h.tee.dz];
    const P = restOn(world, h, 'me', look, d, 0);
    const spread = [[0.35, 0.2, 0], [-0.3, 0.15, 0.2], [0.1, -0.1, -0.35]];
    spread.forEach((o, i) => {
      const v = [d[0] + o[0], d[1] + o[1], d[2] + o[2]];
      const l = Math.hypot(...v);
      restOn(world, h, `p${i + 1}`, look, [v[0] / l, v[1] / l, v[2] / l], i + 1);
    });
    const cup = cupPos(h, 0);
    cam.setUp(...d, true);
    cam.target.set(P[0], P[1], P[2]);
    cam.faceToward(cup[0], cup[1], cup[2]);
    cam.pitch = 0.42;
    cam.wantDist = cam.dist = 10;
    cam.update(0.016, h, 0, P[0], P[1], P[2], 0, 0, 0, false);
    world.holeView.update(0, 0, true);
  } else if (kind === 'thumb3') {
    // A lava moon with a bounce pad: a ball mid-flight over glowing cracks.
    const h = hole('lava-5');
    world.setHole(h, 5);
    const me = flyRef(world, h, 'me', look, Math.min(h.grade.flight * 0.35, 4));
    cam.setUp(...up(h), true);
    cam.target.set(me.p[0], me.p[1], me.p[2]);
    const cup = cupPos(h, me.b.t0 + me.b.step * DT);
    cam.faceToward(cup[0], cup[1], cup[2]);
    cam.pitch = 0.35;
    cam.wantDist = cam.dist = 12;
    cam.update(0.016, h, me.b.t0 + me.b.step * DT, me.p[0], me.p[1], me.p[2], me.b.vx, me.b.vy, me.b.vz, false);
    world.holeView.update(me.b.t0 + me.b.step * DT, 0, true);
  } else if (kind === 'thumb4') {
    // The wormhole alley: portals and a ball leaving one.
    const h = hole('wormhole-4');
    world.setHole(h, 6);
    const me = flyRef(world, h, 'me', look, Math.min(h.grade.flight * 0.5, 6));
    cam.setUp(...up(h), true);
    cam.target.set(me.p[0], me.p[1], me.p[2]);
    cam.yaw = 2.2;
    cam.pitch = 0.3;
    cam.wantDist = cam.dist = 14;
    cam.update(0.016, h, me.b.t0 + me.b.step * DT, me.p[0], me.p[1], me.p[2], me.b.vx, me.b.vy, me.b.vz, false);
    world.holeView.update(me.b.t0 + me.b.step * DT, 0, true);
  } else {
    // The icon: the ball big over an orange world.
    const h = hole('pebble-4');
    world.setHole(h, 9);
    const d = [h.tee.dx, h.tee.dy, h.tee.dz];
    const P = restOn(world, h, 'me', look, d, 0);
    cam.setUp(...d, true);
    cam.target.set(P[0], P[1], P[2]);
    cam.yaw = 0.6;
    cam.pitch = 0.55;
    cam.wantDist = cam.dist = 3.2;
    cam.update(0.016, h, 0, P[0], P[1], P[2], 0, 0, 0, false);
    world.holeView.update(0, 0, true);
    gfx.camera.fov = 40;
    gfx.camera.updateProjectionMatrix();
  }
  backdrop.update(0.016, gfx.camera.position, true);
  world.fx.update(0.016);
  gfx.resize();
  if (kind === 'icon') {
    gfx.camera.fov = 40;
    gfx.camera.updateProjectionMatrix();
  }
  // Two frames so lazy shader compiles finish, then flag ready.
  gfx.render();
  await new Promise((r) => requestAnimationFrame(r));
  gfx.render();
  await new Promise((r) => requestAnimationFrame(r));
  gfx.render();
  window.__posterReady = true;
}

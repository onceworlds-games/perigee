// GLSL for the look: a mid-century travel poster. Toon planets lit by one sun (three bands with soft, anti-aliased
// edges, a cool shadow tint, a halftone print in the shadow and a rim in the atmosphere's colour) with surface detail
// drawn per kind (craters, mown stripes, plates, cracks, ice), a screen-space ink outline of constant width, glowing
// atmosphere shells, the striped ball, the ribbon trail, the soft shadow, the cup's beacon and the painted sky.
// Every colour arrives in linear space and leaves through three's output conversion.

const NOISE = /* glsl */ `
  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
    float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 3.7; a *= 0.5; }
    return v;
  }
  // Cellular noise: the offset to the nearest feature point (xyz), its distance (w), the second distance and a
  // random number for the nearest cell.
  vec4 cells(vec3 p, out float f2, out float rnd) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec3 o1 = vec3(0.0);
    float r1 = 0.0;
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 h = hash33(ip + g);
          vec3 o = g + h * 0.85 + 0.075 - fp;
          float d = dot(o, o);
          if (d < d1) { d2 = d1; d1 = d; o1 = o; r1 = h.z; }
          else if (d < d2) d2 = d;
        }
    f2 = sqrt(d2);
    rnd = r1;
    return vec4(o1, sqrt(d1));
  }
`;

// ---------------------------------------------------------------------------------------------------------- planets

export const PLANET_VERT = /* glsl */ `
  attribute float height;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vO;
  varying vec3 vC;
  varying float vH;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vO = position;
    vC = color;
    vH = height;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const PLANET_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vO;
  varying vec3 vC;
  varying float vH;
  uniform vec3 uSun;
  uniform vec3 uRim;
  uniform vec3 uShade;
  uniform vec3 uSpace;
  uniform float uTime;
  uniform float uPx;
  uniform float uSeed;
  uniform float uDetail;
  uniform float uFog;
  uniform vec4 uPatch[4];
  uniform vec4 uPatchT;
  ${NOISE}

  // A crater field: tilts the normal into bowls and out over rims, darkens floors, lightens rims.
  void craters(vec3 dir, float scale, float amount, float seed, inout vec3 n, inout vec3 base) {
    float f2;
    float rnd;
    vec4 c = cells(dir * scale + seed, f2, rnd);
    if (rnd < 0.35) return;
    float r = 0.16 + 0.26 * fract(rnd * 7.13);
    float t = c.w / r;
    if (t > 1.35) return;
    vec3 toC = normalize(c.xyz - n * dot(c.xyz, n) + 1e-5);
    float tilt = t < 1.0 ? 0.85 * smoothstep(0.15, 1.0, t) : -0.55 * (1.0 - (t - 1.0) / 0.35);
    n = normalize(n + toC * tilt * amount);
    base *= t < 1.0 ? 0.9 : 1.0 + 0.06 * (1.0 - (t - 1.0) / 0.35);
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    vec3 dir = normalize(vO);
    vec3 base = vC;
    float spec = 0.0;
    vec3 emit = vec3(0.0);
    float ink = 0.0;

  #if defined(KIND_DUST) || defined(KIND_COMET)
    if (uDetail > 0.5) {
      craters(dir, 3.2, 1.0, uSeed, n, base);
      if (uDetail > 1.5) craters(dir, 7.5, 0.8, uSeed + 11.0, n, base);
    }
    base *= 0.94 + 0.12 * vnoise(dir * 6.0 + uSeed);
  #endif

  #ifdef KIND_MEADOW
    // Mown stripes round a tilted axis and soft mottling: a fairway on a ball.
    vec3 ax = normalize(vec3(0.3 + fract(uSeed * 0.37), 0.8, 0.2 + fract(uSeed * 0.61)));
    float s = dot(dir, ax) * 15.0;
    float sw = fwidth(s) * 1.5;
    float stripe = smoothstep(0.5 - sw, 0.5 + sw, abs(fract(s) - 0.5) * 2.0);
    base *= 0.95 + 0.07 * stripe;
    base *= 0.92 + 0.14 * fbm(dir * 3.5 + uSeed);
    if (uDetail > 1.5) {
      float f2;
      float rnd;
      vec4 c = cells(dir * 9.0 + uSeed, f2, rnd);
      if (rnd > 0.82) base = mix(base, vec3(0.95, 0.85, 0.55), smoothstep(0.12, 0.06, c.w) * 0.8);
    }
  #endif

  #ifdef KIND_MOSS
    float m = fbm(dir * 5.0 + uSeed);
    base *= 0.85 + 0.3 * smoothstep(0.42, 0.62, m);
    if (uDetail > 0.5) {
      float f2;
      float rnd;
      vec4 c = cells(dir * 10.0 + uSeed, f2, rnd);
      vec3 toC = normalize(c.xyz - n * dot(c.xyz, n) + 1e-5);
      n = normalize(n - toC * 0.35 * smoothstep(0.0, 0.5, c.w));
      base *= 0.92 + 0.1 * smoothstep(0.55, 0.1, c.w);
    }
  #endif

  #ifdef KIND_ICE
    float f2;
    float rnd;
    vec4 c = cells(dir * 4.5 + uSeed, f2, rnd);
    float edge = f2 - c.w;
    float ew = fwidth(edge) * 1.2 + 0.004;
    base = mix(base, vec3(1.0), (1.0 - smoothstep(0.03, 0.03 + ew, edge)) * 0.55);
    base *= 0.96 + 0.08 * rnd;
    spec = 1.0;
  #endif

  #ifdef KIND_LAVA
    float f2;
    float rnd;
    vec4 c = cells(dir * 3.6 + uSeed, f2, rnd);
    float edge = f2 - c.w;
    base *= 0.82 + 0.3 * rnd;
    float ew = fwidth(edge) + 0.004;
    float crack = 1.0 - smoothstep(0.05, 0.05 + ew, edge);
    float hot = 1.0 - smoothstep(0.0, 0.16, edge);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + rnd * 6.28);
    emit = vec3(1.0, 0.36, 0.08) * (crack * 1.6 + hot * 0.25) * pulse;
  #endif

  #ifdef KIND_METAL
    // Plates on a cube map of the sphere, with seams and rivets, alternating tones and a hard highlight.
    vec3 a = abs(dir);
    vec2 uv = a.x > a.y && a.x > a.z ? dir.yz / a.x : a.y > a.z ? dir.xz / a.y : dir.xy / a.z;
    vec2 g = uv * 3.0 + 3.0;
    vec2 cellId = floor(g);
    vec2 f = fract(g);
    vec2 fw = fwidth(g) * 1.5;
    vec2 seam = smoothstep(vec2(0.0), fw + 0.02, f) * smoothstep(vec2(0.0), fw + 0.02, 1.0 - f);
    float sm = seam.x * seam.y;
    float tone = hash13(vec3(cellId, uSeed));
    base *= (0.9 + 0.16 * tone) * (0.55 + 0.45 * sm);
    vec2 rv = abs(f - 0.5);
    float rivet = smoothstep(0.06, 0.035, length(rv - 0.38));
    base = mix(base, vec3(0.95, 0.92, 0.85), rivet * 0.6);
    spec = 0.9;
  #endif

  #ifdef KIND_GAS
    // Latitude bands with a slow turbulent wobble.
    vec3 ax = normalize(vec3(0.2, 1.0, 0.15 + fract(uSeed) * 0.3));
    float lat = dot(dir, ax);
    float wob = fbm(dir * 3.0 + vec3(uTime * 0.03, 0.0, uSeed)) - 0.5;
    float b = lat * 6.5 + wob * 1.1;
    float bw = fwidth(b) * 1.2;
    float band = smoothstep(0.5 - bw, 0.5 + bw, fract(b));
    base = mix(base, uRim, band * 0.45);
    base *= 0.88 + 0.2 * smoothstep(0.3, 0.7, fract(b * 0.5 + 0.13));
  #endif

    // Patches: lava pools, ice sheets, bounce pads (a bullseye) and tar.
    for (int i = 0; i < 4; i++) {
      float type = uPatchT[i];
      if (type < 0.5) continue;
      vec4 P = uPatch[i];
      float cd = dot(dir, P.xyz);
      float depth = (cd - P.w) / max(1e-4, 1.0 - P.w);
      float pw = fwidth(depth) * 1.5 + 0.002;
      float inside = smoothstep(-pw, pw, depth);
      if (inside <= 0.0) continue;
      vec3 pc;
      if (type < 1.5) {
        float f2;
        float rnd;
        vec4 c = cells(dir * 11.0 + uSeed, f2, rnd);
        float e = f2 - c.w;
        pc = mix(vec3(0.95, 0.32, 0.08), vec3(1.0, 0.8, 0.35), 1.0 - smoothstep(0.0, 0.12, e));
        pc *= 0.85 + 0.15 * sin(uTime * 2.3 + rnd * 6.28);
        emit = mix(emit, pc * 0.9, inside);
        pc = mix(vec3(0.12, 0.05, 0.03), pc, smoothstep(0.0, 0.18, depth));
      } else if (type < 2.5) {
        pc = mix(vec3(0.62, 0.86, 0.92), vec3(0.95, 0.99, 1.0), smoothstep(0.85, 0.2, depth));
        spec = max(spec, 1.0);
      } else if (type < 3.5) {
        float r = depth * 4.0;
        float rw = fwidth(r) * 1.5;
        float ring = smoothstep(0.5 - rw, 0.5 + rw, abs(fract(r) - 0.5) * 2.0);
        pc = mix(vec3(0.94, 0.32, 0.26), vec3(0.98, 0.92, 0.78), ring);
      } else {
        pc = vec3(0.02, 0.03, 0.03);
        spec = max(spec, 1.4);
      }
      base = mix(base, pc, inside);
      ink = max(ink, (1.0 - smoothstep(0.0, 0.06 + pw, abs(depth))) * 0.55);
    }

    // The toon ramp: lit, mid and a cool shadow, with soft edges.
    float ndl = dot(n, uSun);
    float w = fwidth(ndl) * 1.3 + 0.004;
    float lit = smoothstep(0.3 - w, 0.3 + w, ndl);
    float mid = smoothstep(-0.18 - w, -0.18 + w, ndl);
    vec3 col = mix(base * uShade, mix(base * 0.8, base * 1.06, lit), mid);
    // A halftone print in the shadow: the poster's screen of dots.
    if (uDetail > 0.5) {
      vec2 px = gl_FragCoord.xy / max(1.0, uPx);
      vec2 gc = fract(mat2(0.707, -0.707, 0.707, 0.707) * px / 5.0) - 0.5;
      float dotR = 0.34 * (1.0 - mid);
      float hd = smoothstep(dotR, dotR - 0.08, length(gc));
      col *= 1.0 - hd * 0.16;
    }
    if (spec > 0.0) {
      vec3 h = normalize(uSun + v);
      float sp = dot(n, h);
      float sw = fwidth(sp) + 0.002;
      col += vec3(1.0, 0.97, 0.9) * smoothstep(0.965 - sw, 0.965 + sw, sp) * 0.55 * spec * mid;
    }
    // The rim in the atmosphere's colour, stronger toward the sun.
    float fr = 1.0 - max(dot(n, v), 0.0);
    float rim = smoothstep(0.62, 0.98, fr);
    col += uRim * rim * (0.14 + 0.36 * clamp(ndl * 0.6 + 0.5, 0.0, 1.0));
    col *= 1.0 - ink;
    col += emit;
    // Distance: far worlds sink a little into the sky.
    float dist = length(cameraPosition - vW);
    col = mix(col, uSpace, clamp((dist - 40.0) / 220.0, 0.0, 0.35) * uFog);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// A constant-width ink line: the back faces pushed outward in screen space.
export const OUTLINE_VERT = /* glsl */ `
  uniform float uWidth;
  uniform float uPx;
  uniform vec2 uRes;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 nv = normalize(normalMatrix * normal);
    vec2 d = nv.xy;
    float l = length(d);
    d = l > 1e-4 ? d / l : vec2(0.0);
    clip.xy += d * uWidth * uPx * 2.0 / uRes * clip.w;
    gl_Position = clip;
  }
`;

export const OUTLINE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(uColor, uAlpha);
    #include <colorspace_fragment>
  }
`;

export const SHELL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// The atmosphere: the back of a shell, brightest at the planet's limb and fading to nothing at the shell's edge,
// warmer on the day side.
export const ATMO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vW;
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uStrength;
  uniform float uFmax;
  uniform float uPower;
  uniform vec3 uCenter;
  uniform float uShellR;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float f = clamp(-dot(n, v) / uFmax, 0.0, 1.0);
    float a = pow(f, uPower) * smoothstep(1.0, 0.93, f);
    float day = clamp(dot(n, uSun) * 0.55 + 0.6, 0.2, 1.15);
    // Close to the world the halo would fill the sky: keep only a thin line at the horizon.
    float D = length(cameraPosition - uCenter) / uShellR;
    float near = smoothstep(1.05, 2.6, D);
    a *= mix(pow(f, 6.0) * 0.6, 1.0, near);
    gl_FragColor = vec4(uColor * a * uStrength * day, 1.0);
    #include <colorspace_fragment>
  }
`;

// A flat ring (a gas giant's rings, the black hole's disc): bands by radius, lit by the sun's side.
export const DISC_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const DISC_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vW;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uInner;
  uniform float uTime;
  uniform float uSpin;
  uniform float uAlpha;
  uniform vec3 uCenter;
  uniform float uShadowR;
  uniform vec3 uSun;
  ${NOISE}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0 || r < uInner) discard;
    float t = (r - uInner) / (1.0 - uInner);
    float ang = atan(p.y, p.x);
    float bands = vnoise(vec3(t * 18.0, 0.0, 1.0)) * 0.6 + vnoise(vec3(t * 55.0, 3.0, 0.0)) * 0.4;
    float streak = uSpin > 0.0 ? vnoise(vec3(t * 6.0, ang * 3.0 + uTime * uSpin, 2.0)) : 0.5;
    vec3 col = mix(uA, uB, smoothstep(0.25, 0.75, bands));
    col *= 0.75 + 0.5 * streak;
    float a = uAlpha * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t) * (0.55 + 0.45 * bands);
    // The planet's shadow across the ring (away from the sun).
    vec3 q = vW - uCenter;
    float along = dot(q, -uSun);
    float off = length(q + uSun * along);
    if (uShadowR > 0.0 && along > 0.0 && off < uShadowR) col *= 0.35;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

// ------------------------------------------------------------------------------------------------------------- ball

export const BALL_VERT = /* glsl */ `
  attribute float height;
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vH = height;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Cream with a coral stripe (in its own frame, so it rolls), toon lit with a glossy highlight.
export const BALL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  uniform vec3 uSun;
  uniform vec3 uBody;
  uniform vec3 uStripe;
  uniform vec3 uRim;
  uniform float uAlpha;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float sw = fwidth(vH) * 1.2;
    float stripe = smoothstep(0.17 + sw, 0.17 - sw, abs(vH));
    vec3 base = mix(uBody, uStripe, stripe);
    float ndl = dot(n, uSun);
    float w = fwidth(ndl) + 0.01;
    float lit = smoothstep(0.25 - w, 0.25 + w, ndl);
    float mid = smoothstep(-0.25 - w, -0.25 + w, ndl);
    vec3 col = mix(base * vec3(0.5, 0.58, 0.62), mix(base * 0.84, base * 1.04, lit), mid);
    vec3 h = normalize(uSun + v);
    float sp = dot(n, h);
    col += vec3(1.0) * smoothstep(0.955, 0.97, sp) * 0.6;
    float fr = 1.0 - max(dot(n, v), 0.0);
    col += uRim * smoothstep(0.55, 1.0, fr) * 0.35;
    gl_FragColor = vec4(col, uAlpha);
    #include <colorspace_fragment>
  }
`;

// The trail: a ribbon that fades with age and softens at its edges, hotter near the ball.
export const TRAIL_VERT = /* glsl */ `
  attribute float fade;
  attribute float side;
  varying float vF;
  varying float vS;
  void main() {
    vF = fade;
    vS = side;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const TRAIL_FRAG = /* glsl */ `
  precision highp float;
  varying float vF;
  varying float vS;
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    float edge = 1.0 - vS * vS;
    float a = pow(vF, 1.6) * smoothstep(0.0, 0.6, edge) * uAlpha;
    vec3 col = mix(uColor, vec3(1.0, 0.96, 0.86), pow(vF, 6.0) * 0.55 * edge);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

// The shadow under the ball: a soft dark disc with a firmer core.
export const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SHADOW_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uSoft;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float a = smoothstep(1.0, uSoft, r);
    gl_FragColor = vec4(uColor, a * uAlpha);
    #include <colorspace_fragment>
  }
`;

// The cup's beacon: a column of light that thins and fades upward, gone when the camera is close.
export const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const BEAM_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vW;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  void main() {
    float y = vUv.y;
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float a = pow(1.0 - y, 2.2) * smoothstep(0.0, 0.7, edge);
    float pulse = 0.8 + 0.2 * sin(uTime * 2.4 - y * 9.0);
    gl_FragColor = vec4(uColor * a * pulse * uAlpha, 1.0);
    #include <colorspace_fragment>
  }
`;

// The flag waves.
export const FLAG_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(uTime * 3.2 + uv.x * 5.0) * 0.09 * uv.x;
    p.y += sin(uTime * 2.1 + uv.x * 3.0) * 0.03 * uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const FLAG_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  void main() {
    float shade = 0.86 + 0.14 * sin(vUv.x * 5.0);
    gl_FragColor = vec4(uColor * shade, 1.0);
    #include <colorspace_fragment>
  }
`;

// ------------------------------------------------------------------------------------------------------------- sky

export const SKY_VERT = /* glsl */ `
  varying vec3 vD;
  void main() {
    vD = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

// Deep pine-black with a lighter band, huge soft nebulae in teal, burnt orange and rose (domain-warped so they
// read as painted clouds, not noise), dark dust lanes and a pale sun with a wide warm halo.
export const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vD;
  uniform vec3 uBase;
  uniform vec3 uDeep;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uSun;
  uniform vec3 uSunCol;
  uniform vec3 uBand;
  uniform vec3 uOff;
  ${NOISE}
  void main() {
    vec3 d = normalize(vD);
    float band = exp(-pow(dot(d, uBand) * 2.4, 2.0));
    vec3 col = mix(uDeep, uBase, 0.35 + 0.65 * band);
    vec3 q = d * 1.25 + uOff;
    vec3 w = vec3(fbm(q + 3.1), fbm(q + 7.7), fbm(q + 1.3));
    float n1 = fbm(q * 1.05 + w * 1.7);
    float n2 = fbm(q * 1.6 - w * 1.3 + 5.0);
    float n3 = fbm(q * 2.4 + w * 0.8 + 9.0);
    float lane = smoothstep(0.52, 0.66, fbm(q * 3.2 + w * 2.0 + 13.0));
    col = mix(col, uA, smoothstep(0.38, 0.78, n1) * (0.42 + 0.4 * band));
    col = mix(col, uB, smoothstep(0.46, 0.84, n2) * (0.28 + 0.3 * band) * (1.0 - lane * 0.6));
    col = mix(col, uC, smoothstep(0.5, 0.86, n3 * (0.6 + n1 * 0.6)) * 0.3);
    col *= 1.0 - lane * 0.35 * band;
    float s = max(dot(d, uSun), 0.0);
    float disc = smoothstep(0.99935, 0.99955, s);
    col = mix(col, uSunCol, disc);
    col += uSunCol * (pow(s, 90.0) * 0.22 + pow(s, 12.0) * 0.07 + pow(s, 3.0) * 0.035);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// Stars twinkle at a fixed size; sparkles are a few bright four-point stars, the atlas way.
export const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  varying float vA;
  uniform float uTime;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.7 + 0.3 * sin(uTime * 1.3 + phase);
    vA = tw;
    gl_PointSize = size * uScale * (0.85 + 0.15 * tw);
    gl_Position = projectionMatrix * mv;
  }
`;

export const STAR_FRAG = /* glsl */ `
  precision highp float;
  varying float vA;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float a = smoothstep(0.5, 0.05, r) * vA;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export const SPARKLE_FRAG = /* glsl */ `
  precision highp float;
  varying float vA;
  uniform vec3 uColor;
  void main() {
    vec2 c = abs(gl_PointCoord - 0.5) * 2.0;
    float cross = max(smoothstep(0.16, 0.0, c.x * (0.25 + c.y * 3.0)), smoothstep(0.16, 0.0, c.y * (0.25 + c.x * 3.0)));
    float core = smoothstep(0.3, 0.0, length(c));
    float a = clamp(cross * (1.0 - length(c) * 0.8) + core, 0.0, 1.0) * vA;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// Dust among the worlds: sized by distance, so it slides past the camera (parallax) and streaks a fast flight.
export const DUST_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float uScale;
  uniform float uTime;
  varying float vA;
  void main() {
    vec3 p = position + vec3(sin(uTime * 0.05 + phase) * 1.5, cos(uTime * 0.04 + phase * 1.3) * 1.0, sin(uTime * 0.03 + phase * 0.7) * 1.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float z = max(-mv.z, 0.5);
    vA = smoothstep(90.0, 20.0, z) * smoothstep(0.8, 3.0, z);
    gl_PointSize = clamp(size * uScale * 28.0 / z, 0.0, 9.0 * uScale);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DUST_FRAG = /* glsl */ `
  precision highp float;
  varying float vA;
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r) * vA * uAlpha;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// --------------------------------------------------------------------------------------------------------- preview

export const DOT_VERT = /* glsl */ `
  attribute float fade;
  uniform float uPx;
  varying float vF;
  void main() {
    vF = fade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp((2.6 * fade + 1.6) * (70.0 / max(-mv.z, 1.0)), 2.5, 13.0) * uPx;
    gl_Position = projectionMatrix * mv;
  }
`;

export const DOT_FRAG = /* glsl */ `
  precision highp float;
  varying float vF;
  uniform vec3 uColor;
  uniform vec3 uInk;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    vec3 col = mix(uInk, uColor, smoothstep(0.5, 0.36, r));
    float a = smoothstep(0.5, 0.42, r) * (0.35 + 0.65 * vF);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

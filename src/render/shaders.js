// GLSL for the look: a three-band toon ramp with a rim, an inverted-hull outline, additive atmosphere shells,
// the striped ball, gas giants, lava cracks and the nebula sky. Colours arrive as uniforms or vertex colours.

export const TOON_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying float vH;
  attribute float height;
  void main() {
    vN = normalize(normalMatrix * normal);
    vC = color;
    vH = height;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Three bands plus a rim; `uGlow` paints emissive cracks where the vertex colour's red channel says lava.
export const TOON_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying float vH;
  uniform vec3 uLight;
  uniform vec3 uRim;
  uniform float uTime;
  uniform float uGlow;
  uniform float uGloss;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec3(1,0,0)), c = hash(i + vec3(0,1,0)), d = hash(i + vec3(1,1,0));
    float e = hash(i + vec3(0,0,1)), g = hash(i + vec3(1,0,1)), h = hash(i + vec3(0,1,1)), k = hash(i + vec3(1,1,1));
    return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
  }
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float d = dot(n, normalize(uLight));
    // Three bands: a warm lit face, a mid tone and a cool shadow, like a printed poster.
    vec3 band = d > 0.42 ? vec3(1.18, 1.12, 1.0) : (d > -0.08 ? vec3(0.86, 0.86, 0.84) : vec3(0.5, 0.56, 0.62));
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 col = vC * band;
    col += uRim * rim * 0.45;
    if (uGloss > 0.0) {
      vec3 h = normalize(normalize(uLight) + v);
      float s = pow(max(dot(n, h), 0.0), 40.0);
      col += vec3(1.0) * s * uGloss * (d > 0.0 ? 1.0 : 0.0);
    }
    if (uGlow > 0.0) {
      float c = noise(vW * 1.6 + vec3(0.0, uTime * 0.05, 0.0));
      float crack = smoothstep(0.47, 0.5, c) * (1.0 - smoothstep(0.5, 0.53, c));
      float pulse = 0.75 + 0.25 * sin(uTime * 2.0 + vW.x);
      col = mix(col, vec3(1.0, 0.45, 0.15) * pulse, crack * uGlow);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const OUTLINE_VERT = /* glsl */ `
  uniform float uWidth;
  void main() {
    vec3 p = position + normal * uWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const OUTLINE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, 1.0); }
`;

export const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const ATMO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vW;
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uStrength;
  void main() {
    vec3 v = normalize(cameraPosition - vW);
    float f = pow(1.0 - abs(dot(normalize(vN), v)), uPower);
    gl_FragColor = vec4(uColor, f * uStrength);
  }
`;

// Gas giants: latitude stripes in two colours, a dark band, a toon ramp and a strong rim.
export const GAS_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying float vH;
  uniform vec3 uLight;
  uniform vec3 uRim;
  uniform vec3 uColor2;
  uniform float uTime;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float d = dot(n, normalize(uLight));
    float band = d > 0.4 ? 1.15 : (d > -0.1 ? 0.82 : 0.55);
    float lat = vH * 7.0 + sin(vH * 23.0 + uTime * 0.2) * 0.3;
    float s = step(0.5, fract(lat));
    vec3 base = mix(vC, uColor2, s);
    float dark = smoothstep(0.05, 0.0, abs(fract(lat * 0.5) - 0.5) - 0.1);
    base *= 1.0 - dark * 0.18;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    gl_FragColor = vec4(base * band + uRim * rim * 0.5, 1.0);
  }
`;

// The ball: cream with a coral stripe round its middle (in its own frame), toon lit.
export const BALL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying float vH;
  uniform vec3 uLight;
  uniform vec3 uRim;
  uniform vec3 uStripe;
  uniform float uAlpha;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float d = dot(n, normalize(uLight));
    float band = d > 0.4 ? 1.12 : (d > -0.1 ? 0.82 : 0.58);
    float stripe = smoothstep(0.12, 0.09, abs(vH)) ;
    vec3 col = mix(vC, uStripe, stripe) * band;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += uRim * rim * 0.3;
    gl_FragColor = vec4(col, uAlpha);
  }
`;

// The sky: deep pine-black with soft nebula shapes in teal, orange and rose, drawn on the inside of a far sphere.
export const SKY_VERT = /* glsl */ `
  varying vec3 vD;
  void main() {
    vD = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

export const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vD;
  uniform vec3 uBase;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform float uSeed;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + uSeed) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec3(1,0,0)), c = hash(i + vec3(0,1,0)), d = hash(i + vec3(1,1,0));
    float e = hash(i + vec3(0,0,1)), g = hash(i + vec3(1,0,1)), h = hash(i + vec3(0,1,1)), k = hash(i + vec3(1,1,1));
    return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.1 + 3.7; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = vD;
    float n1 = fbm(d * 1.5 + 11.0);
    float n2 = fbm(d * 2.1 - 5.0);
    float n3 = fbm(d * 1.2 + 29.0);
    vec3 col = uBase;
    col = mix(col, uA, smoothstep(0.42, 0.7, n1) * 0.95);
    col = mix(col, uB, smoothstep(0.47, 0.74, n2) * 0.85);
    col = mix(col, uC, smoothstep(0.5, 0.76, n3) * 0.7);
    // A faint band of dust across the sky.
    float band = exp(-pow((d.y + 0.15) * 3.0, 2.0)) * 0.08;
    col += vec3(band);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const STAR_VERT = /* glsl */ `
  attribute float size;
  attribute float phase;
  varying float vA;
  uniform float uTime;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.75 + 0.25 * sin(uTime * 1.3 + phase);
    vA = tw;
    gl_PointSize = size * uScale * tw;
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
    float a = smoothstep(0.5, 0.1, r) * vA;
    gl_FragColor = vec4(uColor, a);
  }
`;

export const DOT_VERT = /* glsl */ `
  attribute float fade;
  varying float vF;
  void main() {
    vF = fade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(16.0, (3.5 * fade + 1.5) * (60.0 / max(-mv.z, 1.0)));
    gl_Position = projectionMatrix * mv;
  }
`;

export const DOT_FRAG = /* glsl */ `
  precision highp float;
  varying float vF;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.3, r) * (0.25 + 0.75 * vF);
    gl_FragColor = vec4(uColor, a);
  }
`;

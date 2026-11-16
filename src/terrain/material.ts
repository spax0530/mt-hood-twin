import * as THREE from 'three';

/** Uniforms shared by every terrain tile, owned by the environment module. */
export interface SharedUniforms {
  uSun: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uHazeColor: { value: THREE.Color };
  uHaze: { value: number };
  uRuns: { value: number };
}

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uNormal;
uniform sampler2D uImg;
uniform float uHasImg;
uniform sampler2D uOverlay;
uniform float uHasOverlay;
uniform float uRuns;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHazeColor;
uniform float uHaze;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
  float h = vWorld.y;
  float slope = 1.0 - n.y;
  float big = fbm(vWorld.xz * 0.004);
  float fine = noise(vWorld.xz * 0.18);

  // Exposed rock and ice where it is too steep for snow to hold (about 42 to 53 degrees and up)
  float rock = smoothstep(0.26, 0.40, slope + (big - 0.5) * 0.14);

  // Conifer forest below treeline (about 6,000 ft on Mt Hood, with natural variation)
  float treeline = 1850.0 + (noise(vWorld.xz * 0.0015) - 0.5) * 260.0;
  float below = 1.0 - smoothstep(treeline - 140.0, treeline + 60.0, h);
  float tree;
  if (uHasImg > 0.5) {
    // Summer aerial imagery tells us where the trees really are: dark and green means canopy,
    // so cleared ski runs, roads, lakes and parking lots stay open snow.
    vec3 c = texture2D(uImg, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    tree = smoothstep(0.17, 0.07, lum) * step(c.r * 0.94, c.g);
  } else {
    tree = smoothstep(0.38, 0.58, big);
  }
  tree *= below * (1.0 - rock);

  vec3 snow = vec3(0.90, 0.93, 0.97);
  vec3 rockCol = mix(vec3(0.085, 0.078, 0.075), vec3(0.21, 0.19, 0.18), big);
  rockCol = mix(rockCol, snow, 0.25 * fine); // snow caught on ledges
  vec3 treeCol = mix(vec3(0.016, 0.042, 0.024), snow, 0.08 + 0.26 * fine); // snow-loaded canopy

  vec3 albedo = mix(snow, rockCol, rock);
  albedo = mix(albedo, treeCol, tree);

  if (uHasOverlay > 0.5) {
    vec4 o = texture2D(uOverlay, vUv);
    albedo = mix(albedo, o.rgb, o.a * uRuns);
  }

  float ndl = max(dot(n, uSun), 0.0);
  vec3 col = albedo * (uSunColor * ndl + uSkyColor * (0.35 + 0.65 * n.y));

  float d = distance(vWorld, cameraPosition);
  col = mix(col, uHazeColor, 1.0 - exp(-d * uHaze));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blank.needsUpdate = true;

export function makeTerrainMaterial(shared: SharedUniforms, normalTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
    uniforms: {
      ...shared,
      uNormal: { value: normalTex },
      uImg: { value: blank },
      uHasImg: { value: 0 },
      uOverlay: { value: blank },
      uHasOverlay: { value: 0 },
    },
  });
}

/// <reference path="./n8ao.d.ts" />
// How a generated world is lit and finished, the way a 3D film is: light that comes from its own sky, the subject always
// lit whatever the set's mood, creases darkened, the lens focused on the subject, glowing things blooming, then a
// filmic tone curve, a grade, a vignette and grain. None of it is in the spec: every world gets it.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BloomEffect, DepthOfFieldEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import type { WorldLocation } from "@moco/spec";

// ---------- light from the sky ----------

const ENV_VERTEX = `varying vec3 direction; void main() { direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ENV_FRAGMENT = `
  varying vec3 direction;
  uniform vec3 sun, sunColour, top, middle, horizon, ground;
  void main() {
    vec3 ray = normalize(direction);
    vec3 colour = ray.y > 0.0
      ? mix(mix(horizon, middle, smoothstep(0.0, 0.2, ray.y)), top, smoothstep(0.2, 0.8, ray.y))
      : mix(horizon, ground, smoothstep(0.0, -0.25, ray.y));
    // A broad soft sun and a few studio panels: round shapes pick up highlights from them, which reads as form.
    colour += sunColour * pow(max(dot(ray, sun), 0.0), 24.0) * 6.0;
    colour += vec3(1.0) * smoothstep(0.82, 0.9, dot(ray, normalize(vec3(-0.6, 0.5, 0.6)))) * 1.4;
    colour += vec3(1.0) * smoothstep(0.86, 0.92, dot(ray, normalize(vec3(0.7, 0.35, -0.6)))) * 0.9;
    gl_FragColor = vec4(colour, 1.0);
  }
`;

// Dark skies still need some light to bounce: a black studio makes black models. Floors are lifted, hues kept.
function lifted(hex: string, floor: number): THREE.Color {
  const colour = new THREE.Color(hex);
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  return colour.setHSL(hsl.h, hsl.s, Math.max(hsl.l, floor));
}

// The location's sky as an environment map, so reflections and soft light carry its colours.
export function SkyEnvironment({ sky, ground, sun }: { sky: WorldLocation["sky"]; ground: string; sun: [number, number, number] }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const room = new THREE.Scene();
    const uniforms = {
      sun: { value: new THREE.Vector3(...sun).normalize() },
      sunColour: { value: new THREE.Color(sky.sunColour).multiplyScalar(Math.min(1.5, 0.4 + sky.sunStrength * 0.3)) },
      top: { value: lifted(sky.top, 0.22) },
      middle: { value: lifted(sky.middle, 0.26) },
      horizon: { value: lifted(sky.horizon, 0.3) },
      ground: { value: lifted(ground, 0.12) },
    };
    room.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ vertexShader: ENV_VERTEX, fragmentShader: ENV_FRAGMENT, uniforms, side: THREE.BackSide })));
    const generator = new THREE.PMREMGenerator(gl);
    const target = generator.fromScene(room, 0.02);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.6;
    return () => {
      scene.environment = null;
      target.dispose();
      generator.dispose();
    };
  }, [gl, scene, sky, ground, sun]);
  return null;
}

// ---------- the subject's own light ----------

// A key from the camera's side and a rim from behind, placed from the lens each frame. A dim set stays dim around the
// subject, but the subject reads: every animated film lights its characters separately from the set. They are set
// against the exposure, like on a film set, so a bright lamp behind the subject doesn't leave it a silhouette.
export function SubjectLights({ eye, target, height, sky, exposure }: { eye: THREE.Vector3; target: THREE.Vector3; height: number; sky: WorldLocation["sky"]; exposure: number }) {
  const { key, rim } = useMemo(() => ({ key: new THREE.DirectionalLight(), rim: new THREE.DirectionalLight() }), []);
  const towards = target.clone().sub(eye).setY(0).normalize();
  const side = new THREE.Vector3(towards.z, 0, -towards.x);
  const reach = Math.max(4, height * 4);
  // Key: up and to one side of the camera, 45° off the lens axis.
  key.position.copy(target).addScaledVector(towards, -reach).addScaledVector(side, reach * 0.8).add(new THREE.Vector3(0, reach * 0.7, 0));
  key.target.position.copy(target);
  key.color.set("#fff4e6");
  key.intensity = keyStrength(sky) / Math.min(exposure, 1);
  // Rim: behind and above, in the sky's colour, to split the subject from the background.
  rim.position.copy(target).addScaledVector(towards, reach).addScaledVector(side, -reach * 0.5).add(new THREE.Vector3(0, reach * 0.9, 0));
  rim.target.position.copy(target);
  rim.color.copy(lifted(sky.top, 0.7));
  rim.intensity = 1.6 / Math.min(exposure, 1);
  key.target.updateMatrixWorld();
  rim.target.updateMatrixWorld();
  return (
    <>
      <primitive object={key} />
      <primitive object={key.target} />
      <primitive object={rim} />
      <primitive object={rim.target} />
    </>
  );
}

const keyStrength = (sky: WorldLocation["sky"]) => THREE.MathUtils.clamp(1.8 - sky.sunStrength * 0.5, 0.6, 1.6);

// ---------- exposure ----------

// A camera exposes for the subject. The AI sets lamps by feel (140 a metre from a face is common), so the light
// reaching `point` is added up the way three.js falls it off, and the exposure brings it to a well-lit level.
// Worked out, not measured, so every frame of a shot and every render of it come out the same.
const WELL_LIT = 4;
export function exposureAt(location: WorldLocation, point: THREE.Vector3): number {
  const { sky } = location;
  const sun = sky.sunStrength * Math.max(0.3, Math.sin(THREE.MathUtils.degToRad(sky.sunElevation)));
  const lamps = location.lamps.reduce((total, lamp) => {
    const distance = Math.max(point.distanceTo(new THREE.Vector3(...lamp.at)), 0.4);
    const window = Math.max(0, 1 - (distance / lamp.reach) ** 4) ** 2;
    return total + (lamp.strength / distance ** 2) * window * 0.6; // a lamp is rarely square on to the subject
  }, 0);
  const light = sun + sky.fill + 0.6 * 0.5 + keyStrength(sky) + lamps;
  // Dim sets may stay a little dim (that is their mood), bright ones are brought right down.
  return THREE.MathUtils.clamp(WELL_LIT / light, 0.03, 1.5);
}

class ExposureEffect extends Effect {
  constructor() {
    super("ExposureEffect", "uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }", {
      uniforms: new Map([["exposure", new THREE.Uniform(1)]]),
    });
  }
}

// ---------- camera motion blur ----------

// Each pixel is traced back to where it was on screen half a frame earlier (a 180° shutter), from the depth buffer and
// the camera's previous view, and smeared along that path. One pass in one canvas: the usual way, averaging six
// whole renders, costs four times as much on a 3D stage.
const BLUR_FRAGMENT = `
  uniform mat4 inverseViewProjection;
  uniform mat4 previousViewProjection;
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec4 world = inverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    world /= world.w;
    vec4 before = previousViewProjection * world;
    vec2 trail = (before.xy / before.w * 0.5 + 0.5) - uv;
    // A cut or a camera through the subject would smear the whole frame: cap the trail.
    float length = length(trail);
    if (length > 0.06) trail *= 0.06 / length;
    if (length < 0.0005) { outputColor = inputColor; return; }
    vec4 sum = inputColor;
    for (int index = 1; index < 10; index++) sum += texture2D(inputBuffer, uv + trail * (float(index) / 9.0));
    outputColor = sum / 10.0;
  }
`;

class CameraBlurEffect extends Effect {
  constructor() {
    super("CameraBlurEffect", BLUR_FRAGMENT, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map([["inverseViewProjection", new THREE.Uniform(new THREE.Matrix4())], ["previousViewProjection", new THREE.Uniform(new THREE.Matrix4())]]),
    });
  }
}

export interface LensState {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

// ---------- ink outlines (toon) ----------

// A dark line wherever depth jumps between neighbouring pixels: silhouettes and the edges of parts in front of others.
const INK_FRAGMENT = `
  float viewDepth(const in vec2 at) { return getViewZ(readDepth(at)); }
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    float here = viewDepth(uv);
    vec2 step = texelSize * 2.0;
    float jump = 0.0;
    jump = max(jump, abs(viewDepth(uv + vec2(step.x, 0.0)) - here));
    jump = max(jump, abs(viewDepth(uv - vec2(step.x, 0.0)) - here));
    jump = max(jump, abs(viewDepth(uv + vec2(0.0, step.y)) - here));
    jump = max(jump, abs(viewDepth(uv - vec2(0.0, step.y)) - here));
    float ink = smoothstep(0.012, 0.04, jump / max(abs(here), 0.001));
    outputColor = vec4(mix(inputColor.rgb, vec3(0.03, 0.025, 0.03), ink * 0.92), inputColor.a);
  }
`;

class InkEffect extends Effect {
  constructor() {
    super("InkEffect", INK_FRAGMENT, { attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION });
  }
}

// ---------- grade and grain ----------

const GRADE_FRAGMENT = `
  uniform float seed;
  uniform float grain;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 colour = clamp(inputColor.rgb, 0.0, 1.0);
    vec3 shown = pow(colour, vec3(1.0 / 2.2));
    // A gentle S-curve for contrast, a little more saturation, warm highlights and cool shadows.
    shown = mix(shown, shown * shown * (3.0 - 2.0 * shown), 0.35);
    float light = dot(shown, vec3(0.2126, 0.7152, 0.0722));
    shown = mix(vec3(light), shown, 1.12);
    shown += mix(vec3(-0.012, 0.0, 0.02), vec3(0.025, 0.01, -0.02), smoothstep(0.2, 0.8, light));
    shown += (hash(uv * 1024.0) - 0.5) * grain;
    outputColor = vec4(pow(clamp(shown, 0.0, 1.0), vec3(2.2)), inputColor.a);
  }
`;

class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", GRADE_FRAGMENT, { uniforms: new Map<string, THREE.Uniform>([["seed", new THREE.Uniform(0)], ["grain", new THREE.Uniform(0.028)]]) });
  }
}

// ---------- the composer ----------

// How soft the background goes, by how tight the lens is: a close-up is shot on a long lens wide open.
function bokehFor(fov: number): number {
  return THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(fov, 46, 28, 0.4, 2.5), 0.4, 2.5);
}

// Draws the frame through the finishing passes instead of straight to the screen. `focus` is the point the lens is on.
export function Finish({ focus, fov, subjectHeight, exposure, frame, previous, toon = false }: { focus: THREE.Vector3; fov: number; subjectHeight: number; exposure: number; frame: number; previous: LensState; toon?: boolean }) {
  const { gl, scene, camera, size } = useThree();
  const passes = useMemo(() => {
    // The tone curve is a pass at the end, so the renderer must hand it untouched light.
    gl.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new RenderPass(scene, camera));
    const ao = new N8AOPostPass(scene, camera, size.width, size.height);
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.denoiseSamples = 4;
    ao.configuration.intensity = 3;
    composer.addPass(ao);
    // Exposure before anything that looks at brightness, so bloom picks out what is bright after it.
    const exposed = new ExposureEffect();
    composer.addPass(new EffectPass(camera, exposed));
    const blur = new CameraBlurEffect();
    composer.addPass(new EffectPass(camera, blur));
    const depth = new DepthOfFieldEffect(camera, { worldFocusRange: 2, bokehScale: 2, resolutionScale: 0.5 });
    composer.addPass(new EffectPass(camera, depth));
    // A toon world gets ink lines, drawn after the blur so they stay crisp.
    if (toon) composer.addPass(new EffectPass(camera, new InkEffect()));
    const grade = new GradeEffect();
    composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({ luminanceThreshold: 1.6, luminanceSmoothing: 0.3, intensity: 0.5, mipmapBlur: true, radius: 0.7 }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        grade,
        new VignetteEffect({ offset: 0.32, darkness: 0.55 }),
      ),
    );

    return { composer, ao, exposed, blur, depth, grade, before: new THREE.PerspectiveCamera() };
  }, [gl, scene, camera, toon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    passes.composer.setSize(size.width, size.height);
  }, [passes, size.width, size.height]);
  useEffect(() => () => passes.composer.dispose(), [passes]);

  // Radii follow the subject: a petri dish and a giant need very different creases.
  passes.ao.configuration.aoRadius = THREE.MathUtils.clamp(subjectHeight * 0.35, 0.02, 6);
  passes.ao.configuration.distanceFalloff = THREE.MathUtils.clamp(subjectHeight * 0.2, 0.01, 3);
  passes.depth.target = focus;
  passes.depth.cocMaterial.worldFocusRange = Math.max(subjectHeight * 1.2, 0.02);
  passes.depth.bokehScale = bokehFor(fov) * (toon ? 0.4 : 1); // a toon world stays mostly sharp
  (passes.grade.uniforms.get("seed") as THREE.Uniform).value = frame % 97;
  (passes.exposed.uniforms.get("exposure") as THREE.Uniform).value = exposure;

  // Priority 1 takes the frame over from R3F's own render.
  useFrame(() => {
    const lens = camera as THREE.PerspectiveCamera;
    lens.updateMatrixWorld();
    const { before } = passes;
    Object.assign(before, { fov: previous.fov, aspect: lens.aspect, near: lens.near, far: lens.far });
    before.updateProjectionMatrix();
    before.position.copy(previous.eye);
    before.lookAt(previous.target);
    before.updateMatrixWorld();
    (passes.blur.uniforms.get("inverseViewProjection") as THREE.Uniform<THREE.Matrix4>).value.multiplyMatrices(lens.matrixWorld, lens.projectionMatrixInverse);
    (passes.blur.uniforms.get("previousViewProjection") as THREE.Uniform<THREE.Matrix4>).value.multiplyMatrices(before.projectionMatrix, before.matrixWorldInverse);
    passes.composer.render();
  }, 1);
  return null;
}

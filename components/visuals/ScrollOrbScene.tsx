"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useScroll } from "framer-motion";
import * as React from "react";
import * as THREE from "three";

type ShapeSet = {
  dome: Float32Array;
  core: Float32Array;
  ribbon: Float32Array;
  crescent: Float32Array;
  vortex: Float32Array;
  phase: Float32Array;
  size: Float32Array;
  colorShift: Float32Array;
};

const vertexShader = `
  precision mediump float;

  attribute float aPhase;
  attribute float aSize;
  attribute float aColorShift;

  uniform float uTime;
  uniform float uScrollProgress;
  uniform float uIntensity;
  uniform float uVelocity;
  uniform vec2 uMouse;

  varying float vAlpha;
  varying float vColorShift;

  void main() {
    vec3 p = position;
    float breathe = sin(uTime * 1.35 + aPhase + uScrollProgress * 8.0) * 0.028 * uIntensity;
    float shimmer = sin(uTime * 4.4 + aPhase * 1.7) * 0.012;
    float stretch = clamp(uVelocity * 9.0, -0.7, 0.7);

    p += normalize(p + vec3(0.0001)) * (breathe + shimmer);
    p.y += stretch * sin(aPhase * 2.0) * 0.16;
    p.x += uMouse.x * 0.12;
    p.y += uMouse.y * 0.065;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float depth = clamp(4.4 / -mvPosition.z, 0.46, 1.65);
    gl_PointSize = aSize * depth * (1.0 + abs(stretch) * 0.42);
    vAlpha = 0.62 + 0.28 * sin(uTime * 2.0 + aPhase);
    vColorShift = aColorShift;
  }
`;

const fragmentShader = `
  precision mediump float;

  uniform float uIntensity;

  varying float vAlpha;
  varying float vColorShift;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float dist = length(c);
    float core = smoothstep(0.5, 0.0, dist);
    float halo = smoothstep(0.5, 0.14, dist) * 0.72;
    float alpha = min(1.0, (core * 1.18 + halo) * vAlpha);

    vec3 deepBlue = vec3(0.07, 0.22, 0.98);
    vec3 cyan = vec3(0.10, 0.88, 1.00);
    vec3 whiteHot = vec3(0.86, 0.98, 1.00);
    vec3 color = mix(deepBlue, cyan, vColorShift);
    color = mix(color, whiteHot, core * 0.34 * uIntensity);

    gl_FragColor = vec4(color, alpha * uIntensity);
  }
`;

function easeInOut(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function mapRange(value: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function createRandom(seed = 7) {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function writeDome(target: Float32Array, index: number, rand: () => number) {
  const i3 = index * 3;
  const u = rand();
  const v = rand();
  const theta = Math.PI * u;
  const phi = Math.PI * (0.12 + 0.82 * v);
  const radius = 1.15 + rand() * 0.95;
  const horizonBias = Math.pow(rand(), 2) * 0.36;

  target[i3] = Math.cos(theta) * Math.sin(phi) * radius * 2.55;
  target[i3 + 1] = -0.74 + Math.abs(Math.cos(phi)) * radius * 0.78 - horizonBias;
  target[i3 + 2] = Math.sin(theta) * Math.sin(phi) * radius * 0.74 - 0.34;
}

function writeCore(target: Float32Array, index: number, rand: () => number) {
  const i3 = index * 3;
  const lane = index % 7;
  const theta = rand() * Math.PI * 2;
  const radius = lane < 2 ? 0.78 + rand() * 0.12 : Math.cbrt(rand()) * 0.68;
  const y = (rand() - 0.5) * (lane < 2 ? 0.2 : 1.02);
  const ring = lane < 2 ? 0.42 : 1;

  target[i3] = Math.cos(theta) * radius * ring;
  target[i3 + 1] = y;
  target[i3 + 2] = Math.sin(theta) * radius * ring * 0.78;
}

function writeRibbon(target: Float32Array, index: number, rand: () => number, count: number) {
  const i3 = index * 3;
  const row = index % 64;
  const rowT = row / 63;
  const colT = Math.floor(index / 64) / Math.max(1, Math.floor(count / 64));
  const wave = Math.sin(rowT * Math.PI * 2.2 + colT * 8.5);

  target[i3] = -1.28 + wave * 0.54 + (rand() - 0.5) * 0.08;
  target[i3 + 1] = lerp(-2.45, 2.5, rowT) + (rand() - 0.5) * 0.05;
  target[i3 + 2] = -0.28 + Math.cos(colT * Math.PI * 4.0 + rowT * 2.1) * 0.82;
}

function writeCrescent(target: Float32Array, index: number, rand: () => number) {
  const i3 = index * 3;
  const theta = lerp(-0.85, 1.28, rand()) * Math.PI;
  const phi = lerp(-0.68, 0.72, rand()) * Math.PI * 0.72;
  const radius = 1.4 + rand() * 0.74;
  const bite = Math.sin(theta * 1.2) > 0.2 ? 0.7 : 1;

  target[i3] = 1.46 + Math.cos(theta) * Math.cos(phi) * radius * 0.9 * bite;
  target[i3 + 1] = Math.sin(phi) * radius * 1.05;
  target[i3 + 2] = Math.sin(theta) * Math.cos(phi) * radius * 0.86;
}

function writeVortex(target: Float32Array, index: number, rand: () => number, count: number) {
  const i3 = index * 3;
  const t = index / Math.max(1, count - 1);
  const angle = t * Math.PI * 22 + rand() * 0.38;
  const radius = Math.pow(1 - t, 0.42) * 1.4 + rand() * 0.12;

  target[i3] = 1.22 + Math.cos(angle) * radius * 0.86;
  target[i3 + 1] = (t - 0.5) * 2.2 + Math.sin(angle * 0.45) * 0.18;
  target[i3 + 2] = Math.sin(angle) * radius * 0.88;
}

function createShapes(count: number): ShapeSet {
  const dome = new Float32Array(count * 3);
  const core = new Float32Array(count * 3);
  const ribbon = new Float32Array(count * 3);
  const crescent = new Float32Array(count * 3);
  const vortex = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  const colorShift = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const rand = createRandom(index * 97 + 17);
    writeDome(dome, index, rand);
    writeCore(core, index, rand);
    writeRibbon(ribbon, index, rand, count);
    writeCrescent(crescent, index, rand);
    writeVortex(vortex, index, rand, count);
    phase[index] = rand() * Math.PI * 2;
    size[index] = 3.4 + rand() * 7.2;
    colorShift[index] = 0.34 + rand() * 0.66;
  }

  return { dome, core, ribbon, crescent, vortex, phase, size, colorShift };
}

function shapeForProgress(progress: number, shapes: ShapeSet) {
  if (progress < 0.32) {
    return { from: shapes.dome, to: shapes.dome, mix: 0 };
  }

  if (progress < 0.45) {
    return {
      from: shapes.dome,
      to: shapes.core,
      mix: easeInOut(mapRange(progress, 0.32, 0.45))
    };
  }

  if (progress < 0.68) {
    return {
      from: shapes.core,
      to: shapes.ribbon,
      mix: easeInOut(mapRange(progress, 0.45, 0.68))
    };
  }

  if (progress < 0.82) {
    return {
      from: shapes.ribbon,
      to: shapes.crescent,
      mix: easeInOut(mapRange(progress, 0.68, 0.82))
    };
  }

  return {
    from: shapes.crescent,
    to: shapes.vortex,
    mix: easeInOut(mapRange(progress, 0.82, 1))
  };
}

function sceneTransform(progress: number) {
  const heroToBridge = easeInOut(mapRange(progress, 0.0, 0.32));
  const coreIn = easeInOut(mapRange(progress, 0.32, 0.45));
  const ribbonIn = easeInOut(mapRange(progress, 0.45, 0.68));
  const crescentIn = easeInOut(mapRange(progress, 0.68, 0.82));
  const vortexIn = easeInOut(mapRange(progress, 0.82, 1));

  let x = lerp(0, 0.02, heroToBridge);
  let y = lerp(-0.22, -0.78, heroToBridge);
  let scale = lerp(1.06, 0.98, heroToBridge);

  x = lerp(x, 0.04, coreIn);
  y = lerp(y, -0.12, coreIn);
  scale = lerp(scale, 0.7, coreIn);

  x = lerp(x, 0.34, ribbonIn);
  y = lerp(y, 0.04, ribbonIn);
  scale = lerp(scale, 1.08, ribbonIn);

  x = lerp(x, -0.12, crescentIn);
  y = lerp(y, 0.04, crescentIn);
  scale = lerp(scale, 1.02, crescentIn);

  x = lerp(x, -0.08, vortexIn);
  y = lerp(y, -0.02, vortexIn);
  scale = lerp(scale, 1.04, vortexIn);

  return { x, y, scale };
}

function ParticleField({
  particleCount,
  reducedMotion
}: {
  particleCount: number;
  reducedMotion: boolean;
}) {
  const { scrollYProgress } = useScroll();
  const shapes = React.useMemo(() => createShapes(particleCount), [particleCount]);
  const positionsRef = React.useRef(new Float32Array(0));
  const geometryRef = React.useRef<THREE.BufferGeometry>(null);
  const groupRef = React.useRef<THREE.Group>(null);
  const materialRef = React.useRef<THREE.ShaderMaterial>(null);
  const smoothProgress = React.useRef(0);
  const previousProgress = React.useRef(0);
  const velocity = React.useRef(0);
  const mouse = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      mouse.current.x = x;
      mouse.current.y = -y;
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  React.useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) {
      return;
    }

    positionsRef.current = new Float32Array(shapes.dome);
    geometry.setAttribute("position", new THREE.BufferAttribute(positionsRef.current, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(shapes.phase, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(shapes.size, 1));
    geometry.setAttribute("aColorShift", new THREE.BufferAttribute(shapes.colorShift, 1));
    geometry.computeBoundingSphere();
  }, [shapes]);

  useFrame(({ clock }, delta) => {
    const rawProgress = reducedMotion ? 0.08 : scrollYProgress.get();
    const smoothing = reducedMotion ? 1 : 1 - Math.pow(0.002, delta);
    smoothProgress.current += (rawProgress - smoothProgress.current) * smoothing;

    const progress = smoothProgress.current;
    const instantVelocity = (rawProgress - previousProgress.current) / Math.max(delta, 0.016);
    velocity.current += (instantVelocity - velocity.current) * 0.09;
    previousProgress.current = rawProgress;

    const { from, to, mix } = shapeForProgress(progress, shapes);
    const settle = reducedMotion ? 1 : 1 - Math.pow(0.0008, delta);
    const positions = positionsRef.current;
    if (!positions.length) {
      return;
    }

    for (let index = 0; index < positions.length; index += 3) {
      const tx = lerp(from[index], to[index], mix);
      const ty = lerp(from[index + 1], to[index + 1], mix);
      const tz = lerp(from[index + 2], to[index + 2], mix);
      positions[index] += (tx - positions[index]) * settle;
      positions[index + 1] += (ty - positions[index + 1]) * settle;
      positions[index + 2] += (tz - positions[index + 2]) * settle;
    }

    const positionAttr = geometryRef.current?.getAttribute("position");
    if (positionAttr) {
      positionAttr.needsUpdate = true;
    }

    const transform = sceneTransform(progress);
    if (groupRef.current) {
      groupRef.current.position.x += (transform.x + mouse.current.x * 0.12 - groupRef.current.position.x) * 0.08;
      groupRef.current.position.y += (transform.y + mouse.current.y * 0.05 - groupRef.current.position.y) * 0.08;
      groupRef.current.scale.setScalar(
        THREE.MathUtils.lerp(groupRef.current.scale.x, transform.scale, 0.08)
      );
      groupRef.current.rotation.y = clock.elapsedTime * 0.045 + progress * Math.PI * 0.64;
      groupRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.15 + progress * 4.0) * 0.06;
      groupRef.current.rotation.z = Math.sin(progress * Math.PI * 2.0) * 0.03;
    }

    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
      materialRef.current.uniforms.uScrollProgress.value = progress;
      materialRef.current.uniforms.uIntensity.value = reducedMotion ? 0.62 : 1;
      materialRef.current.uniforms.uVelocity.value = reducedMotion ? 0 : THREE.MathUtils.clamp(velocity.current, -0.22, 0.22);
      materialRef.current.uniforms.uMouse.value.set(mouse.current.x, mouse.current.y);
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.22, 0]} scale={1.06}>
      <points frustumCulled={false}>
        <bufferGeometry ref={geometryRef} />
        <shaderMaterial
          ref={materialRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={{
            uTime: { value: 0 },
            uScrollProgress: { value: 0 },
            uIntensity: { value: 1 },
            uVelocity: { value: 0 },
            uMouse: { value: new THREE.Vector2(0, 0) }
          }}
        />
      </points>
    </group>
  );
}

function useOrbProfile() {
  const [profile, setProfile] = React.useState({
    particles: 7600,
    reducedMotion: false
  });

  React.useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function update() {
      const width = window.innerWidth;
      const reducedMotion = motionQuery.matches;
      const particles = reducedMotion ? 1800 : width < 640 ? 2800 : width < 1024 ? 5000 : 7600;
      setProfile({ particles, reducedMotion });
    }

    update();
    window.addEventListener("resize", update, { passive: true });
    motionQuery.addEventListener("change", update);

    return () => {
      window.removeEventListener("resize", update);
      motionQuery.removeEventListener("change", update);
    };
  }, []);

  return profile;
}

export default function ScrollOrbScene() {
  const { particles, reducedMotion } = useOrbProfile();

  return (
    <div className="orb-canvas" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(34,211,238,0.18),transparent_28rem),radial-gradient(circle_at_72%_74%,rgba(37,99,235,0.14),transparent_30rem)]" />
      <Canvas
        camera={{ position: [0, 0, 5.2], fov: 52, near: 0.1, far: 100 }}
        dpr={[1, 1.45]}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: "high-performance"
        }}
      >
        <color attach="background" args={["#030712"]} />
        <fog attach="fog" args={["#030712", 8.5, 18]} />
        <ParticleField particleCount={particles} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}

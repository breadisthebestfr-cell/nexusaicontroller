import { useEffect, useRef, useState } from 'react'

// The Jarvis "presence" orb — a real-time WebGL plasma sphere.
//
// A fragment shader raymarches a faux-sphere and lights it with domain-warped
// fBm noise (turbulent filaments), a hot core, a fresnel rim, and a soft outer
// halo. It reacts to what Jarvis is doing via uniforms:
//   idle    → slow, calm swirl
//   working → faster, brighter, more turbulent (thinking / running a command)
//   talking → breathes open/closed; each `pulse` (a speech boundary) flashes it
//
// No external deps; if WebGL is unavailable it falls back to the CSS orb.

export type OrbState = 'idle' | 'working' | 'talking'

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uSpeed;      // swirl speed
uniform float uIntensity;  // brightness / turbulence
uniform float uPulse;      // 0..1 transient flash (speech boundary)
uniform float uTalk;       // 0..1 how much it's "talking" (breathes)

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.55;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}

void main() {
  // Centre and normalise so the sphere fills ~72% of the canvas (room for the halo).
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y * 0.72);

  float breatheOsc = uTalk * (0.5 + 0.5 * sin(uTime * 7.0));
  float breathe = 1.0 + breatheOsc * 0.05 + uPulse * 0.06;

  float d = length(p) / breathe;
  float z = sqrt(max(0.0, 1.0 - d * d));   // faux sphere depth
  vec2  s = p / breathe;
  float t = uTime * uSpeed;

  // Domain-warped fBm across the sphere surface → turbulent plasma filaments.
  vec2 q = vec2(fbm(s * 2.6 + t), fbm(s * 2.6 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(s * 2.6 + 2.2 * q + 0.15 * t),
    fbm(s * 2.6 + 2.2 * q + vec2(8.3, 2.8) - 0.126 * t)
  );
  float f = fbm(s * 3.0 + 3.2 * r + t * 0.5);
  f = pow(clamp(f, 0.0, 1.0), 1.4);
  float fil = smoothstep(0.32, 0.9, f);      // sharpened bright veins

  // Violet → magenta → near-white ramp.
  vec3 deep = vec3(0.10, 0.02, 0.26);
  vec3 mid  = vec3(0.48, 0.14, 0.95);
  vec3 hot  = vec3(0.92, 0.62, 1.0);
  vec3 col = mix(deep, mid, smoothstep(0.15, 0.6, f));
  col = mix(col, hot, fil * (0.6 + 0.6 * uIntensity));

  // Hot core.
  float core = pow(smoothstep(0.62, 0.0, d), 2.0);
  col += vec3(1.0, 0.86, 1.0) * core * (1.1 + uPulse * 1.6 + breatheOsc * 0.8);

  // Fresnel rim light.
  float fres = pow(1.0 - z, 3.0);
  col += vec3(0.55, 0.28, 1.0) * fres * 1.25;

  // Depth shading + subtle inner shadow at the bottom.
  col *= 0.82 + 0.18 * z;

  // Sphere mask + soft outer halo.
  float sphere = smoothstep(1.03, 0.97, d);
  float halo = exp(-max(0.0, d - 1.0) * 3.6) * (0.55 + 0.35 * uIntensity);
  vec3 outCol = col * sphere + vec3(0.42, 0.18, 0.92) * halo;

  float alpha = max(sphere, halo * 0.9);
  gl_FragColor = vec4(outCol * alpha, alpha);   // premultiplied
}
`

interface Targets {
  speed: number
  intensity: number
  talk: number
}
const TARGETS: Record<OrbState, Targets> = {
  idle: { speed: 0.16, intensity: 0.55, talk: 0.0 },
  working: { speed: 0.62, intensity: 1.15, talk: 0.0 },
  talking: { speed: 0.34, intensity: 0.85, talk: 1.0 }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('orb shader:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function JarvisOrb({
  state,
  pulse = 0,
  size = 200
}: {
  state: OrbState
  pulse?: number
  size?: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  // Latest state/pulse without restarting the render loop.
  const stateRef = useRef(state)
  const kickRef = useRef(0)
  stateRef.current = state
  useEffect(() => {
    // A new boundary → flash the orb; decays each frame in the loop.
    kickRef.current = Math.min(1, kickRef.current + 0.85)
  }, [pulse])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = (canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }) ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) {
      setFailed(true)
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram()
    if (!vs || !fs || !prog) {
      setFailed(true)
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('orb link:', gl.getProgramInfoLog(prog))
      setFailed(true)
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'uRes')
    const uTime = gl.getUniformLocation(prog, 'uTime')
    const uSpeed = gl.getUniformLocation(prog, 'uSpeed')
    const uIntensity = gl.getUniformLocation(prog, 'uIntensity')
    const uPulse = gl.getUniformLocation(prog, 'uPulse')
    const uTalk = gl.getUniformLocation(prog, 'uTalk')

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied alpha

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const px = Math.round(size * dpr)
    canvas.width = px
    canvas.height = px
    gl.viewport(0, 0, px, px)
    gl.uniform2f(uRes, px, px)

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // Smoothed current values so state changes ease in.
    const cur: Targets = { ...TARGETS[stateRef.current] }
    const start = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const target = TARGETS[stateRef.current]
      const k = 0.06
      cur.speed += (target.speed - cur.speed) * k
      cur.intensity += (target.intensity - cur.intensity) * k
      cur.talk += (target.talk - cur.talk) * k
      kickRef.current *= 0.9

      const t = ((now - start) / 1000) * (reduce ? 0.25 : 1)
      gl.uniform1f(uTime, t)
      gl.uniform1f(uSpeed, cur.speed)
      gl.uniform1f(uIntensity, cur.intensity)
      gl.uniform1f(uPulse, kickRef.current)
      gl.uniform1f(uTalk, cur.talk)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const onLost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
    }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [size])

  if (failed) {
    // WebGL unavailable — the original CSS orb still conveys the three states.
    return (
      <div className="orb-wrap">
        <div className={`orb orb-${state}`} style={{ width: size, height: size }}>
          <div className="orb-glow" />
          <div className="orb-ring" />
          <div className="orb-sphere">
            <div className="orb-plasma" />
            <div className="orb-plasma p2" />
            <div className="orb-core" />
          </div>
          {state === 'talking' && <span key={pulse} className="orb-kick" />}
        </div>
      </div>
    )
  }

  return (
    <div className="orb-wrap">
      <canvas
        ref={canvasRef}
        className="orb-canvas"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    </div>
  )
}

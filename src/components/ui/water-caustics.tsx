"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * WaterCaustics — real-time WebGL "sunlight through water" background.
 * Two counter-drifting cellular light webs (bright where cell borders meet), RGB-split
 * for dispersion, modulated by travelling brightness, over a depth-graded floor with
 * soft slanted ray shafts. The pointer adds a lens ripple that eases back when idle.
 */
export interface WaterCausticsProps {
  /** 2–5 hex colours, dark → bright (last ≈ filament cores). */
  palette?: string[];
  /** Deepest shadow colour (corners / bottom). */
  bg?: string;
  /** Opacity of the water body (0 = only glowing webs over the page). */
  bgAlpha?: number;
  speed?: number;
  scale?: number;
  intensity?: number;
  dispersion?: number;
  rays?: number;
  depth?: number;
  wobble?: number;
  mouse?: number;
  /** Strength of self-spawning ambient ripple rings (0 = off). */
  ambient?: number;
  /** Max device-pixel-ratio for the canvas. */
  maxDpr?: number;
  className?: string;
}

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uPal[5];
uniform float uPalN;
uniform vec3 uBg;
uniform float uBgA, uScale, uInt, uDisp, uRays, uDepth, uWob, uMouseStr, uMouseAmt, uAmb;
uniform vec2 uMouse;

vec2 h2(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// distance between nearest and 2nd nearest animated cell point: ~0 on borders
float edge(vec2 p, float t){
  vec2 g = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 h = h2(g + o);
    vec2 pt = o + 0.5 + 0.42 * sin(t * (0.6 + h.yx * 0.8) + 6.2831 * h);
    float d = length(pt - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2){ d2 = d; }
  }
  return d2 - d1;
}

float web(vec2 p, float t){
  vec2 a = p * 2.6 + vec2(t * 0.11, t * 0.05);
  vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * p * 3.7 - vec2(t * 0.07, -t * 0.09);
  float l1 = exp(-edge(a, t) * 11.0);
  float l2 = exp(-edge(b, t * 1.2 + 3.0) * 13.0);
  return (l1 + l2) * 0.45 + l1 * l2 * 1.6; // overlaps become hot cores
}

vec3 ramp(float x){
  x = clamp(x, 0.0, 1.0) * (uPalN - 1.0);
  vec3 c = uPal[0];
  for (int i = 1; i < 5; i++){
    float fi = float(i);
    if (fi < uPalN) c = mix(c, uPal[i], clamp(x - (fi - 1.0), 0.0, 1.0));
  }
  return c;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float t = uTime;

  // pointer lens ripple
  vec2 m = (uMouse - 0.5) * vec2(asp, 1.0);
  vec2 dm = p - m;
  float r = length(dm);
  float rip = sin(r * 38.0 - t * 7.0) * exp(-r * 5.0) * uMouseStr * uMouseAmt;
  p += normalize(dm + 1e-4) * rip * 0.025;
  float focus = exp(-r * r * 18.0) * uMouseStr * uMouseAmt;

  // ambient ripples: occasional soft rings spawning at random spots on their own
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    float tk = t * 0.22 + fk * 1.37;
    float ph = fract(tk);
    vec2 c = (h2(vec2(floor(tk), fk * 7.3)) - 0.5) * vec2(asp, 1.0) * 1.6;
    vec2 dk = p - c;
    float rk = length(dk);
    float front = rk - ph * 0.9;
    float ring = sin(front * 28.0) * exp(-abs(front) * 10.0) * (1.0 - ph) * smoothstep(0.0, 0.15, ph);
    p += normalize(dk + 1e-4) * ring * 0.008 * uAmb;
  }

  // organic wobble
  p += uWob * 0.06 * vec2(sin(p.y * 3.1 + t * 0.7), cos(p.x * 2.7 - t * 0.6));

  vec2 q = p * uScale;
  vec2 dir = vec2(0.7, 0.45) * uDisp * 0.012;
  vec3 w = vec3(web(q - dir, t), web(q, t), web(q + dir, t));

  float travel = 0.65 + 0.35 * sin(p.x * 1.4 + p.y * 0.8 - t * 0.5);
  w *= travel * (1.0 + focus * 0.8);

  // depth-graded floor
  float vig = smoothstep(1.25, 0.2, length((uv - 0.5) * vec2(1.1, 1.0)));
  float grade = mix(1.0, uv.y * 0.7 + 0.3, uDepth);
  vec3 floorC = mix(uBg, ramp(0.25), grade * mix(1.0, vig, uDepth));

  // slanted god-ray shafts (upper frame)
  float s = p.x + p.y * 0.55;
  float sh = pow(0.5 + 0.5 * sin(s * 5.5 + sin(s * 1.9 + t * 0.25) * 1.8 + t * 0.15), 5.0);
  float rays = sh * smoothstep(0.1, 1.0, uv.y) * uRays * 0.22;

  float lum = dot(w, vec3(0.333));
  vec3 light = vec3(ramp(w.r * 0.9 + 0.1).r, ramp(w.g * 0.9 + 0.1).g, ramp(w.b * 0.9 + 0.1).b);
  light = mix(light, vec3(lum), 0.15) * w * uInt;
  light += ramp(0.85) * rays;
  light *= mix(1.0, vig, uDepth * 0.6);

  float la = clamp(max(max(light.r, light.g), light.b), 0.0, 1.0);
  float a = uBgA + (1.0 - uBgA) * la;
  vec3 col = floorC * uBgA + light;     // premultiplied
  gl_FragColor = vec4(min(col, vec3(a)), a);
}`;

function hex(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const v = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export function WaterCaustics({
  palette = ["#1b1240", "#3b2a9a", "#5941F2", "#D9328E", "#fff4fb"],
  bg = "#0b0820",
  bgAlpha = 1,
  speed = 0.35,
  scale = 1,
  intensity = 0.9,
  dispersion = 0.4,
  rays = 0.5,
  depth = 0.5,
  wobble = 0.6,
  mouse = 0.5,
  ambient = 0.5,
  maxDpr = 1.5,
  className,
}: WaterCausticsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const params = useRef({ palette, bg, bgAlpha, speed, scale, intensity, dispersion, rays, depth, wobble, mouse, ambient });
  params.current = { palette, bg, bgAlpha, speed, scale, intensity, dispersion, rays, depth, wobble, mouse, ambient };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFallback(true);
      return;
    }
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) {
      setFallback(true);
      return;
    }

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("WaterCaustics shader:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFallback(true);
      return;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      res: U("uRes"), time: U("uTime"), pal: U("uPal"), palN: U("uPalN"), bg: U("uBg"), bgA: U("uBgA"),
      scale: U("uScale"), int: U("uInt"), disp: U("uDisp"), rays: U("uRays"), depth: U("uDepth"),
      wob: U("uWob"), mStr: U("uMouseStr"), mAmt: U("uMouseAmt"), amb: U("uAmb"), mouse: U("uMouse"),
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, rect.width < 640 ? 1 : maxDpr);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const ptr = { x: 0.5, y: 0.5, amt: 0, target: 0, last: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      ptr.x = x;
      ptr.y = y;
      ptr.target = 1;
      ptr.last = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    let raf = 0;
    let time = 0;
    let prev = performance.now();
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
    });
    io.observe(canvas);
    const onVis = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVis);

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const P = params.current;
      time += dt * P.speed * 2;
      if (now - ptr.last > 1200) ptr.target = 0;
      ptr.amt += (ptr.target - ptr.amt) * Math.min(1, dt * 3);

      const pal = P.palette.slice(0, 5);
      while (pal.length < 2) pal.push(pal[0] ?? "#ffffff");
      const flat = new Float32Array(15);
      pal.forEach((c, i) => flat.set(hex(c), i * 3));
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, time);
      gl.uniform3fv(u.pal, flat);
      gl.uniform1f(u.palN, pal.length);
      gl.uniform3fv(u.bg, hex(P.bg));
      gl.uniform1f(u.bgA, P.bgAlpha);
      gl.uniform1f(u.scale, P.scale);
      gl.uniform1f(u.int, P.intensity); // linear: 0 = off, 1 = full filament brightness
      gl.uniform1f(u.disp, P.dispersion);
      gl.uniform1f(u.rays, P.rays);
      gl.uniform1f(u.depth, P.depth);
      gl.uniform1f(u.wob, P.wobble);
      gl.uniform1f(u.mStr, P.mouse);
      gl.uniform1f(u.mAmt, ptr.amt);
      gl.uniform1f(u.amb, P.ambient);
      gl.uniform2f(u.mouse, ptr.x, ptr.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    function start() {
      if (raf || !visible || document.hidden) return;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    }
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [maxDpr]);

  if (fallback) {
    const stops = palette.length ? palette : ["#000", "#fff"];
    return (
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{
          opacity: Math.max(0.35, bgAlpha),
          background: `radial-gradient(ellipse at 30% 20%, ${stops[stops.length - 2] ?? stops[0]}55, transparent 60%), radial-gradient(ellipse at 75% 80%, ${stops[1] ?? stops[0]}66, transparent 65%), linear-gradient(180deg, ${stops[1] ?? bg}, ${bg})`,
        }}
      />
    );
  }

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}

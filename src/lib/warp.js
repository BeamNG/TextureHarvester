
import * as THREE from "three";
import { TX } from "../tx.js";

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uTexSize;
  uniform mat3 uH;
  uniform vec4 uDomain;
  uniform vec2 uCurve[8];
  uniform bool uCurved;
  uniform vec2 uLensK;
  uniform vec3 uLens; // centre.xy, scale
  varying vec2 vUv;

  // Must match edgePoint() in homography.js (selftest checks bit agreement).
  vec2 bez(vec2 a, vec2 b, int edge, float t) {
    vec2 c1 = mix(a, b, 1.0 / 3.0) + uCurve[edge * 2];
    vec2 c2 = mix(a, b, 2.0 / 3.0) + uCurve[edge * 2 + 1];
    float s = 1.0 - t;
    return s * s * s * a + 3.0 * s * s * t * c1 + 3.0 * s * t * t * c2 + t * t * t * b;
  }

  vec2 coons(vec2 p) {
    const vec2 c0 = vec2(0.0, 0.0);
    const vec2 c1 = vec2(1.0, 0.0);
    const vec2 c2 = vec2(1.0, 1.0);
    const vec2 c3 = vec2(0.0, 1.0);
    vec2 top = bez(c0, c1, 0, p.x);
    vec2 right = bez(c1, c2, 1, p.y);
    vec2 bottom = bez(c2, c3, 2, 1.0 - p.x);
    vec2 left = bez(c3, c0, 3, 1.0 - p.y);
    vec2 bilinear = mix(mix(c0, c1, p.x), mix(c3, c2, p.x), p.y);
    return mix(top, bottom, p.y) + mix(left, right, p.x) - bilinear;
  }

  // Must agree with toActual in lib/lens.js; selftest checks over the whole frame.
  vec2 distort(vec2 ideal) {
    if (uLensK.x == 0.0 && uLensK.y == 0.0) return ideal;
    vec2 d = (ideal - uLens.xy) / uLens.z;
    float r2 = dot(d, d);
    float f = 1.0 + uLensK.x * r2 + uLensK.y * r2 * r2;
    return uLens.xy + d * f * uLens.z;
  }

  void main() {
    vec2 local = mix(uDomain.xy, uDomain.zw, vUv);
    if (uCurved) local = coons(local);
    vec3 p = uH * vec3(local, 1.0);
    if (abs(p.z) < 1e-8) { gl_FragColor = vec4(0.0); return; }
    vec2 src = distort(p.xy / p.z);
    vec2 uv = src / uTexSize;
// Outside the source image stays transparent instead of smearing the edge texel.
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
    gl_FragColor = texture2D(uTex, uv);
  }
`;

let gpu = null;

function context() {
  if (gpu) return gpu;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // v = 0 pinned to output top (homography v runs top-to-bottom).
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(
    [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTex: { value: null },
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uH: { value: new THREE.Matrix3() },
      uDomain: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCurve: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 0)) },
      uCurved: { value: false },
      uLensK: { value: new THREE.Vector2(0, 0) },
      uLens: { value: new THREE.Vector3(0, 0, 1) },
    },
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));

  gpu = {
    renderer,
    material,
    scene,
    camera: new THREE.Camera(),
    target: null,
    maxTextureSize: renderer.capabilities.maxTextureSize,
  };
  return gpu;
}

function targetOfSize(g, width, height) {
  if (!g.target || g.target.width !== width || g.target.height !== height) {
    if (g.target) g.target.dispose();
    g.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.SRGBColorSpace,
    });
  }
  return g.target;
}

function createSource(image) {
  const g = context();
  const max = g.maxTextureSize;
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;

  let uploaded = image;
  let scale = 1;

  if (naturalWidth > max || naturalHeight > max) {
    scale = Math.min(max / naturalWidth, max / naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    uploaded = canvas;
    scale = canvas.width / naturalWidth;
  }

  const texture = new THREE.Texture(uploaded);
  texture.flipY = false; // keeps v = 0 on the image's first row, matching pixel coords
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = g.renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;

  return {
    texture,
    scale,
    width: uploaded.width || naturalWidth,
    height: uploaded.height || naturalHeight,
    naturalWidth,
    naturalHeight,
  };
}

function warpQuad(source, quad, options) {
  const opts = options || {};
  const supersample = Math.max(1, Math.min(4, Math.round(opts.supersample || 1)));
  const g = context();

  const domain = TX.geom.domainOf(opts.domain);
  const curve = TX.geom.curveOf(opts.curve);
  const curved = !TX.geom.isFlatCurve(curve);

  const lensSettings = TX.lens.settingsOf(opts.lens);
  const lensed = !TX.lens.isIdentity(lensSettings);
  const lensOriginal = lensed
    ? TX.lens.project(lensSettings, source.width / source.scale, source.height / source.scale)
    : null;
  const lensScaled = lensed
    ? TX.lens.project(lensSettings, source.width, source.height) : null;

  const scaled = quad.map(p => ({ x: p.x * source.scale, y: p.y * source.scale }));
  const dims = opts.size && opts.size.width > 0 && opts.size.height > 0
    ? opts.size
    : TX.geom.quadDimensions(TX.geom.effectiveQuad(quad, domain, curve, lensOriginal));
  if (!Number.isFinite(dims.width) || !Number.isFinite(dims.height)) return null;

  let outWidth = Math.max(1, Math.round(dims.width));
  let outHeight = Math.max(1, Math.round(dims.height));

  const cap = opts.maxSide > 0 ? opts.maxSide : 0;
  if (cap && Math.max(outWidth, outHeight) > cap) {
    const shrink = cap / Math.max(outWidth, outHeight);
    outWidth = Math.max(1, Math.round(outWidth * shrink));
    outHeight = Math.max(1, Math.round(outHeight * shrink));
  }

  let factor = supersample;
  const limit = g.maxTextureSize;
  while (factor > 1 && (outWidth * factor > limit || outHeight * factor > limit)) factor--;

  const renderWidth = Math.min(limit, outWidth * factor);
  const renderHeight = Math.min(limit, outHeight * factor);
  outWidth = Math.min(outWidth, limit);
  outHeight = Math.min(outHeight, limit);

  const h = TX.geom.fitQuad(scaled, lensScaled);
  if (!h) return null;

  g.material.uniforms.uTex.value = source.texture;
  g.material.uniforms.uTexSize.value.set(source.width, source.height);
  g.material.uniforms.uH.value.set(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]);
  g.material.uniforms.uDomain.value.set(domain.u0, domain.v0, domain.u1, domain.v1);
  g.material.uniforms.uCurved.value = curved;
  g.material.uniforms.uLensK.value.set(
    lensScaled ? lensScaled.k1 : 0, lensScaled ? lensScaled.k2 : 0);
  g.material.uniforms.uLens.value.set(
    lensScaled ? lensScaled.cx : 0,
    lensScaled ? lensScaled.cy : 0,
    lensScaled ? lensScaled.scale : 1);
  curve.forEach((c, i) => {
    g.material.uniforms.uCurve.value[i * 2].set(c.a.x, c.a.y);
    g.material.uniforms.uCurve.value[i * 2 + 1].set(c.b.x, c.b.y);
  });

  const target = targetOfSize(g, renderWidth, renderHeight);
  g.renderer.setRenderTarget(target);
  g.renderer.clear();
  g.renderer.render(g.scene, g.camera);

  const pixels = new Uint8Array(renderWidth * renderHeight * 4);
  g.renderer.readRenderTargetPixels(target, 0, 0, renderWidth, renderHeight, pixels);
  g.renderer.setRenderTarget(null);

// Framebuffer rows come back bottom-up; ImageData wants them top-down.
  const flipped = new Uint8ClampedArray(pixels.length);
  const stride = renderWidth * 4;
  for (let row = 0; row < renderHeight; row++) {
    const from = (renderHeight - 1 - row) * stride;
    flipped.set(pixels.subarray(from, from + stride), row * stride);
  }

  const rendered = document.createElement("canvas");
  rendered.width = renderWidth;
  rendered.height = renderHeight;
  rendered.getContext("2d").putImageData(new ImageData(flipped, renderWidth, renderHeight), 0, 0);

  if (renderWidth === outWidth && renderHeight === outHeight) return rendered;

  const resolved = document.createElement("canvas");
  resolved.width = outWidth;
  resolved.height = outHeight;
  const ctx = resolved.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(rendered, 0, 0, outWidth, outHeight);
  return resolved;
}

function isSupported() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch (err) {
    return false;
  }
}

TX.warp = { createSource, warpQuad, isSupported };


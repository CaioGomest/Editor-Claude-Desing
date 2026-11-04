(function (global) {
  'use strict';

  const Easing = {
    linear: (t) => t,

    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => (--t) * t * t + 1,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

    easeInQuart: (t) => t * t * t * t,
    easeOutQuart: (t) => 1 - (--t) * t * t * t,
    easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),

    easeInQuint: (t) => t * t * t * t * t,
    easeOutQuint: (t) => 1 + (--t) * t * t * t * t,
    easeInOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t),
  };

  function ease(name) {
    return Easing[name] || Easing.linear;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, p) {
    return a + (b - a) * clamp(p, 0, 1);
  }

  // Deterministic pseudo-noise — every visual random effect must go through
  // this (never Math.random / Date.now) so a given t always renders the same.
  function noise(t, s) {
    const x = Math.sin(t * 37.13 + s * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  // "Stuttered" noise: quantized to a step every 1/hz seconds, so effects
  // that should flicker frame-to-frame (glitch triggers, static) don't
  // smoothly drift as t moves within a step.
  function stut(t, s, hz) {
    return noise(Math.floor(t * (hz || 10)), s);
  }

  function animateRange(from, to, start, end, easeFn) {
    return (tt) => {
      if (tt <= start) return from;
      if (tt >= end) return to;
      const local = (tt - start) / (end - start);
      return from + (to - from) * easeFn(local);
    };
  }

  function progress(start, end, t) {
    if (end == null || end <= start) return 1;
    return clamp((t - start) / (end - start), 0, 1);
  }

  function animValue(spec, p, fallback) {
    if (!spec) return fallback;
    const from = spec.from != null ? spec.from : fallback;
    const to = spec.to != null ? spec.to : from;
    return from + (to - from) * ease(spec.ease)(p);
  }

  function envelopeValue(envelope, t, easeName) {
    if (!envelope || !envelope.length) return 1;
    if (t <= envelope[0].t) return envelope[0].v;
    const last = envelope[envelope.length - 1];
    if (t >= last.t) return last.v;
    const fn = ease(easeName);
    for (let i = 0; i < envelope.length - 1; i++) {
      const a = envelope[i], b = envelope[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const local = span === 0 ? 0 : (t - a.t) / span;
        return a.v + (b.v - a.v) * fn(local);
      }
    }
    return last.v;
  }

  function resolveColor(theme, value) {
    if (typeof value === 'string' && value.charAt(0) === '@') {
      const key = value.slice(1);
      return (theme && theme.colors && theme.colors[key]) || value;
    }
    return value;
  }

  function toRgba(color, alpha) {
    if (typeof color === 'string' && color.charAt(0) === '#') {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color; // already a css color function; alpha is the caller's problem
  }

  function tweakDefault(project, id) {
    const tw = (project.tweaks || []).find((x) => x.id === id);
    return tw ? tw.default : undefined;
  }

  function activeRegionIds(project, t) {
    const ids = new Set();
    (project.regions || []).forEach((r) => { if (t >= r.start && t < r.end) ids.add(r.id); });
    return ids;
  }

  // A tweak's value at time t, forced to 0/false whenever t falls in a
  // region listed in the muteDuring of a layer bound to that same tweak —
  // this is how e.g. glitch (and anything reading its k) goes silent during
  // a project's "quiet" ending without every consumer having to know about it.
  function effectiveTweakValue(project, tweakId, activeRegions) {
    const value = tweakDefault(project, tweakId);
    const fx = (project.tracks || []).find((tr) => tr.kind === 'effects');
    const layers = (fx && fx.layers) || [];
    const muted = layers.some((l) => {
      const boundId = l.bindTo ? l.bindTo.replace(/^tweak\./, '') : null;
      return boundId === tweakId && Array.isArray(l.muteDuring) && l.muteDuring.some((r) => activeRegions.has(r));
    });
    if (muted) return typeof value === 'number' ? 0 : false;
    return value;
  }

  function assetUrl(project, assetId) {
    const a = project.assets || {};
    const img = (a.images || []).find((x) => x.id === assetId);
    if (img) {
      if (img.url) return img.url; // direct override (e.g. an upload not yet written to disk)
      return (a.basePath || '') + (a.prefix || '') + img.file;
    }
    // No entry in an explicit images[] list (or no list at all): some
    // projects instead derive the filename straight from the id via a
    // shared prefix + extension, to avoid spelling out every asset.
    if (a.ext) return (a.basePath || '') + (a.prefix || '') + assetId + a.ext;
    return null;
  }

  function audioUrl(project, assetId) {
    const a = project.assets || {};
    const aud = (a.audio || []).find((x) => x.id === assetId);
    if (!aud) return null;
    if (aud.url) return aud.url;
    return (a.basePath || '') + aud.file;
  }

  function buildFilterString(filter) {
    if (!filter) return 'none';
    const parts = [];
    if (filter.grayscale != null) parts.push(`grayscale(${filter.grayscale})`);
    if (filter.contrast != null) parts.push(`contrast(${filter.contrast})`);
    if (filter.brightness != null) parts.push(`brightness(${filter.brightness})`);
    if (filter.blur != null) parts.push(`blur(${filter.blur}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  function findActiveClipIndex(clips, t) {
    if (!clips || !clips.length) return -1;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const end = c.end != null ? c.end : Infinity;
      if (t < end || i === clips.length - 1) return i;
    }
    return clips.length - 1;
  }

  function findActiveClip(clips, t) {
    const i = findActiveClipIndex(clips, t);
    return i === -1 ? null : clips[i];
  }

  // opacityOverride, when given, replaces the clip's own fadeIn-based ramp —
  // used during a crossfade, where both the outgoing and incoming clips'
  // opacities are driven by one shared transition progress instead.
  function renderImageClip(project, clip, t, z, opacityOverride) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;overflow:hidden;z-index:${z};`;
    const url = assetUrl(project, clip.asset);
    if (!url) return el;

    const p = progress(clip.start, clip.end, t);
    const cam = clip.camera || {};
    const zoom = animValue(cam.zoom, p, 1);
    const panX = animValue(cam.panX, p, 0);
    const panY = animValue(cam.panY, p, 0);
    const offsetX = cam.offsetX || 0;
    const offsetY = cam.offsetY || 0;
    const opacity = opacityOverride != null ? opacityOverride
      : clip.fadeIn ? clamp((t - clip.start) / clip.fadeIn, 0, 1) : 1;

    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'width:108%', 'height:108%',
      `object-fit:${clip.fit || 'cover'}`,
      `object-position:${clip.objectPosition || '50% 50%'}`,
      `filter:${buildFilterString(clip.filter)}`,
      `opacity:${opacity}`,
      `transform:translate(-50%, -50%) translateX(${offsetX + panX}%) translateY(${offsetY + panY}%) scale(${zoom})`,
    ].join(';');
    el.appendChild(img);
    return el;
  }

  function renderScrimLayer(layer, t, z) {
    const el = document.createElement('div');
    const p = layer.params || {};
    const edge = p.edge === 'top' ? 'top' : 'bottom';
    const stops = (p.stops || []).map(([o, c]) => `${c} ${o * 100}%`).join(', ');
    const dir = edge === 'bottom' ? 'to top' : 'to bottom';
    const opacity = envelopeValue(layer.envelope, t, layer.ease);
    el.style.cssText = [
      'position:absolute', 'left:0', 'right:0', `${edge}:0`,
      `height:${p.height != null ? p.height : 300}px`,
      `z-index:${z}`, 'pointer-events:none',
      `background:${stops ? `linear-gradient(${dir}, ${stops})` : 'none'}`,
      `opacity:${opacity}`,
    ].join(';');
    return el;
  }

  function renderVignetteLayer(project, layer, t, z) {
    const el = document.createElement('div');
    const p = layer.params || {};
    const shape = p.shape || '150% 100% at 50% 50%';
    const inner = p.inner != null ? p.inner : 0.3;
    const baseOpacity = p.opacity != null ? p.opacity : 1;
    const color = resolveColor(project.theme, p.color || '#000000');
    const edgeColor = toRgba(color, baseOpacity);
    const opacity = envelopeValue(layer.envelope, t, layer.ease);
    el.style.cssText = [
      'position:absolute', 'inset:0', `z-index:${z}`, 'pointer-events:none',
      `background:radial-gradient(${shape}, transparent ${inner * 100}%, ${edgeColor} 100%)`,
      `opacity:${opacity}`,
    ].join(';');
    return el;
  }

  function renderScanlinesLayer(layer, t, z) {
    const p = layer.params || {};
    const gap = p.gap != null ? p.gap : 3;
    const thickness = p.thickness != null ? p.thickness : 3;
    const period = p.period != null ? p.period : gap + thickness;
    const color = p.color || 'rgba(0,0,0,0.42)';
    const speed = p.scrollSpeed || 0;
    const opacity = p.opacity != null ? p.opacity : 1;
    const posY = (((t * speed) % period) + period) % period;
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'inset:0', `z-index:${z}`, 'pointer-events:none',
      `opacity:${opacity}`,
      `background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) ${gap}px, ${color} ${gap + 1}px, ${color} ${period}px)`,
      `background-position:0 ${posY}px`,
    ].join(';');
    return el;
  }

  function renderSweepLayer(canvasHeight, layer, t, z) {
    const p = layer.params || {};
    const height = p.height != null ? p.height : 300;
    const speed = p.speed || 0;
    const color = p.color || 'rgba(255,255,255,0.05)';
    const overscan = p.overscan != null ? p.overscan : 400;
    const span = canvasHeight + overscan;
    const top = ((((t * speed) % span) + span) % span) - overscan / 2;
    const opacity = envelopeValue(layer.envelope, t, layer.ease);
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'left:0', 'right:0', `height:${height}px`, `top:${top}px`,
      `z-index:${z}`, 'pointer-events:none',
      `background:linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${color} 50%, rgba(255,255,255,0) 100%)`,
      `opacity:${opacity}`,
    ].join(';');
    return el;
  }

  function renderGrainLayer(project, layer, t, z, activeRegions) {
    const p = layer.params || {};
    const boundId = layer.bindTo ? layer.bindTo.replace(/^tweak\./, '') : null;
    const k = boundId ? (effectiveTweakValue(project, boundId, activeRegions) || 0) : 0;
    const tile = p.tile || 220;
    const svg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${p.baseFrequency != null ? p.baseFrequency : 0.85}' numOctaves='${p.octaves || 3}' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='${tile}' height='${tile}' filter='url(#n)'/></svg>`
    );
    const posX = Math.floor(noise(t, 3) * tile);
    const posY = Math.floor(noise(t, 8) * tile);
    const base = p.opacity != null ? p.opacity : 0.1;
    const opacity = base + k * (p.opacityPerK || 0);
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'inset:0', `z-index:${z}`, 'pointer-events:none',
      `background-image:url("data:image/svg+xml,${svg}")`,
      `background-position:${posX}px ${posY}px`,
      `opacity:${opacity}`, `mix-blend-mode:${p.blend || 'overlay'}`,
    ].join(';');
    return el;
  }

  function renderGlitchLayer(project, layer, t, z, activeRegions, canvasHeight) {
    const p = layer.params || {};
    const boundId = layer.bindTo ? layer.bindTo.replace(/^tweak\./, '') : null;
    const k = boundId ? (effectiveTweakValue(project, boundId, activeRegions) || 0) : 0;

    let hard = false;
    if (layer.hits) {
      const hitsBoundId = layer.hits.bindTo ? layer.hits.bindTo.replace(/^tweak\./, '') : null;
      const hitsEnabled = hitsBoundId ? !!effectiveTweakValue(project, hitsBoundId, activeRegions) : true;
      const width = layer.hits.width != null ? layer.hits.width : 0.1;
      hard = !!(hitsEnabled && layer.hits.force && (layer.hits.at || []).some((h) => t >= h && t < h + width));
    }

    const hz = p.hz || 7;
    const thresholdPerK = p.thresholdPerK != null ? p.thresholdPerK : 0.05;
    const active = hard || stut(t, 11, hz) > 1 - k * thresholdPerK;
    if (!active) return null;

    const bands = p.bands || 4;
    const minH = p.bandMinHeight != null ? p.bandMinHeight : 20;
    const maxH = p.bandMaxHeight != null ? p.bandMaxHeight : 150;
    const maxShift = p.maxShift != null ? p.maxShift : 60;
    const shiftPerK = p.shiftPerK || 0;
    const colorA = p.colorA || 'rgba(255,255,255,0.09)';
    const colorB = p.colorB || 'rgba(200,32,42,0.14)';

    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;z-index:${z};pointer-events:none;`;
    for (let i = 0; i < bands; i++) {
      const y = stut(t + i * 0.7, 2 + i, 14) * canvasHeight;
      const h = minH + stut(t + i, 4 + i, 14) * (maxH - minH);
      const dx = (stut(t + i * 0.3, 6 + i, 14) - 0.5) * (maxShift + shiftPerK * k);
      const band = document.createElement('div');
      band.style.cssText = [
        'position:absolute', 'left:0', 'right:0', `top:${y}px`, `height:${h}px`,
        `background:${i % 2 ? colorA : colorB}`,
        `transform:translateX(${dx}px)`, 'mix-blend-mode:screen',
        i === 0 && p.topBorder ? `border-top:${p.topBorder}` : '',
      ].join(';');
      el.appendChild(band);
    }
    return el;
  }

  function renderStaticLayer(layer, t, z) {
    const p = layer.params || {};
    const at = p.at != null ? p.at : 0;
    const dur = p.dur != null ? p.dur : 0.5;
    if (t < at || t >= at + dur) return null;
    const stripe = p.stripe || [2, 5];
    const baseOpacity = p.baseOpacity != null ? p.baseOpacity : 0.12;
    const noiseAmount = p.noiseAmount != null ? p.noiseAmount : 0.2;
    const hz = p.hz || 20;
    const fadeFrom = p.fadeFrom != null ? p.fadeFrom : 0.2;
    const fadeEase = ease(p.ease || 'easeInOutQuart');
    const lightOpacity = baseOpacity + stut(t, 1, hz) * noiseAmount;
    const gradient = `repeating-linear-gradient(to bottom, rgba(255,255,255,${lightOpacity}) 0 ${stripe[0]}px, rgba(0,0,0,0.9) ${stripe[0]}px ${stripe[1]}px)`;
    const opacity = animateRange(1, 0, at + fadeFrom, at + dur, fadeEase)(t);
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'inset:0', `z-index:${z}`, 'pointer-events:none',
      `background:${gradient}`, `opacity:${opacity}`,
    ].join(';');
    return el;
  }

  function renderFlashFrameLayer(project, layer, t, z, activeRegions) {
    const p = layer.params || {};
    if (t < p.start || t >= p.end) return null;
    const boundId = layer.bindTo ? layer.bindTo.replace(/^tweak\./, '') : null;
    if (boundId && !effectiveTweakValue(project, boundId, activeRegions)) return null;
    const url = assetUrl(project, p.asset);
    if (!url) return null;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = [
      'position:absolute', 'inset:0', 'width:100%', 'height:100%', 'object-fit:cover',
      `z-index:${z}`, 'pointer-events:none',
      `filter:${buildFilterString(p.filter)}`,
      `mix-blend-mode:${p.blend || 'screen'}`,
      `opacity:${p.opacity != null ? p.opacity : 1}`,
    ].join(';');
    return img;
  }

  function formatTimecode(offset, t, frameRate) {
    const parts = String(offset || '00:00:00').split(':').map(Number);
    const offsetSec = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    const total = offsetSec + Math.max(0, t);
    const pad = (n) => String(Math.floor(n)).padStart(2, '0');
    return `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(Math.floor(total % 60))}:${pad((total % 1) * frameRate)}`;
  }

  function renderHudLayer(project, layer, t, z, glitchK) {
    const p = layer.params || {};
    const theme = project.theme || {};
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;z-index:${z};pointer-events:none;`;

    const corners = p.corners || {};
    const size = corners.size != null ? corners.size : 80;
    const inset = corners.inset != null ? corners.inset : 44;
    const thickness = corners.thickness != null ? corners.thickness : 3;
    const cColor = resolveColor(theme, corners.color || 'rgba(200,32,42,0.7)');
    [0, 1, 2, 3].forEach((i) => {
      const right = i === 1 || i === 3;
      const bottom = i >= 2;
      const c = document.createElement('div');
      c.style.cssText = [
        'position:absolute', `width:${size}px`, `height:${size}px`,
        `${right ? 'right' : 'left'}:${inset}px`,
        `${bottom ? 'bottom' : 'top'}:${inset}px`,
        `${right ? 'border-right' : 'border-left'}:${thickness}px solid ${cColor}`,
        `${bottom ? 'border-bottom' : 'border-top'}:${thickness}px solid ${cColor}`,
      ].join(';');
      el.appendChild(c);
    });

    const cellBase = p.cellBase || {};
    (p.cells || []).forEach((cell) => {
      const merged = Object.assign({}, cellBase, cell);
      const right = merged.at === 'topRight' || merged.at === 'bottomRight';
      const bottom = merged.at === 'bottomLeft' || merged.at === 'bottomRight';
      const font = (theme.fonts && theme.fonts[merged.font]) || merged.font || 'inherit';
      const color = resolveColor(theme, merged.color || '#fff');
      const posCss = `${right ? 'right' : 'left'}:${merged.x || 0}px;${bottom ? 'bottom' : 'top'}:${merged.y || 0}px;`;
      const baseCss = `position:absolute;${posCss}font-family:${font};font-size:${merged.size || 24}px;letter-spacing:${merged.letterSpacing || 'normal'};color:${color};font-weight:${merged.weight || 400};white-space:nowrap;`;

      if (cell.type === 'rec') {
        const period = cell.blinkPeriod || 1;
        const duty = cell.blinkDuty != null ? cell.blinkDuty : 0.5;
        const on = (t % period) < period * duty;
        const dim = cell.dimOpacity != null ? cell.dimOpacity : 0.15;
        const wrap = document.createElement('div');
        wrap.style.cssText = `position:absolute;${posCss}display:flex;align-items:center;gap:${cell.gap || 10}px;opacity:${on ? 1 : dim};`;
        const dotSize = cell.dotSize || 16;
        const dot = document.createElement('div');
        dot.style.cssText = `width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${color};`;
        const label = document.createElement('div');
        label.style.cssText = `font-family:${font};font-size:${merged.size || 24}px;letter-spacing:${merged.letterSpacing || 'normal'};color:${color};font-weight:${cell.weight || 700};white-space:nowrap;`;
        label.textContent = 'REC';
        wrap.appendChild(dot);
        wrap.appendChild(label);
        el.appendChild(wrap);
        return;
      }

      if (cell.type === 'timecode') {
        const div = document.createElement('div');
        div.style.cssText = baseCss;
        div.textContent = formatTimecode(cell.offset, t, cell.frameRate || 24);
        el.appendChild(div);
        return;
      }

      if (cell.type === 'keyed') {
        const keys = cell.keys || [];
        let active = keys[0];
        keys.forEach((k) => { if (t >= k.t) active = k; });
        if (!active) return;
        const kColor = resolveColor(theme, active.color || merged.color || '#fff');
        const div = document.createElement('div');
        div.style.cssText = `position:absolute;${posCss}font-family:${font};font-size:${active.size || merged.size || 24}px;letter-spacing:${merged.letterSpacing || 'normal'};color:${kColor};font-weight:${active.weight != null ? active.weight : merged.weight || 400};white-space:nowrap;`;
        div.textContent = active.text || '';
        el.appendChild(div);
        return;
      }

      if (cell.type === 'conditional') {
        const m = /^k\s*>\s*(-?[\d.]+)$/.exec(cell.when || '');
        const threshold = m ? parseFloat(m[1]) : 0;
        const isTrue = glitchK > threshold;
        const div = document.createElement('div');
        div.style.cssText = baseCss;
        div.textContent = isTrue ? cell.textTrue : cell.textFalse;
        el.appendChild(div);
        return;
      }

      const div = document.createElement('div');
      div.style.cssText = baseCss;
      div.textContent = merged.text || '';
      el.appendChild(div);
    });

    return el;
  }

  function renderTextClip(project, clip, t, z) {
    const start = clip.start, end = clip.end;
    const inSpec = clip.in || {};
    const outSpec = clip.out || {};
    const fadeInDur = inSpec.fadeDur != null ? inSpec.fadeDur : 0.2;
    const fadeIn = animateRange(0, 1, start, start + fadeInDur, ease('easeOutCubic'))(t);
    const outDur = outSpec.dur != null ? outSpec.dur : 0.3;
    const fadeOut = animateRange(1, 0, end - outDur, end, ease('easeInOutQuart'))(t);
    const opacity = fadeIn * fadeOut;
    if (opacity <= 0.001) return null;

    const dy = inSpec.dy != null ? inSpec.dy : 0;
    const punchDur = inSpec.dur != null ? inSpec.dur : 0.5;
    const inTranslateY = animateRange(dy, 0, start, start + punchDur, ease(inSpec.ease || 'easeOutQuint'))(t);
    // Exit direction is independent of the entrance's: animated in its own
    // window at the clip's end, from 0 up to outSpec.dy. The two windows
    // don't overlap (except on very short clips), and each range clamps to
    // its resting value (0) outside its own window, so summing them is safe.
    const outDy = outSpec.dy != null ? outSpec.dy : 0;
    const outTranslateY = animateRange(0, outDy, end - outDur, end, ease('easeInOutQuart'))(t);
    const translateY = inTranslateY + outTranslateY;

    let scale = 1;
    if (clip.drift && clip.drift.scale) {
      const ds = clip.drift.scale;
      scale = animateRange(
        ds.from != null ? ds.from : 1, ds.to != null ? ds.to : 1,
        start, end, ease(ds.ease || 'easeInOutQuart')
      )(t);
    }

    const box = clip.box || {};
    const style = clip.style || {};
    const theme = project.theme || {};
    const font = (theme.fonts && theme.fonts[style.font]) || style.font || 'inherit';
    const color = resolveColor(theme, style.color || '#fff');

    // box.bottom anchors from the bottom edge instead of the top — without
    // this, a bottom-anchored box (as the editor's title cards use) always
    // fell back to the top:0 default below and rendered pinned to the top.
    const vAnchorCss = box.bottom != null
      ? `bottom:${box.bottom}px`
      : `top:${typeof box.top === 'string' ? box.top : (box.top || 0) + 'px'}`;

    const el = document.createElement('div');
    // data-text-clip-id + the sr-text-hit class on the title/sub children
    // (below) let the editor UI hit-test a click against the actual glyph
    // bounds — this wrapper itself always spans left→right regardless of
    // how little text it holds, so it's useless for that on its own.
    if (clip.id) el.dataset.textClipId = clip.id;
    el.style.cssText = [
      'position:absolute',
      `left:${box.left != null ? box.left + 'px' : '0'}`,
      `right:${box.right != null ? box.right + 'px' : '0'}`,
      vAnchorCss,
      `z-index:${z}`, 'pointer-events:none',
      `text-align:${clip.align || 'center'}`,
      `opacity:${opacity}`,
      `transform:translateY(${translateY}px) scale(${scale})`,
    ].join(';');

    const titleEl = document.createElement('div');
    titleEl.className = 'sr-text-hit';
    titleEl.style.cssText = [
      `font-family:${font}`, `font-size:${style.size || 96}px`,
      `font-weight:${style.weight || 400}`,
      `line-height:${style.lineHeight || 1.05}`, `color:${color}`,
      style.shadow ? `text-shadow:${style.shadow}` : '',
    ].join(';');
    titleEl.textContent = clip.text || '';
    el.appendChild(titleEl);

    if (clip.rule) {
      const r = clip.rule;
      const growStart = start + (r.growFrom != null ? r.growFrom : 0);
      const growEnd = start + (r.growTo != null ? r.growTo : 1);
      const width = animateRange(0, r.width || 0, growStart, growEnd, ease(r.ease || 'easeInOutQuart'))(t);
      const ruleEl = document.createElement('div');
      ruleEl.style.cssText = [
        `height:${r.height || 4}px`, `width:${width}px`,
        `background:${resolveColor(theme, r.color || '#fff')}`, 'margin:38px auto 0',
      ].join(';');
      el.appendChild(ruleEl);
    }

    // __editingSub is a transient, never-saved flag the editor sets on the
    // selected title clip so an empty subtitle still gets a DOM element to
    // double-click into (see startTitleTextEdit in app.js); export always
    // renders from a plain project.json clip, which never carries it.
    if (clip.sub || clip.__editingSub) {
      const ss = clip.subStyle || {};
      const subDelay = ss.delay || 0;
      const subOpacity = animateRange(0, 1, start + subDelay, start + subDelay + 0.4, ease('easeOutCubic'))(t);
      const subFont = (theme.fonts && theme.fonts[ss.font]) || ss.font || 'inherit';
      const subEl = document.createElement('div');
      subEl.className = 'sr-text-hit';
      subEl.style.cssText = [
        'margin-top:34px', `font-family:${subFont}`, `font-weight:${ss.weight || 400}`,
        `font-size:${ss.size || 32}px`, `letter-spacing:${ss.letterSpacing || 'normal'}`,
        `color:${resolveColor(theme, ss.color || '#fff')}`,
        `opacity:${clip.sub ? subOpacity : 0.4}`,
        clip.sub ? '' : 'font-style:italic;outline:1px dashed rgba(255,255,255,0.35);outline-offset:4px',
      ].join(';');
      subEl.textContent = clip.sub || '+ legenda (clique duplo)';
      el.appendChild(subEl);
    }

    return el;
  }

  function renderCaptionsTrack(project, track, t, z, activeRegions) {
    const boundId = track.bindTo ? track.bindTo.replace(/^tweak\./, '') : null;
    if (boundId && !effectiveTweakValue(project, boundId, activeRegions)) return null;
    const clip = (track.clips || []).find((c) => t >= c.start && t < c.end);
    if (!clip) return null;
    const fade = 0.18;
    const opacity = clamp(Math.min((t - clip.start) / fade, (clip.end - t) / fade), 0, 1);
    if (opacity <= 0.001) return null;

    const st = track.style || {};
    const box = st.box || {};
    const theme = project.theme || {};
    const font = (theme.fonts && theme.fonts[st.font]) || st.font || 'inherit';
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      `left:${box.left != null ? box.left + 'px' : '0'}`,
      `right:${box.right != null ? box.right + 'px' : '0'}`,
      `bottom:${box.bottom != null ? box.bottom + 'px' : '40px'}`,
      `z-index:${z}`, 'pointer-events:none',
      `text-align:${st.align || 'center'}`,
      `font-family:${font}`, `font-weight:${st.weight || 400}`,
      `font-size:${st.size || 32}px`, `line-height:${st.lineHeight || 1.3}`,
      `color:${resolveColor(theme, st.color || '#fff')}`,
      st.shadow ? `text-shadow:${st.shadow}` : '',
      `opacity:${opacity}`,
    ].join(';');
    el.textContent = clip.text || '';
    return el;
  }

  function renderFrame(project, t, container) {
    if (!project || !container) return;
    const canvas = project.canvas || {};
    const canvasHeight = canvas.height || 1920;
    container.style.width = (canvas.width || 1080) + 'px';
    container.style.height = canvasHeight + 'px';
    container.style.background = canvas.background || '#000';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.innerHTML = '';

    const activeRegions = activeRegionIds(project, t);
    const glitchK = effectiveTweakValue(project, 'glitch', activeRegions) || 0;
    const items = [];

    (project.tracks || []).forEach((track) => {
      if (track.enabled === false) return;
      const z = track.z || 0;

      if (track.kind === 'image') {
        const clips = track.clips || [];
        const idx = findActiveClipIndex(clips, t);
        if (idx === -1) return;
        const clip = clips[idx];
        const prev = idx > 0 ? clips[idx - 1] : null;
        // transitionDur (falls back to the older fadeIn field so existing
        // projects keep their look) is how long the crossfade from the
        // previous clip into this one takes, starting at this clip's start.
        // Capped to this clip's own length — otherwise the incoming image
        // never reaches full opacity before the clip's own end (it'd still
        // be mid-fade when the *next* clip's crossfade takes over), which
        // looks like it's permanently stuck translucent the whole time.
        const rawTransitionDur = clip.transitionDur != null ? clip.transitionDur : (clip.fadeIn || 0);
        const transitionDur = Math.min(rawTransitionDur, Math.max(0, clip.end - clip.start));
        if (prev && transitionDur > 0 && t < clip.start + transitionDur) {
          const localP = clamp((t - clip.start) / transitionDur, 0, 1);
          items.push({ z, el: renderImageClip(project, prev, t, z, 1 - localP) });
          items.push({ z: z + 0.1, el: renderImageClip(project, clip, t, z + 0.1, localP) });
        } else {
          items.push({ z, el: renderImageClip(project, clip, t, z) });
        }
        return;
      }

      if (track.kind === 'text') {
        (track.clips || []).forEach((clip) => {
          const el = renderTextClip(project, clip, t, z);
          if (el) items.push({ z, el });
        });
        return;
      }

      if (track.kind === 'captions') {
        const el = renderCaptionsTrack(project, track, t, z, activeRegions);
        if (el) items.push({ z, el });
        return;
      }

      if (track.kind === 'effects') {
        (track.layers || []).forEach((layer) => {
          if (layer.enabled === false) return;
          const lz = layer.z || z;
          let el = null;
          if (layer.type === 'scrim') el = renderScrimLayer(layer, t, lz);
          else if (layer.type === 'vignette') el = renderVignetteLayer(project, layer, t, lz);
          else if (layer.type === 'scanlines') el = renderScanlinesLayer(layer, t, lz);
          else if (layer.type === 'sweep') el = renderSweepLayer(canvasHeight, layer, t, lz);
          else if (layer.type === 'grain') el = renderGrainLayer(project, layer, t, lz, activeRegions);
          else if (layer.type === 'glitch') el = renderGlitchLayer(project, layer, t, lz, activeRegions, canvasHeight);
          else if (layer.type === 'static') el = renderStaticLayer(layer, t, lz);
          else if (layer.type === 'flashFrame') el = renderFlashFrameLayer(project, layer, t, lz, activeRegions);
          else if (layer.type === 'hud') el = renderHudLayer(project, layer, t, lz, glitchK);
          // spotlight: still pending.
          if (el) items.push({ z: lz, el });
        });
        return;
      }

      // component tracks (the CTA): a later stage, per plan.
    });

    items.sort((a, b) => a.z - b.z);
    items.forEach((it) => container.appendChild(it.el));
  }

  global.SCPRenderer = {
    renderFrame, noise, stut, Easing, clamp, lerp, ease, animateRange,
    progress, animValue, envelopeValue, resolveColor, assetUrl, audioUrl,
    tweakDefault, activeRegionIds, effectiveTweakValue,
  };
})(window);

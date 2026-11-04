(function () {
  'use strict';

  const STRIP_PX_PER_SEC = 50; // floor width for the clip/audio strips — keeps blocks tappable on narrow screens
  const MIN_CLIP_DURATION = 0.1; // floor so a trim drag can never zero out (or invert) a clip

  const stageOuter = document.getElementById('stage-outer');
  const stageFrame = document.getElementById('stage-frame');
  const stage = document.getElementById('stage');
  const stageInteract = document.getElementById('stage-interact');
  const focusHandle = document.getElementById('focus-handle');
  const kfButtons = Array.from(document.querySelectorAll('.co-kf-btn'));
  const playBtn = document.getElementById('play-btn');
  const saveBtn = document.getElementById('save-btn');
  const downloadZipBtn = document.getElementById('download-zip-btn');
  const saveStatus = document.getElementById('save-status');
  const scrub = document.getElementById('scrub');
  const timeField = document.getElementById('time-field');
  const durationLabel = document.getElementById('duration-label');
  const timelineRuler = document.getElementById('timeline-ruler');
  const timelineRulerTrack = document.getElementById('timeline-ruler-track');
  const clipStrip = document.getElementById('clip-strip');
  const clipStripTrack = document.getElementById('clip-strip-track');
  const clipStripPlayhead = document.getElementById('clip-strip-playhead');
  const clipOptionsEmpty = document.getElementById('clip-options-empty');
  const clipOptionsForm = document.getElementById('clip-options-form');
  const clipOptionsInfo = document.getElementById('clip-options-info');
  const swapImageBtn = document.getElementById('swap-image-btn');
  const assetPicker = document.getElementById('asset-picker');
  const assetPickerGrid = document.getElementById('asset-picker-grid');
  const assetPickerClose = document.getElementById('asset-picker-close');
  const assetUploadInput = document.getElementById('asset-upload-input');
  const audioStrip = document.getElementById('audio-strip');
  const audioStripTrack = document.getElementById('audio-strip-track');
  const audioStripPlayhead = document.getElementById('audio-strip-playhead');
  const audioUploadInput = document.getElementById('audio-upload-input');
  const titlesStrip = document.getElementById('titles-strip');
  const titlesStripTrack = document.getElementById('titles-strip-track');
  const titlesStripPlayhead = document.getElementById('titles-strip-playhead');
  const titleOptionsEmpty = document.getElementById('title-options-empty');
  const titleOptionsForm = document.getElementById('title-options-form');
  const titleSizeInput = document.getElementById('title-size-input');
  const titleFontInput = document.getElementById('title-font-input');
  const titleWeightInput = document.getElementById('title-weight-input');
  const titleSubSizeInput = document.getElementById('title-sub-size-input');
  const titleSubFontInput = document.getElementById('title-sub-font-input');
  const titleSubWeightInput = document.getElementById('title-sub-weight-input');
  const titleInDirInput = document.getElementById('title-in-dir-input');
  const titleInDurInput = document.getElementById('title-in-dur-input');
  const titleOutDirInput = document.getElementById('title-out-dir-input');
  const titleOutDurInput = document.getElementById('title-out-dur-input');
  const titleRemoveBtn = document.getElementById('title-remove-btn');
  const titlePositionHandle = document.getElementById('title-position-handle');

  // Single contextual side panel (matches the approved mockup): exactly one
  // tool is active at a time, the toolbar highlights only that icon, and the
  // panel swaps to the matching section with a "Propriedades · <tool>" title
  // — instead of several independently-toggled accordions.
  const sidePanelTitle = document.getElementById('side-panel-title');
  const toolCameraBtn = document.getElementById('tool-camera');
  const toolTransitionBtn = document.getElementById('tool-transition');
  const toolTextBtn = document.getElementById('tool-text');
  const toolAudioBtn = document.getElementById('tool-audio');
  const toolEffectsBtn = document.getElementById('fx-panel-open-btn');
  const toolSplitBtn = document.getElementById('tool-split');

  const toolButtons = {
    camera: toolCameraBtn, transition: toolTransitionBtn, text: toolTextBtn,
    audio: toolAudioBtn, effects: toolEffectsBtn, split: toolSplitBtn,
  };
  const panelSections = {
    camera: document.getElementById('clip-options'),
    transition: document.getElementById('transition-options'),
    text: document.getElementById('title-options'),
    audio: document.getElementById('audio-options'),
    effects: document.getElementById('fx-panel'),
    split: document.getElementById('split-options'),
  };
  const panelTitles = {
    camera: 'câmera', transition: 'transição', text: 'texto',
    audio: 'áudio', effects: 'efeitos', split: 'dividir',
  };
  let activeTool = 'camera';

  function setActiveTool(tool) {
    if (!panelSections[tool]) return;
    activeTool = tool;
    Object.keys(toolButtons).forEach((k) => toolButtons[k].classList.toggle('open', k === tool));
    Object.keys(panelSections).forEach((k) => { panelSections[k].hidden = k !== tool; });
    sidePanelTitle.textContent = 'Propriedades · ' + panelTitles[tool];
  }

  toolCameraBtn.addEventListener('click', () => setActiveTool('camera'));
  toolTransitionBtn.addEventListener('click', () => setActiveTool('transition'));
  toolTextBtn.addEventListener('click', () => setActiveTool('text'));
  toolAudioBtn.addEventListener('click', () => { setActiveTool('audio'); if (typeof refreshAudioOptionsPanel === 'function') refreshAudioOptionsPanel(); });
  toolEffectsBtn.addEventListener('click', () => setActiveTool('effects'));
  toolSplitBtn.addEventListener('click', () => { setActiveTool('split'); splitSelectedClip(); });

  setActiveTool('camera');
  // audio-options DOM refs are declared further down, after buildAudioStrip;
  // the panel's initial "nothing selected" state renders via its own
  // `hidden` default in the HTML, no extra call needed here.

  // The image/titles/audio strips are three separate scroll containers that
  // all share the same px-per-second scale and total width (STRIP_PX_PER_SEC
  // × project.duration) — so scrolling one should scroll the other two by
  // the exact same amount, keeping a given moment lined up vertically across
  // all three instead of drifting apart. The `syncing` guard stops the
  // mirrored scrollLeft writes from re-triggering each other's own listener.
  function linkStripScroll(strips) {
    let syncing = false;
    strips.forEach((el) => {
      el.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        strips.forEach((other) => {
          if (other !== el && other.scrollLeft !== el.scrollLeft) other.scrollLeft = el.scrollLeft;
        });
        syncing = false;
      });
    });
  }
  linkStripScroll([timelineRuler, clipStrip, titlesStrip, audioStrip]);

  // One shared ruler above the three strips (instead of each carrying its
  // own timecodes) — ticks every 5s, width/position on the same
  // STRIP_PX_PER_SEC scale as the tracks so it lines up exactly, and its
  // own scrollLeft is just mirrored from the strips above (never dragged
  // directly — see linkStripScroll).
  function buildTimelineRuler() {
    const duration = project.duration;
    const interval = 5;
    timelineRulerTrack.style.width = Math.round(duration * STRIP_PX_PER_SEC) + 'px';
    timelineRulerTrack.innerHTML = '';
    for (let s = 0; s <= duration; s += interval) {
      const tick = document.createElement('span');
      tick.className = 'timeline-ruler-tick';
      tick.style.left = Math.round(s * STRIP_PX_PER_SEC) + 'px';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      tick.textContent = m + ':' + String(sec).padStart(2, '0');
      timelineRulerTrack.appendChild(tick);
    }
  }

  // The small grip tab at the top of each strip's playhead line — dragging
  // it scrubs the video by converting the pointer's x position back into a
  // time, using the same STRIP_PX_PER_SEC scale the tracks were built with.
  // Wired identically on all three strips: since their scroll positions are
  // now synced and they share that same scale, dragging any one of them
  // moves every playhead (and the real transport scrub bar) together.
  const SCRUB_EDGE_ZONE = 36; // px from the container's edge that triggers auto-scroll
  const SCRUB_EDGE_MAX_SPEED = 20; // px scrolled per animation frame right at the edge
  function makeScrubHandleDraggable(gripEl, trackEl) {
    const containerEl = trackEl.parentElement;
    let dragging = false;
    let lastClientX = 0;
    let autoScrollRaf = null;

    function seekToClientX(clientX) {
      const rect = trackEl.getBoundingClientRect();
      pause();
      setTime((clientX - rect.left) / STRIP_PX_PER_SEC);
    }

    // Runs every frame while dragging, independent of pointermove — so
    // holding the pointer pinned against the edge of the strip (it can't
    // physically move further once it hits the screen/window edge) still
    // keeps scrolling the strip and pushing the seek forward, instead of
    // seeking stalling the moment the cursor stops moving.
    function autoScrollStep() {
      if (!dragging) { autoScrollRaf = null; return; }
      const rect = containerEl.getBoundingClientRect();
      let speed = 0;
      if (lastClientX < rect.left + SCRUB_EDGE_ZONE) {
        const depth = (rect.left + SCRUB_EDGE_ZONE - lastClientX) / SCRUB_EDGE_ZONE;
        speed = -SCRUB_EDGE_MAX_SPEED * Math.min(1, depth);
      } else if (lastClientX > rect.right - SCRUB_EDGE_ZONE) {
        const depth = (lastClientX - (rect.right - SCRUB_EDGE_ZONE)) / SCRUB_EDGE_ZONE;
        speed = SCRUB_EDGE_MAX_SPEED * Math.min(1, depth);
      }
      if (speed !== 0) {
        containerEl.scrollLeft += speed;
        seekToClientX(lastClientX);
      }
      autoScrollRaf = requestAnimationFrame(autoScrollStep);
    }

    gripEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastClientX = e.clientX;
      try { gripEl.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer to capture */ }
      seekToClientX(e.clientX);
      if (autoScrollRaf == null) autoScrollRaf = requestAnimationFrame(autoScrollStep);
    });
    gripEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      lastClientX = e.clientX;
      seekToClientX(e.clientX);
    });
    function stopDrag(e) {
      if (!dragging) return;
      dragging = false;
      // Belt-and-suspenders alongside the `if (!dragging)` check inside
      // autoScrollStep itself — cancels immediately rather than waiting on
      // one more (possibly throttled, if the tab isn't focused) rAF tick.
      if (autoScrollRaf != null) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
      try { gripEl.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
    gripEl.addEventListener('pointerup', stopDrag);
    gripEl.addEventListener('pointercancel', stopDrag);
  }
  makeScrubHandleDraggable(clipStripPlayhead.querySelector('.strip-playhead-grip'), clipStripTrack);
  makeScrubHandleDraggable(titlesStripPlayhead.querySelector('.strip-playhead-grip'), titlesStripTrack);
  makeScrubHandleDraggable(audioStripPlayhead.querySelector('.strip-playhead-grip'), audioStripTrack);

  let project = null;
  let t = 0;
  let playing = false;
  let lastTs = null;
  let clipBlocks = [];
  let selectedClip = null;
  let currentProjectDir = null;
  let originalAssetsBasePath = '';
  let uploadTargetClip = null;
  let audioBlocks = [];
  let selectedAudioClip = null;
  const audioElements = new Map(); // clip -> HTMLAudioElement
  let titleBlocks = [];
  let selectedTitleClip = null;
  let activeKeyframe = 'from';
  let dragMode = null; // 'pan' | 'focus' | 'titlepos' | 'titletext'
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanX = 0;
  let dragStartOffsetY = 0;
  let dragStartBoxLeft = 0;
  let dragStartBoxBottom = 0;
  let editingTextEl = null;
  let editingTextClip = null;
  let editingTextPart = null; // 'text' | 'sub'
  let editingTextCleanup = null;

  function validateProject(p) {
    const errs = [];
    if (!p.canvas || !p.canvas.width || !p.canvas.height) errs.push('canvas ausente/incompleto');
    if (typeof p.duration !== 'number') errs.push('duration ausente');
    if (!p.assets) errs.push('assets ausente');
    if (!Array.isArray(p.tracks)) errs.push('tracks ausente');
    if (errs.length) throw new Error('Projeto invalido: ' + errs.join(', '));
  }

  function fitScale() {
    if (!project) return;
    const canvas = project.canvas;
    const scale = Math.min(
      stageOuter.clientWidth / canvas.width,
      stageOuter.clientHeight / canvas.height,
      1
    );
    stageFrame.style.width = canvas.width + 'px';
    stageFrame.style.height = canvas.height + 'px';
    stageFrame.style.transform = `scale(${scale})`;
  }

  function render() {
    SCPRenderer.renderFrame(project, t, stage);
  }

  function setTime(nt) {
    t = clampTime(nt);
    scrub.value = String(t);
    timeField.value = t.toFixed(3);
    render();
    updateClipStripPlayhead();
    updateTitlesStripPlayhead();
    syncAudio();
    updateAudioStripPlayhead();
  }

  function imageTrack() {
    return (project.tracks || []).find((tr) => tr.kind === 'image') || null;
  }

  // Drag-to-reorder, shared by the image and audio strips: past a small
  // movement threshold the block follows the pointer and, on release, is
  // spliced into the clip list at the dropped position — every clip keeps
  // its own duration, only the order (and so start/end) changes.
  function reorderClipsByTime(clips, draggedClip, hoverTime) {
    const others = clips.filter((c) => c !== draggedClip);
    let insertAt = others.length;
    for (let i = 0; i < others.length; i++) {
      if (hoverTime < (others[i].start + others[i].end) / 2) { insertAt = i; break; }
    }
    others.splice(insertAt, 0, draggedClip);
    let cursor = 0;
    others.forEach((c) => {
      const dur = c.end - c.start;
      c.start = cursor;
      c.end = cursor + dur;
      cursor += dur;
    });
    clips.length = 0;
    others.forEach((c) => clips.push(c));
  }

  function makeClipDraggable(el, clip, clips, stripTrackEl, duration, onDrop, ignoreTarget) {
    let pointerId = null;
    let startX = 0;
    let dragging = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (ignoreTarget && ignoreTarget(e.target))) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      dragging = false;
    });

    el.addEventListener('pointermove', (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 6) return;
        dragging = true;
        el.classList.add('dragging');
        el.setPointerCapture(pointerId);
      }
      el.style.transform = `translateX(${dx}px)`;
      el.style.zIndex = '20';
    });

    function finish(e, commit) {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const wasDragging = dragging;
      try { el.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
      pointerId = null;
      dragging = false;
      el.style.transform = '';
      el.style.zIndex = '';
      el.classList.remove('dragging');
      if (wasDragging) {
        el._justDragged = true;
        if (commit) {
          const rect = stripTrackEl.getBoundingClientRect();
          const relX = SCPRenderer.clamp(e.clientX - rect.left, 0, rect.width);
          onDrop((relX / rect.width) * duration);
        }
      }
    }

    el.addEventListener('pointerup', (e) => finish(e, true));
    el.addEventListener('pointercancel', (e) => finish(e, false));
  }

  // Trim handles at the edges of a clip block (CapCut-style), shared by the
  // image and titles strips. Only visual — el.style.left/width get a live
  // preview via calc(), nothing in the data model changes until pointerup,
  // when onCommit(side, clip, newValue) applies whatever chain/independence
  // rule that track needs and triggers a full re-layout. This mirrors
  // makeClipDraggable's preview-then-commit pattern, and matters because a
  // mid-drag rebuild would destroy the handle that currently owns pointer
  // capture. onPreview(newStart, newEnd), if given, is called on every move
  // so the caller can show live feedback (e.g. an info label).
  function makeClipResizable(el, clip, side, stripTrackEl, getDuration, onCommit, onPreview) {
    const handle = document.createElement('div');
    handle.className = 'clip-handle clip-handle-' + side;
    el.appendChild(handle);

    let pointerId = null;
    let startX = 0;
    let origStart = 0;
    let origEnd = 0;
    let previewValue = null;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      pointerId = e.pointerId;
      startX = e.clientX;
      origStart = clip.start;
      origEnd = clip.end;
      previewValue = null;
      handle.setPointerCapture(pointerId);
      el.classList.add('resizing');
    });

    handle.addEventListener('pointermove', (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const rect = stripTrackEl.getBoundingClientRect();
      const duration = getDuration();
      const dxPx = e.clientX - startX;
      const dt = (dxPx / rect.width) * duration;

      if (side === 'right') {
        const newEnd = Math.max(origStart + MIN_CLIP_DURATION, origEnd + dt);
        previewValue = newEnd;
        el.style.width = ((newEnd - origStart) / duration) * 100 + '%';
        if (onPreview) onPreview(origStart, newEnd);
      } else {
        const newStart = SCPRenderer.clamp(origStart + dt, 0, origEnd - MIN_CLIP_DURATION);
        previewValue = newStart;
        el.style.left = (newStart / duration) * 100 + '%';
        el.style.width = ((origEnd - newStart) / duration) * 100 + '%';
        if (onPreview) onPreview(newStart, origEnd);
      }
    });

    function finish(e, commit) {
      if (pointerId == null || e.pointerId !== pointerId) return;
      try { handle.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
      pointerId = null;
      el.classList.remove('resizing');
      el.style.left = '';
      el.style.width = '';
      if (commit && previewValue != null) onCommit(side, clip, previewValue);
      previewValue = null;
    }

    handle.addEventListener('pointerup', (e) => finish(e, true));
    handle.addEventListener('pointercancel', (e) => finish(e, false));
  }

  // Applies a trim on the (chained) image track: 'right' moves this clip's
  // end and ripples every clip after it by the same delta (so the chain
  // stays gapless and the video's total duration follows the last clip's
  // new end); 'left' only rolls the boundary with the previous clip, since
  // it alone shares that edge — re-clamped here (not in the drag preview)
  // so the previous clip can't be squeezed below its own minimum duration.
  function commitClipResize(side, clip, newValue) {
    const track = imageTrack();
    if (!track) return;
    const idx = track.clips.indexOf(clip);
    if (side === 'right') {
      const delta = newValue - clip.end;
      clip.end = newValue;
      for (let j = idx + 1; j < track.clips.length; j++) {
        track.clips[j].start += delta;
        track.clips[j].end += delta;
      }
      project.duration = track.clips[track.clips.length - 1].end;
    } else {
      const prevClip = idx > 0 ? track.clips[idx - 1] : null;
      const minStart = prevClip ? prevClip.start + MIN_CLIP_DURATION : 0;
      clip.start = Math.max(newValue, minStart);
      if (prevClip) prevClip.end = clip.start;
    }
    syncDurationDependentUI();
    buildClipStrip();
    render();
    if (clip === selectedClip) selectClip(clip);
  }

  // Keeps everything that depends on project.duration — the scrub bar's
  // range, the header label, the audio strip's width — in sync after a trim
  // changes it. Also pulled out so loadProject() can reuse it at startup.
  function syncDurationDependentUI() {
    scrub.max = String(project.duration);
    durationLabel.textContent =
      project.duration.toFixed(1) + 's · ' + project.canvas.width + 'x' + project.canvas.height +
      ' · ' + (project.canvas.fps || 30) + 'fps';
    if (t > project.duration) setTime(project.duration);
    buildAudioStrip();
    buildTitlesStrip();
    buildTimelineRuler();
  }

  function buildClipStrip() {
    clipStripTrack.innerHTML = '';
    clipStripTrack.appendChild(clipStripPlayhead);
    clipBlocks = [];
    const track = imageTrack();
    if (!track) return;
    const duration = project.duration;
    clipStripTrack.style.width = Math.round(duration * STRIP_PX_PER_SEC) + 'px';
    (track.clips || []).forEach((clip, idx) => {
      const leftPct = (clip.start / duration) * 100;
      const widthPct = ((clip.end - clip.start) / duration) * 100;
      const el = document.createElement('div');
      el.className = 'clip-block';
      el.style.left = leftPct + '%';
      el.style.width = widthPct + '%';
      const url = SCPRenderer.assetUrl(project, clip.asset);
      if (url) el.style.backgroundImage = `url("${url}")`;
      const label = document.createElement('div');
      label.className = 'clip-block-label';
      label.textContent = clip.asset + '  ' + clip.start.toFixed(1) + 's';
      el.appendChild(label);
      el.addEventListener('click', () => {
        if (el._justDragged) { el._justDragged = false; return; }
        pause();
        setTime(clip.start);
        selectClip(clip);
      });
      el.addEventListener('dblclick', () => {
        selectClip(clip);
        openAssetPicker(clip);
      });
      makeClipDraggable(
        el, clip, track.clips, clipStripTrack, duration,
        (hoverTime) => {
          reorderClipsByTime(track.clips, clip, hoverTime);
          buildClipStrip();
          render();
        },
        (target) => target.classList.contains('clip-handle')
      );
      const previewInfo = (s, e) => {
        clipOptionsInfo.textContent = clip.asset + '  ·  ' + s.toFixed(1) + 's \u2192 ' + e.toFixed(1) + 's';
      };
      // The chain always starts at 0, so the first clip's left edge has
      // nothing to trim against — only give it the right handle.
      if (idx > 0) {
        makeClipResizable(el, clip, 'left', clipStripTrack, () => project.duration, commitClipResize, previewInfo);
      }
      makeClipResizable(el, clip, 'right', clipStripTrack, () => project.duration, commitClipResize, previewInfo);
      clipStripTrack.appendChild(el);
      clipBlocks.push({ clip, el });
      if (idx > 0) clipStripTrack.appendChild(makeTransitionMarker(clip, leftPct));
    });
    updateClipStripPlayhead();
  }

  // A small bowtie icon sitting right on the cut between this clip and the
  // previous one — click to add/remove a crossfade there, scroll to tune its
  // length. This is the transition itself, not a tucked-away panel toggle:
  // placed exactly where a transition conceptually lives, between the two clips.
  const DEFAULT_TRANSITION_DUR = 0.8;
  function markerTitle(dur) {
    return dur > 0
      ? 'Transição: ' + dur.toFixed(2) + 's — clique pra remover, role pra ajustar'
      : 'Sem transição — clique pra adicionar um fade, ou role aqui';
  }
  function makeTransitionMarker(clip, leftPct) {
    const marker = document.createElement('div');
    marker.className = 'transition-marker' + (clip.transitionDur > 0 ? ' active' : '');
    marker.style.left = leftPct + '%';
    marker.title = markerTitle(clip.transitionDur || 0);
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      clip.transitionDur = clip.transitionDur > 0 ? 0 : DEFAULT_TRANSITION_DUR;
      marker.classList.toggle('active', clip.transitionDur > 0);
      marker.title = markerTitle(clip.transitionDur);
      render();
    });
    marker.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, Math.round(((clip.transitionDur || 0) + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100);
      clip.transitionDur = next;
      marker.classList.toggle('active', next > 0);
      marker.title = markerTitle(next);
      render();
    }, { passive: false });
    return marker;
  }

  const transitionBulkInput = document.getElementById('transition-bulk-input');
  const transitionBulkApply = document.getElementById('transition-bulk-apply');
  const transitionBulkClear = document.getElementById('transition-bulk-clear');

  transitionBulkApply.addEventListener('click', () => {
    // Brazilian keyboards type "1,5", not "1.5" — parseFloat alone stops at
    // the comma and silently returns just the integer part (1), which is
    // why different typed durations all looked the same.
    const v = parseFloat(String(transitionBulkInput.value).replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    const clips = (imageTrack() && imageTrack().clips) || [];
    clips.forEach((clip, idx) => { if (idx > 0) clip.transitionDur = v; });
    buildClipStrip();
    render();
  });

  transitionBulkClear.addEventListener('click', () => {
    const clips = (imageTrack() && imageTrack().clips) || [];
    clips.forEach((clip) => { clip.transitionDur = 0; });
    buildClipStrip();
    render();
  });

  function updateClipStripPlayhead() {
    if (!project) return;
    const pct = (t / project.duration) * 100;
    clipStripPlayhead.style.left = pct + '%';
    clipBlocks.forEach(({ clip, el }) => {
      const active = t >= clip.start && (t < clip.end || clip === clipBlocks[clipBlocks.length - 1].clip);
      el.classList.toggle('active', active);
      el.classList.toggle('selected', clip === selectedClip);
    });
  }

  // ---- Audio track -------------------------------------------------------

  function audioTrack() {
    return (project.tracks || []).find((tr) => tr.kind === 'audio') || null;
  }

  function ensureAudioTrack() {
    let track = audioTrack();
    if (!track) {
      track = { id: 'audio', kind: 'audio', label: 'Áudio', z: 0, clips: [] };
      project.tracks.push(track);
    }
    if (!project.assets.audio) project.assets.audio = [];
    return track;
  }

  function getAudioEl(clip) {
    let el = audioElements.get(clip);
    if (!el) {
      const url = SCPRenderer.audioUrl(project, clip.asset);
      if (!url) return null;
      el = new Audio(url);
      el.preload = 'auto';
      audioElements.set(clip, el);
    }
    return el;
  }

  function syncAudio() {
    const track = audioTrack();
    if (!track) return;
    (track.clips || []).forEach((clip) => {
      const el = getAudioEl(clip);
      if (!el) return;
      const within = t >= clip.start && t < clip.end;
      el.volume = clip.volume != null ? clip.volume : 1;
      if (within) {
        const target = t - clip.start + (clip.offset || 0);
        // .play() must be called in the same tick as the user gesture (the
        // click on the play button, via requestAnimationFrame) or Chrome's
        // autoplay policy silently blocks it — so it must never be deferred
        // behind an async 'loadedmetadata' wait. Seeking is what's unreliable
        // before readyState >= HAVE_METADATA, so only *that* part waits.
        if (el.readyState < 1) {
          if (!el.dataset.seekPending) {
            el.dataset.seekPending = '1';
            el.addEventListener('loadedmetadata', () => {
              delete el.dataset.seekPending;
              el.currentTime = t - clip.start + (clip.offset || 0);
            }, { once: true });
          }
        } else if (Math.abs(el.currentTime - target) > 0.15) {
          el.currentTime = target;
        }
        if (playing) {
          if (el.paused) el.play().catch((err) => console.error('Falha ao tocar áudio:', err));
        } else if (!el.paused) {
          el.pause();
        }
      } else if (!el.paused) {
        el.pause();
      }
    });
  }

  function pauseAllAudio() {
    audioElements.forEach((el) => { if (!el.paused) el.pause(); });
  }

  function buildAudioStrip() {
    audioStripTrack.innerHTML = '';
    audioStripTrack.appendChild(audioStripPlayhead);
    audioBlocks = [];
    const track = audioTrack();
    const duration = project.duration;
    audioStripTrack.style.width = Math.round(duration * STRIP_PX_PER_SEC) + 'px';

    ((track && track.clips) || []).forEach((clip) => {
      const audioEntry = (project.assets.audio || []).find((a) => a.id === clip.asset);
      const el = document.createElement('div');
      el.className = 'audio-block';
      el.style.left = (clip.start / duration) * 100 + '%';
      el.style.width = ((clip.end - clip.start) / duration) * 100 + '%';

      const label = document.createElement('div');
      label.className = 'audio-block-label';
      label.textContent = (audioEntry && audioEntry.file) || clip.asset;
      el.appendChild(label);

      const controls = document.createElement('div');
      controls.className = 'audio-block-controls';
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
      vol.value = clip.volume != null ? clip.volume : 1;
      vol.addEventListener('click', (e) => e.stopPropagation());
      vol.addEventListener('input', () => {
        clip.volume = parseFloat(vol.value);
        syncAudio();
        if (selectedAudioClip === clip) refreshAudioOptionsPanel();
      });
      const removeBtn = document.createElement('button');
      removeBtn.className = 'audio-block-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remover áudio';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el2 = audioElements.get(clip);
        if (el2) { el2.pause(); audioElements.delete(clip); }
        track.clips = track.clips.filter((c) => c !== clip);
        if (selectedAudioClip === clip) selectedAudioClip = null;
        buildAudioStrip();
        refreshAudioOptionsPanel();
      });
      controls.appendChild(vol);
      controls.appendChild(removeBtn);
      el.appendChild(controls);

      el.addEventListener('click', () => {
        if (el._justDragged) { el._justDragged = false; return; }
        selectedAudioClip = clip;
        setActiveTool('audio');
        updateAudioStripPlayhead();
        refreshAudioOptionsPanel();
      });

      makeClipDraggable(
        el, clip, track.clips, audioStripTrack, duration,
        (hoverTime) => {
          reorderClipsByTime(track.clips, clip, hoverTime);
          buildAudioStrip();
          syncAudio();
        },
        (target) => !!target.closest('.audio-block-controls')
      );

      audioStripTrack.appendChild(el);
      audioBlocks.push({ clip, el });
    });

    const addTile = document.createElement('div');
    addTile.className = 'audio-add-tile';
    addTile.textContent = '+ Áudio';
    // Without an explicit left, an absolutely-positioned element with no
    // in-flow siblings (every clip block here is itself absolute) falls
    // back to the top-left corner — sitting right on top of a clip that
    // starts at 0s (very common: a full-length narration/music track),
    // making it look like the track is empty when it's actually full.
    const audioRightmostEndPx = ((track && track.clips) || [])
      .reduce((max, c) => Math.max(max, c.end), 0) * STRIP_PX_PER_SEC;
    addTile.style.left = audioRightmostEndPx + 'px';
    addTile.addEventListener('click', () => {
      audioUploadInput.value = '';
      audioUploadInput.click();
    });
    audioStripTrack.appendChild(addTile);

    updateAudioStripPlayhead();
  }

  function updateAudioStripPlayhead() {
    if (!project) return;
    const pct = (t / project.duration) * 100;
    audioStripPlayhead.style.left = pct + '%';
    audioBlocks.forEach(({ clip, el }) => el.classList.toggle('selected', clip === selectedAudioClip));
  }

  const audioOptionsEmpty = document.getElementById('audio-options-empty');
  const audioOptionsForm = document.getElementById('audio-options-form');
  const audioOptionsInfo = document.getElementById('audio-options-info');
  const audioOptionsVolumeRange = document.getElementById('audio-options-volume-range');
  const audioOptionsVolumeNumber = document.getElementById('audio-options-volume-number');
  const audioOptionsRemoveBtn = document.getElementById('audio-options-remove-btn');

  function refreshAudioOptionsPanel() {
    if (!selectedAudioClip) {
      audioOptionsEmpty.hidden = false;
      audioOptionsForm.hidden = true;
      return;
    }
    const audioEntry = (project.assets.audio || []).find((a) => a.id === selectedAudioClip.asset);
    audioOptionsEmpty.hidden = true;
    audioOptionsForm.hidden = false;
    audioOptionsInfo.textContent = (audioEntry && audioEntry.file) || selectedAudioClip.asset;
    const vol = selectedAudioClip.volume != null ? selectedAudioClip.volume : 1;
    audioOptionsVolumeRange.value = vol;
    audioOptionsVolumeNumber.value = vol;
  }

  function setSelectedAudioVolume(vol) {
    if (!selectedAudioClip) return;
    selectedAudioClip.volume = SCPRenderer.clamp(vol, 0, 1);
    syncAudio();
    refreshAudioOptionsPanel();
    const block = audioBlocks.find((b) => b.clip === selectedAudioClip);
    if (block) {
      const rangeInput = block.el.querySelector('.audio-block-controls input[type="range"]');
      if (rangeInput) rangeInput.value = selectedAudioClip.volume;
    }
  }

  audioOptionsVolumeRange.addEventListener('input', () => setSelectedAudioVolume(parseFloat(audioOptionsVolumeRange.value)));
  audioOptionsVolumeNumber.addEventListener('input', () => setSelectedAudioVolume(parseFloat(audioOptionsVolumeNumber.value)));
  audioOptionsRemoveBtn.addEventListener('click', () => {
    if (!selectedAudioClip) return;
    const track = audioTrack();
    if (!track) return;
    const el2 = audioElements.get(selectedAudioClip);
    if (el2) { el2.pause(); audioElements.delete(selectedAudioClip); }
    track.clips = track.clips.filter((c) => c !== selectedAudioClip);
    selectedAudioClip = null;
    buildAudioStrip();
    refreshAudioOptionsPanel();
  });

  function audioIdFromFilename(filename) {
    const dot = filename.lastIndexOf('.');
    let base = dot > 0 ? filename.slice(0, dot) : filename;
    const existing = new Set((project.assets.audio || []).map((a) => a.id));
    let id = base;
    for (let n = 2; existing.has(id); n++) id = base + '-' + n;
    return id;
  }

  async function handleAudioUpload(file) {
    const filename = await uploadAssetToServer(file);
    const id = audioIdFromFilename(filename);
    const track = ensureAudioTrack();
    project.assets.audio.push({ id, file: filename });
    track.clips.push({ id: 'a' + Date.now(), asset: id, start: 0, end: project.duration, volume: 1 });
    buildAudioStrip();
  }

  // ---- Titles (text overlay) track ---------------------------------------
  //
  // Unlike the image track, text cards aren't chained — each one sits at
  // whatever start/end the user placed it at, and can overlap or leave
  // gaps freely. So dragging a whole block just shifts it in time (see
  // makeClipShiftable), and the trim handles only ever touch the clip
  // being dragged (see commitTitleResize) — no ripple, no chain neighbor.

  function titlesTrack() {
    return (project.tracks || []).find((tr) => tr.kind === 'text') || null;
  }

  function ensureTitlesTrack() {
    let track = titlesTrack();
    if (!track) {
      track = { id: 'titles', kind: 'text', label: 'Títulos', z: 52, clips: [] };
      project.tracks.push(track);
    }
    return track;
  }

  // Whole-block drag for freely-placed clips: shifts start+end together by
  // the dragged delta (clamped to stay inside [0, duration]), unlike
  // makeClipDraggable's reorder-and-repack behaviour used by the chained
  // image/audio strips.
  function makeClipShiftable(el, clip, stripTrackEl, getDuration, onCommit, ignoreTarget) {
    let pointerId = null;
    let startX = 0;
    let dragging = false;
    let origStart = 0;
    let origEnd = 0;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (ignoreTarget && ignoreTarget(e.target))) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      dragging = false;
      origStart = clip.start;
      origEnd = clip.end;
    });

    el.addEventListener('pointermove', (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 6) return;
        dragging = true;
        el.classList.add('dragging');
        el.setPointerCapture(pointerId);
      }
      el.style.transform = `translateX(${dx}px)`;
    });

    function finish(e, commit) {
      if (pointerId == null || e.pointerId !== pointerId) return;
      const wasDragging = dragging;
      try { el.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
      pointerId = null;
      dragging = false;
      el.style.transform = '';
      el.classList.remove('dragging');
      if (wasDragging) {
        el._justDragged = true;
        if (commit) {
          const rect = stripTrackEl.getBoundingClientRect();
          const duration = getDuration();
          const dt = ((e.clientX - startX) / rect.width) * duration;
          const dur = origEnd - origStart;
          const newStart = SCPRenderer.clamp(origStart + dt, 0, Math.max(0, duration - dur));
          onCommit(newStart, newStart + dur);
        }
      }
    }

    el.addEventListener('pointerup', (e) => finish(e, true));
    el.addEventListener('pointercancel', (e) => finish(e, false));
  }

  function buildTitlesStrip() {
    titlesStripTrack.innerHTML = '';
    titlesStripTrack.appendChild(titlesStripPlayhead);
    titleBlocks = [];
    const track = titlesTrack();
    const duration = project.duration;
    titlesStripTrack.style.width = Math.round(duration * STRIP_PX_PER_SEC) + 'px';

    ((track && track.clips) || []).forEach((clip) => {
      const el = document.createElement('div');
      el.className = 'title-block';
      el.style.left = (clip.start / duration) * 100 + '%';
      el.style.width = ((clip.end - clip.start) / duration) * 100 + '%';

      const label = document.createElement('div');
      label.className = 'title-block-label';
      label.textContent = clip.text || '(sem texto)';
      el.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'title-block-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remover este texto';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        track.clips = track.clips.filter((c) => c !== clip);
        if (selectedTitleClip === clip) deselectTitleClip();
        buildTitlesStrip();
        render();
      });
      el.appendChild(removeBtn);

      el.addEventListener('click', () => {
        if (el._justDragged) { el._justDragged = false; return; }
        selectTitleClip(clip);
      });

      makeClipShiftable(
        el, clip, titlesStripTrack, () => project.duration,
        (newStart, newEnd) => {
          clip.start = newStart;
          clip.end = newEnd;
          buildTitlesStrip();
          render();
          if (clip === selectedTitleClip) selectTitleClip(clip);
        },
        (target) => target.classList.contains('clip-handle') || target.classList.contains('title-block-remove')
      );

      makeClipResizable(el, clip, 'left', titlesStripTrack, () => project.duration, commitTitleResize);
      makeClipResizable(el, clip, 'right', titlesStripTrack, () => project.duration, commitTitleResize);

      titlesStripTrack.appendChild(el);
      titleBlocks.push({ clip, el });
    });

    const addTile = document.createElement('div');
    addTile.className = 'title-add-tile';
    addTile.textContent = '+ Texto';
    // Same fix as the audio strip's add-tile: default to left:0 (its static
    // position, since every card here is absolutely positioned) instead of
    // trailing the last card, so it doesn't sit on top of one that starts at 0s.
    const titleRightmostEndPx = ((track && track.clips) || [])
      .reduce((max, c) => Math.max(max, c.end), 0) * STRIP_PX_PER_SEC;
    addTile.style.left = titleRightmostEndPx + 'px';
    addTile.addEventListener('click', addTitleClip);
    titlesStripTrack.appendChild(addTile);

    updateTitlesStripPlayhead();
  }

  function updateTitlesStripPlayhead() {
    if (!project) return;
    const pct = (t / project.duration) * 100;
    titlesStripPlayhead.style.left = pct + '%';
    titleBlocks.forEach(({ clip, el }) => el.classList.toggle('selected', clip === selectedTitleClip));
  }

  // Independent trim (no chain neighbor, no project.duration change):
  // clamps stay entirely within this one clip's own bounds.
  function commitTitleResize(side, clip, newValue) {
    if (side === 'right') {
      clip.end = SCPRenderer.clamp(newValue, clip.start + MIN_CLIP_DURATION, project.duration);
    } else {
      clip.start = SCPRenderer.clamp(newValue, 0, clip.end - MIN_CLIP_DURATION);
    }
    buildTitlesStrip();
    render();
    if (clip === selectedTitleClip) selectTitleClip(clip);
  }

  function refreshTitleBlock(clip) {
    const entry = titleBlocks.find((b) => b.clip === clip);
    if (entry) entry.el.querySelector('.title-block-label').textContent = clip.text || '(sem texto)';
  }

  // The handle marks the box's bottom-left anchor point — box.left/right and
  // box.top are ignored on purpose; every title card this editor creates or
  // edits is normalized to a left+bottom anchor (see the pointermove
  // handler below) so this one drag point always means the same thing.
  function positionTitleHandle(clip) {
    const box = clip.box || {};
    const leftPct = ((box.left || 0) / project.canvas.width) * 100;
    const topPct = ((project.canvas.height - (box.bottom || 0)) / project.canvas.height) * 100;
    titlePositionHandle.style.left = leftPct + '%';
    titlePositionHandle.style.top = topPct + '%';
  }

  // Fonts are per-project theme tokens (project.theme.fonts), not a fixed
  // list — populate the dropdown from whatever this project defines, plus
  // the clip's current value in case it's a raw font-family string instead
  // of a known token (e.g. a project with no theme.fonts entry at all).
  function populateFontSelect(selectEl, currentValue) {
    const fonts = (project.theme && project.theme.fonts) || {};
    const keys = Object.keys(fonts);
    if (currentValue && !keys.includes(currentValue)) keys.push(currentValue);
    selectEl.innerHTML = '';
    keys.forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      selectEl.appendChild(opt);
    });
    selectEl.value = currentValue || keys[0] || '';
  }

  // Direction is just the sign of the vertical offset the entrance/exit
  // animation travels — positive dy means the text starts/ends below its
  // resting spot (translateY moves it down), negative means above. "Subir"
  // reads as "comes from below rising up" on entry but "continues rising
  // off the top" on exit, so the sign flips between the two.
  const TITLE_DIR_MAGNITUDE = 30;
  function dirFromDy(dy, isExit) {
    if (!dy) return 'none';
    const up = isExit ? dy < 0 : dy > 0;
    return up ? 'up' : 'down';
  }
  function dyFromDir(dir, isExit) {
    if (dir === 'none') return 0;
    const up = dir === 'up';
    const sign = isExit ? (up ? -1 : 1) : (up ? 1 : -1);
    return sign * TITLE_DIR_MAGNITUDE;
  }

  function selectTitleClip(clip) {
    deselectClip();
    if (selectedTitleClip && selectedTitleClip !== clip) deselectTitleClip();
    selectedTitleClip = clip;
    const style = clip.style || (clip.style = {});
    const subStyle = clip.subStyle || (clip.subStyle = {});
    titleSizeInput.value = style.size != null ? style.size : 96;
    populateFontSelect(titleFontInput, style.font);
    titleWeightInput.value = String(style.weight != null ? style.weight : 400);
    titleSubSizeInput.value = subStyle.size != null ? subStyle.size : 32;
    populateFontSelect(titleSubFontInput, subStyle.font);
    titleSubWeightInput.value = String(subStyle.weight != null ? subStyle.weight : 400);
    const inSpec = clip.in || (clip.in = {});
    const outSpec = clip.out || (clip.out = {});
    titleInDirInput.value = dirFromDy(inSpec.dy, false);
    titleInDurInput.value = inSpec.dur != null ? inSpec.dur : (inSpec.fadeDur != null ? inSpec.fadeDur : 0.5);
    titleOutDirInput.value = dirFromDy(outSpec.dy, true);
    titleOutDurInput.value = outSpec.dur != null ? outSpec.dur : 0.3;
    // Transient, never saved (see renderTextClip in renderer.js) — gives an
    // empty subtitle a ghost DOM element so there's still something on the
    // stage to double-click to start typing one.
    clip.__editingSub = true;
    clip.box || (clip.box = {});
    titleOptionsEmpty.hidden = true;
    titleOptionsForm.hidden = false;
    setActiveTool('text');
    positionTitleHandle(clip);
    titlePositionHandle.hidden = false;
    pause();
    // Jump to the middle of the card instead of clip.start — at start the
    // in-animation's fade/rise is still at 0, so it wouldn't actually be
    // visible yet on the stage while editing it.
    setTime(SCPRenderer.clamp((clip.start + clip.end) / 2, clip.start, clip.end));
    updateTitlesStripPlayhead();
  }

  function deselectTitleClip() {
    if (!selectedTitleClip) return;
    endTitleTextEdit(true);
    delete selectedTitleClip.__editingSub;
    selectedTitleClip = null;
    titleOptionsEmpty.hidden = false;
    titleOptionsForm.hidden = true;
    titlePositionHandle.hidden = true;
    updateTitlesStripPlayhead();
  }

  function addTitleClip() {
    const track = ensureTitlesTrack();
    const dur = 3;
    const start = SCPRenderer.clamp(t, 0, Math.max(0, project.duration - dur));
    const clip = {
      id: 'tt' + Date.now(),
      start, end: Math.min(project.duration, start + dur),
      text: 'Novo texto', sub: '',
      box: { left: 150, bottom: 300 },
      align: 'left',
      style: {
        font: 'mono', weight: 700, size: 96, lineHeight: 1, letterSpacing: '0.02em',
        color: '@ink', shadow: '0 8px 40px rgba(0,0,0,0.95)',
      },
      subStyle: {
        font: 'mono', size: 28, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.7)',
        marginTop: 22, paddingTop: 18, ruleTop: { thickness: 3, color: '@red' },
      },
      in: { kind: 'riseFade', dy: 24, dur: 0.5, riseDur: 0.9, ease: 'easeOutQuint', fadeEase: 'easeOutCubic' },
      out: { kind: 'fade', dur: 0.6, ease: 'easeInOutQuart' },
    };
    track.clips.push(clip);
    buildTitlesStrip();
    selectTitleClip(clip);
    render();
  }

  function applyTitleStyleField(group, key, value) {
    if (!selectedTitleClip) return;
    const target = selectedTitleClip[group] || (selectedTitleClip[group] = {});
    target[key] = value;
    render();
  }

  titleSizeInput.addEventListener('input', () => {
    const value = parseFloat(titleSizeInput.value);
    if (!isNaN(value)) applyTitleStyleField('style', 'size', value);
  });
  titleFontInput.addEventListener('change', () => applyTitleStyleField('style', 'font', titleFontInput.value));
  titleWeightInput.addEventListener('change', () => applyTitleStyleField('style', 'weight', parseInt(titleWeightInput.value, 10)));

  titleSubSizeInput.addEventListener('input', () => {
    const value = parseFloat(titleSubSizeInput.value);
    if (!isNaN(value)) applyTitleStyleField('subStyle', 'size', value);
  });
  titleSubFontInput.addEventListener('change', () => applyTitleStyleField('subStyle', 'font', titleSubFontInput.value));
  titleSubWeightInput.addEventListener('change', () => applyTitleStyleField('subStyle', 'weight', parseInt(titleSubWeightInput.value, 10)));

  titleInDirInput.addEventListener('change', () => {
    applyTitleStyleField('in', 'dy', dyFromDir(titleInDirInput.value, false));
  });
  titleInDurInput.addEventListener('input', () => {
    if (!selectedTitleClip) return;
    const value = parseFloat(titleInDurInput.value);
    if (isNaN(value) || value < 0) return;
    const inSpec = selectedTitleClip.in || (selectedTitleClip.in = {});
    inSpec.dur = value;
    inSpec.fadeDur = value;
    render();
  });
  titleOutDirInput.addEventListener('change', () => {
    applyTitleStyleField('out', 'dy', dyFromDir(titleOutDirInput.value, true));
  });
  titleOutDurInput.addEventListener('input', () => {
    const value = parseFloat(titleOutDurInput.value);
    if (!isNaN(value) && value >= 0) applyTitleStyleField('out', 'dur', value);
  });

  titleRemoveBtn.addEventListener('click', () => {
    if (!selectedTitleClip) return;
    const track = titlesTrack();
    if (track) track.clips = track.clips.filter((c) => c !== selectedTitleClip);
    deselectTitleClip();
    buildTitlesStrip();
    render();
  });

  // ---- Effects panel (tweaks + effect-layer list + HUD editor) ----------

  const tweakGlitchField = document.getElementById('tweak-glitch');
  const tweakGlitchRange = tweakGlitchField.querySelector('input[type="range"]');
  const tweakGlitchNum = tweakGlitchField.querySelector('input[type="number"]');
  const tweakCaptions = document.getElementById('tweak-captions');
  const tweakFlashes = document.getElementById('tweak-flashes');
  const fxLayersList = document.getElementById('fx-layers-list');
  const hudEditorRow = document.getElementById('hud-editor-row');
  const hudNudgeField = document.getElementById('hud-nudge-field');
  const hudNudgeRange = hudNudgeField.querySelector('input[type="range"]');
  const hudNudgeNum = hudNudgeField.querySelector('input[type="number"]');

  let selectedFxLayer = null;
  let hudNudgeApplied = 0;

  function findTweak(id) {
    return (project.tweaks || []).find((tw) => tw.id === id);
  }

  function populateTweaksPanel() {
    const glitch = findTweak('glitch');
    tweakGlitchRange.value = tweakGlitchNum.value = glitch ? glitch.default : 0;
    const captions = findTweak('captions');
    tweakCaptions.checked = !!(captions && captions.default);
    const flashes = findTweak('flashes');
    tweakFlashes.checked = !!(flashes && flashes.default);
  }

  function setGlitchTweak(v) {
    const tw = findTweak('glitch');
    if (!tw) return;
    tw.default = v;
    tweakGlitchRange.value = v;
    tweakGlitchNum.value = v;
    render();
  }

  tweakGlitchRange.addEventListener('input', () => setGlitchTweak(parseFloat(tweakGlitchRange.value)));
  tweakGlitchNum.addEventListener('input', () => {
    const v = parseFloat(tweakGlitchNum.value);
    if (!isNaN(v)) setGlitchTweak(v);
  });

  tweakCaptions.addEventListener('change', () => {
    const tw = findTweak('captions');
    if (tw) { tw.default = tweakCaptions.checked; render(); }
  });
  tweakFlashes.addEventListener('change', () => {
    const tw = findTweak('flashes');
    if (tw) { tw.default = tweakFlashes.checked; render(); }
  });

  function fxLayers() {
    const track = (project.tracks || []).find((tr) => tr.kind === 'effects');
    return (track && track.layers) || [];
  }

  function buildFxLayersList() {
    fxLayersList.innerHTML = '';
    fxLayers().forEach((layer) => {
      const chip = document.createElement('div');
      chip.className = 'fx-layer-chip';
      chip.classList.toggle('selected', layer === selectedFxLayer);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = layer.enabled !== false;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        layer.enabled = cb.checked;
        render();
      });
      const label = document.createElement('span');
      label.textContent = layer.label || layer.id;
      chip.appendChild(cb);
      chip.appendChild(label);
      chip.addEventListener('click', () => selectFxLayer(layer));
      fxLayersList.appendChild(chip);
    });
  }

  function selectFxLayer(layer) {
    selectedFxLayer = layer;
    Array.from(fxLayersList.children).forEach((chip, i) => chip.classList.toggle('selected', fxLayers()[i] === layer));
    if (layer.type === 'hud') {
      hudEditorRow.hidden = false;
      populateHudEditor(layer);
    } else {
      hudEditorRow.hidden = true;
    }
  }

  function populateHudEditor(layer) {
    hudNudgeApplied = 0;
    hudNudgeRange.value = hudNudgeNum.value = 0;
  }

  // "Recuar tudo": nudges corners.inset AND every cell's x/y by the same
  // delta, so the whole HUD (brackets, REC, timecode, everything) moves
  // inward together instead of one piece at a time.
  function applyHudNudge(v) {
    if (!selectedFxLayer || isNaN(v)) return;
    const delta = v - hudNudgeApplied;
    if (!selectedFxLayer.params.corners) selectedFxLayer.params.corners = {};
    const corners = selectedFxLayer.params.corners;
    corners.inset = (corners.inset || 0) + delta;
    (selectedFxLayer.params.cells || []).forEach((cell) => {
      cell.x = (cell.x || 0) + delta;
      cell.y = (cell.y || 0) + delta;
    });
    hudNudgeApplied = v;
    hudNudgeRange.value = v;
    hudNudgeNum.value = v;
    render();
  }

  hudNudgeRange.addEventListener('input', () => applyHudNudge(parseFloat(hudNudgeRange.value)));
  hudNudgeNum.addEventListener('input', () => applyHudNudge(parseFloat(hudNudgeNum.value)));

  function ensureCamera(clip) {
    if (!clip.camera) clip.camera = {};
    if (!clip.camera.zoom) clip.camera.zoom = { from: 1, to: 1 };
    if (!clip.camera.panX) clip.camera.panX = { from: 0, to: 0 };
    return clip.camera;
  }

  function parseObjectPosition(clip) {
    const m = /(-?[\d.]+)%\s+(-?[\d.]+)%/.exec(clip.objectPosition || '');
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
  }

  function setObjectPositionX(clip, x) {
    const [, y] = parseObjectPosition(clip);
    clip.objectPosition = x + '% ' + y + '%';
  }

  function setObjectPositionY(clip, y) {
    const [x] = parseObjectPosition(clip);
    clip.objectPosition = x + '% ' + y + '%';
  }

  const CAMERA_FIELDS = {
    zoom: {
      get: (c) => ensureCamera(c).zoom[activeKeyframe],
      set: (c, v) => { ensureCamera(c).zoom[activeKeyframe] = v; },
    },
    panx: {
      get: (c) => ensureCamera(c).panX[activeKeyframe],
      set: (c, v) => { ensureCamera(c).panX[activeKeyframe] = v; },
    },
    offsetX: { get: (c) => ensureCamera(c).offsetX || 0, set: (c, v) => { ensureCamera(c).offsetX = v; } },
    offsetY: { get: (c) => ensureCamera(c).offsetY || 0, set: (c, v) => { ensureCamera(c).offsetY = v; } },
    opX: { get: (c) => parseObjectPosition(c)[0], set: setObjectPositionX },
    opY: { get: (c) => parseObjectPosition(c)[1], set: setObjectPositionY },
  };

  const cameraFieldEls = {};
  document.querySelectorAll('.co-field').forEach((el) => {
    const key = el.dataset.field;
    const range = el.querySelector('input[type="range"]');
    const num = el.querySelector('input[type="number"]');
    cameraFieldEls[key] = { range, num };
    const apply = (v) => {
      if (!selectedClip || isNaN(v)) return;
      CAMERA_FIELDS[key].set(selectedClip, v);
      range.value = v;
      num.value = v;
      if (key === 'opX' || key === 'opY') positionFocusHandle(selectedClip);
      render();
    };
    range.addEventListener('input', () => apply(parseFloat(range.value)));
    num.addEventListener('input', () => apply(parseFloat(num.value)));
  });

  function populateCameraForm(clip) {
    Object.keys(CAMERA_FIELDS).forEach((key) => {
      const v = CAMERA_FIELDS[key].get(clip);
      cameraFieldEls[key].range.value = v;
      cameraFieldEls[key].num.value = v;
    });
  }

  function positionFocusHandle(clip) {
    const [x, y] = parseObjectPosition(clip);
    focusHandle.style.left = x + '%';
    focusHandle.style.top = y + '%';
  }

  function setActiveKeyframe(kf) {
    activeKeyframe = kf;
    kfButtons.forEach((b) => b.classList.toggle('active', b.dataset.kf === kf));
    if (!selectedClip) return;
    pause();
    setTime(kf === 'from' ? selectedClip.start : Math.max(selectedClip.start, selectedClip.end - 0.001));
    populateCameraForm(selectedClip);
  }

  kfButtons.forEach((b) => b.addEventListener('click', () => setActiveKeyframe(b.dataset.kf)));

  function selectClip(clip) {
    deselectTitleClip();
    selectedClip = clip;
    clipOptionsInfo.textContent = clip.asset + '  ·  ' + clip.start.toFixed(1) + 's → ' + clip.end.toFixed(1) + 's';
    clipOptionsEmpty.hidden = true;
    clipOptionsForm.hidden = false;
    setActiveTool('camera');
    kfButtons.forEach((b) => b.classList.toggle('active', b.dataset.kf === activeKeyframe));
    populateCameraForm(clip);
    positionFocusHandle(clip);
    focusHandle.hidden = false;
    stageInteract.classList.add('editable');
    updateClipStripPlayhead();
  }

  // Mirrors selectClip's "empty" state — needed now that selecting a title
  // card (selectTitleClip) must be able to clear an image-clip selection,
  // since the stage drag handles (focus vs. title-position) are mutually
  // exclusive and both key off which one is currently non-null.
  function deselectClip() {
    if (!selectedClip) return;
    selectedClip = null;
    clipOptionsEmpty.hidden = false;
    clipOptionsForm.hidden = true;
    focusHandle.hidden = true;
    stageInteract.classList.remove('editable');
    updateClipStripPlayhead();
  }

  // "Dividir" toolbar tool: cuts the selected image clip into two at the
  // current playhead time. Both halves keep the same asset/camera/filter —
  // the camera keyframe animation isn't re-timed to stay continuous across
  // the cut, so each half replays its own from→to over its own (shorter)
  // span; good enough for a first cut, tune each half afterward if needed.
  function splitSelectedClip() {
    if (!selectedClip) return;
    const track = imageTrack();
    const clips = (track && track.clips) || [];
    const idx = clips.indexOf(selectedClip);
    if (idx === -1) return;
    const clip = selectedClip;
    if (t <= clip.start + MIN_CLIP_DURATION || t >= clip.end - MIN_CLIP_DURATION) return;

    const newClip = Object.assign({}, clip, { start: t });
    if (clip.camera) newClip.camera = Object.assign({}, clip.camera);
    newClip.transitionDur = 0; // a fresh hard cut, not a crossfade
    clip.end = t;

    clips.splice(idx + 1, 0, newClip);
    buildClipStrip();
    selectClip(newClip);
    render();
  }

  function refreshClipBlock(clip) {
    const entry = clipBlocks.find((b) => b.clip === clip);
    if (!entry) return;
    const url = SCPRenderer.assetUrl(project, clip.asset);
    entry.el.style.backgroundImage = url ? `url("${url}")` : 'none';
    entry.el.querySelector('.clip-block-label').textContent =
      clip.asset + '  ' + clip.start.toFixed(1) + 's';
    if (clip === selectedClip) selectClip(clip);
  }

  function addAssetThumb(id, clip) {
    const url = SCPRenderer.assetUrl(project, id);
    const thumb = document.createElement('div');
    thumb.className = 'asset-thumb';
    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.alt = id;
    const label = document.createElement('div');
    label.className = 'asset-thumb-label';
    label.textContent = id;
    thumb.appendChild(imgEl);
    thumb.appendChild(label);
    thumb.addEventListener('click', () => {
      clip.asset = id;
      refreshClipBlock(clip);
      render();
      closeAssetPicker();
    });
    assetPickerGrid.appendChild(thumb);
  }

  // Projects with an explicit assets.images[] list use that; projects that
  // instead derive filenames from prefix+id+ext (too many assets to spell
  // out) have no such list — for those, ask the server what's actually in
  // the assets/ folder so the picker still has something to show.
  async function listPickableAssetIds() {
    const explicit = (project.assets && project.assets.images) || [];
    if (explicit.length) return explicit.map((img) => img.id);
    try {
      const res = await fetch('api.php?action=list_assets&dir=' + encodeURIComponent(currentProjectDir));
      const data = await res.json();
      if (!data.ok) return [];
      const ext = (project.assets && project.assets.ext) || '';
      const files = ext
        ? data.files.filter((f) => f.toLowerCase().endsWith(ext.toLowerCase()))
        : data.files.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
      return files.map((f) => assetIdFromFilename(f));
    } catch (err) {
      console.error('Falha ao listar assets do servidor:', err);
      return [];
    }
  }

  async function openAssetPicker(clip) {
    assetPickerGrid.innerHTML = '';

    const uploadTile = document.createElement('div');
    uploadTile.className = 'asset-thumb upload-tile';
    const icon = document.createElement('div');
    icon.className = 'upload-tile-icon';
    icon.textContent = '+';
    const uploadLabel = document.createElement('div');
    uploadLabel.className = 'asset-thumb-label';
    uploadLabel.textContent = 'Enviar imagem';
    uploadTile.appendChild(icon);
    uploadTile.appendChild(uploadLabel);
    uploadTile.addEventListener('click', () => {
      uploadTargetClip = clip;
      assetUploadInput.value = '';
      assetUploadInput.click();
    });
    assetPickerGrid.appendChild(uploadTile);
    assetPicker.hidden = false;

    const ids = await listPickableAssetIds();
    ids.forEach((id) => addAssetThumb(id, clip));
  }

  function closeAssetPicker() {
    assetPicker.hidden = true;
  }

  function assetIdFromFilename(filename) {
    const prefix = project.assets.prefix || '';
    let base = filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
    const dot = base.lastIndexOf('.');
    if (dot > 0) base = base.slice(0, dot);
    const existing = new Set((project.assets.images || []).map((i) => i.id));
    let id = base;
    for (let n = 2; existing.has(id); n++) id = base + '-' + n;
    return id;
  }

  // Uploads a file into projects/<dir>/assets/ on the server and returns
  // the (possibly de-duplicated) filename it was saved as.
  async function uploadAssetToServer(file) {
    const fd = new FormData();
    fd.append('action', 'upload_asset');
    fd.append('dir', currentProjectDir);
    fd.append('file', file);
    const res = await fetch('api.php', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'falha ao enviar o arquivo');
    return data.file;
  }

  async function handleAssetUpload(file, clip) {
    const filename = await uploadAssetToServer(file);
    const id = assetIdFromFilename(filename);
    project.assets.images.push({ id, file: filename });
    clip.asset = id;
    refreshClipBlock(clip);
    render();
    closeAssetPicker();
  }

  function clampTime(v) {
    return Math.max(0, Math.min(project.duration, v));
  }

  // Optional hook so a caller can stop playback at the end of the
  // timeline instead of the normal preview loop back to 0.
  let stopAtEnd = false;
  let onPlaybackEnded = null;

  function tick(ts) {
    if (!playing) return;
    if (lastTs == null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    let nt = t + dt;
    if (nt >= project.duration) {
      if (stopAtEnd) {
        stopAtEnd = false;
        setTime(project.duration);
        pause();
        const cb = onPlaybackEnded;
        onPlaybackEnded = null;
        if (cb) cb();
        return;
      }
      nt = 0;
    }
    setTime(nt);
    requestAnimationFrame(tick);
  }

  function play() {
    if (playing || !project) return;
    playing = true;
    lastTs = null;
    playBtn.textContent = '⏸';
    requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    playBtn.textContent = '▶';
    pauseAllAudio();
  }

  function togglePlay() {
    if (playing) pause(); else play();
  }

  playBtn.addEventListener('click', togglePlay);

  scrub.addEventListener('input', () => {
    pause();
    setTime(parseFloat(scrub.value));
  });

  timeField.addEventListener('change', () => {
    const v = parseFloat(timeField.value.replace(',', '.'));
    if (!isNaN(v)) {
      pause();
      setTime(v);
    }
  });

  swapImageBtn.addEventListener('click', () => {
    if (selectedClip) openAssetPicker(selectedClip);
  });

  assetPickerClose.addEventListener('click', closeAssetPicker);

  assetUploadInput.addEventListener('change', async () => {
    const file = assetUploadInput.files && assetUploadInput.files[0];
    const clip = uploadTargetClip;
    uploadTargetClip = null;
    if (!file || !clip) return;
    try {
      await handleAssetUpload(file, clip);
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        alert('Falha ao enviar a imagem: ' + err.message);
        console.error(err);
      }
    }
  });

  assetPicker.addEventListener('click', (e) => {
    if (e.target === assetPicker) closeAssetPicker();
  });

  audioUploadInput.addEventListener('change', async () => {
    const file = audioUploadInput.files && audioUploadInput.files[0];
    if (!file) return;
    try {
      await handleAudioUpload(file);
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        alert('Falha ao enviar o áudio: ' + err.message);
        console.error(err);
      }
    }
  });

  let saveStatusTimer = null;
  function flashSaveStatus(msg, isError) {
    saveStatus.textContent = msg;
    saveStatus.style.color = isError ? '#f66' : '#6fae95';
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => { saveStatus.textContent = ''; }, 2500);
  }

  async function saveProject() {
    try {
      // Write back the page-rooted basePath as the original relative one —
      // otherwise every save bakes in another "projects/<dir>/" and the
      // next load rebases on top of that, compounding the prefix.
      const toSave = Object.assign({}, project, {
        assets: Object.assign({}, project.assets, { basePath: originalAssetsBasePath }),
      });
      const res = await fetch('api.php', {
        method: 'POST',
        body: new URLSearchParams({ action: 'save_project', dir: currentProjectDir, project: JSON.stringify(toSave) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro desconhecido');
      flashSaveStatus('Salvo ✓');
      return true;
    } catch (err) {
      flashSaveStatus('Falha ao salvar', true);
      console.error(err);
      return false;
    }
  }

  saveBtn.addEventListener('click', saveProject);

  downloadZipBtn.addEventListener('click', async () => {
    if (!currentProjectDir) return;
    const saved = await saveProject();
    if (!saved) return;
    flashSaveStatus('Montando ZIP…');
    try {
      const res = await fetch('api.php?action=export_zip&dir=' + encodeURIComponent(currentProjectDir));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro desconhecido');
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || (currentProjectDir + '.zip');
      a.click();
      flashSaveStatus('ZIP pronto ✓');
    } catch (err) {
      flashSaveStatus('Falha no ZIP', true);
      console.error(err);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      saveProject();
      return;
    }
    if (e.code === 'Escape' && !assetPicker.hidden) {
      closeAssetPicker();
      return;
    }
    if (e.code === 'Escape' && !exportModal.hidden) {
      exportModal.hidden = true;
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
  });

  window.addEventListener('resize', fitScale);
  // iOS Safari sometimes reports stale layout right at 'orientationchange';
  // resize alone usually covers it, this is just a safety net.
  window.addEventListener('orientationchange', () => setTimeout(fitScale, 300));

  // ---- Fonts (preview + export need the real @font-face, not the fallback) ----

  function loadGoogleFonts(list) {
    if (!list || !list.length) return;
    const params = list.map((f) => 'family=' + f.replace(/\s+/g, '+')).join('&');
    const href = 'https://fonts.googleapis.com/css2?' + params + '&display=swap';
    if (document.querySelector('link[data-scp-font]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-scp-font', '1');
    document.head.appendChild(link);
  }

  // ---- Export (frame sequence → MP4, at 1x/2x/4x resolution) ------------

  const exportBtn = document.getElementById('export-btn');
  const exportModal = document.getElementById('export-modal');
  const exportClose = document.getElementById('export-close');
  const exportScaleSelect = document.getElementById('export-scale');
  const exportResLabel = document.getElementById('export-res-label');
  const exportSequenceBtn = document.getElementById('export-sequence-btn');
  const exportCancelBtn = document.getElementById('export-cancel-btn');
  let lastExportFolder = null;
  const exportStatus = document.getElementById('export-status');
  const exportHistoryList = document.getElementById('export-history-list');

  let exportCancelled = false;
  let cachedFontCss = null;

  function updateExportResLabel() {
    const scale = parseInt(exportScaleSelect.value, 10);
    const w = project.canvas.width * scale;
    const h = project.canvas.height * scale;
    exportResLabel.textContent = w + '×' + h + 'px';
  }

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  function formatExportDate(unix) {
    const d = new Date(unix * 1000);
    const pad = (x) => String(x).padStart(2, '0');
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  async function refreshExportHistory() {
    if (!currentProjectDir || !exportHistoryList) return;
    try {
      const res = await fetch('api.php?action=list_exports&dir=' + encodeURIComponent(currentProjectDir));
      const data = await res.json();
      const files = (data && data.ok && data.files) ? data.files : [];
      if (!files.length) {
        exportHistoryList.innerHTML = '<div class="export-history-empty">Nenhum MP4 ainda. Quando a exportação terminar, o arquivo fica aqui (e em projects/exports/).</div>';
        return;
      }
      exportHistoryList.innerHTML = files.map((f) => {
        const name = String(f.name || '').replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
        return '<a class="export-history-item" href="' + f.url + '" download target="_blank">' +
          '<span class="export-history-name">' + name + '</span>' +
          '<span class="export-history-meta">' + formatExportDate(f.mtime) + ' · ' + formatBytes(f.size) + '</span>' +
          '</a>';
      }).join('');
    } catch (err) {
      exportHistoryList.innerHTML = '<div class="export-history-empty">Não consegui listar os vídeos salvos.</div>';
      console.error(err);
    }
  }

  exportBtn.addEventListener('click', () => {
    updateExportResLabel();
    exportStatus.textContent = '';
    exportModal.hidden = false;
    refreshExportHistory();
  });
  exportClose.addEventListener('click', () => { exportModal.hidden = true; });
  exportModal.addEventListener('click', (e) => { if (e.target === exportModal) exportModal.hidden = true; });
  exportScaleSelect.addEventListener('change', updateExportResLabel);

  // Pulls every @font-face this page uses into one CSS blob with the font
  // files themselves inlined as data: URIs — the export's offscreen SVG is
  // its own isolated document, so it can't reach the page's own stylesheets
  // or fonts.googleapis.com on its own. Computed once and cached: it's the
  // same for every frame of a sequence export.
  async function getInlineFontCss() {
    if (cachedFontCss != null) return cachedFontCss;
    const rules = [];
    for (const ss of document.styleSheets) {
      let cssRules;
      try {
        cssRules = ss.cssRules;
      } catch (e) {
        if (ss.href) {
          try {
            const txt = await fetch(ss.href).then((r) => r.text());
            (txt.match(/@font-face\s*{[^}]*}/g) || []).forEach((css) => rules.push({ css, base: ss.href }));
          } catch (e2) { /* skip: falls back to the substitute font */ }
        }
        continue;
      }
      if (!cssRules) continue;
      for (const r of cssRules) {
        if (r.type === CSSRule.FONT_FACE_RULE) rules.push({ css: r.cssText, base: ss.href || location.href });
      }
    }
    const toDataURL = (url) => fetch(url)
      .then((r) => r.blob())
      .then((b) => new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(url);
        fr.readAsDataURL(b);
      }))
      .catch(() => url);
    const parts = await Promise.all(rules.map(async ({ css, base }) => {
      const re = /url\((['"]?)([^'")]+)\1\)/g;
      const matches = [];
      let m;
      while ((m = re.exec(css))) matches.push(m);
      let out = css;
      for (const mm of matches) {
        const u = mm[2];
        if (u.startsWith('data:')) continue;
        let abs;
        try { abs = new URL(u, base).href; } catch (e) { continue; }
        out = out.split(mm[0]).join(`url("${await toDataURL(abs)}")`);
      }
      return out;
    }));
    cachedFontCss = parts.join('\n');
    return cachedFontCss;
  }

  function rewriteImgSrcsAbsolute(root) {
    root.querySelectorAll('img').forEach((img) => img.setAttribute('src', img.src));
  }

  // The outer <img> wrapping the whole SVG (built below) fires its load
  // event as soon as the SVG/XML document itself parses — it does NOT wait
  // for raster images nested inside the foreignObject to finish loading
  // from the network, even if the browser cache already has the bytes.
  // Without this, drawImage() below silently captures whatever was drawn
  // before those images arrived: nothing, i.e. a black frame — 100%
  // reproducible for a video export (confirmed with a plain "open this
  // exact SVG markup in a tab" test: the markup itself is correct, only
  // the canvas capture of it is premature). Inlining every <img> as a
  // data: URI removes the async load entirely — nothing left to race.
  const imageDataUriCache = new Map();
  function toImageDataUri(url) {
    if (imageDataUriCache.has(url)) return imageDataUriCache.get(url);
    const p = fetch(url)
      .then((r) => r.blob())
      .then((b) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('falha ao ler imagem'));
        fr.readAsDataURL(b);
      }));
    imageDataUriCache.set(url, p);
    return p;
  }

  async function inlineImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      try {
        img.setAttribute('src', await toImageDataUri(src));
      } catch (err) {
        console.error('Falha ao converter imagem para data URI:', src, err);
      }
    }));
  }

  async function rasterizeFrame(atTime, targetW, targetH, fontCss) {
    const offscreen = document.createElement('div');
    SCPRenderer.renderFrame(project, atTime, offscreen);
    rewriteImgSrcsAbsolute(offscreen);
    await inlineImages(offscreen);
    const scale = targetW / project.canvas.width;

    // Built as real DOM nodes and serialized once via XMLSerializer — NOT
    // string concatenation + outerHTML. outerHTML uses HTML5 serialization,
    // which leaves void elements like <img> unclosed ("<img ...>"); that's
    // invalid inside an SVG (which demands well-formed XML), so the whole
    // foreignObject fails to parse and rasterizing silently breaks.
    // XMLSerializer self-closes them correctly ("<img .../>").
    const svgNS = 'http://www.w3.org/2000/svg';
    const xhtmlNS = 'http://www.w3.org/1999/xhtml';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(targetW));
    svg.setAttribute('height', String(targetH));
    const fo = document.createElementNS(svgNS, 'foreignObject');
    fo.setAttribute('x', '0');
    fo.setAttribute('y', '0');
    fo.setAttribute('width', '100%');
    fo.setAttribute('height', '100%');
    const wrapper = document.createElementNS(xhtmlNS, 'div');
    wrapper.setAttribute('style',
      'width:' + project.canvas.width + 'px;height:' + project.canvas.height +
      'px;transform-origin:top left;transform:scale(' + scale + ');position:relative;overflow:hidden;');
    const styleEl = document.createElementNS(xhtmlNS, 'style');
    styleEl.textContent = fontCss;
    wrapper.appendChild(styleEl);
    wrapper.appendChild(offscreen);
    fo.appendChild(wrapper);
    svg.appendChild(fo);

    const svgMarkup = new XMLSerializer().serializeToString(svg);
    const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => {
        console.error('SVG que falhou ao rasterizar (primeiros 800 chars):', svgMarkup.slice(0, 800));
        reject(new Error('falha ao rasterizar o quadro'));
      };
      im.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.getContext('2d').drawImage(img, 0, 0, targetW, targetH);
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) reject(new Error('quadro vazio ao gerar a imagem'));
        else resolve(blob);
      }, type || 'image/png', quality);
    });
  }

  async function uploadExportFrame(blob, folderName, filename) {
    const qs = new URLSearchParams({
      action: 'export_frame',
      dir: currentProjectDir,
      folder: folderName,
      filename: filename,
    });
    const res = await fetch('api.php?' + qs.toString(), {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (err) {
      throw new Error('resposta inválida do servidor ao gravar o quadro');
    }
    if (!data.ok) throw new Error(data.error || 'falha ao gravar o quadro');
  }

  // `php -S` (the local dev server) handles one request at a time — firing
  // several multipart uploads at it concurrently doesn't make it faster,
  // it makes it flaky (interleaved connections can end up with a request
  // that's missing its file). This serializes anything that hits the
  // network so only one upload is ever in flight, while still letting the
  // (CPU-bound, in-browser, server-independent) rasterization step above
  // run several frames ahead of it.
  function createSerialQueue() {
    let tail = Promise.resolve();
    return function runSerial(fn) {
      const run = () => fn();
      const result = tail.then(run, run);
      tail = result.then(() => {}, () => {});
      return result;
    };
  }

  // Runs `worker` over every index in [0, count), with at most `limit` calls
  // in flight at once — each of `limit` "lanes" just keeps pulling the next
  // index as soon as it finishes its previous one, so a lane that's waiting
  // on network I/O (the upload) never blocks the others from doing CPU work
  // (rasterizing) in the meantime. Stops handing out new indices (but still
  // lets in-flight ones finish) once `isCancelled()` goes true.
  async function runWithConcurrency(count, limit, worker, isCancelled) {
    let next = 0;
    async function lane() {
      while (true) {
        if (isCancelled && isCancelled()) return;
        const i = next++;
        if (i >= count) return;
        await worker(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, count) }, lane));
  }

  // How many frames to rasterize+upload at once. Frame export isn't tied to
  // real-time playback (unlike "Gravar vídeo"), so the only ceiling here is
  // how much of each frame's time is spent waiting (image decode, the local
  // upload) vs. actually occupying the one JS thread (building/serializing
  // the SVG, the synchronous canvas draw) — overlapping a handful of frames
  // lets that waiting time hide behind other frames' CPU work instead of
  // happening one frame at a time. Higher doesn't reliably keep helping
  // past this, since that CPU-bound part is still single-threaded.
  const EXPORT_CONCURRENCY = 4;

  exportSequenceBtn.addEventListener('click', async () => {
    const scale = parseInt(exportScaleSelect.value, 10);
    const w = project.canvas.width * scale, h = project.canvas.height * scale;
    const fps = project.canvas.fps || 30;
    const totalFrames = Math.ceil(project.duration * fps);
    const folderName = 'export_' + w + 'x' + h;

    exportCancelled = false;
    exportSequenceBtn.disabled = true;
    exportCancelBtn.hidden = false;
    pause();

    let done = 0;
    const startedAt = performance.now();
    const uploadSerial = createSerialQueue();
    try {
      const fontCss = await getInlineFontCss();
      await runWithConcurrency(totalFrames, EXPORT_CONCURRENCY, async (i) => {
        const frameT = Math.min(i / fps, project.duration);
        const canvas = await rasterizeFrame(frameT, w, h, fontCss);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        const filename = 'frame_' + String(i + 1).padStart(5, '0') + '.jpg';
        await uploadSerial(() => uploadExportFrame(blob, folderName, filename));
        done++;
        const fps2 = done / ((performance.now() - startedAt) / 1000);
        exportStatus.textContent = 'Exportando… quadro ' + done + '/' + totalFrames +
          ' (' + fps2.toFixed(1) + ' quadros/s)';
      }, () => exportCancelled);
      if (exportCancelled) {
        exportStatus.textContent = 'Cancelado em ' + done + '/' + totalFrames + '.';
      } else {
        lastExportFolder = folderName;
      }
    } catch (err) {
      exportStatus.textContent = 'Falha: ' + err.message;
      console.error(err);
    } finally {
      exportSequenceBtn.disabled = false;
      exportCancelBtn.hidden = true;
    }
    if (lastExportFolder === folderName && !exportCancelled) await assembleVideo();
  });

  exportCancelBtn.addEventListener('click', () => { exportCancelled = true; });

  // Polls job_status until the cron runner (see cron/process-jobs.sh)
  // finishes a queued ffmpeg job — only happens on hosts where PHP can't
  // exec ffmpeg itself (assemble_video then returns {queued:true} instead
  // of the finished file right away). Local dev never hits this path.
  async function pollJobStatus(jobId, { intervalMs = 4000, timeoutMs = 20 * 60 * 1000 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const res = await fetch('api.php?' + new URLSearchParams({
        action: 'job_status', dir: currentProjectDir, jobId,
      }));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro ao checar o status');
      if (data.status === 'ok') return;
      if (data.status === 'error') throw new Error('ffmpeg falhou: ' + (data.log || '').slice(-500));
      // 'pending' or 'unknown' (not picked up by cron yet) — keep waiting.
    }
    // The ffmpeg job itself is NOT cancelled by this — it keeps running on
    // the server via cron regardless of whether the browser is still here
    // to watch it. This only means this tab gave up waiting.
    const err = new Error('O navegador parou de esperar, mas o processamento continua no servidor. Reabra esse painel daqui a pouco pra ver o link quando terminar.');
    err.stillRunning = true;
    throw err;
  }

  async function assembleVideo() {
    if (!lastExportFolder) return;
    exportSequenceBtn.disabled = true;
    exportStatus.textContent = 'Quadros prontos. Juntando tudo num arquivo de vídeo (MP4)… vídeos longos podem levar vários minutos. O link pra baixar aparece aqui quando terminar.';
    try {
      const res = await fetch('api.php', {
        method: 'POST',
        body: new URLSearchParams({
          action: 'assemble_video',
          dir: currentProjectDir,
          folder: lastExportFolder,
          fps: String(project.canvas.fps || 30),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro desconhecido');
      if (data.queued) {
        exportStatus.textContent = 'Na fila do servidor (processado a cada minuto)… isso pode levar alguns minutos.';
        // This host's shared CPU encodes well under real-time speed on long
        // videos (observed as slow as ~0.2x) — size the wait to the actual
        // video length instead of a fixed window, or long exports time out
        // here client-side while ffmpeg is still happily running server-side.
        const estimatedMs = (project.duration / 0.12) * 1000 + 3 * 60 * 1000;
        const timeoutMs = Math.max(20 * 60 * 1000, Math.min(estimatedMs, 3 * 60 * 60 * 1000));
        await pollJobStatus(data.jobId, { timeoutMs });
      }
      const label = data.audio ? 'Baixar vídeo (com áudio)' : 'Baixar vídeo';
      exportStatus.innerHTML = 'Pronto e salvo — <a href="' + data.url + '" download target="_blank">' + label + '</a>';
      await refreshExportHistory();
    } catch (err) {
      exportStatus.textContent = err.stillRunning ? err.message : ('Falha ao gerar o MP4: ' + err.message);
      console.error(err);
    } finally {
      exportSequenceBtn.disabled = false;
    }
  }

  function getStageScale() {
    return stageFrame.getBoundingClientRect().width / project.canvas.width;
  }

  // Hit-tests a click against the actual rendered glyphs of the currently
  // visible title/subtitle text (the '.sr-text-hit' spans renderer.js tags
  // on each text clip's DOM), so clicking directly on "SCP-076" etc. in the
  // stage preview selects that title card — without needing to hunt for its
  // block in the Títulos timeline strip first. Uses Range.getClientRects()
  // rather than the wrapping div's own rect, since that div always spans
  // left→right (for centering/alignment) regardless of how little text it
  // actually holds.
  // Same hit-test, but also reports which element/part ('text' vs 'sub')
  // was hit — needed to start inline editing on the right one.
  function findTextHitAtPoint(clientX, clientY) {
    const track = titlesTrack();
    if (!track) return null;
    const wrappers = Array.from(stage.querySelectorAll('[data-text-clip-id]'));
    for (let i = wrappers.length - 1; i >= 0; i--) {
      const wrapper = wrappers[i];
      const parts = wrapper.querySelectorAll('.sr-text-hit');
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        if (!part.firstChild) continue;
        const range = document.createRange();
        range.selectNodeContents(part.firstChild);
        const rects = range.getClientRects();
        for (const r of rects) {
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            const clip = track.clips.find((c) => c.id === wrapper.dataset.textClipId);
            if (clip) return { clip, part: j === 0 ? 'text' : 'sub' };
          }
        }
      }
    }
    return null;
  }

  function findTextClipAtPoint(clientX, clientY) {
    const hit = findTextHitAtPoint(clientX, clientY);
    return hit ? hit.clip : null;
  }

  // Makes the title/sub DOM element itself (not just the sidebar fields)
  // directly typeable, in place on the stage — see the dblclick wiring
  // below. `part` is only ever 'text' or 'sub'.
  function startTitleTextEdit(clip, part) {
    if (editingTextClip === clip && editingTextPart === part) return;
    endTitleTextEdit(true);
    if (selectedTitleClip !== clip) selectTitleClip(clip);
    // selectTitleClip() may have just re-rendered the stage, so look the
    // live element up fresh rather than trusting one found before that.
    const wrapper = stage.querySelector('[data-text-clip-id="' + clip.id + '"]');
    const parts = wrapper ? wrapper.querySelectorAll('.sr-text-hit') : [];
    const el = part === 'text' ? parts[0] : parts[1];
    if (!el) return;
    if (part === 'sub' && !clip.sub) el.textContent = ''; // drop the "+ legenda" ghost placeholder
    editingTextEl = el;
    editingTextClip = clip;
    editingTextPart = part;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const onBlur = () => endTitleTextEdit(false);
    const onKeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
    };
    const onPointerDown = (ev) => ev.stopPropagation();
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('pointerdown', onPointerDown);
    editingTextCleanup = () => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('pointerdown', onPointerDown);
    };
  }

  function endTitleTextEdit(skipRender) {
    if (!editingTextEl) return;
    const el = editingTextEl;
    const clip = editingTextClip;
    const part = editingTextPart;
    const cleanup = editingTextCleanup;
    editingTextEl = null;
    editingTextClip = null;
    editingTextPart = null;
    editingTextCleanup = null;
    if (cleanup) cleanup();
    el.contentEditable = 'false';
    if (part === 'text') { clip.text = el.textContent; refreshTitleBlock(clip); }
    else if (part === 'sub') { clip.sub = el.textContent; }
    if (!skipRender) render();
  }

  function endDrag(e) {
    const target = dragMode === 'focus' ? focusHandle : dragMode === 'titlepos' ? titlePositionHandle : stageInteract;
    if (dragMode && e.pointerId != null) {
      try { target.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }
    dragMode = null;
  }

  stageInteract.addEventListener('pointerdown', (e) => {
    // A click outside the element currently being typed into ends that edit
    // (the element's own pointerdown, below, stops propagation so this only
    // fires for clicks elsewhere).
    if (editingTextEl) endTitleTextEdit(false);

    const hitTextClip = findTextClipAtPoint(e.clientX, e.clientY);
    if (hitTextClip) {
      selectTitleClip(hitTextClip);
      // Drag the text by grabbing it anywhere, not just its tiny corner
      // handle — delta-based so the box doesn't jump to the cursor.
      dragMode = 'titletext';
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const box = hitTextClip.box || (hitTextClip.box = {});
      dragStartBoxLeft = box.left || 0;
      dragStartBoxBottom = box.bottom || 0;
      stageInteract.setPointerCapture(e.pointerId);
      return;
    }
    if (!selectedClip) return;
    dragMode = 'pan';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const cam = ensureCamera(selectedClip);
    dragStartPanX = cam.panX[activeKeyframe];
    dragStartOffsetY = cam.offsetY || 0;
    stageInteract.setPointerCapture(e.pointerId);
  });

  stageInteract.addEventListener('dblclick', (e) => {
    const hit = findTextHitAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    startTitleTextEdit(hit.clip, hit.part);
  });

  stageInteract.addEventListener('pointermove', (e) => {
    if (dragMode === 'titletext' && selectedTitleClip) {
      const scale = getStageScale();
      const dxPx = (e.clientX - dragStartX) / scale;
      const dyPx = (e.clientY - dragStartY) / scale;
      const box = selectedTitleClip.box || (selectedTitleClip.box = {});
      box.left = Math.round(dragStartBoxLeft + dxPx);
      box.bottom = Math.round(dragStartBoxBottom - dyPx);
      delete box.right;
      delete box.top;
      positionTitleHandle(selectedTitleClip);
      render();
      return;
    }
    if (dragMode !== 'pan' || !selectedClip) return;
    const scale = getStageScale();
    const dxPct = ((e.clientX - dragStartX) / scale / project.canvas.width) * 100;
    const dyPct = ((e.clientY - dragStartY) / scale / project.canvas.height) * 100;
    const cam = ensureCamera(selectedClip);
    cam.panX[activeKeyframe] = dragStartPanX + dxPct;
    cam.offsetY = dragStartOffsetY + dyPct;
    cameraFieldEls.panx.range.value = cam.panX[activeKeyframe];
    cameraFieldEls.panx.num.value = cam.panX[activeKeyframe].toFixed(1);
    cameraFieldEls.offsetY.range.value = cam.offsetY;
    cameraFieldEls.offsetY.num.value = cam.offsetY.toFixed(1);
    render();
  });

  stageInteract.addEventListener('pointerup', endDrag);
  stageInteract.addEventListener('pointercancel', endDrag);

  // Pointer cursor affordance: show a "clickable" pointer while hovering
  // text (separate from the pan-drag pointermove above, which only fires
  // once dragMode === 'pan').
  stageInteract.addEventListener('pointermove', (e) => {
    if (dragMode) return;
    stageInteract.style.cursor = findTextClipAtPoint(e.clientX, e.clientY) ? 'pointer' : '';
  });

  stageInteract.addEventListener('wheel', (e) => {
    if (!selectedClip) return;
    e.preventDefault();
    const cam = ensureCamera(selectedClip);
    const next = SCPRenderer.clamp(cam.zoom[activeKeyframe] - e.deltaY * 0.0015, 0.5, 4);
    cam.zoom[activeKeyframe] = next;
    cameraFieldEls.zoom.range.value = next;
    cameraFieldEls.zoom.num.value = next.toFixed(2);
    render();
  }, { passive: false });

  focusHandle.addEventListener('pointerdown', (e) => {
    if (!selectedClip) return;
    e.stopPropagation();
    dragMode = 'focus';
    focusHandle.setPointerCapture(e.pointerId);
  });

  focusHandle.addEventListener('pointermove', (e) => {
    if (dragMode !== 'focus' || !selectedClip) return;
    e.stopPropagation();
    const rect = stageInteract.getBoundingClientRect();
    const x = SCPRenderer.clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = SCPRenderer.clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
    selectedClip.objectPosition = x.toFixed(1) + '% ' + y.toFixed(1) + '%';
    positionFocusHandle(selectedClip);
    cameraFieldEls.opX.range.value = x; cameraFieldEls.opX.num.value = x.toFixed(1);
    cameraFieldEls.opY.range.value = y; cameraFieldEls.opY.num.value = y.toFixed(1);
    render();
  });

  focusHandle.addEventListener('pointerup', endDrag);
  focusHandle.addEventListener('pointercancel', endDrag);

  titlePositionHandle.addEventListener('pointerdown', (e) => {
    if (!selectedTitleClip) return;
    e.stopPropagation();
    dragMode = 'titlepos';
    titlePositionHandle.setPointerCapture(e.pointerId);
  });

  titlePositionHandle.addEventListener('pointermove', (e) => {
    if (dragMode !== 'titlepos' || !selectedTitleClip) return;
    e.stopPropagation();
    const rect = stageInteract.getBoundingClientRect();
    const xPx = SCPRenderer.clamp(((e.clientX - rect.left) / rect.width) * project.canvas.width, 0, project.canvas.width);
    const yPx = SCPRenderer.clamp(((e.clientY - rect.top) / rect.height) * project.canvas.height, 0, project.canvas.height);
    const box = selectedTitleClip.box || (selectedTitleClip.box = {});
    box.left = Math.round(xPx);
    box.bottom = Math.round(project.canvas.height - yPx);
    // Normalize the anchor to left+bottom so it always matches what the
    // handle (and the number fields) show — drop any right/top a clip may
    // have started with instead of trying to keep both pairs in sync.
    delete box.right;
    delete box.top;
    positionTitleHandle(selectedTitleClip);
    render();
  });

  titlePositionHandle.addEventListener('pointerup', endDrag);
  titlePositionHandle.addEventListener('pointercancel', endDrag);

  async function loadProject() {
    const requestedId = new URLSearchParams(location.search).get('project');
    const manifestRes = await fetch('projects/projects.json');
    if (!manifestRes.ok) throw new Error('Não achei projects/projects.json (HTTP ' + manifestRes.status + ')');
    const manifest = await manifestRes.json();
    if (!Array.isArray(manifest) || !manifest.length) {
      throw new Error('projects/projects.json está vazio. Importe um projeto na página Projetos.');
    }
    const entry = manifest.find((p) => p.id === requestedId) || manifest[0];
    currentProjectDir = entry.dir;
    const res = await fetch('projects/' + entry.dir + '/project.json');
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ao carregar projects/' + entry.dir + '/project.json');
    const p = await res.json();
    validateProject(p);
    // project.json's own basePath ("assets/") is relative to the project's
    // folder, not to this page (which lives at the editor root) — rebase it
    // for rendering. Keep the original so saveProject() can write the file
    // back with the relative path, not this page-rooted one (saving the
    // rebased value would double up on every future load+save).
    originalAssetsBasePath = p.assets.basePath || '';
    p.assets.basePath = 'projects/' + entry.dir + '/' + originalAssetsBasePath;
    return p;
  }

  loadProject()
    .then((p) => {
      project = p;
      loadGoogleFonts(p.theme && p.theme.googleFonts);
      scrub.min = '0';
      scrub.max = String(p.duration);
      scrub.step = String(1 / (p.canvas.fps || 30));
      document.title = (p.meta && p.meta.title) || 'SCP Motion Editor';
      durationLabel.textContent =
        p.duration.toFixed(1) + 's · ' + p.canvas.width + 'x' + p.canvas.height +
        ' · ' + (p.canvas.fps || 30) + 'fps';
      fitScale();
      buildClipStrip();
      buildAudioStrip();
      buildTitlesStrip();
      buildTimelineRuler();
      populateTweaksPanel();
      buildFxLayersList();
      setTime(0);
    })
    .catch((err) => {
      document.body.innerHTML =
        '<pre style="color:#f66;padding:24px;white-space:pre-wrap;">Erro ao carregar o projeto:\n' +
        err.message + '</pre>';
      console.error(err);
    });
})();

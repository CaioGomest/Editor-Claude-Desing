(function () {
  'use strict';

  const grid = document.getElementById('projects-grid');
  const countEl = document.getElementById('projects-count');
  const importBtn = document.getElementById('import-zip-btn');
  const importStatus = document.getElementById('import-status');
  const zipInput = document.getElementById('zip-upload-input');
  const downloadModal = document.getElementById('download-modal');
  const downloadClose = document.getElementById('download-close');
  const downloadTitle = document.getElementById('download-title');
  const downloadMp4List = document.getElementById('download-mp4-list');
  const downloadZipBtn = document.getElementById('download-zip-btn');
  let downloadModalDir = null;
  const aiHowtoBtn = document.getElementById('ai-howto-btn');
  const aiHowtoModal = document.getElementById('ai-howto-modal');
  const aiHowtoClose = document.getElementById('ai-howto-close');
  const aiHowtoCopyBtn = document.getElementById('ai-howto-copy');
  const aiHowtoPrompt = document.getElementById('ai-howto-prompt');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // "scp076-longo" -> "SCP-076"; falls back to the raw id for anything that
  // doesn't follow that naming pattern.
  function tagFromId(id) {
    const m = /^scp(\d+)/i.exec(id);
    return m ? 'SCP-' + m[1] : id;
  }

  function buildCardSkeleton(entry) {
    const card = document.createElement('a');
    card.className = 'project-card';
    card.href = 'editor.html?project=' + encodeURIComponent(entry.id);
    card.innerHTML =
      '<div class="project-card-thumb">' +
      '<span class="project-card-tag">' + escapeHtml(tagFromId(entry.id)) + '</span>' +
      '<span class="project-card-duration"></span>' +
      '</div>' +
      '<div class="project-card-body">' +
      '<div class="project-card-title">' + escapeHtml(entry.title || entry.id) + '</div>' +
      '<div class="project-card-meta">' + escapeHtml(entry.id) + '</div>' +
      '<div class="project-card-footer">' +
      '<span class="project-card-footer-count"></span>' +
      '<div class="project-card-actions">' +
      '<button type="button" class="project-card-rename" title="Renomear">' +
      '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>' +
      '</button>' +
      '<button type="button" class="project-card-export" title="Baixar (MP4 ou .zip do projeto)">' +
      '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>' +
      '</button>' +
      '<button type="button" class="project-card-delete" title="Apagar projeto">' +
      '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    card.querySelector('.project-card-delete').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteProject(entry);
    });
    card.querySelector('.project-card-rename').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      renameProject(entry);
    });
    card.querySelector('.project-card-export').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDownloadModal(entry, card._exportFiles || []);
    });
    return card;
  }

  function fillCardDetails(card, p, dir) {
    const plate = (p.tracks || []).find((tr) => tr.kind === 'image');
    const firstClip = plate && plate.clips && plate.clips[0];
    if (firstClip) {
      const rel = SCPRenderer.assetUrl(p, firstClip.asset);
      if (rel) {
        card.querySelector('.project-card-thumb').style.backgroundImage = `url("projects/${dir}/${rel}")`;
      }
    }
    card.querySelector('.project-card-meta').textContent =
      p.canvas.width + '×' + p.canvas.height + '  ·  ' + (p.canvas.fps || 30) + 'fps';
    card.querySelector('.project-card-duration').textContent = p.duration.toFixed(1) + 's';
  }

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  // Export files are fetched up front so the download modal (opened later,
  // on demand) never has to wait on a request — just stashed on the card's
  // own element instead of rendered inline, keeping the card layout fixed
  // regardless of how many exports a project has.
  async function fillCardExports(card, dir) {
    const countEl = card.querySelector('.project-card-footer-count');
    try {
      const res = await fetch('api.php?action=list_exports&dir=' + encodeURIComponent(dir));
      const data = await res.json();
      const files = (data && data.ok && data.files) ? data.files : [];
      card._exportFiles = files;
      if (countEl) countEl.textContent = files.length + ' exportado' + (files.length === 1 ? '' : 's');
    } catch (err) {
      card._exportFiles = [];
    }
  }

  async function loadAndRenderProjects() {
    let manifest = [];
    try {
      const res = await fetch('projects/projects.json?t=' + Date.now());
      if (res.ok) manifest = await res.json();
    } catch (err) { /* treated as empty below */ }

    grid.innerHTML = '';
    if (countEl) countEl.textContent = manifest.length + ' projeto' + (manifest.length === 1 ? '' : 's');
    if (!Array.isArray(manifest) || !manifest.length) {
      grid.innerHTML = '<div class="projects-empty">Nenhum projeto ainda. Clique em "Importar ZIP" para trazer um export do Claude Design.</div>';
      return;
    }
    manifest.forEach((entry) => {
      const card = buildCardSkeleton(entry);
      grid.appendChild(card);
      fetch('projects/' + entry.dir + '/project.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => { if (p) fillCardDetails(card, p, entry.dir); })
        .catch(() => {});
      fillCardExports(card, entry.dir);
    });
  }

  async function api(action, fields) {
    const fd = new FormData();
    fd.append('action', action);
    Object.keys(fields || {}).forEach((k) => fd.append(k, fields[k]));
    const res = await fetch('api.php', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'erro desconhecido');
    return data;
  }

  async function renameProject(entry) {
    const input = prompt('Novo nome do projeto:', entry.title || entry.id);
    if (input == null) return;
    const title = input.trim();
    if (!title || title === entry.title) return;
    try {
      await api('rename_project', { id: entry.id, title });
      await loadAndRenderProjects();
    } catch (err) {
      alert('Falha ao renomear: ' + err.message);
      console.error(err);
    }
  }

  async function deleteProject(entry) {
    const sure = confirm(
      'Apagar o projeto "' + (entry.title || entry.id) + '"?\n\n' +
      'Ele some da lista, mas a pasta vai pra "projects/.trash/" ' +
      '(não é apagado de verdade — se precisar, eu recupero de lá).'
    );
    if (!sure) return;
    try {
      await api('delete_project', { dir: entry.dir });
      await loadAndRenderProjects();
    } catch (err) {
      alert('Falha ao apagar: ' + err.message);
      console.error(err);
    }
  }

  async function downloadProjectZip(dir) {
    importStatus.textContent = 'Montando ZIP…';
    try {
      const res = await fetch('api.php?action=export_zip&dir=' + encodeURIComponent(dir));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro desconhecido');
      importStatus.textContent = '';
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || (dir + '.zip');
      a.click();
    } catch (err) {
      importStatus.textContent = '';
      alert('Falha ao exportar ZIP: ' + err.message);
      console.error(err);
    }
  }

  function openDownloadModal(entry, files) {
    downloadModalDir = entry.dir;
    downloadTitle.textContent = 'Baixar — ' + (entry.title || entry.id);
    if (!files.length) {
      downloadMp4List.innerHTML = '<p class="co-hint">Nenhum v&iacute;deo exportado ainda. Use o bot&atilde;o Exportar dentro do editor.</p>';
    } else {
      downloadMp4List.innerHTML = files.map((f) =>
        '<a class="project-card-export-file" href="' + escapeHtml(f.url) + '" download>' +
        escapeHtml(f.name) + ' · ' + formatBytes(f.size) + '</a>'
      ).join('');
    }
    downloadModal.hidden = false;
  }

  downloadClose.addEventListener('click', () => { downloadModal.hidden = true; });
  downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) downloadModal.hidden = true;
  });
  downloadZipBtn.addEventListener('click', () => {
    if (downloadModalDir) downloadProjectZip(downloadModalDir);
    downloadModal.hidden = true;
  });

  importBtn.addEventListener('click', () => {
    zipInput.value = '';
    zipInput.click();
  });

  zipInput.addEventListener('change', async () => {
    const file = zipInput.files && zipInput.files[0];
    if (!file) return;
    importStatus.textContent = 'Importando ' + file.name + '…';
    try {
      const fd = new FormData();
      fd.append('action', 'import_zip');
      fd.append('zip', file);
      const res = await fetch('api.php', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'erro desconhecido');
      importStatus.textContent = 'Importado: ' + data.imported.map((e) => e.title).join(', ');
      await loadAndRenderProjects();
    } catch (err) {
      importStatus.textContent = '';
      alert('Falha ao importar: ' + err.message);
      console.error(err);
    }
  });

  aiHowtoBtn.addEventListener('click', () => { aiHowtoModal.hidden = false; });
  aiHowtoClose.addEventListener('click', () => { aiHowtoModal.hidden = true; });
  aiHowtoModal.addEventListener('click', (e) => {
    if (e.target === aiHowtoModal) aiHowtoModal.hidden = true;
  });
  aiHowtoCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(aiHowtoPrompt.value);
    } catch (err) {
      // Clipboard API can be unavailable (no HTTPS, permission denied) —
      // falls back to a manual select so the user can still Ctrl+C it.
      aiHowtoPrompt.select();
    }
    const original = aiHowtoCopyBtn.textContent;
    aiHowtoCopyBtn.textContent = 'Copiado!';
    setTimeout(() => { aiHowtoCopyBtn.textContent = original; }, 1500);
  });

  loadAndRenderProjects();
})();

/* ===========================================================================
   app.js — draws the entered name onto the certificate background and
   exports it as a PNG or PDF.

   You should not need to edit this file. Every position, font and colour
   option lives in the CERT_CONFIG block at the bottom of index.html.
   =========================================================================== */

(function () {
  'use strict';

  /* ---------- config ------------------------------------------------------ */

  var DEFAULTS = {
    backgroundFile: 'certificate-bg.png',
    xPercent: 50,
    yPercent: 58,
    fontSizePercent: 7,
    maxWidthPercent: 74,
    minFontSizePercent: 1.5,
    color: '#1f2a44',
    fontFamily: '"Great Vibes", "Snell Roundhand", "Brush Script MT", cursive',
    fontWeight: 400,
    textAlign: 'center',
    textBaseline: 'middle',
    letterSpacingEm: 0,
    uppercase: false,
    autoShrink: true,
    pixelOverrides: { x: null, y: null, fontSize: null },
    downloadPrefix: 'certificate',
    pdfFit: 'fit',
    fallbackSize: { width: 2000, height: 1414 }
  };

  var cfg = (function () {
    var provided = window.CERT_CONFIG || {};
    var merged = Object.assign({}, DEFAULTS, provided);
    merged.pixelOverrides = Object.assign({}, DEFAULTS.pixelOverrides, provided.pixelOverrides || {});
    merged.fallbackSize = Object.assign({}, DEFAULTS.fallbackSize, provided.fallbackSize || {});

    // ?bg=other-certificate.png lets you try a different background without
    // editing CERT_CONFIG — handy when you swap artwork.
    var override = new URLSearchParams(location.search).get('bg');
    if (override) merged.backgroundFile = override;
    return merged;
  })();

  var REFERENCE_SIZE = 100;              // measuring size; text scales linearly from it
  var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  var FONT_WAIT_MS = 2500;

  /* ---------- elements ---------------------------------------------------- */

  var el = {
    form: document.getElementById('cert-form'),
    name: document.getElementById('name'),
    hint: document.getElementById('hint'),
    png: document.getElementById('btn-png'),
    pdf: document.getElementById('btn-pdf'),
    status: document.getElementById('status'),
    notice: document.getElementById('notice'),
    canvas: document.getElementById('certificate'),
    meta: document.getElementById('preview-meta'),
    bgName: document.getElementById('bg-name')
  };

  var ctx = el.canvas.getContext('2d');

  var state = {
    background: null,       // loaded <img>, or null while using the placeholder
    loadFailed: false,
    ready: false,
    busy: false
  };

  /* ---------- ui helpers -------------------------------------------------- */

  var notices = [];
  var noticeKeys = {};

  function renderNotices() {
    if (!notices.length) {
      el.notice.hidden = true;
      el.notice.innerHTML = '';
      return;
    }
    var worst = notices.some(function (n) { return n.kind === 'error'; }) ? 'error' : 'info';
    el.notice.className = 'notice' + (worst === 'error' ? ' notice--error' : '');
    el.notice.innerHTML = notices.map(function (n) { return n.html; }).join('<br>');
    el.notice.hidden = false;
  }

  function addNotice(key, html, kind) {
    if (noticeKeys[key]) return;
    noticeKeys[key] = true;
    notices.push({ key: key, html: html, kind: kind || 'info' });
    renderNotices();
  }

  function removeNotice(key) {
    if (!noticeKeys[key]) return;
    delete noticeKeys[key];
    notices = notices.filter(function (n) { return n.key !== key; });
    renderNotices();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(message, kind) {
    el.status.textContent = message || '';
    el.status.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function cleanName() {
    return el.name.value.replace(/\s+/g, ' ').trim();   // collapses runs of spaces
  }

  function markInvalid(invalid) {
    el.name.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    el.hint.className = 'field__hint' + (invalid ? ' field__hint--error' : '');
    el.hint.textContent = invalid
      ? 'Please enter a name before generating the certificate.'
      : 'Enter a name to enable the download buttons.';
  }

  function refreshButtons() {
    var blocked = state.busy || !state.ready || cleanName().length === 0;
    el.png.disabled = blocked;
    el.pdf.disabled = blocked;
  }

  function safeFilename(name) {
    var slug = name
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')  // characters no filesystem likes
      .replace(/[.\s_]+/g, '-')                             // dots are legal but untidy in filenames
      .replace(/-{2,}/g, '-')
      .slice(0, 60)
      .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
      .toLowerCase();
    return slug ? cfg.downloadPrefix + '-' + slug : cfg.downloadPrefix;
  }

  /* ---------- text layout ------------------------------------------------- */

  function setLetterSpacing(size) {
    if (!('letterSpacing' in ctx)) return;
    ctx.letterSpacing = cfg.letterSpacingEm
      ? (size * Number(cfg.letterSpacingEm)).toFixed(3) + 'px'
      : '0px';
  }

  function applyFont(size) {
    ctx.font = cfg.fontWeight + ' ' + size + 'px ' + cfg.fontFamily;
    setLetterSpacing(size);
  }

  // The advance width under-reports script fonts, whose swashes spill past it,
  // so prefer the real ink extents when the browser can provide them.
  function measureInk(text) {
    var metrics = ctx.measureText(text);
    var hasInk = typeof metrics.actualBoundingBoxLeft === 'number' &&
      typeof metrics.actualBoundingBoxRight === 'number';
    var inkWidth = hasInk ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight : 0;
    return Math.max(metrics.width, inkWidth);
  }

  // Text width is linear in font size (letter spacing is em-based too), so one
  // measurement at REFERENCE_SIZE gives the exact size that fits maxWidth.
  function fitFontSize(width, height, text) {
    var maxWidth = width * (Number(cfg.maxWidthPercent) / 100);
    var baseSize = cfg.pixelOverrides.fontSize != null
      ? Number(cfg.pixelOverrides.fontSize)
      : height * (Number(cfg.fontSizePercent) / 100);
    var minSize = Math.min(baseSize, Math.max(6, height * (Number(cfg.minFontSizePercent) / 100)));

    if (!cfg.autoShrink || !text) return baseSize;

    applyFont(REFERENCE_SIZE);
    var referenceWidth = measureInk(text);
    var size = baseSize;

    if (referenceWidth > 0) {
      size = Math.min(baseSize, REFERENCE_SIZE * (maxWidth / referenceWidth));
    }
    if (size < minSize) {
      size = minSize;
      if (referenceWidth > 0 && REFERENCE_SIZE * (maxWidth / referenceWidth) < minSize) {
        console.warn('[certificate] Name is still wider than maxWidthPercent at the ' +
          'minimum font size. Lower minFontSizePercent or increase maxWidthPercent.');
      }
    }
    return size;
  }

  function drawName(text, width, height) {
    var value = cfg.uppercase ? text.toLocaleUpperCase() : text;
    var size = fitFontSize(width, height, value);

    applyFont(size);
    ctx.textAlign = cfg.textAlign;
    ctx.textBaseline = cfg.textBaseline;
    ctx.fillStyle = cfg.color;

    var x = cfg.pixelOverrides.x != null ? Number(cfg.pixelOverrides.x) : width * (Number(cfg.xPercent) / 100);
    var y = cfg.pixelOverrides.y != null ? Number(cfg.pixelOverrides.y) : height * (Number(cfg.yPercent) / 100);
    ctx.fillText(value, x, y);
  }

  /* ---------- built-in placeholder background ----------------------------- */

  // Only used when certificate-bg.png is missing, so the whole flow stays
  // testable. It is drawn locally, so the canvas never becomes tainted.
  function drawPlaceholderBackground(width, height) {
    var unit = Math.min(width, height);

    var wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, '#fffdf7');
    wash.addColorStop(1, '#f4ecdc');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    var outer = unit * 0.045;
    var inner = outer + unit * 0.016;
    ctx.strokeStyle = '#c2a14a';
    ctx.lineWidth = Math.max(2, unit * 0.005);
    ctx.strokeRect(outer, outer, width - outer * 2, height - outer * 2);
    ctx.lineWidth = Math.max(1, unit * 0.0018);
    ctx.strokeRect(inner, inner, width - inner * 2, height - inner * 2);

    var arm = unit * 0.05;
    [[inner, inner, 1, 1], [width - inner, inner, -1, 1],
     [inner, height - inner, 1, -1], [width - inner, height - inner, -1, -1]]
      .forEach(function (corner) {
        ctx.beginPath();
        ctx.moveTo(corner[0] + corner[2] * arm, corner[1]);
        ctx.lineTo(corner[0], corner[1]);
        ctx.lineTo(corner[0], corner[1] + corner[3] * arm);
        ctx.stroke();
      });

    ctx.save();
    setLetterSpacing(0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#2b3245';
    ctx.font = '600 ' + Math.round(unit * 0.030) + 'px Georgia, "Times New Roman", serif';
    ctx.fillText('CERTIFICATE OF ACHIEVEMENT', width / 2, height * 0.24);

    ctx.fillStyle = '#a9782b';
    ctx.font = '400 ' + Math.round(unit * 0.017) + 'px Georgia, "Times New Roman", serif';
    ctx.fillText('placeholder background — your PNG is not loaded yet', width / 2, height * 0.315);

    ctx.strokeStyle = '#d8d2c4';
    ctx.lineWidth = Math.max(1, unit * 0.0012);
    ctx.beginPath();
    ctx.moveTo(width * 0.24, height * 0.70);
    ctx.lineTo(width * 0.76, height * 0.70);
    ctx.stroke();

    ctx.fillStyle = '#6b7385';
    ctx.font = '400 ' + Math.round(unit * 0.016) + 'px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    ctx.fillText('Add certificate-bg.png next to index.html', width / 2, height * 0.80);
    ctx.restore();
  }

  /* ---------- rendering --------------------------------------------------- */

  function updateMeta(width, height) {
    var size = width + ' × ' + height + ' px';
    el.meta.textContent = size + (state.background ? ' · ' + cfg.backgroundFile : ' · placeholder');
  }

  function render(text) {
    var canvas = el.canvas;
    var background = state.background;
    var width = background ? background.naturalWidth : cfg.fallbackSize.width;
    var height = background ? background.naturalHeight : cfg.fallbackSize.height;

    // Resizing the canvas also clears it, so the background is always redrawn
    // first and the name always lands on top.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.drawImage(background, 0, 0, width, height);
    } else {
      drawPlaceholderBackground(width, height);
    }
    if (text) drawName(text, width, height);

    updateMeta(width, height);
  }

  function loadBackground() {
    return new Promise(function (resolve) {
      var img = new Image();
      var settled = false;

      function finish() {
        resolve();
      }

      img.onload = function () {
        if (img.naturalWidth > 0) {
          state.background = img;
          state.loadFailed = false;
          if (settled) {                      // arrived after the hang guard fired
            removeNotice('missing-background');
            render(cleanName());
          }
        } else {
          state.loadFailed = true;
        }
        if (!settled) { settled = true; finish(); }
      };

      img.onerror = function () {
        state.loadFailed = true;
        if (!settled) { settled = true; finish(); }
      };

      // Never leave the UI stuck behind a hanging image request.
      setTimeout(function () {
        if (!settled) { settled = true; state.loadFailed = true; finish(); }
      }, 8000);

      img.src = cfg.backgroundFile;
    });
  }

  function waitForFonts() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    var loaded = document.fonts.load(cfg.fontWeight + ' ' + REFERENCE_SIZE + 'px ' + cfg.fontFamily)
      .catch(function () { /* offline: the system fallback font is fine */ });
    var ready = document.fonts.ready || Promise.resolve();
    return Promise.all([loaded, ready]);
  }

  /* ---------- export ------------------------------------------------------ */

  function isSecurityError(error) {
    return !!error && (error.name === 'SecurityError' ||
      /tainted|insecure|cross-origin/i.test(error.message || ''));
  }

  function reportTaintedCanvas() {
    addNotice('taint',
      '<strong>Downloads are blocked while this page is opened straight from disk.</strong><br>' +
      'Browsers treat local images as cross-origin, so the picture cannot be saved. ' +
      'Serve the folder over HTTP instead — in a terminal, from this folder, run ' +
      '<code>python -m http.server 8000</code> and open <code>http://localhost:8000</code>. ' +
      '(No Python? <code>npx serve</code> works too.)',
      'error');
    setStatus('Could not export: run the page through a local server (see the note above).', 'error');
  }

  function canvasToBlob() {
    return new Promise(function (resolve, reject) {
      try {
        el.canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject({ name: 'SecurityError', message: 'The canvas could not be exported (tainted).' });
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
  }

  var jsPdfPromise = null;

  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jsPdfPromise) return jsPdfPromise;

    jsPdfPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = JSPDF_URL;
      script.async = true;
      script.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else { jsPdfPromise = null; reject(new Error('The PDF library loaded but did not start up correctly.')); }
      };
      script.onerror = function () {
        jsPdfPromise = null;
        reject(new Error('Could not reach the PDF library (offline?). PNG download still works.'));
      };
      document.head.appendChild(script);
    });
    return jsPdfPromise;
  }

  function downloadPng(stem) {
    return canvasToBlob().then(function (blob) {
      triggerDownload(blob, stem + '.png');
      setStatus('Downloaded ' + stem + '.png', 'ok');
    });
  }

  function downloadPdf(stem) {
    return loadJsPdf().then(function (JsPDF) {
      var dataUrl = el.canvas.toDataURL('image/png');   // throws on a tainted canvas
      var width = el.canvas.width;
      var height = el.canvas.height;
      var landscape = width >= height;
      var pdf = new JsPDF({
        orientation: landscape ? 'landscape' : 'portrait',
        unit: 'pt',
        format: 'a4',
        compress: true
      });

      var pageWidth = pdf.internal.pageSize.getWidth();
      var pageHeight = pdf.internal.pageSize.getHeight();
      var drawWidth = pageWidth;
      var drawHeight = pageHeight;

      if (cfg.pdfFit !== 'stretch') {
        var scale = cfg.pdfFit === 'fill'
          ? Math.max(pageWidth / width, pageHeight / height)   // covers the page, crops the overflow
          : Math.min(pageWidth / width, pageHeight / height);  // whole certificate, no cropping
        drawWidth = width * scale;
        drawHeight = height * scale;
      }

      pdf.addImage(dataUrl, 'PNG',
        (pageWidth - drawWidth) / 2, (pageHeight - drawHeight) / 2,
        drawWidth, drawHeight, undefined, 'FAST');
      pdf.save(stem + '.pdf');
      setStatus('Downloaded ' + stem + '.pdf', 'ok');
    });
  }

  function handleExportError(error) {
    if (isSecurityError(error)) { reportTaintedCanvas(); return; }
    var message = (error && error.message) || 'Something went wrong while generating the certificate.';
    setStatus(message, 'error');
    if (window.console) console.error('[certificate]', error);
  }

  function withBusy(button, label, task) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    var originalLabel = button.textContent;
    button.textContent = label;
    refreshButtons();

    return Promise.resolve()
      .then(task)
      .catch(handleExportError)
      .then(function () {
        state.busy = false;
        button.textContent = originalLabel;
        refreshButtons();
      });
  }

  /* ---------- wiring ------------------------------------------------------ */

  var frame = 0;

  el.name.addEventListener('input', function () {
    markInvalid(false);
    setStatus('');
    refreshButtons();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () { render(cleanName()); });
  });

  function generate() {
    var name = cleanName();
    if (!name) { markInvalid(true); el.name.focus(); return; }
    render(name);                                    // make sure the bitmap matches the field
    withBusy(el.png, 'Generating…', function () { return downloadPng(safeFilename(name)); });
  }

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    generate();
  });

  // A disabled submit button blocks the browser's implicit submission, so
  // Enter is handled here to keep the keyboard path working (and to explain
  // itself when the field is still empty).
  el.name.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    generate();
  });

  el.pdf.addEventListener('click', function () {
    var name = cleanName();
    if (!name) { markInvalid(true); el.name.focus(); return; }
    render(name);
    withBusy(el.pdf, 'Building PDF…', function () { return downloadPdf(safeFilename(name)); });
  });

  /* ---------- start ------------------------------------------------------- */

  function init() {
    el.bgName.textContent = cfg.backgroundFile;
    markInvalid(false);
    refreshButtons();

    if (location.protocol === 'file:') {
      addNotice('file-protocol',
        '<strong>Heads up:</strong> you are opening this page straight from disk. ' +
        'Downloads need it served over HTTP — run <code>python -m http.server 8000</code> ' +
        'in this folder and open <code>http://localhost:8000</code>.');
    }

    loadBackground().then(function () {
      if (state.loadFailed) {
        addNotice('missing-background',
          'Could not load <code>' + escapeHtml(cfg.backgroundFile) + '</code>, so a built-in ' +
          'placeholder background is shown. Add your PNG next to <code>index.html</code> and reload.');
      }
      // Don't let a slow web font hold the page hostage.
      return Promise.race([waitForFonts(), new Promise(function (r) { setTimeout(r, FONT_WAIT_MS); })]);
    }).then(function () {
      render(cleanName());
      state.ready = true;
      refreshButtons();
    });

    // If the webfont arrives after the first paint, redraw so the name is never
    // exported in a fallback font.
    if (document.fonts) {
      var redraw = function () { if (state.ready) render(cleanName()); };
      if (document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(redraw, redraw);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redraw);
    }
  }

  init();
})();

# Certificate Generator

A single-page certificate generator. Type a name, hit **Generate**, and a finished
certificate downloads — your background image with the name composited on top.

No build step, no `npm install`. Three files: `index.html`, `styles.css`, `app.js`.

## Run it

Open a terminal **in this folder** and start any static server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

> **Don't double-click `index.html`.** Browsers treat images loaded from `file://`
> as cross-origin, which makes the canvas unexportable — clicks would produce
> nothing. The page detects this and tells you what to do, but the server above
> is the real answer. Alternative: `npx serve`.

## Your background image

Put a PNG named **`certificate-bg.png`** in this folder, next to `index.html`.
That's it — the page picks it up on reload and the canvas adopts its exact
dimensions, so the download is the same resolution as your artwork.

If the file is missing, the page draws a placeholder background so you can still
try the flow, and shows a note explaining what to add.

## Changing where the name sits

Everything is in the `CERT_CONFIG` block at the bottom of `index.html`. Positions
are **percentages of the image**, not pixels, so swapping in a differently-sized
PNG keeps the name in the same relative spot.

```js
xPercent: 50,           // 0 = far left, 50 = centred, 100 = far right
yPercent: 58,           // 0 = top, 50 = middle, 100 = bottom (centre of the text)
fontSizePercent: 7,     // font size as a percentage of image HEIGHT
maxWidthPercent: 74,    // names wider than this get shrunk to fit
color: '#1f2a44',       // any CSS colour
fontFamily: '"Great Vibes", "Snell Roundhand", cursive',
uppercase: false,
autoShrink: true        // long names shrink instead of overflowing
```

Prefer exact pixels? Set any of `pixelOverrides: { x, y, fontSize }` to a number
and that value is used verbatim instead of the percentage.

Long names are shrunk automatically so they always fit inside `maxWidthPercent`.
`minFontSizePercent` is the floor that shrinking will not go below.

### Trying a different background without editing config

Append `?bg=` to the URL:

```
http://localhost:8000/?bg=samples/sample-certificate.png
```

## PNG and PDF

- **Generate certificate (PNG)** — exports at the background's native
  resolution, named `certificate-<name>.png`.
- **Download PDF** — a single A4 page (portrait or landscape to match your
  artwork). `pdfFit` controls it: `'fit'` keeps the whole certificate visible
  (no cropping, possibly thin margins), `'fill'` covers the page completely,
  `'stretch'` forces it to the page edges.

The PDF button pulls [jsPDF](https://github.com/parallax/jsPDF) from a CDN the
first time you click it, so it needs an internet connection once. The PNG
download has no dependencies at all and works offline.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing downloads | You're on `file://`. Serve the folder (see above). |
| Placeholder background | `certificate-bg.png` isn't in this folder, or the name is misspelled. |
| Name in the wrong spot | Tune `xPercent` / `yPercent` / `fontSizePercent` in `index.html` and reload. |
| Script font looks plain | The Google Font couldn't load (offline). It falls back to `Snell Roundhand` / `Brush Script MT` / `cursive`, and the exported PNG matches what you see. |

The name is drawn at the same size in the preview and the export, so what you see
on screen is exactly what you get in the file.

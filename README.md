# Texture Harvester

Mark a surface in a photograph, get a flat tiling texture with a full PBR material out.

**Live:** [beamng.github.io/TextureHarvester](https://beamng.github.io/TextureHarvester/)

![Texture Harvester](assets/demo.gif)

## Why try it

- **Perspective warp** — mark a quad on a photo, get a flat tile on the Atlas
- **Ctrl+drag an edge** (long-press and drag on touch) — two edges finish the mark
- **Flatten lighting (L)** — divide out illumination baked into the photo
- **Auto PBR maps** — normals, roughness, cavity; judged in 3D; export a GLB (**Ctrl+G**)
- **Tiling preview with seam lines** — the honest check that a weld or mirror worked
- **Pack** — tight atlas sheet with padding / optional power-of-two
- **Pixel loupe**, **corner welding**, marks past the photo edge, optional **depth bow**
- **Example photos** in the intro — first extract without hunting for a camera
- **One self-contained HTML file** — no server, no install

## Develop

```bash
npm install
npm run dev      # http://localhost:5173, hot reload
npm run build    # dist/index.html, one file
npm test         # selftest, inttest and uitest in headless Chrome
```

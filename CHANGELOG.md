# Changelog

## [0.3.0] — 2026-08-10

### Added
- Mark corners can be dragged outside the photograph; the overhang fills red and those handles turn red
- Richer `index.html` metadata: Open Graph / Twitter cards, theme colour, canonical URL, JSON-LD, and an inline SVG favicon

### Notes
- Samples outside the photo stay transparent in the extract (unchanged warp behaviour)

## [0.2.0] — 2026-08-09

### Added
- Touch and tablet support: pinch-zoom and two-finger pan on Source, Atlas, and Tiling
- Touch mark placement: long-press to start a corner, tap to continue, long-press-drag for an edge
- Soft-disable for the 3D preview when WebGL cannot be created or the context is lost
- Coarse-pointer status hints (long-press, pinch, two fingers)
- Safe-area and `100dvh` viewport handling for notched tablets and mobile browser chrome

### Fixed
- 3D preview no longer takes down the app when an extra WebGL context fails

## [0.1.0] — 2026-08-09

First public release: mark surfaces in a photograph, flatten them into tiling textures with PBR maps, pack an atlas, and preview or export as GLB — one self-contained HTML file.

### Also in this tag
- Default dock layout tuned to the demo
- GitHub repository link in the toolbar

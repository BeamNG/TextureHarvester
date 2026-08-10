# Changelog

## [0.6.0] — 2026-08-10

### Added
- Auto-generate PBR maps after extract (Settings → Material); first run suggests strengths
- Intro can load the bundled example photos
- Meeting edges finish a mark as a parallelogram; pinched or stacked corners show a warning
- First extract selects the new atlas slice and fits it once Atlas is actually on screen

### Changed
- Touch tips and status hints say long-press and drag (long-press alone only opens the loupe)
- Stronger Props group headers; warning chip no longer reserves empty icon space

### Fixed
- Dragging a mark edge/corner no longer rebuilds PBR every frame (was very slow with maps on)
- Tiles and 3D refresh when mark pixels change
- Status bar follows the active dock tab without clicking the panel body
- Atlas fit no longer measures the off-screen parking host (first slice looked tiny)

## [0.5.0] — 2026-08-10

### Added
- Compact mobile layout: one panel at a time with a tab strip; desktop dock layout kept separately
- First-run intro walkthrough (reopen from the help icon or Settings), with touch-aware steps and control previews
- Live dots on tabs when a panel has something useful (photo, texture, preview-ready selection, depth)
- Help button in the toolbar

### Changed
- Touch tutorials and status hints use long-press / tap instead of Ctrl+click
- Import and Export are primary toolbar actions; undo/redo and GitHub sit on the right
- Shorter mobile tab labels (Tiles, 3D, Props); clearer active-tab chrome
- Canvas and 3D preview follow screen DPI up to 3× and rebuild on browser zoom

### Fixed
- Page zoom no longer leaves canvases soft or mis-sized
- 3D tab no longer lights up for a photo that has no depth yet

## [0.4.1] — 2026-08-10

### Fixed
- Settings header shows a Done button (the close icon was missing from the icon set)
- Settings opens with no transition animation

## [0.4.0] — 2026-08-10

### Changed
- Settings opens as a fullscreen, scrollable page instead of a dropdown menu

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

Vendored browser entry points of `@cybr/labs-sdk` 0.1.1 (MIT, see LICENSE):

- `terminal.js` comes from `dist/terminal.js`
- `terminal-xterm.js` comes from `dist/terminal/xterm.js`

They are served from our own origin rather than loaded from a CDN at runtime. To upgrade:

1. Copy the same files from the new version's npm package into a new versioned directory.
2. Update the import paths in `docs/js/map-game.js`.

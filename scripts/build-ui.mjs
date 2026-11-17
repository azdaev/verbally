import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'ui/styles.css', '-o', 'ui/compiled.css', '--minify'], { stdio: 'inherit' })
try {
  await build({ entryPoints: ['ui/app.jsx'], bundle: true, minify: true, outfile: 'js/ui.js',
    format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' })
} finally { rmSync('ui/compiled.css', { force: true }) }

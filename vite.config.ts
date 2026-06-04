import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Vite plugin: after build, inline the small app CSS bundle into index.html
// to eliminate the render-blocking CSS request.
function inlineCssPlugin() {
	return {
		name: 'inline-css',
		apply: 'build' as const,
		closeBundle() {
			const distDir = path.resolve(__dirname, 'dist')
			const htmlPath = path.join(distDir, 'index.html')
			let html = fs.readFileSync(htmlPath, 'utf-8')

			// Find the app CSS link (not Bootstrap CDN). The optional non-capturing
			// prefix tolerates a deploy base (e.g. /webpranks); group 1 captures the
			// on-disk path under dist/, which has no base prefix.
			const cssLinkMatch = html.match(/<link rel="stylesheet" crossorigin href="[^"]*(\/assets\/index-[^"]+\.css)">/)
			if (!cssLinkMatch) return

			const cssPath = path.join(distDir, cssLinkMatch[1])
			const cssContent = fs.readFileSync(cssPath, 'utf-8')

			// Replace the <link> with an inline <style>
			html = html.replace(cssLinkMatch[0], `<style>${cssContent}</style>`)
			fs.writeFileSync(htmlPath, html)
		}
	}
}

export default defineConfig(({ command }) => ({
	// Deploy base. Defaults to '/' (Netlify, root domain). The GitHub Pages
	// project-site build sets VITE_BASE=/webpranks/ so assets resolve under the
	// /webpranks subpath at easierbycode.com/webpranks.
	base: process.env.VITE_BASE ?? '/',
	plugins: [
		react(),
		inlineCssPlugin(),
	],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src')
		}
	},
	build: {
		target: 'ES2020',
		outDir: 'dist',
	},
	esbuild: {
		drop: command === 'build' ? ['console', 'debugger'] : []
	}
}))

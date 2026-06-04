// Deployment base path.
//
// `import.meta.env.BASE_URL` is Vite's build-time base: '/' for the root Netlify
// deploy (webfun.click) and '/webpranks/' for the GitHub Pages project-site deploy
// (easierbycode.com/webpranks). BASE strips the trailing slash so it can be
// prepended to absolute '/asset' paths without producing a double slash.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Prefix an absolute app path (e.g. '/jester-320.png') with the deployment base. */
export const asset = (path: string): string =>
	BASE + (path.startsWith('/') ? path : `/${path}`)

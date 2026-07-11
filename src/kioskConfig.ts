// Kiosk / embed parameters captured from the initial URL query by PrankRunner
// on first render, before react-router strips the query string. Page-effect
// scenes are created later (after the target page loads), by which point the
// query is gone — so they read these values here instead.
//
// `embed` is set when the prank runs inside another app's iframe (e.g. the
// squad-game meteor-smash bonus round). Embedded scenes report their result to
// the parent window via postMessage instead of redirecting.
export const kioskConfig = {
	embed: false,
	seconds: 10,
}

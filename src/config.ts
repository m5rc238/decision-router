// Central GitHub link. Override at build time with VITE_GITHUB_URL if the
// repository moves. It feeds the "GitHub" link in the app chrome.
export const GITHUB_URL: string =
  import.meta.env.VITE_GITHUB_URL ?? 'https://github.com/m5rc238/decision-router'
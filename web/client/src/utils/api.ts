declare const __VERCEL_ENV__: string;

const getApiBaseUrl = () => {
  if (__VERCEL_ENV__ === 'preview') {
    return 'https://api-testing.albionroads.live';
  }

  // Empty string = same origin. Works in dev via the Vite proxy (/api, /ws)
  // and in production when the client is served from the same host as the
  // API (e.g. Tailscale Funnel, nginx). Override with VITE_API_URL for a
  // separately hosted API.
  return import.meta.env.VITE_API_URL || '';
};

export const API_BASE_URL = getApiBaseUrl();

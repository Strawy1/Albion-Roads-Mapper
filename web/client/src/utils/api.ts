declare const __VERCEL_ENV__: string;

const getApiBaseUrl = () => {
  if (__VERCEL_ENV__ === 'preview') {
    return 'https://api-testing.albionroads.live';
  }

  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

export const API_BASE_URL = getApiBaseUrl();

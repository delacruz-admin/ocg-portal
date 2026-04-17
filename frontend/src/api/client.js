import { getToken, redirectToLogin, isAuthenticated } from '../auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL || '';
const CHAT_URL = import.meta.env.VITE_CHAT_URL || '';

async function request(path, options = {}) {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new Error('Not authenticated');
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        ...options.headers,
      },
    });
  } catch (fetchErr) {
    // NetworkError usually means token expired and CORS preflight failed,
    // or the connection was reset. Re-auth fixes most cases.
    if (!isAuthenticated()) {
      redirectToLogin();
      throw new Error('Session expired — redirecting to login');
    }
    throw fetchErr;
  }

  if (res.status === 401) {
    redirectToLogin();
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export function listOcgs() {
  return request('/ocgs');
}

export function getOcg(ocgId) {
  return request(`/ocgs/${ocgId}`);
}

export function analyzeTimecard(ocgId, entries) {
  return request('/analyze', {
    method: 'POST',
    body: JSON.stringify({ ocg_id: ocgId, entries }),
  });
}

export function chatOcg(ocgId, messages) {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify({ ocg_id: ocgId, messages }),
  });
}

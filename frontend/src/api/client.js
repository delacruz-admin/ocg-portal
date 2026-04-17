import { getToken, redirectToLogin, isAuthenticated } from '../auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Returns a promise that never resolves — used after redirect to prevent
// downstream catch blocks from firing before the browser navigates away
function redirectAndHalt() {
  redirectToLogin();
  return new Promise(() => {});
}

async function request(path, options = {}) {
  const token = getToken();
  if (!token) {
    return redirectAndHalt();
  }

  // Check token expiry before making the call
  if (!isAuthenticated()) {
    return redirectAndHalt();
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
    // NetworkError — likely expired token causing CORS preflight failure
    if (!isAuthenticated()) {
      return redirectAndHalt();
    }
    throw fetchErr;
  }

  if (res.status === 401 || res.status === 403) {
    return redirectAndHalt();
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

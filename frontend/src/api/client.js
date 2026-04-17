import { getToken, redirectToLogin, isAuthenticated, tokenMinutesLeft } from '../auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function redirectAndHalt() {
  console.warn('[API] Redirecting to login...');
  redirectToLogin();
  return new Promise(() => {});
}

async function request(path, options = {}) {
  const token = getToken();
  const mins = tokenMinutesLeft();
  const url = `${API_BASE}${path}`;

  console.log(`[API] Request: ${options.method || 'GET'} ${url}`);
  console.log(`[API] Token present: ${!!token}, authenticated: ${isAuthenticated()}, expires in: ${mins}min`);
  console.log(`[API] API_BASE: "${API_BASE}"`);

  if (!token) {
    console.warn('[API] No token — redirecting');
    return redirectAndHalt();
  }

  if (!isAuthenticated()) {
    console.warn('[API] Token expired — redirecting');
    return redirectAndHalt();
  }

  let res;
  try {
    console.log(`[API] Fetching ${url}...`);
    const startTime = Date.now();
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        ...options.headers,
      },
    });
    const elapsed = Date.now() - startTime;
    console.log(`[API] Response: ${res.status} ${res.statusText} (${elapsed}ms)`);
    console.log(`[API] Response headers:`, Object.fromEntries(res.headers.entries()));
  } catch (fetchErr) {
    console.error(`[API] Fetch threw:`, fetchErr.name, fetchErr.message);
    console.error(`[API] Token still valid: ${isAuthenticated()}, mins left: ${tokenMinutesLeft()}`);
    if (!isAuthenticated()) {
      return redirectAndHalt();
    }
    throw fetchErr;
  }

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    console.warn(`[API] Auth error ${res.status}:`, body);
    return redirectAndHalt();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`[API] Error response:`, res.status, body);
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  console.log(`[API] Success:`, Object.keys(data));
  return data;
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

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || window.location.origin;

export function getToken() {
  return sessionStorage.getItem('id_token');
}

export function isAuthenticated() {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function redirectToLogin() {
  const url = `${COGNITO_DOMAIN}/login?response_type=token&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=openid+email+profile`;
  window.location.href = url;
}

export function handleCallback() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const idToken = params.get('id_token');
  if (idToken) {
    sessionStorage.setItem('id_token', idToken);
    window.history.replaceState(null, '', window.location.pathname);
  }
}

export function logout() {
  sessionStorage.removeItem('id_token');
  const url = `${COGNITO_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
  window.location.href = url;
}

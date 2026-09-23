/**
 * Karu AI - Global Authentication & Fetch Interceptor
 * Ensures all /api/ requests include credentials and the Bearer token from localStorage.
 */
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    options = options || {};
    
    // Always include credentials for cookie preservation
    if (typeof options.credentials === 'undefined') {
      options.credentials = 'include';
    }

    const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : '');
    const token = localStorage.getItem('authToken');

    if (token && urlStr.includes('/api/')) {
      if (!options.headers) {
        options.headers = { 'Authorization': 'Bearer ' + token };
      } else if (options.headers instanceof Headers) {
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', 'Bearer ' + token);
        }
      } else if (Array.isArray(options.headers)) {
        if (!options.headers.some(([k]) => k.toLowerCase() === 'authorization')) {
          options.headers.push(['Authorization', 'Bearer ' + token]);
        }
      } else if (typeof options.headers === 'object') {
        if (!options.headers['Authorization'] && !options.headers['authorization']) {
          options.headers['Authorization'] = 'Bearer ' + token;
        }
      }
    }

    const response = await originalFetch(url, options);

    // If API returns 401 on an authenticated page, clean up and redirect
    if (response.status === 401 && urlStr.includes('/api/auth/me')) {
      const isLoginPage = window.location.pathname.includes('login') || window.location.pathname.includes('signup');
      if (!isLoginPage) {
        console.warn('Authentication expired, redirecting to login...');
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = 'login.html';
      }
    }

    return response;
  };
})();


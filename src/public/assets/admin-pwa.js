if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch((error) => {
      console.error('[PWA_REGISTRATION_ERROR]', error);
    });
  });
}

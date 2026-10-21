// Thème choisi (ou celui du système), appliqué avant l'affichage : pas d'éclair blanc.
;(function () {
  var saved = null
  try {
    saved = localStorage.getItem('compi-theme')
  } catch {
    // stockage indisponible (navigation privée) : thème du système
  }
  var light = saved ? saved === 'light' : window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
})()

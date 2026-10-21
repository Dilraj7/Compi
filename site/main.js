// Site de Compi : visage du robot (yeux LED qui clignent et suivent la souris), demandes
// qui défilent dans l'îlot, thème clair ou sombre, menu sur téléphone, boutons « Copier »,
// captures qui s'ouvrent en grand.
// Mouvement réduit demandé par le système : visage fixe, aucune animation.
;(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ─── Thème ────────────────────────────────────────────────────────────────
  var root = document.documentElement
  var toggle = document.querySelector('[data-theme-toggle]')
  function label() {
    toggle.setAttribute('aria-label', root.getAttribute('data-theme') === 'light' ? 'Passer en thème sombre' : 'Passer en thème clair')
  }
  label()
  toggle.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    root.setAttribute('data-theme', next)
    try {
      localStorage.setItem('compi-theme', next)
    } catch {
      // stockage indisponible : le choix vaut pour cette visite
    }
    label()
  })

  // ─── Menu (téléphone) : l'îlot s'agrandit vers le bas ─────────────────────
  var island = document.querySelector('[data-island]')
  var menuBtn = document.querySelector('[data-menu]')
  function setMenu(open) {
    island.classList.toggle('open', open)
    menuBtn.setAttribute('aria-expanded', String(open))
  }
  menuBtn.addEventListener('click', function () {
    setMenu(!island.classList.contains('open'))
  })
  island.addEventListener('click', function (e) {
    if (e.target.closest('.island-links a')) setMenu(false)
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false)
  })
  window.addEventListener(
    'scroll',
    function () {
      island.classList.toggle('scrolled', window.scrollY > 8)
    },
    { passive: true }
  )

  // ─── Copier ───────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = document.getElementById(btn.getAttribute('data-copy')).innerText
      var done = function () {
        btn.textContent = 'Copié'
        setTimeout(function () {
          btn.textContent = 'Copier'
        }, 1600)
      }
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {})
    })
  })

  // ─── Image agrandie ───────────────────────────────────────────────────────
  // Sans <dialog>, le lien ouvre simplement l'image en grand.
  var zoom = document.querySelector('[data-zoom-dialog]')
  if (zoom && typeof zoom.showModal === 'function') {
    var big = zoom.querySelector('img')
    document.querySelectorAll('[data-zoom]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault()
        var img = link.querySelector('img')
        big.src = link.getAttribute('href')
        big.alt = img.alt
        // Sur téléphone, l'image garde sa taille réelle (--w) et se parcourt du doigt.
        big.style.setProperty('--w', img.getAttribute('width') + 'px')
        zoom.showModal()
        zoom.scrollTo(0, 0)
      })
    })
    zoom.addEventListener('click', function (e) {
      if (e.target === zoom || e.target.closest('[data-zoom-close]')) zoom.close()
    })
  }

  // ─── Yeux LED : 5 × 5 points par œil ──────────────────────────────────────
  // Chaque expression liste les points allumés (ligne × 5 + colonne).
  var square = function (dx, dy) {
    var on = []
    for (var r = 1; r <= 3; r++) for (var c = 1; c <= 3; c++) on.push((r + dy) * 5 + (c + dx))
    return on
  }
  var FACES = {
    happy: [15, 11, 7, 13, 19],
    blink: [11, 12, 13],
    look: square
  }
  var eyes = Array.prototype.slice.call(document.querySelectorAll('[data-eye]'))
  eyes.forEach(function (eye) {
    for (var i = 0; i < 25; i++) eye.appendChild(document.createElement('i'))
  })
  function show(on) {
    eyes.forEach(function (eye) {
      Array.prototype.forEach.call(eye.children, function (dot, i) {
        dot.classList.toggle('on', on.indexOf(i) >= 0)
      })
    })
  }

  var stage = document.querySelector('[data-robot]')
  var gaze = { dx: 0, dy: 0 }
  var mood = 'look'
  function render() {
    show(mood === 'look' ? FACES.look(gaze.dx, gaze.dy) : FACES[mood])
  }

  if (reduce) {
    mood = 'happy'
    render()
  } else {
    render()
    // Le regard suit la souris, d'un point au plus dans chaque direction.
    window.addEventListener(
      'pointermove',
      function (e) {
        var box = stage.getBoundingClientRect()
        var x = (e.clientX - (box.left + box.width / 2)) / window.innerWidth
        var y = (e.clientY - (box.top + box.height / 2)) / window.innerHeight
        var dx = x > 0.12 ? 1 : x < -0.12 ? -1 : 0
        var dy = y > 0.18 ? 1 : y < -0.18 ? -1 : 0
        if (dx !== gaze.dx || dy !== gaze.dy) {
          gaze = { dx: dx, dy: dy }
          if (mood === 'look') render()
        }
      },
      { passive: true }
    )
    // Clignement de temps en temps, sourire au survol.
    var blink = function () {
      if (mood === 'look') {
        mood = 'blink'
        render()
        setTimeout(function () {
          mood = 'look'
          render()
        }, 140)
      }
      setTimeout(blink, 2600 + Math.random() * 3000)
    }
    setTimeout(blink, 1800)
    stage.addEventListener('pointerenter', function () {
      mood = 'happy'
      render()
    })
    stage.addEventListener('pointerleave', function () {
      mood = 'look'
      render()
    })
  }

  // ─── Demandes qui défilent dans l'îlot ────────────────────────────────────
  var ask = document.querySelector('[data-ask]')
  var ASKS = [
    'Qu’est-ce que j’ai aujourd’hui ?',
    'Décale mon déjeuner d’une heure',
    'Rappelle-moi d’appeler Léa à 17 h',
    'Range mon Bureau',
    'Résume ce PDF',
    'Mets la musique en pause'
  ]
  if (!reduce && ask) {
    var n = 0
    var type = function (text, i) {
      ask.textContent = text.slice(0, i)
      if (i < text.length) setTimeout(type, 38, text, i + 1)
      else
        setTimeout(function () {
          n = (n + 1) % ASKS.length
          type(ASKS[n], 0)
        }, 2400)
    }
    setTimeout(type, 2400, ASKS[1], 0)
    n = 1
  }
})()

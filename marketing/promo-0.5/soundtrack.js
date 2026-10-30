// Bande-son du film promo 0.5, synthétisée hors ligne (Web Audio), sans aucun fichier :
// nappe d'accords, arpège, basse et batterie légère à 120 BPM, plus les vrais sons
// de Compi (src/renderer/src/lib/sounds.ts) aux moments où l'app les joue.
// Le calendrier des scènes vient de timeline.js, partagé avec l'image. Après la grille :
// accord de fin, courte pause, montée, trois touches, impact, la musique repart plus fort, puis une respiration.

;(() => {
  const SR = 48000
  const { V, Q, Z, A, B, P, L, W, M, T, C, N, G, END, R, K, X, F, BACK, FIN } = window.TL
  const QS = Q - 6.3
  const TS = T - 9.0
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)
  function mulberry32(seed) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  // Accords (MIDI) et basse : intro, puis une mesure (2 s) par accord, puis l'accord final.
  const C_ADD9 = { notes: [60, 64, 67, 74], bass: 36 }
  const A_M7 = { notes: [57, 60, 64, 67], bass: 45 }
  const F_MAJ7 = { notes: [53, 57, 60, 64], bass: 41 }
  const G6 = { notes: [55, 59, 62, 64], bass: 43 }
  const PROG = [C_ADD9, A_M7, F_MAJ7, G6, A_M7, F_MAJ7, C_ADD9, G6]
  const DO_MAJ9 = [60, 64, 67, 71, 74]
  const CHORDS = [{ t: 0, end: 3.0, ...F_MAJ7 }]
  for (let t = 3.0, k = 0; t < END - 1e-6; t += 2, k++) CHORDS.push({ t, end: Math.min(t + 2, END), ...PROG[k % PROG.length] })
  CHORDS.push({ t: END, end: R, notes: DO_MAJ9, bass: 36 }) // la grille s'efface : accord de fin, coupé net
  for (let t = X, k = 0; t < BACK - 1e-6; t += 2, k++) CHORDS.push({ t, end: Math.min(t + 2, BACK + 0.3), ...PROG[k % PROG.length] })
  CHORDS.push({ t: BACK + 0.3, end: FIN, ...F_MAJ7 }) // respiration
  CHORDS.push({ t: FIN, end: 1e9, notes: DO_MAJ9, bass: 36 }) // Do maj9
  const chordAt = (t) => CHORDS.find((c) => t >= c.t && t < c.end) ?? CHORDS[CHORDS.length - 1]

  // Sons de Compi (mêmes notes que l'app).
  const COMPI = {
    attention: [
      { f: 587.33, at: 0, dur: 0.22 },
      { f: 880, at: 0.12, dur: 0.34 }
    ],
    reminder: [
      { f: 783.99, at: 0, dur: 0.55 },
      { f: 987.77, at: 0.15, dur: 0.55 },
      { f: 1174.66, at: 0.3, dur: 0.85 },
      { f: 2349.32, at: 0.3, dur: 0.4, gain: 0.12 }
    ],
    message: [
      { f: 1046.5, at: 0, dur: 0.1, type: 'triangle' },
      { f: 1318.51, at: 0.14, dur: 0.16, type: 'triangle' }
    ],
    ok: [{ f: 1567.98, at: 0, dur: 0.06, type: 'triangle', gain: 0.5 }],
    done: [
      { f: 880, at: 0, dur: 0.2 },
      { f: 659.25, at: 0.13, dur: 0.4 }
    ]
  }

  window.renderSoundtrack = async (duration) => {
    const ctx = new OfflineAudioContext(2, Math.round(SR * duration), SR)
    const rand = mulberry32(2026)

    // Bus : musique, effets, réverbération, puis compresseur et sortie.
    const master = ctx.createGain()
    master.gain.setValueAtTime(1, 0)
    master.gain.setValueAtTime(1, duration - 0.6)
    master.gain.linearRampToValueAtTime(0, duration)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 10
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.18
    comp.connect(master).connect(ctx.destination)

    const music = ctx.createGain()
    music.gain.value = 0.9
    music.connect(comp)
    const sfx = ctx.createGain()
    sfx.gain.value = 1
    sfx.connect(comp)

    // Réverbération : réponse impulsionnelle de bruit décroissant (graine fixe).
    const verb = ctx.createConvolver()
    const irLen = Math.round(SR * 2.2)
    const ir = ctx.createBuffer(2, irLen, SR)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < irLen; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / irLen, 3.2) * (i < SR * 0.01 ? i / (SR * 0.01) : 1)
    }
    verb.buffer = ir
    const verbOut = ctx.createGain()
    verbOut.gain.value = 0.32
    verb.connect(verbOut).connect(comp)
    const send = (node, amount) => {
      const g = ctx.createGain()
      g.gain.value = amount
      node.connect(g).connect(verb)
    }

    // Écho ping-pong pour l'arpège (3 croches pointées à 120 BPM).
    const delayIn = ctx.createGain()
    const dl = ctx.createDelay(1)
    const dr = ctx.createDelay(1)
    dl.delayTime.value = 0.375
    dr.delayTime.value = 0.375
    const fb = ctx.createGain()
    fb.gain.value = 0.32
    const panL = ctx.createStereoPanner()
    panL.pan.value = -0.7
    const panR = ctx.createStereoPanner()
    panR.pan.value = 0.7
    const delayOut = ctx.createGain()
    delayOut.gain.value = 0.28
    delayIn.connect(dl)
    dl.connect(panL).connect(delayOut)
    dl.connect(dr)
    dr.connect(panR).connect(delayOut)
    dr.connect(fb).connect(dl)
    delayOut.connect(music)

    const noiseBuf = ctx.createBuffer(1, SR, SR)
    {
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1
    }
    const noise = (at, dur) => {
      const s = ctx.createBufferSource()
      s.buffer = noiseBuf
      s.loop = true
      s.start(at, rand() * 0.5)
      s.stop(at + dur + 0.05)
      return s
    }
    const env = (g, at, peak, attack, decay, hold = 0) => {
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(peak, at + attack)
      if (hold) g.gain.setValueAtTime(peak, at + attack + hold)
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay)
    }

    // ── Nappe ──────────────────────────────────────────────────────
    const padBus = ctx.createGain()
    padBus.gain.value = 0.05
    const padLp = ctx.createBiquadFilter()
    padLp.type = 'lowpass'
    padLp.frequency.setValueAtTime(700, 0)
    padLp.frequency.linearRampToValueAtTime(1500, 3)
    padLp.frequency.setValueAtTime(1500, G - 1.5)
    padLp.frequency.linearRampToValueAtTime(2600, G)
    padLp.frequency.setValueAtTime(2600, BACK)
    padLp.frequency.linearRampToValueAtTime(1100, BACK + 1.2)
    padLp.frequency.setValueAtTime(1100, FIN - 0.3)
    padLp.frequency.linearRampToValueAtTime(2600, FIN)
    padLp.Q.value = 0.6
    padBus.connect(padLp).connect(music)
    send(padLp, 0.5)
    for (const c of CHORDS) {
      const start = Math.max(0, c.t - 0.05)
      const end = Math.min(duration, c.end + 0.35)
      for (const n of c.notes)
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator()
          o.type = 'sawtooth'
          o.frequency.value = midi(n)
          o.detune.value = det
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, start)
          g.gain.linearRampToValueAtTime(1, start + (c.t === 0 ? 1.2 : 0.3))
          g.gain.setValueAtTime(1, end - 0.4)
          g.gain.linearRampToValueAtTime(0, end)
          const p = ctx.createStereoPanner()
          p.pan.value = det < 0 ? -0.35 : 0.35
          o.connect(g).connect(p).connect(padBus)
          o.start(start)
          o.stop(end + 0.05)
        }
    }

    // ── Arpège ─────────────────────────────────────────────────────
    const arpBus = ctx.createGain()
    arpBus.gain.value = 0.11
    arpBus.connect(music)
    arpBus.connect(delayIn)
    send(arpBus, 0.35)
    const pluck = (at, n, level = 1) => {
      for (const [type, mult, lv] of [
        ['triangle', 1, 1],
        ['sine', 2, 0.35]
      ]) {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = midi(n) * mult
        const g = ctx.createGain()
        env(g, at, lv * level, 0.003, 0.22)
        o.connect(g).connect(arpBus)
        o.start(at)
        o.stop(at + 0.3)
      }
    }
    const ORDER = [0, 1, 2, 3, 2, 1, 2, 3]
    for (let t = 3.0, k = 0; t < END - 1e-6; k++) {
      const ns = chordAt(t).notes
      // Une octave plus haut pendant l'îlot vivant et « ce que tu as manqué », pour varier.
      const up = (t >= L && t < W) || (t >= M && t < T) ? 24 : 12
      pluck(t, ns[ORDER[k % ORDER.length] % ns.length] + up, k % 4 === 0 ? 1 : up === 24 ? 0.5 : 0.7)
      t += t >= G ? 0.125 : 0.25
    }
    // Le plein écran : arpège en doubles croches, une octave plus haut un temps sur deux.
    for (let t = X, k = 0; t < BACK - 1e-6; k++, t += 0.125) {
      const ns = chordAt(t).notes
      pluck(t, ns[ORDER[k % ORDER.length] % ns.length] + (Math.floor(k / 16) % 2 ? 24 : 12), k % 4 === 0 ? 1 : 0.62)
    }
    // Arpège lent de l'intro, de la fin de la grille (avant la pause) et de la vraie fin.
    ;[0.4, 0.9, 1.4, 1.9, 2.4].forEach((t, i) => pluck(t, F_MAJ7.notes[i % 4] + 12, 0.5))
    for (let i = 0; i < 3; i++) pluck(END + i * 0.2, DO_MAJ9[i % 5] + 12, 0.75 - i * 0.15)
    for (let i = 0; i < 12; i++) pluck(FIN + i * 0.25, DO_MAJ9[i % 5] + 12, Math.max(0.12, 0.75 - i * 0.055))

    // ── Basse ──────────────────────────────────────────────────────
    const bassBus = ctx.createGain()
    bassBus.gain.value = 0.2
    const bassLp = ctx.createBiquadFilter()
    bassLp.type = 'lowpass'
    bassLp.frequency.value = 380
    bassBus.connect(bassLp).connect(music)
    for (let t = 3.0; t < END - 1e-6; t += 0.5) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = midi(chordAt(t).bass)
      const g = ctx.createGain()
      env(g, t, 1, 0.02, 0.38)
      o.connect(g).connect(bassBus)
      o.start(t)
      o.stop(t + 0.5)
    }
    // Plein écran : basse en croches.
    for (let t = X; t < BACK - 1e-6; t += 0.25) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = midi(chordAt(t).bass)
      const g = ctx.createGain()
      env(g, t, Math.round((t - X) / 0.25) % 2 ? 0.7 : 1, 0.015, 0.2)
      o.connect(g).connect(bassBus)
      o.start(t)
      o.stop(t + 0.26)
    }
    // Note tenue de la fin de la grille (éteinte avant R), puis de la vraie fin.
    for (const [at, hold, decay, stop] of [
      [END, 0.15, 0.3, R],
      [FIN, 0.6, 3.2, duration]
    ]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = midi(36)
      const g = ctx.createGain()
      env(g, at, 1, 0.02, decay, hold)
      o.connect(g).connect(bassBus)
      o.start(at)
      o.stop(stop)
    }

    // ── Batterie légère ────────────────────────────────────────────
    const drums = ctx.createGain()
    drums.gain.setValueAtTime(0.5, 0)
    drums.gain.setValueAtTime(0.5, T)
    drums.gain.linearRampToValueAtTime(0.6, T + 2)
    drums.gain.setValueAtTime(0.75, X)
    drums.connect(music)
    const kick = (at, level = 1) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(150, at)
      o.frequency.exponentialRampToValueAtTime(46, at + 0.12)
      const g = ctx.createGain()
      env(g, at, level, 0.002, 0.3)
      o.connect(g).connect(drums)
      o.start(at)
      o.stop(at + 0.35)
    }
    const hat = (at, level = 1) => {
      const s = noise(at, 0.06)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 7500
      const g = ctx.createGain()
      env(g, at, 0.12 * level, 0.001, 0.045)
      s.connect(hp).connect(g).connect(drums)
    }
    const clap = (at) => {
      const s = noise(at, 0.2)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1600
      bp.Q.value = 0.9
      const g = ctx.createGain()
      env(g, at, 0.28, 0.002, 0.14)
      s.connect(bp).connect(g).connect(drums)
      send(g, 0.25)
    }
    // Deux respirations sans grosse caisse : avant l'îlot vivant et avant la grille.
    const breaks = [
      [L - 1.0, L],
      [G - 1.0, G]
    ]
    for (let t = 3.0; t < END - 1e-6; t += 0.5) {
      const beat = Math.round((t - 3.0) / 0.5)
      const rest = breaks.some(([a, b]) => t >= a && t < b)
      if (!rest) kick(t, beat % 2 === 0 ? 0.85 : 0.65)
      if (t >= 6.5) {
        hat(t + 0.25)
        if (t >= Q && beat % 2 === 1 && !rest) clap(t)
        if (t >= G) hat(t + 0.125, 0.5)
      }
    }
    kick(END, 1)
    // Plein écran : la batterie repart plus fort (grosse caisse à chaque temps, charleston en doubles croches).
    for (let t = X; t < BACK - 1e-6; t += 0.5) {
      const beat = Math.round((t - X) / 0.5)
      kick(t, beat % 2 === 0 ? 1 : 0.75)
      if (beat % 2 === 1) clap(t)
      for (const off of [0.125, 0.25, 0.375]) hat(t + off, off === 0.25 ? 1 : 0.55)
    }

    // ── Effets ─────────────────────────────────────────────────────
    const blip = (at, f0, f1, dur, level, type = 'sine') => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(f0, at)
      o.frequency.exponentialRampToValueAtTime(f1, at + dur)
      const g = ctx.createGain()
      env(g, at, level, 0.004, dur)
      o.connect(g).connect(sfx)
      o.start(at)
      o.stop(at + dur + 0.05)
      return g
    }
    const click = (at, level = 1) => {
      const s = noise(at, 0.04)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2200
      const g = ctx.createGain()
      env(g, at, 0.22 * level, 0.001, 0.025)
      s.connect(hp).connect(g).connect(sfx)
      blip(at, 220, 140, 0.04, 0.12 * level)
    }
    const whoosh = (at, dur, f0, f1, level = 0.18) => {
      const s = noise(at, dur)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 1.2
      bp.frequency.setValueAtTime(f0, at)
      bp.frequency.exponentialRampToValueAtTime(f1, at + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(level, at + dur * 0.7)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      s.connect(bp).connect(g).connect(sfx)
      send(g, 0.3)
    }
    const impact = (at, level = 0.5) => {
      blip(at, 90, 38, 0.9, level)
      const s = noise(at, 0.5)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      const g = ctx.createGain()
      env(g, at, level * 0.4, 0.003, 0.45)
      s.connect(lp).connect(g).connect(sfx)
      send(g, 0.4)
    }
    const compi = (at, kind, level = 0.32) => {
      const soft = ctx.createBiquadFilter()
      soft.type = 'lowpass'
      soft.frequency.value = 3600
      const bus = ctx.createGain()
      bus.gain.value = level
      bus.connect(soft).connect(sfx)
      send(soft, 0.35)
      for (const n of COMPI[kind]) {
        const o = ctx.createOscillator()
        o.type = n.type ?? 'sine'
        o.frequency.value = n.f
        const g = ctx.createGain()
        env(g, at + n.at, n.gain ?? 1, 0.015, n.dur - 0.015)
        o.connect(g).connect(bus)
        o.start(at + n.at)
        o.stop(at + n.at + n.dur + 0.05)
      }
    }
    const open = (at) => whoosh(at, 0.4, 600, 3000, 0.08)
    const close = (at) => whoosh(at, 0.4, 2000, 400, 0.08)
    const tick = (at, k = 0) => blip(at, 700 + k * 120, 1100 + k * 160, 0.07, 0.05, 'triangle')

    // Accroche : l'îlot s'ouvre, les LED s'allument.
    blip(0.13, 420, 760, 0.12, 0.12)
    for (let k = 0; k < 9; k++) blip(0.36 + k * 0.05 + rand() * 0.02, 2300 + rand() * 900, 2000, 0.03, 0.05)
    whoosh(1.9, 1.1, 300, 5200, 0.12)
    // Discussion : raccourci, ouverture, frappe, envoi.
    ;[2.92, 3.0, 3.08].forEach((t) => click(t))
    impact(3.0, 0.32)
    whoosh(3.12, 0.45, 2400, 500, 0.12)
    const question = 'Qu’est-ce que j’ai aujourd’hui ?'
    for (let k = 0; k < question.length; k += 2) click(3.72 + (k / question.length) * 0.58, 0.28 + rand() * 0.12)
    compi(4.38, 'ok', 0.3)
    compi(6.04, 'done', 0.18)
    close(6.25)
    // Dictée vocale : touches maintenues, écoute, rappel créé.
    ;[V + 0.42, V + 0.5, V + 0.58].forEach((t) => click(t))
    blip(V + 0.48, 520, 880, 0.14, 0.07)
    click(V + 2.3, 0.5)
    compi(V + 2.85, 'reminder', 0.3)
    close(V + 4.25)
    // Actions rapides (horaires d'origine, décalés).
    ;[7.4, 7.48, 7.56].forEach((t) => click(t + QS))
    whoosh(7.55 + QS, 0.35, 600, 3000, 0.08)
    click(8.05 + QS, 0.8)
    compi(8.52 + QS, 'ok', 0.3)
    compi(8.62 + QS, 'message', 0.3)
    // Zone d'écran : raccourci, l'écran se fige, on encadre, texte lu, « Expliquer ».
    ;[Z + 0.55, Z + 0.63, Z + 0.71].forEach((t) => click(t))
    blip(Z + 1.0, 1800, 900, 0.09, 0.06, 'triangle')
    whoosh(Z + 1.32, 0.66, 800, 2400, 0.04)
    click(Z + 2.05, 0.5)
    open(Z + 2.5)
    compi(Z + 2.62, 'ok', 0.26)
    click(Z + 3.2, 0.7)
    compi(Z + 3.22, 'ok', 0.3)
    compi(Z + 3.9, 'done', 0.28)
    close(Z + 4.7)
    // Agenda : demande, carte d'autorisation, clic, le rendez-vous glisse.
    open(A + 0.18)
    for (let k = 0; k < 7; k++) click(A + 0.4 + k * 0.075, 0.25 + rand() * 0.1)
    compi(A + 1.45, 'attention', 0.34)
    click(A + 2.65, 0.7)
    compi(A + 2.68, 'ok', 0.32)
    whoosh(A + 2.8, 0.35, 900, 2600, 0.07)
    compi(A + 2.95, 'done', 0.3)
    close(A + 4.05)
    // Choix du cerveau.
    open(B + 0.3)
    for (let k = 0; k < 3; k++) tick(B + 0.5 + k * 0.08, k)
    click(B + 1.85, 0.7)
    tick(B + 2.15, 3)
    click(B + 3.1, 0.7)
    for (let k = 0; k < 3; k++) compi(B + 3.3 + k * 0.2, 'ok', 0.16)
    compi(B + 3.95, 'done', 0.26)
    close(B + 4.5)
    // Garde-fou : lecture du document, masquage de l'IBAN, réponse.
    open(P + 0.25)
    compi(P + 0.45, 'ok', 0.24)
    blip(P + 1.88, 900, 2400, 0.22, 0.06, 'triangle')
    compi(P + 1.95, 'ok', 0.3)
    tick(P + 3.45, 2)
    close(P + 4.05)
    // Îlot vivant : musique au survol, pomodoro.
    tick(L + 0.2, 0)
    blip(L + 0.72, 600, 900, 0.1, 0.05)
    compi(L + 2.75, 'ok', 0.28)
    tick(L + 2.8, 4)
    // Réunion de bout en bout : l'alerte, la préparation, l'enregistrement (le temps défile), le résumé.
    compi(W + 0.17, 'attention', 0.34)
    click(W + 1.05, 0.7)
    open(W + 1.2)
    for (let k = 0; k < 6; k++) tick(W + 1.35 + k * 0.09, k)
    click(W + 2.95, 0.7)
    click(W + 3.65, 0.7)
    blip(W + 3.8, 520, 880, 0.14, 0.07)
    whoosh(W + 4.3, 1.8, 400, 2400, 0.045)
    click(W + 6.45, 0.7)
    whoosh(W + 7.2, 0.4, 900, 2600, 0.07)
    compi(W + 7.4, 'done', 0.28)
    for (let k = 0; k < 4; k++) tick(W + 7.55 + k * 0.08, k)
    // La suite : étapes, deux cartes d'accord (brouillon, note Obsidian), la réponse.
    click(W + 9.3, 0.7)
    open(W + 9.45)
    ;[W + 10.05, W + 10.4, W + 11.2, W + 12.1].forEach((at, k) => tick(at, k + 1))
    compi(W + 10.55, 'attention', 0.34)
    click(W + 11.1, 0.7)
    compi(W + 11.12, 'ok', 0.3)
    compi(W + 11.4, 'attention', 0.28)
    click(W + 12.0, 0.7)
    compi(W + 12.02, 'ok', 0.3)
    compi(W + 12.25, 'done', 0.3)
    close(W + 13.95)
    // Ce que tu as manqué : la notification, puis la carte.
    compi(M + 0.27, 'message', 0.3)
    open(M + 1.62)
    for (let k = 0; k < 4; k++) tick(M + 1.75 + k * 0.1, k)
    close(M + 3.15)
    // Autorisation et rangement (horaires d'origine, décalés).
    compi(9.28 + TS, 'attention', 0.36)
    compi(10.02 + TS, 'ok', 0.34)
    compi(10.16 + TS, 'done', 0.34)
    for (let i = 0; i < 14; i++) blip(10.25 + i * 0.045 + 0.38 + TS, 900 + (i % 4) * 140, 1400 + (i % 4) * 160, 0.05, 0.035, 'triangle')
    // Claude Code : modification, validation au clavier, tests réussis.
    whoosh(C, 0.45, 500, 2400, 0.07)
    tick(C + 0.45, 1)
    for (let k = 0; k < 6; k++) click(C + 0.86 + k * 0.1, 0.25)
    compi(C + 1.7, 'attention', 0.34)
    ;[C + 2.6, C + 2.68, C + 2.76].forEach((t) => click(t))
    compi(C + 2.8, 'ok', 0.32)
    compi(C + 3.85, 'done', 0.3)
    // Connecteurs : deux comptes reliés.
    open(N + 0.25)
    for (const [at, done] of [
      [N + 1.35, N + 2.0],
      [N + 2.6, N + 3.2]
    ]) {
      click(at, 0.7)
      compi(done, 'message', 0.26)
    }
    close(N + 4.05)
    // La grille des fonctionnalités.
    whoosh(G - 0.65, 0.65, 400, 7000, 0.16)
    impact(G, 0.42)
    for (let i = 0; i < 9; i++) tick(G + 0.12 + i * 0.06, i % 6)
    // La grille s'efface sur l'accord de fin.
    whoosh(END - 0.2, 0.5, 2400, 400, 0.08)
    // « Et ce n'est pas tout. » : une courte pause, le clin d'œil, puis une montée jusqu'à l'explosion.
    blip(R + 0.78, 900, 1500, 0.07, 0.05, 'triangle')
    blip(R + 0.9, 1500, 2200, 0.06, 0.04, 'triangle')
    {
      const rise = noise(R + 0.6, X - R - 0.6)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 2.2
      bp.frequency.setValueAtTime(260, R + 0.6)
      bp.frequency.exponentialRampToValueAtTime(7000, X)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, R + 0.6)
      g.gain.exponentialRampToValueAtTime(0.2, X - 0.04)
      g.gain.linearRampToValueAtTime(0.0001, X)
      rise.connect(bp).connect(g).connect(sfx)
      send(g, 0.4)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(110, R + 0.6)
      o.frequency.exponentialRampToValueAtTime(880, X)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1800
      const og = ctx.createGain()
      og.gain.setValueAtTime(0.0001, R + 0.6)
      og.gain.exponentialRampToValueAtTime(0.05, X - 0.04)
      og.gain.linearRampToValueAtTime(0.0001, X)
      o.connect(lp).connect(og).connect(sfx)
      o.start(R + 0.6)
      o.stop(X + 0.02)
    }
    // Alt + Maj + Entrée, puis l'îlot prend tout l'écran : impact profond.
    ;[K + 0.2, K + 0.32, K + 0.46].forEach((t) => click(t, 1.2))
    impact(X, 0.95)
    blip(X, 62, 28, 1.6, 0.7)
    whoosh(X - 0.05, 0.8, 4000, 300, 0.12)
    // Le plein écran : frappe, envoi, étapes, carte d'accord, clic, fichier écrit.
    for (let k = 0; k < 66; k += 2) click(F + 0.15 + (k / 66) * 0.8, 0.25 + rand() * 0.1)
    compi(F + 1.05, 'ok', 0.3)
    for (const at of [F + 1.3, F + 3.6, F + 6.0, F + 7.6]) whoosh(at, 0.6, 500, 1600, 0.035)
    compi(F + 4.0, 'ok', 0.18)
    compi(F + 5.0, 'attention', 0.34)
    click(F + 7.2, 0.7)
    compi(F + 7.22, 'ok', 0.32)
    compi(F + 7.4, 'done', 0.3)
    compi(F + 8.05, 'message', 0.2)
    // Échap : retour à l'îlot, une respiration.
    click(BACK - 0.1, 1)
    whoosh(BACK + 0.12, 0.6, 2600, 260, 0.11)
    {
      const br = noise(BACK + 0.3, 1.8)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 0.8
      bp.frequency.setValueAtTime(700, BACK + 0.3)
      bp.frequency.linearRampToValueAtTime(420, BACK + 2.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, BACK + 0.3)
      g.gain.exponentialRampToValueAtTime(0.05, BACK + 0.85)
      g.gain.exponentialRampToValueAtTime(0.0001, BACK + 2.1)
      br.connect(bp).connect(g).connect(sfx)
      send(g, 0.5)
    }
    // Vraie fin : Compi 0.5.
    whoosh(FIN - 0.6, 0.6, 500, 6000, 0.14)
    impact(FIN, 0.5)
    compi(FIN + 0.05, 'reminder', 0.34)
    blip(FIN + 0.8, 1300, 2100, 0.1, 0.07, 'triangle')
    blip(FIN + 1.24, 1300, 1900, 0.08, 0.06, 'triangle')
    blip(FIN + 3.62, 1300, 1900, 0.08, 0.05, 'triangle')

    const out = await ctx.startRendering()
    // Normalisation : crête à -1 dBFS.
    let peak = 0
    for (let ch = 0; ch < 2; ch++) for (const v of out.getChannelData(ch)) peak = Math.max(peak, Math.abs(v))
    const k = peak > 0 ? 0.89 / peak : 1
    for (let ch = 0; ch < 2; ch++) {
      const d = out.getChannelData(ch)
      for (let i = 0; i < d.length; i++) d[i] *= k
    }
    out.peak = peak
    // Niveau RMS de chaque seconde (dBFS), pour vérifier le mixage sans l'écouter.
    out.levels = Array.from({ length: Math.ceil(duration) }, (_, sec) => {
      const d = out.getChannelData(0)
      let sum = 0
      let n = 0
      for (let i = sec * SR; i < Math.min(d.length, (sec + 1) * SR); i++, n++) sum += d[i] * d[i]
      return Math.round(10 * Math.log10(sum / Math.max(1, n) + 1e-12))
    })
    return out
  }
})()

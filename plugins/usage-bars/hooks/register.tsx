import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-bars', key: 'limits' } as const, [] as Limit[])
const tick = atom({ plugin: 'usage-bars', key: 'tick' } as const, 0)

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Semana' }
const label = (k: string) => LABELS[k] ?? k
const ORDER = ['five_hour', 'seven_day']
const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : 9)
const TRACK_H = 22
const NARROW = 200
const INK = '#FFFFFF'
const FONT = "'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"

// verde bajo 80 %, naranjo desde 80 %, rojo al llegar al límite
const colorFor = (pct: number) => (pct >= 100 ? '#C5353E' : pct >= 80 ? '#C96A00' : '#18883A')

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`
const hash = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const resetIn = (iso?: string) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

// última posición de la cabeza por ventana, para que el relleno se deslice desde donde estaba
const lastHead = new Map<string, number>()

function trackSvg(l: Limit, W: number): string {
  const H = TRACK_H
  const frac = Math.max(0, Math.min(1, l.percentUsed / 100))
  const fx = frac * W
  const from = lastHead.get(l.kind) ?? fx
  lastHead.set(l.kind, fx)
  const glide = Math.abs(from - fx) > 0.5
  const ease = 'calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"'

  const color = colorFor(l.percentUsed)
  const acc = hex(color)
  const light = mix(acc, [255, 255, 255], 0.32)
  const grey = [132, 130, 138]

  // píxeles: rejilla de 3px, 7 filas, más densos hacia la cabeza, titilando
  const buckets = [0, 1, 2, 3, 4].map(b => {
    const m = b / 4
    const dense = 0.22 + 0.78 * Math.pow(m, 1.5)
    return { color: rgb(mix(grey, light, m)), opacity: (0.35 + 0.65 * dense).toFixed(2) }
  })
  const dots = new Map<string, string>()
  for (let col = 0; col * 3 < fx; col++) {
    const x = col * 3
    const u = Math.min(1, (x + 1.5) / fx)
    const dense = 0.22 + 0.78 * Math.pow(u, 1.5)
    const bucket = Math.min(4, Math.floor(Math.min(1, Math.pow(u, 0.9) * 1.1) * 4.99))
    for (let r = 0; r < 7; r++) {
      if (hash(col, r, 1) > dense + 0.1) continue
      const key = `b${bucket} t${Math.floor(hash(col, r, 2) * 12)}`
      dots.set(key, (dots.get(key) ?? '') + `M${x} ${1 + r * 3}h2v2h-2z`)
    }
  }
  const px = [...dots].map(([cls, d]) => {
    const n = Number(cls.split('t')[1])
    const dur = (1.1 + (n % 5) * 0.37).toFixed(2)
    const begin = (-(n * 0.53) % 3).toFixed(2)
    return `<path class="${cls}" d="${d}"><animate attributeName="opacity" values="1;.15;1" keyTimes="0;.5;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></path>`
  }).join('')

  // marcas cada 25 % (cápsulas) y cada 5 % (puntos), brillantes una vez superadas
  let marks = ''
  for (let k = 1; k < 20; k++) {
    const x = (k / 20) * W
    const passed = x < fx - 1
    const fill = passed ? rgb(mix(light, [255, 255, 255], 0.45)) : '#A8A69E'
    marks += k % 5 === 0
      ? `<rect x="${(x - 1.5).toFixed(1)}" y="${(H - 10) / 2}" width="3" height="10" rx="1.5" fill="${fill}" opacity="${passed ? 0.95 : 0.75}"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.4" fill="${fill}" opacity="${passed ? 0.8 : 0.6}"/>`
  }

  // píldora en la cabeza: tiempo hasta el reinicio (o punto redondo si es estrecho)
  const reset = resetIn(l.resetsAt)
  const pctText = `${Math.round(l.percentUsed)}%`
  const widest = Math.max(reset.length, pctText.length)
  const kw = W < NARROW ? H : Math.round(widest * 6.6 + 22)
  const clampX = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = clampX(fx)
  const kFrom = clampX(from)
  // la píldora alterna entre el porcentaje y el tiempo hasta el reinicio (ciclo de 6 s, con fundido)
  const swap = (values: string) =>
    `<animate attributeName="opacity" values="${values}" keyTimes="0;.42;.5;.92;1" dur="6s" repeatCount="indefinite"/>`
  const knob =
    `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>` +
    (W < NARROW
      ? ''
      : `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${pctText}${swap('1;1;0;0;1')}</text>` +
        (reset ? `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt" opacity="0">${reset}${swap('0;0;1;1;0')}</text>` : ''))

  const style = `<style>
${buckets.map((b, i) => `.b${i}{fill:${b.color};fill-opacity:${b.opacity}}`).join('')}
.kt{font:500 12px ${FONT};fill:${INK}}
</style>`
  const glideFill = glide ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" dur=".45s" ${ease} fill="freeze"/>` : ''
  const glideKnob = glide ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" dur=".45s" ${ease} fill="freeze"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style}
<defs><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill"><rect width="${fx.toFixed(1)}" height="${H}">${glideFill}</rect></clipPath>
<linearGradient id="base" x1="0" x2="${Math.max(1, fx).toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity=".05"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient></defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#base)"/>${px}</g>${marks}</g>
<g transform="translate(${kx.toFixed(1)} 0)">${glideKnob}${knob}</g></svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length > 0) await update($, limits, () => u.rateLimits as Limit[])
    } catch {}
    // refresca el tiempo de reinicio cada minuto
    $.clock.every(60000, () => update($, tick, n => n + 1))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      await update($, limits, () => e.rateLimits as Limit[])
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, limits)
    if (e.props.hasSurvey) return next(e)
    await read($, tick)

    const t = $.ui.resolve(e)
    const { Box, Text } = t
    if (all.length === 0) {
      return <Text dimColor>Límites de uso: esperando datos (aparecen tras la próxima respuesta)</Text>
    }
    const Svg = 'Svg' in t ? t.Svg : null
    const rows = [...all].sort((a, b) => rank(a.kind) - rank(b.kind))

    const total = Math.max(320, (e.props.bodyColumns || 100) * 8)
    const half = Math.floor((total - 24) / 2)
    // etiqueta y porcentaje ocupan ~110px de cada mitad
    const trackW = Math.max(100, Math.min(700, half - 110))

    return (
      <Box flexDirection="row" gap={3}>
        {rows.map(l => {
          const pct = Math.round(l.percentUsed)
          const color = colorFor(l.percentUsed)
          const alt = `${label(l.kind)}: ${pct}% usado, reinicia en ${resetIn(l.resetsAt)}`
          const cells = Math.round(pct / 4)
          return (
            <Box key={l.kind} flexGrow={1} flexDirection="row" alignItems="center" gap={1}>
              <Text color={color}>●</Text>
              <Text bold>{label(l.kind)}</Text>
              <Box flexGrow={1} />
              {Svg ? (
                <Svg source={trackSvg(l, trackW)} alt={alt} width={trackW} height={TRACK_H} />
              ) : (
                <Text>
                  <Text color={color}>{'━'.repeat(cells)}</Text>
                  <Text dimColor>{'─'.repeat(25 - cells)}</Text>
                  <Text dimColor> {pct}% · {resetIn(l.resetsAt)}</Text>
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}

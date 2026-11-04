import type { EngineInterface, Register } from 'claude-code'

// The pane every mod draws a row into: each adds its own ui.render hook on it.
const PANE = 'mods'
// Surfaces that raise the band above the prompt, where mods already show their lines.
const BANDED = new Set(['terminal', 'desktop'])

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Mods' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'mods', description: 'Mods: one pane with what your mods need from you, what is next, and their status' })
    const surfaces = await $.session.surfaces()
    if (surfaces.length && !surfaces.some(s => BANDED.has(s))) void open($)
    return r
  })

  // A client with no band joined later, say a phone: it gets the pane too.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    if (!BANDED.has(e.surface)) void open($)
    return r
  })

  on('command.run', { command: 'mods' }, async $ => {
    const { isPlaced } = await open($)
    return { text: isPlaced ? 'Mods pane open.' : 'The Mods pane is open, but this surface does not show panes.' }
  })

  // The rows are the other mods'; with none drawn, say what the pane is for.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const rows = await next(e)
    if (rows) return rows
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>Nothing needs you. Asks, what is next and status from your mods show here.</Text>
  })
}

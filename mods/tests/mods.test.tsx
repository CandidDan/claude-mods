import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'mods',
  component: 'Pane',
  requestId: 'mods',
  props: { title: 'Mods', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The world beneath: the surfaces drawing this session, and the panes opened. */
function world(on: On, surfaces: string[]) {
  const opened: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return opened
}

const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

test('a session with no band, like a cloud one, opens the Mods pane by itself', async ($, on) => {
  const opened = world(on, ['mobile'])
  await start($)
  expect(opened).toEqual(['mods'])
})

test('in the terminal or the desktop app the pane waits for /mods', async ($, on) => {
  const opened = world(on, ['desktop'])
  await start($)
  expect(opened).toEqual([])
  expect((await $.command.run({ command: 'mods', args: '' } as never)).text).toBe('Mods pane open.')
  expect(opened).toEqual(['mods'])
})

test('a phone that joins later gets the pane', async ($, on) => {
  const opened = world(on, ['desktop'])
  await start($)
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as never)
  expect(opened).toEqual(['mods'])
})

test('rows the other mods draw pass through as they are', async ($, on) => {
  world(on, ['desktop'])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>a row</Text>
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('a row')
})

import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

const composer = { kind: 'composer' } as const
const LONG = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long reply.`).join('\n')
const SHORT = 'Done: the tests pass.'

/**
 * The world beneath: commands, toasts, and the message each jump aims for, read
 * from the mod's debug line: the kit has no transcript for the scroll itself to
 * move, so every scroll here ends in the mod's own "Could not scroll back".
 */
function world(on: On) {
  const scrolls: { requestId: string }[] = []
  const toasts: string[] = []
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'back' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.log', ($, e) => {
    const m = /^back: scrolling to (.+)$/.exec(String((e as { text?: string }).text ?? ''))
    if (m) scrolls.push({ requestId: m[1]! })
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  return { scrolls, toasts }
}

const start = ($: Step) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

/** Draws one of your messages, as the transcript would, under this id. */
async function said($: Step, requestId: string, text = 'make the landing page better', origin: { kind: string } = composer) {
  const row = await $.ui.mount({ plugin: 'back', surface: 'desktop', component: 'UserMessage', requestId, props: { text, origin, isExpanded: true } as never })
  await row.unmount()
}

/** Draws a reply block and leaves it mounted, so its button can be pressed. */
const reply = ($: Step, requestId: string, text: string, surface: 'desktop' | 'mobile' = 'desktop') =>
  $.ui.mount({ plugin: 'back', surface, component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } as never })

const back = async ($: Step, args = '') => (await $.command.run({ command: 'back', args } as never)).text

test('a long reply has a button back to the message it answers; a short one has none', async ($, on) => {
  const w = world(on)
  await start($)
  await said($, 'u1')
  const long = await reply($, 'a1', LONG)
  expect(await long.find({ type: 'Button' })).toBeTruthy()
  await long.press({ key: 'back-a1' })
  expect(w.scrolls).toEqual([{ requestId: 'u1' }])

  await said($, 'u2', 'now do the same for the footer please')
  const short = await reply($, 'a2', SHORT)
  expect(await short.find({ type: 'Button' })).toBeFalsy()
})

test('a reply drawn again keeps pointing at the message it answered, not the newest', async ($, on) => {
  const w = world(on)
  await start($)
  await said($, 'u1')
  await (await reply($, 'a1', LONG)).unmount()
  await said($, 'u2', 'and the pricing page as well, same idea')
  const again = await reply($, 'a1', LONG)
  await again.press({ key: 'back-a1' })
  expect(w.scrolls).toEqual([{ requestId: 'u1' }])
})

test('the button shows on a phone too', async ($, on) => {
  world(on)
  await start($)
  await said($, 'u1')
  const row = await reply($, 'a1', LONG, 'mobile')
  expect(await row.find({ type: 'Button' })).toBeTruthy()
})

test('/back goes to your last message, /back 2 to the one before; slash commands and app messages are not yours', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await back($)).toBe('No message of yours to go back to yet.')
  await said($, 'u1')
  await said($, 'u2', 'then fix the footer links on mobile')
  await said($, 'c1', '/time today')
  await said($, 'm1', '<side-sessions-event>a session finished</side-sessions-event>', { kind: 'sdk' })
  await said($, 'n1', 'Background task finished', { kind: 'task-notification' })
  await back($)
  await back($, '2')
  expect(w.scrolls).toEqual([{ requestId: 'u2' }, { requestId: 'u1' }])
})

test('a scroll that fails is said, not swallowed', async ($, on) => {
  const w = world(on)
  await start($)
  await said($, 'u1')
  expect(await back($)).toMatch(/^Could not scroll back: /)
  const row = await reply($, 'a1', LONG)
  await row.press({ key: 'back-a1' })
  expect(w.toasts[0]).toMatch(/^Could not scroll back: /)
})

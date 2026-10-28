import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = { plugin: 'reflect', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 }
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RULE = 'Write British English spelling in all copy.'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

// The test's clock, set by world: settle lets the background check run.
let time: ReturnType<typeof mock.clock>

/** The world beneath: files in memory, a home, a cwd, and a model that labels and drafts as told. */
function world(on: On, files: Record<string, string> = {}, label = 'lasting rule', draft = RULE) {
  const seen = { classified: 0, writes: 0 }
  time = mock.clock(on, { now: Date.UTC(2026, 9, 28, 10, 0) })
  mock.store(on)
  mock.env(on, { HOME: '/home/dan' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', () => ({ value: {} }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($, e) => {
    seen.writes += 1
    files[e.path] = e.text
    return { value: undefined }
  })
  on('model.classify', () => {
    seen.classified += 1
    return { value: label }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: draft, usage } }))
  return seen
}

/** A reply from Claude, then the person's next prompt. */
async function exchange($: Step, prompt: string) {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ turnId: 't1', answer: 'Here is the color palette for the homepage.', durationMs: 900, isAborted: false, reason: 'answer' })
  await $.prompt.submit({ text: prompt })
  await time.settle()
}

async function bandText($: Step) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps })
  const text = (await band.find({ type: 'Box' }))?.text ?? (await band.find({ type: 'Text' }))?.text
  await band.unmount()
  return text
}

async function press($: Step, key: string) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps })
  await band.press({ key })
  await band.unmount()
  await time.settle()
}

test('a lasting correction drafts a rule, and This project saves it under its heading', async ($, on) => {
  const files: Record<string, string> = { '/work/CLAUDE.md': '# Project\n\nUse pnpm.\n' }
  world(on, files)
  await exchange($, "No, it's colour. Always use British spelling.")
  expect(await bandText($)).toContain(`Save as a rule? ${RULE}`)

  await press($, 'project')
  expect(files['/work/CLAUDE.md']).toBe(`# Project\n\nUse pnpm.\n\n## Rules from corrections\n\n- ${RULE}\n`)
  expect(await bandText($)).toContain("Saved to this project's CLAUDE.md.")
  await time.advance(8000)
  expect(await bandText($)).toBe('engine')
})

test('Everywhere adds to the existing section, before the next one, and never twice', async ($, on) => {
  const path = '/home/dan/.claude/CLAUDE.md'
  const files: Record<string, string> = { [path]: '## Rules from corrections\n\n- Keep replies short.\n\n## Tools\n\nUse gh.\n' }
  const seen = world(on, files)
  await exchange($, "Don't use American spelling.")
  await press($, 'everywhere')
  expect(files[path]).toBe(`## Rules from corrections\n\n- Keep replies short.\n- ${RULE}\n\n## Tools\n\nUse gh.\n`)

  await $.prompt.submit({ text: 'Stop using American spelling!' })
  await time.settle()
  await press($, 'everywhere')
  expect(seen.writes).toBe(1)
  expect(await bandText($)).toContain('Already in your CLAUDE.md.')
})

test('a prompt that is not a correction never reaches the model', async ($, on) => {
  const seen = world(on)
  await exchange($, 'Great, now do the footer.')
  expect(seen.classified).toBe(0)
  expect(await bandText($)).toBe('engine')
})

test('a one-off fix shows nothing', async ($, on) => {
  world(on, {}, 'one-off fix')
  await exchange($, 'No, the second one.')
  expect(await bandText($)).toBe('engine')
})

test('a NONE draft shows nothing', async ($, on) => {
  world(on, {}, 'lasting rule', 'NONE')
  await exchange($, 'No, the second one.')
  expect(await bandText($)).toBe('engine')
})

test('Skip clears the band and writes nothing', async ($, on) => {
  const seen = world(on)
  await exchange($, 'Never use em dashes.')
  await press($, 'skip')
  expect(seen.writes).toBe(0)
  expect(await bandText($)).toBe('engine')
})

test('/reflect off stops the checks in every chat', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ command: 'reflect', args: 'off' })).text).toContain('off in every chat')
  await exchange($, "No, don't do that.")
  expect(seen.classified).toBe(0)
  expect((await $.command.run({ command: 'reflect', args: 'on' })).text).toContain('Reflect is on')
})

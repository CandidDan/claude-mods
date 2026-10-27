import { expect, mock, test } from 'claude-code/testing';
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const planJson = JSON.stringify({
    headline: 'Two clear hours, then the call.',
    blocks: [
        { start: '14:00', end: '16:00', label: 'TanPlan conference runlist', kind: 'work' },
        { start: '16:00', end: '16:30', label: 'Call with Matt', kind: 'fixed' },
    ],
    next: [
        { title: 'Finish the conference runlist', why: 'it gates everything before Friday', minutes: 60 },
        { title: 'Reply to Leah', why: 'she asked yesterday', minutes: 10 },
    ],
    waiting: [{ title: 'Domain transfer', why: 'registrar email outstanding' }],
    sources: ['session'],
});
/** The world beneath the plugin: no MCP tools, a pane that opens, a status line. */
function world(on, isPlaced = true) {
    on('tool.list', () => ({ value: [] }));
    on('ui.open', () => ({ value: { isPlaced } }));
    on('ui.close', () => ({ value: undefined }));
    on('ui.status', () => ({ value: undefined }));
    on('command.register', () => ({ value: {} }));
}
const PANE = { plugin: 'day', component: 'Pane', requestId: 'day' };
const paneProps = {
    title: 'Today',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
};
test('/today plans from a fork and the pane shows it on each surface', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) });
    world(on);
    on('model.fork', () => ({ value: { isAnswered: true, text: planJson, usage } }));
    const ran = await $.command.run({ command: 'today', args: '' });
    expect(ran.text).toContain('Two clear hours');
    expect(ran.text).toContain('1. Finish the conference runlist');
    for (const surface of ['terminal', 'desktop']) {
        const ui = await $.ui.mount({ ...PANE, surface, props: paneProps });
        const md = await ui.find({ key: 'plan' });
        expect(md?.text).toContain('Finish the conference runlist');
        expect(md?.text).toContain('Waiting on you');
        expect(await ui.find({ key: 'start' })).toBeDefined();
        await ui.unmount();
    }
});
test('/today eod widens the window to the end of the day', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) }); // 03:00 UTC
    world(on);
    let askedFor = '';
    on('model.fork', ($, e) => {
        askedFor = e.prompt;
        return { value: { isAnswered: true, text: planJson, usage } };
    });
    await $.command.run({ command: 'today', args: 'eod' });
    expect(askedFor).toMatch(/Plan the next \d+(\.\d+)? hours/);
    expect(askedFor).not.toContain('Plan the next 4 hours');
});
test('nothing to fork yet is said in the pane, not thrown', async ($, on) => {
    mock.clock(on);
    world(on);
    on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }));
    on('session.messages', () => ({ value: [] }));
    const ran = await $.command.run({ command: 'today', args: '' });
    expect(ran.text).toContain('send one prompt');
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: paneProps });
    expect(await ui.find({ text: /send one prompt/ })).toBeDefined();
    await ui.unmount();
});
test('after a resume (nothing to fork) it plans from the saved transcript', async ($, on) => {
    mock.clock(on);
    world(on);
    on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }));
    on('session.messages', () => ({
        value: [{ role: 'user', text: 'ship the handoff fix', toolUses: [] }],
    }));
    on('session.model', () => ({ value: 'claude-opus-5-5' }));
    let sent = '';
    on('model.complete', ($, e) => {
        sent = e.prompt;
        return { value: { isAnswered: true, text: planJson, usage } };
    });
    const ran = await $.command.run({ command: 'today', args: '' });
    expect(sent).toContain('USER: ship the handoff fix');
    expect(ran.text).not.toContain('send one prompt');
    expect(ran.text).not.toContain('Could not plan');
});
test('with no pane on the surface, the whole plan comes back in the reply', async ($, on) => {
    mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) });
    world(on, false);
    on('model.fork', () => ({ value: { isAnswered: true, text: planJson, usage } }));
    const ran = await $.command.run({ command: 'today', args: '' });
    expect(ran.text).toContain('Two clear hours');
    expect(ran.text).toContain('Call with Matt');
    expect(ran.text).toContain('Waiting on you');
    expect(ran.text).not.toContain('Today pane');
});

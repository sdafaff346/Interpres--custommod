import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

function batchHarness(chat, { skipIfNative = true } = {}) {
    const calls = [];
    const noop = () => ({ text() { return this; }, show() { return this; }, hide() { return this; } });
    const ctx = vm.createContext({
        chat, calls,
        getSettings: () => ({ skipIfNative, viewLang: 'ko', storyLang: 'en' }),
        canSkipNative: (a, b) => a !== b,
        currentChatId: () => 'chat-1',
        looksLikeLang: (text, code) => code === 'ko' && /[가-힣]/.test(text),
        translateIncoming: async (id, options) => { calls.push({ id, options }); return true; },
        translationJobs: new Map(),
        updateStatsUI() {},
        toastr: { info() {}, success() {} },
        $: noop,
    });
    vm.runInContext(slice('let batchRunning = false;', 'async function clearAllTranslations('), ctx);
    return ctx;
}

test('whole-chat translation includes user messages that still need a translation', async () => {
    const chat = [
        { mes: 'Hello there.', is_user: false },                       // greeting, never rendered in a long chat
        { mes: 'I walk in.', is_user: true },                          // user wrote in the story language
        { mes: '안녕', is_user: true },                                 // user wrote in the viewing language
        { mes: 'I said hi.', is_user: true, extra: { display_text: '인사했다' } }, // input-translated already
        { mes: 'System note', is_system: true },
        { mes: 'She nods.', is_user: false },
        { mes: 'Keep original', is_user: false, extra: { interpres_codeblocks_original: true } },
    ];
    const ctx = batchHarness(chat);
    await ctx.translateWholeChat();
    assert.deepEqual(ctx.calls.map(c => c.id), [0, 1, 5]);
    assert.ok(ctx.calls.every(c => c.options.force && c.options.batch));
});

test('user messages in the viewing language are skipped even when skip-native is off', async () => {
    const ctx = batchHarness([{ mes: '안녕', is_user: true }, { mes: 'Hi', is_user: true }], { skipIfNative: false });
    await ctx.translateWholeChat();
    assert.deepEqual(ctx.calls.map(c => c.id), [1]);
});

test('refreshing a message that is not on screen never touches SillyTavern renderers', () => {
    let updates = 0;
    let reasoning = 0;
    const rendered = new Set([5]);
    const ctx = vm.createContext({
        MODULE_NAME: 'test', console,
        document: { querySelector: sel => (rendered.has(Number(sel.match(/mesid="(\d+)"/)[1])) ? {} : null) },
        updateMessageBlock: () => { updates++; },
        updateReasoningUI: () => { reasoning++; throw new TypeError("Cannot read properties of null (reading 'getAttribute')"); },
    });
    vm.runInContext(slice('function isMessageRendered(', '/* ============================================================\n * 메시지 단위 번역'), ctx);
    ctx.refreshMessage(0, {});
    ctx.refreshReasoning(0);
    assert.equal(updates, 0);
    assert.equal(reasoning, 0);
    ctx.refreshMessage(5, {});
    assert.doesNotThrow(() => ctx.refreshReasoning(5));
    assert.equal(updates, 1);
    assert.equal(reasoning, 1);
});

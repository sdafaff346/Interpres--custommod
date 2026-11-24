import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

function harness(message) {
    const log = { translations: 0, saves: 0, refreshes: 0, reasoning: 0 };
    const ctx = vm.createContext({
        chat: [message],
        getStringHash: s => 'hash:' + s,
        refreshMessage: () => { log.refreshes++; },
        refreshReasoning: () => { log.reasoning++; },
        decorateMessages() {},
        getContext: () => ({ saveChat: async () => { log.saves++; } }),
        translateIncoming: async () => { log.translations++; },
    });
    vm.runInContext(slice('/** 원문 보기로 숨겨 둔 번역본이', '/* ============================================================\n * 일괄 도구'), ctx);
    return { ctx, log };
}

test('the button switches to the original and back to the same translation without an API call', async () => {
    const message = { mes: 'Hello.', extra: { display_text: '안녕.', reasoning_display_text: '생각', interpres_codeblocks_src: 'hash:Hello.' } };
    const { ctx, log } = harness(message);

    await ctx.toggleOrTranslate(0);   // → original
    assert.equal(message.extra.display_text, undefined);
    assert.equal(message.extra.reasoning_display_text, undefined);
    assert.equal(message.extra.interpres_codeblocks_original, true);

    await ctx.toggleOrTranslate(0);   // → translation again
    assert.equal(message.extra.display_text, '안녕.');
    assert.equal(message.extra.reasoning_display_text, '생각');
    assert.equal(message.extra.interpres_codeblocks_src, 'hash:Hello.');
    assert.equal(message.extra.interpres_codeblocks_original, undefined);
    assert.equal(message.extra.interpres_codeblocks_hidden, undefined);
    assert.equal(log.translations, 0);
    assert.equal(log.saves, 2);
});

test('a stored translation of an older original is not restored — the message is translated again', async () => {
    const message = { mes: 'Edited text.', extra: { interpres_codeblocks_original: true, interpres_codeblocks_hidden: { display_text: '옛 번역', src: 'hash:Old text.' } } };
    const { ctx, log } = harness(message);
    await ctx.toggleOrTranslate(0);
    assert.equal(log.translations, 1);
    assert.equal(message.extra.display_text, undefined);
    assert.equal(message.extra.interpres_codeblocks_hidden, undefined);
});

test('a message with no translation yet is translated on the first press', async () => {
    const { ctx, log } = harness({ mes: 'Hi', extra: {} });
    await ctx.toggleOrTranslate(0);
    assert.equal(log.translations, 1);
});

test('every place that resets the original-view choice also drops the stored copy', () => {
    const resets = source.split('delete m.extra.interpres_codeblocks_original;').length - 1
        + source.split('delete message.extra.interpres_codeblocks_original;').length - 1;
    const drops = source.split('delete m.extra.interpres_codeblocks_hidden;').length - 1
        + source.split('delete message.extra.interpres_codeblocks_hidden;').length - 1;
    assert.ok(resets > 0);
    assert.ok(drops >= resets);
});

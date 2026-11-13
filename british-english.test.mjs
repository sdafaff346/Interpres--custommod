import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./settings.html', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

function languageContext() {
    const ctx = vm.createContext({});
    vm.runInContext(slice('const LANG_PROMPT_NAMES', '/* ============================================================\n * 기본 설정'), ctx);
    vm.runInContext(slice('function pairNotes(', '/**\n * 기본 시스템 프롬프트 틀.'), ctx);
    vm.runInContext(slice('function scriptRatio(', '/* ============================================================\n * 캐시 키'), ctx);
    return ctx;
}

test('British English is selectable for both the viewing and the model language', () => {
    assert.equal((html.match(/<option value="en-GB">English \(UK\)<\/option>/g) || []).length, 2);
});

test('British English gets its own prompt name and spelling notes', () => {
    const ctx = languageContext();
    assert.equal(ctx.langName('en-GB'), 'British English');
    assert.equal(ctx.langName('en'), 'English');
    const fromKorean = ctx.pairNotes('ko', 'en-GB').join('\n');
    assert.match(fromKorean, /Korean formality/);
    assert.match(fromKorean, /British spelling/);
    assert.doesNotMatch(fromKorean, /may already be English/);
    const fromAmerican = ctx.pairNotes('en', 'en-GB').join('\n');
    assert.match(fromAmerican, /American spelling, vocabulary, and idiom count as untranslated/);
    assert.equal(ctx.pairNotes('en', 'ko').some(n => /British/.test(n)), false);
});

test('same-script language pairs never skip messages as "already native"', () => {
    const ctx = languageContext();
    assert.equal(ctx.canSkipNative('en-GB', 'en'), false);
    assert.equal(ctx.canSkipNative('en', 'en-GB'), false);
    assert.equal(ctx.canSkipNative('ko', 'en-GB'), true);
    assert.equal(ctx.canSkipNative('en-GB', 'ko'), true);
});

test('whole-chat translation into British English keeps American English messages', async () => {
    const calls = [];
    const noop = () => ({ text() { return this; }, show() { return this; }, hide() { return this; } });
    const ctx = vm.createContext({
        chat: [{ mes: 'The color of the elevator.', is_user: false }, { mes: 'I walk in.', is_user: true }],
        getSettings: () => ({ skipIfNative: true, viewLang: 'en-GB', storyLang: 'en' }),
        currentChatId: () => 'chat-1',
        translateIncoming: async (id) => { calls.push(id); return true; },
        translationJobs: new Map(), updateStatsUI() {}, toastr: { info() {}, success() {} }, $: noop,
    });
    vm.runInContext(slice('function scriptFamily(', '/* ============================================================\n * 기본 설정'), ctx);
    vm.runInContext(slice('function scriptRatio(', '/* ============================================================\n * 캐시 키'), ctx);
    vm.runInContext(slice('let batchRunning = false;', 'async function clearAllTranslations('), ctx);
    await ctx.translateWholeChat();
    assert.deepEqual(calls, [0, 1]);
});

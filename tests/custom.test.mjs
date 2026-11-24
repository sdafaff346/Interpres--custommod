// Interpres Custom(개조판)에서 v1.7.0 원본 위에 덧붙인 기능과 고친 문제를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime, fakeTranslator } from './runtime.mjs';
import { splitChunks } from '../codeblocks.mjs';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../templates/settings.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

/* ---------- 원본과 함께 설치해도 충돌하지 않는다 ---------- */

test('standalone namespace: own settings key, DOM names, message stamps and slash commands', async () => {
    assert.match(source, /const MODULE_NAME = 'interpres_codeblocks';/);
    assert.ok(html.includes('id="icb_settings"'));
    for (const command of ['icb', 'icb-msg', 'icb-chat', 'icb-book']) assert.ok(source.includes(`name: '${command}'`), command);
    assert.ok(!/extra\.interpres_(?:original|src|code|media|keep|tone)\b/.test(source), 'no stamps shared with the original');
    for (const text of [source, html, css]) assert.ok(!/\binterp(?=[_-]|\b)/.test(text), 'no interp_/interp- names left');
    assert.match(manifest.display_name, /^Interpres Custom/);

    const app = await runtime();
    app.context.extension_settings.interpres = { enabled: false, viewLang: 'ja' };
    const mine = app.getSettings();
    assert.equal(app.context.extension_settings.interpres.viewLang, 'ja', 'original Interpres settings untouched');
    assert.equal(app.context.extension_settings.interpres_codeblocks, mine);
});

test('settings saved by the old Custom v1.1.x carry over under their new names', async () => {
    const app = await runtime();
    app.context.extension_settings.interpres_codeblocks = {
        translationConcurrency: 1, showInputTranslationButton: false, showCodeBlockToggles: false,
        chunkChars: 8000, chunkParagraphs: 30, customApi: {}, reverseProxy: {},
    };
    const s = app.getSettings();
    assert.equal(s.concurrency, 1);
    assert.equal(s.inputButton, false);
    assert.equal(s.codeToggles, false);
    assert.equal(s.chunkChars, 8000);
    assert.equal(s.chunkParagraphs, 30);
    assert.equal(s.autoRenderRecovery, true);
    for (const old of ['translationConcurrency', 'showInputTranslationButton', 'showCodeBlockToggles']) assert.ok(!(old in s));
});

/* ---------- 조각당 최대 문단 ---------- */

test('chunks are also limited by paragraph count', () => {
    const text = Array.from({ length: 10 }, (_, i) => `P${i}`).join('\n\n');
    assert.deepEqual(splitChunks(text, 6000), [text], 'no paragraph limit → one piece');
    const parts = splitChunks(text, 6000, 4);
    assert.equal(parts.length, 3);
    assert.equal(parts.join(''), text, 'nothing lost or reordered');
    assert.ok(parts.every(p => p.split(/\n[ \t]*\n/).filter(Boolean).length <= 4));
});

test('the paragraph limit from settings reaches the translator', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.getSettings().chunkParagraphs = 4;
    const src = Array.from({ length: 12 }, (_, i) => `Line ${i} here.`).join('\n\n');
    const out = await app.translateText(src, 'en', 'ko');
    assert.equal(app.calls.length, 3);
    assert.equal(out.split('\n\n').length, 12);
});

/* ---------- 화면에 없는 메시지 ---------- */

test('translating a message that is not on screen succeeds and is saved without redrawing it', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.context.document = { querySelector: () => null };   // 긴 챗: 이 메시지는 화면에 그려져 있지 않다
    app.getSettings().translateReasoning = true;
    app.chat.push({ is_user: false, mes: 'Hello there.', extra: { reasoning: 'Thinking hard.' } });
    assert.equal(await app.translateIncoming(0, { force: true }), true);
    assert.match(app.chat[0].extra.display_text, /^한5 한5\.$/);
    assert.ok(app.chat[0].extra.reasoning_display_text);
    assert.deepEqual(app.redrawn, [], 'SillyTavern renderer not called for an off-screen message');
    assert.deepEqual(app.reasoningDrawn, []);
});

test('messages on screen are still redrawn', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.context.document = { querySelector: (sel) => (sel.includes('mesid="0"') ? {} : null) };
    app.chat.push({ is_user: false, mes: 'Hello there.', extra: {} });
    assert.equal(await app.translateIncoming(0, { force: true }), true);
    assert.deepEqual(app.redrawn, [0]);
});

/* ---------- 전체 번역에 내 메시지 포함 ---------- */

test('whole-chat translation includes my messages, skipping ones already in the viewing language', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.chat.push(
        { is_user: false, mes: 'Hello there.', extra: {} },
        { is_user: true, mes: 'I walk in.', extra: {} },
        { is_user: true, mes: '안녕하세요 반가워요', extra: {} },
        { is_user: true, mes: 'I said hi.', extra: { display_text: '인사했다' } },     // 입력 번역으로 이미 처리됨
        { is_system: true, mes: 'note', extra: {} },
        { is_user: false, mes: 'Keep this.', extra: { interpres_codeblocks_original: true } },
    );
    app.getSettings().skipIfNative = false;
    await app.run('translateWholeChat()');
    assert.ok(app.chat[0].extra.display_text);
    assert.ok(app.chat[1].extra.display_text, 'my English message is translated');
    assert.equal(app.chat[2].extra.display_text, undefined, 'my Korean message is left alone');
    assert.equal(app.chat[3].extra.display_text, '인사했다');
    assert.equal(app.chat[5].extra.display_text, undefined, 'original view choice respected');
});

test('editing my translated message drops the stale translation', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.run('bindEvents()');
    app.chat.push({ is_user: true, mes: 'I walk in.', extra: {} });
    await app.translateIncoming(0, { force: true });
    assert.ok(app.chat[0].extra.display_text);
    app.chat[0].mes = 'I run in.';
    await app.context.eventSource.emit('MESSAGE_UPDATED', 0);
    assert.equal(app.chat[0].extra.display_text, undefined);
    assert.equal(app.chat[0].extra.interpres_codeblocks_src, undefined);
});

/* ---------- 원문 보기 즉시 전환 ---------- */

test('the globe button flips to the original and back to the same translation with no new request', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.getSettings().translateReasoning = true;
    app.chat.push({ is_user: false, mes: 'Hello there.', extra: { reasoning: 'Hmm.' } });
    await app.translateIncoming(0, { force: true });
    const translated = app.chat[0].extra.display_text;
    const calls = app.calls.length;

    await app.run('toggleOrTranslate(0)');
    assert.equal(app.chat[0].extra.display_text, undefined);
    assert.equal(app.chat[0].extra.interpres_codeblocks_original, true);

    // 원문을 보는 동안 리렌더가 와도 자동 번역이 되살리지 않는다
    await app.translateIncoming(0);
    assert.equal(app.chat[0].extra.display_text, undefined);

    await app.run('toggleOrTranslate(0)');
    assert.equal(app.chat[0].extra.display_text, translated);
    assert.ok(app.chat[0].extra.reasoning_display_text);
    assert.equal(app.chat[0].extra.interpres_codeblocks_original, undefined);
    assert.equal(app.chat[0].extra.interpres_codeblocks_hidden, undefined);
    assert.equal(app.calls.length, calls, 'no API call to come back');
});

test('a kept translation of an older original is not restored — it translates the new text', async () => {
    const app = await runtime({ translate: fakeTranslator });
    app.chat.push({ is_user: false, mes: 'Hello there.', extra: {} });
    await app.translateIncoming(0, { force: true });
    await app.run('toggleOrTranslate(0)');
    app.chat[0].mes = 'Goodbye friend.';
    await app.run('toggleOrTranslate(0)');
    assert.match(app.chat[0].extra.display_text, /^한7 한6\.$/);
});

test('every reset of the original-view choice also drops the kept translation', () => {
    const count = (rx) => (source.match(rx) || []).length;
    const resets = count(/delete (?:m|message)\.extra\.interpres_codeblocks_original;/g);
    const drops = count(/delete (?:m|message)\.extra\.interpres_codeblocks_hidden;/g);
    assert.ok(resets > 0 && drops >= resets, `${drops} drops for ${resets} resets`);
});

/* ---------- 영국식 영어 ---------- */

test('British English: selectable, named, with spelling notes; American→British is not skipped', async () => {
    assert.equal((html.match(/<option value="en-GB">English \(UK\)<\/option>/g) || []).length, 2);
    const app = await runtime({ translate: fakeTranslator });
    assert.equal(app.run("langName('en-GB')"), 'British English');
    const fromKo = app.run("pairNotes('ko', 'en-GB')").join('\n');
    assert.match(fromKo, /Korean formality/);
    assert.match(fromKo, /British spelling/);
    assert.match(app.run("pairNotes('en', 'en-GB')").join('\n'), /American spelling, vocabulary, and idiom count as untranslated/);
    assert.equal(app.run("canSkipNative('en-GB', 'en')"), false);
    assert.equal(app.run("canSkipNative('ko', 'en-GB')"), true);

    Object.assign(app.getSettings(), { viewLang: 'en-GB', storyLang: 'en', skipIfNative: true });
    app.chat.push({ is_user: false, mes: 'The color of the elevator.', extra: {} });
    assert.equal(await app.translateIncoming(0), true, 'English text still converted to British English');
});

/* ---------- 옛 개조판에서 번역한 메시지 ---------- */

test('messages translated by the old Custom keep working: code-block state and anchors are converted', async () => {
    const app = await runtime();
    const hash = (str) => app.run(`getStringHash(${JSON.stringify(str)})`);
    const mes = 'Hi.\n\n```\nStatus: ok\n```';
    const translated = '안녕.\n\n```\n상태: 좋음\n```';
    const oldAnchor = '\n\n<div class="icb_code_start icb_code_block_0" data-icb-block="0"></div>\n\n';
    app.chat.push(
        { is_user: false, mes, extra: { display_text: 'old', interpres_codeblocks_code: { sourceHash: hash(mes), translated, originals: [0] } } },
        { is_user: false, mes: 'Changed since.', extra: { interpres_codeblocks_code: { sourceHash: 123, translated: 'x', originals: [] } } },
        { is_user: false, mes: 'Shown original.', extra: { interpres_codeblocks_hidden: { display_text: `A${oldAnchor}B` } } },
    );
    assert.equal(app.run('migrateLegacyMessages()'), 3);
    const code = app.chat[0].extra.interpres_codeblocks_code;
    assert.deepEqual(JSON.parse(JSON.stringify(code)), { h: hash(mes), t: translated, o: [0] });
    assert.match(app.chat[0].extra.display_text, /Status: ok/, 'block picked as original stays original');
    assert.ok(!app.chat[0].extra.display_text.includes('icb_code_start'));
    assert.equal(app.chat[1].extra.interpres_codeblocks_code, undefined);
    assert.equal(app.chat[2].extra.interpres_codeblocks_hidden.display_text, 'A\n\nB');
    assert.equal(app.run('migrateLegacyMessages()'), 0, 'running again changes nothing');
});

/* ---------- 설정 화면 ---------- */

test('settings panel has the Custom controls and the Graphite input icon', () => {
    for (const id of ['icb_chunk_paragraphs', 'icb_auto_render_recovery']) assert.ok(html.includes(`id="${id}"`), id);
    assert.match(source, /const COMPOSER_ICON = 'fa-graphite fa-thin fa-language';/);
});

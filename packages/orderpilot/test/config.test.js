import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_GRAPH_API_VERSION, createSettings } from '../src/config.js';

// Settings: an option wins, otherwise the environment variable, read at call time.

const PAGE = { PAGE_ACCESS_TOKEN: 'token', FACEBOOK_PAGE_ID: '123', META_APP_SECRET: 'secret', META_VERIFY_TOKEN: 'verify' };

describe('createSettings', () => {
  it('reads the environment on every call', () => {
    const env = { ...PAGE };
    const settings = createSettings({}, env);
    assert.deepEqual(settings.sendApi(), { accessToken: 'token', pageId: '123', version: DEFAULT_GRAPH_API_VERSION });
    env.FACEBOOK_PAGE_ID = '456';
    env.META_GRAPH_API_VERSION = 'v27.0';
    assert.deepEqual(settings.sendApi(), { accessToken: 'token', pageId: '456', version: 'v27.0' });
  });

  it('an option wins over the environment, and values are trimmed', () => {
    const settings = createSettings({ pageId: ' 789 ', pageAccessToken: 'option-token' }, { ...PAGE });
    assert.deepEqual(settings.sendApi(), { accessToken: 'option-token', pageId: '789', version: DEFAULT_GRAPH_API_VERSION });
    assert.equal(createSettings({ pageId: 42 }, {}).pageId(), '42');
  });

  it('names missing, placeholder and malformed settings; secrets are null until set', () => {
    const settings = createSettings({}, { PAGE_ACCESS_TOKEN: 'replace_with_token', FACEBOOK_PAGE_ID: 'abc', META_GRAPH_API_VERSION: '26' });
    assert.deepEqual(settings.invalid(), ['appSecret', 'verifyToken', 'pageAccessToken', 'pageId', 'graphApiVersion']);
    assert.equal(settings.sendApi(), null);
    assert.equal(settings.appSecret(), null);
    assert.equal(settings.verifyToken(), null);
    assert.equal(settings.graphApiVersion(), DEFAULT_GRAPH_API_VERSION, 'a malformed version is never used');
    assert.deepEqual(createSettings({}, PAGE).invalid(), []);
  });

  it('accepts only a numeric app id', () => {
    assert.equal(createSettings({}, { FACEBOOK_APP_ID: '555' }).appId(), '555');
    assert.equal(createSettings({}, { FACEBOOK_APP_ID: 'my-app' }).appId(), null);
  });

  it('detects the language unless DETECT_LANGUAGE is "false" or the option says no', () => {
    for (const value of [undefined, '', 'true', 'TRUE', 'yes', '1']) {
      assert.equal(createSettings({}, { DETECT_LANGUAGE: value }).detectLanguage(), true, String(value));
    }
    for (const value of ['false', 'FALSE', ' false ']) {
      assert.equal(createSettings({}, { DETECT_LANGUAGE: value }).detectLanguage(), false, value);
    }
    assert.equal(createSettings({ detectLanguage: false }, {}).detectLanguage(), false);
    assert.equal(createSettings({ detectLanguage: true }, { DETECT_LANGUAGE: 'false' }).detectLanguage(), true);
  });

  it('replies unless autoReply says no; a function is asked every time', () => {
    assert.equal(createSettings({}, {}).autoReply(), true);
    assert.equal(createSettings({ autoReply: false }, {}).autoReply(), false);
    let on = false;
    const settings = createSettings({ autoReply: () => on }, {});
    assert.equal(settings.autoReply(), false);
    on = true;
    assert.equal(settings.autoReply(), true);
  });
});

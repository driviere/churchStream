'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { App } = require('../lib/app');

// A stand-in for the app with just what the media controls use.
function fakeApp({ type = 'audio', playing = true, desk = false } = {}) {
  const plays = [];
  const live = { key: 'k1', kind: 'media', title: 'Peter Song', media: { type, file: 'media:clip-a.mp3', duration: 333, loop: false, volume: 0.8, youtube: { id: 'abc' } } };
  const relay = {
    now: playing && type !== 'youtube' ? { id: 'k1', kind: 'audio', path: '/x.mp3', title: 'Peter Song', volume: 0.8, startedAt: Date.now() - 13000 } : null,
    play(item) { plays.push(item); this.now = { ...item, startedAt: Date.now() - (item.seek || 0) * 1000 }; },
    stop() { this.now = null; },
    setVolume(v) { if (this.now) this.now.volume = v; },
  };
  const app = Object.create(App.prototype);
  Object.assign(app, { state: { live: { item: live, index: 0 } }, relay, yt: { now: null }, cfg: { mediaSound: desk ? 'desk' : 'stream' }, plays, changed() {}, mediaPath: (f) => '/' + f });
  return app;
}

test('media: jump to a place in the music playing now', () => {
  const app = fakeApp();
  app.mediaControl({ action: 'seek', at: 120 });
  assert.equal(app.plays.length, 1);
  assert.equal(app.plays[0].seek, 120);
  assert.ok(Math.abs(Date.now() - app.relay.now.startedAt - 120000) < 50);
});

test('media: a jump past the end stays inside the track; a jump before Play starts it there', () => {
  const app = fakeApp({ playing: false });
  app.mediaControl({ action: 'seek', at: 9999 });
  assert.equal(app.plays.length, 1);
  assert.ok(app.plays[0].seek < 333 && app.plays[0].seek > 332);
  app.mediaControl({ action: 'seek', at: -5 });
  assert.equal(app.plays[1].seek, 0);
});

test('media: YouTube jumps by moving its start time (paused too)', () => {
  const app = fakeApp({ type: 'youtube' });
  app.playMedia(app.state.live.item);
  app.mediaControl({ action: 'seek', at: 60 });
  assert.ok(Math.abs(Date.now() - app.yt.now.startedAt - 60000) < 50);
  const y = app.yt.now;
  y.paused = true; y.pausedAt = Date.now();
  app.mediaControl({ action: 'seek', at: 30 });
  assert.equal(y.pausedAt - y.startedAt, 30000);
});

test('media: with the sound desk, the stream gets no sound but the room keeps its volume', () => {
  const app = fakeApp({ playing: false, desk: true });
  app.playMedia(app.state.live.item);
  assert.equal(app.plays[0].volume, 0);
  assert.equal(app.plays[0].roomVolume, 0.8);
  app.mediaControl({ volume: 0.5 });
  assert.equal(app.relay.now.volume, 0);
  assert.equal(app.relay.now.roomVolume, 0.5);
});

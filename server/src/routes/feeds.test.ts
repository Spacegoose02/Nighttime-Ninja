import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelIdFromHtml, parseYouTubeVideosPage, relativeToIso } from './feeds.ts';

test('reads videos from a YouTube channel page', () => {
  const data = {
    metadata: { channelMetadataRenderer: { title: 'Test Kitchen' } },
    contents: [
      { richItemRenderer: { content: { lockupViewModel: {
        contentId: 'abc123', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        metadata: { lockupMetadataViewModel: { title: { content: 'Perfect "Pancakes"' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '1.2M views' } }, { text: { content: '3 days ago' } }] }] } } } },
      } } } },
      { videoRenderer: { videoId: 'def456', title: { runs: [{ text: 'Old style' }] }, publishedTimeText: { simpleText: '2 weeks ago' } } },
    ],
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
  const p = parseYouTubeVideosPage(html);
  assert.equal(p.title, 'Test Kitchen');
  assert.equal(p.entries.length, 2);
  assert.equal(p.entries[0].title, 'Perfect "Pancakes"');
  assert.equal(p.entries[0].videoId, 'abc123');
  assert.ok(Date.parse(p.entries[0].published!) > Date.parse(p.entries[1].published!));
});

test('finds the channel id, not a featured channel', () => {
  const html = '"channelId":"UCwrongwrongwrongwrongw" <link rel="canonical" href="https://www.youtube.com/channel/UCrightrightrightrightr">';
  assert.equal(channelIdFromHtml(html), 'UCrightrightrightrightr');
});

test('turns relative times into dates', () => {
  const now = Date.parse('2026-10-17T00:00:00Z');
  assert.equal(relativeToIso('12d ago', now), '2026-10-05T00:00:00.000Z');
  assert.equal(relativeToIso('1 hour ago', now), '2026-10-16T23:00:00.000Z');
  assert.equal(relativeToIso('Streamed', now), null);
});

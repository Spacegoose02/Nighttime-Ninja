import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { askLocal, toOpenAi } from './localai.ts';
import { recordUsage, usageCost, usageSummary } from './aiusage.ts';
import { openMemoryDb } from './db.ts';

test('turns a Claude request into an OpenAI one', () => {
  const body = toOpenAi({
    system: [{ type: 'text', text: 'You are Gordy.' }],
    messages: [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'What is this?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Saving it.' }, { type: 'tool_use', id: 't1', name: 'save_recipe', input: { title: 'Soup' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Saved' }] },
    ],
    tools: [
      { name: 'save_recipe', description: 'Save it', input_schema: { type: 'object', properties: {} } },
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
    ],
    output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
  } as never, 'llama3.1') as { model: string; messages: { role: string; content: unknown; tool_calls?: unknown[] }[]; tools: unknown[]; response_format: { type: string } };

  assert.equal(body.model, 'llama3.1');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'You are Gordy.' });
  assert.deepEqual(body.messages[1].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: 'What is this?' }]);
  assert.equal(body.messages[2].tool_calls?.length, 1);
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 't1', content: 'Saved' });
  // Web search is Claude's own; only the app's tools carry over.
  assert.equal(body.tools.length, 1);
  assert.equal(body.response_format.type, 'json_schema');
});

test('asks an OpenAI-compatible server and reads the streamed answer, tools and usage', async () => {
  let seen: { model?: string } = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o: object) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ choices: [{ delta: { content: 'Hello ' } }] });
      send({ choices: [{ delta: { content: 'there' } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_item', arguments: '{"name":' } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"milk"}' } }] }, finish_reason: 'tool_calls' }] });
      send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const streamed: string[] = [];
    const res = await askLocal({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'qwen', apiKey: null }, { messages: [{ role: 'user', content: 'hi' }] }, (t) => streamed.push(t));
    assert.equal(seen.model, 'qwen');
    assert.deepEqual(streamed, ['Hello ', 'there']);
    assert.equal(res.stop_reason, 'tool_use');
    assert.deepEqual(res.content[0], { type: 'text', text: 'Hello there', citations: null });
    assert.deepEqual(res.content[1], { type: 'tool_use', id: 'c1', name: 'add_item', input: { name: 'milk' } });
    assert.deepEqual(res.usage, { input_tokens: 12, output_tokens: 5 });
  } finally {
    server.close();
  }
});

test('a server that is down gives a message a person can act on', async () => {
  await assert.rejects(
    askLocal({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x', apiKey: null }, { messages: [{ role: 'user', content: 'hi' }] }),
    /Couldn't reach your AI server/,
  );
});

test('counts AI use and estimates its cost', () => {
  assert.equal(usageCost('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(usageCost('claude-haiku-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6 }), 0.01);
  assert.equal(usageCost('some-new-model', { input_tokens: 1 }), null);
  assert.equal(usageCost('llama3.1', { input_tokens: 1e6 }, true), 0);

  const db = openMemoryDb();
  recordUsage(db, 'claude-sonnet-5-5', { input_tokens: 500_000, output_tokens: 100_000 });
  recordUsage(db, 'claude-sonnet-5-5', { input_tokens: 500_000, output_tokens: 100_000 });
  recordUsage(db, 'llama3.1', { input_tokens: 10, output_tokens: 10 }, true);
  const s = usageSummary(db);
  assert.equal(s.today.requests, 3);
  assert.equal(s.month.cost, 4); // 1M in at $2 + 200k out at $10
  assert.deepEqual(s.byModel.map((m) => m.model), ['claude-sonnet-5-5', 'llama3.1']);
});

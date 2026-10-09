// TEST FIXTURE ONLY: a local stand-in for the Anthropic Messages API used by
// the AI end-to-end test. It returns a fixed structured response (one finding
// with genuine quotes, one with a fabricated quote) so the full pipeline —
// SDK request, schema parsing, server + browser quote verification, UI — can
// be exercised without a real API key. It is never used outside tests.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 8788);
const output = {
  findings: [
    {
      title: 'Shortness of breath reported in one note, denied in another',
      category: 'explicit_conflict', clinical_topic: 'history',
      explanation: 'One record reports occasional shortness of breath while a later record states the patient denies it.',
      reason_for_human_review: 'Symptom history differs between records; the reviewer should confirm with the patient.',
      uncertainty: 'The symptom may have resolved between visits.',
      relevant_dates: ['2026-03-12', '2031-01-01'],
      evidence: [
        { document_id: '__DOC_A__', side: 'A', quote: 'Patient reports occasional shortness of breath on exertion.' },
        { document_id: '__DOC_B__', side: 'B', quote: 'Denies shortness of breath.' },
      ],
    },
    {
      title: 'Fabricated warfarin statement',
      category: 'potential_discrepancy', clinical_topic: 'medication',
      explanation: 'x', reason_for_human_review: 'x', uncertainty: '', relevant_dates: [],
      evidence: [{ document_id: '__DOC_A__', side: 'A', quote: 'Warfarin 5 mg daily.' }],
    },
  ],
};

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    if (!req.headers['x-api-key'] || !json.output_config?.format) { res.writeHead(400); res.end('{}'); return; }
    // Map placeholder ids to the document ids present in the prompt (in order).
    const prompt = JSON.stringify(json.messages);
    const ids = [...prompt.matchAll(/document_id=\\"(doc_[A-Za-z0-9]+)\\"/g)].map((m) => m[1]);
    const text = JSON.stringify(output).replaceAll('__DOC_A__', ids[0] ?? 'doc_x').replaceAll('__DOC_B__', ids[1] ?? 'doc_y');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: json.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake Anthropic fixture on ${PORT}`));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from '../src/api-client.js';
import { createExamForgeServer } from '../src/tools.js';

const ccna = {
  certification: {
    code: 'ccna',
    name: 'Cisco Certified Network Associate',
    examCode: '200-301',
    domains: [
      { code: '3.0', name: 'IP Connectivity', weight: 0.25, subtopics: [{ code: '3.4', name: 'OSPFv2' }] },
      { code: '5.0', name: 'Security Fundamentals', weight: 0.15, subtopics: [] },
    ],
    allowedQuestionTypes: ['mcq_single', 'cli'],
  },
  bank: { questions: 1, byDomain: { '3.0': 1 }, exams: 0 },
};

function fakeApi(overrides: Partial<Record<string, (body?: unknown) => unknown>> = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api: ApiClient = {
    async get(path) {
      calls.push({ method: 'GET', path });
      const handler = overrides[`GET ${path.split('?')[0]}`];
      if (handler) return handler() as never;
      if (path.startsWith('/certifications/ccna')) return ccna as never;
      if (path.startsWith('/admin/questions?')) return { questions: [{ slug: 'ccna-3.4-ospf-001', stem: 'Énoncé existant' }] } as never;
      throw new ApiError(404, 'not_found', path);
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      const handler = overrides[`POST ${path}`];
      if (handler) return handler(body) as never;
      throw new ApiError(404, 'not_found', path);
    },
  };
  return { api, calls };
}

async function connect(api: ApiClient) {
  const server = createExamForgeServer(api);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const payload = (res: unknown) => JSON.parse(((res as { content: { text: string }[] }).content)[0]!.text);

describe('exam-forge-mcp', () => {
  it('expose les outils du cahier des charges', async () => {
    const client = await connect(fakeApi().api);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_certification',
      'analyze_weakness',
      'generate_exam',
      'generate_question',
      'get_certification',
      'record_review',
      'submit_question',
      'validate_question',
    ]);
  });

  it('generate_question fournit le format, les règles et les énoncés à ne pas dupliquer', async () => {
    const client = await connect(fakeApi().api);
    const res = await client.callTool({
      name: 'generate_question',
      arguments: { certification: 'ccna', domain: '3.0', subtopic: '3.4', type: 'cli', difficulty: 'hard' },
    });
    const brief = payload(res);
    expect(brief.format.slug).toMatch(/^ccna-3\.4-<sujet-court>-002/);
    expect(brief.format.key.type).toBe('cli');
    expect(brief.existingStems).toEqual([{ slug: 'ccna-3.4-ospf-001', stem: 'Énoncé existant' }]);
  });

  it('refuse un type non autorisé par la certification', async () => {
    const client = await connect(fakeApi().api);
    const res = await client.callTool({
      name: 'generate_question',
      arguments: { certification: 'ccna', domain: '3.0', type: 'matching', difficulty: 'easy' },
    });
    expect(res.isError).toBe(true);
    expect(payload(res).error).toBe('type_not_allowed');
  });

  it('remonte les erreurs de validation de l\'API pour que l\'IA corrige', async () => {
    const { api } = fakeApi({
      'POST /admin/questions': () => {
        throw new ApiError(400, 'bad_request', 'Question rejetée', ['réponse z absente des options']);
      },
    });
    const client = await connect(api);
    const res = await client.callTool({ name: 'submit_question', arguments: { question: { slug: 'x' } } });
    expect(res.isError).toBe(true);
    expect(payload(res).details).toEqual(['réponse z absente des options']);
  });

  it('generate_exam dit quoi générer quand la banque est trop petite', async () => {
    const { api, calls } = fakeApi({
      'POST /admin/exams': () => {
        throw new ApiError(409, 'insufficient_questions', 'manque', { domain: '3.0', needed: 26, available: 4 });
      },
    });
    const client = await connect(api);
    const res = await client.callTool({ name: 'generate_exam', arguments: { certification: 'ccna', question_count: 102 } });
    expect(payload(res).details.todo).toContain('au moins 22 question(s)');
    expect(calls.at(-1)?.body).toEqual({ certification: 'ccna', questionCount: 102 });
  });

  it('le client HTTP envoie le jeton de service et décode les erreurs', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ error: { code: 'forbidden', message: 'non' } }), { status: 403 });
    }) as unknown as typeof fetch;
    const client = createApiClient('https://api.exemple.fr/', 'jeton', fakeFetch);
    await expect(client.get('/stats?certification=ccna')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(seen[0]).toEqual({ url: 'https://api.exemple.fr/api/v1/stats?certification=ccna', auth: 'Bearer jeton' });
  });
});

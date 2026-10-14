#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiClient } from './api-client.js';
import { createExamForgeServer } from './tools.js';

const apiUrl = process.env.EXAMFORGE_API_URL;
const token = process.env.EXAMFORGE_SERVICE_TOKEN;
if (!apiUrl || !token) {
  console.error('EXAMFORGE_API_URL et EXAMFORGE_SERVICE_TOKEN sont requis.');
  process.exit(1);
}

const server = createExamForgeServer(createApiClient(apiUrl, token));
await server.connect(new StdioServerTransport());

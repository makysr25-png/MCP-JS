const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { rejectUnknownKeys, requireObject } = require('./validation');

const tools = [
  {
    name: 'list_directory',
    description: 'List files and folders in a workspace directory.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1, maxLength: 1024, description: 'Relative workspace path.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a bounded section of a UTF-8 workspace file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1024 },
        start: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
        end: { type: 'integer', minimum: 0, maximum: 1000000 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 file in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1024 },
        content: { type: 'string', maxLength: 1000000 },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Search file names and contents within the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        path: { type: 'string', minLength: 1, maxLength: 1024, default: '.' },
        extension: { type: 'string', maxLength: 32 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workspace_info',
    description: 'Get basic project information and a bounded file listing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function validateToolRequest(name, args) {
  requireObject(args);
  const fields = {
    list_directory: ['path'],
    read_file: ['path', 'start', 'end'],
    write_file: ['path', 'content', 'append'],
    search_files: ['query', 'path', 'extension'],
    get_workspace_info: [],
  }[name];
  if (!fields) throw new Error(`Unknown tool: ${name}`);
  rejectUnknownKeys(args, fields);
}

function createMcpServer(workspace) {
  const server = new Server(
    { name: 'workspace-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      validateToolRequest(name, args);
      let result;
      switch (name) {
        case 'list_directory': result = workspace.listDirectory(args); break;
        case 'read_file': result = workspace.readFile(args); break;
        case 'write_file': result = workspace.writeFile(args); break;
        case 'search_files': result = workspace.searchFiles(args); break;
        case 'get_workspace_info': result = workspace.getWorkspaceInfo(); break;
        default: throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: workspace.listWorkspaceResources(),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => (
    workspace.readResource(request.params.uri)
  ));
  return server;
}

module.exports = { createMcpServer, tools, validateToolRequest };

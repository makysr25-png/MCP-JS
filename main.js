const { WorkspaceService } = require('./src/workspace-service');
const { createMcpServer } = require('./src/server');

const workspace = new WorkspaceService();
const server = createMcpServer(workspace);

async function main() {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Workspace MCP server started for ${workspace.root}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  getWorkspaceRoot: () => workspace.root,
  safeResolvePath: (inputPath) => workspace.resolvePath(inputPath),
  listDirectory: (targetPath = '.') => workspace.listDirectory({ path: targetPath }),
  readFile: (targetPath, start = 0, end) => workspace.readFile({ path: targetPath, start, end }),
  writeFile: (targetPath, content, append = false) => workspace.writeFile({ path: targetPath, content, append }),
  searchFiles: (targetPath = '.', query = '', extension) => (
    workspace.searchFiles({ path: targetPath, query, extension })
  ),
  getWorkspaceInfo: () => workspace.getWorkspaceInfo(),
  readResourceByUri: (uri) => workspace.readResource(uri),
  workspace,
  server,
  main,
};

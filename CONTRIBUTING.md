# Contributing to JustOneAPI MCP

Thank you for your interest in contributing to JustOneAPI MCP! This document provides guidelines for contributing to the project.

## Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/justoneapi-mcp.git
   cd justoneapi-mcp
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Create Environment File**
   ```bash
   cp .env.example .env
   # Edit .env and add your JUSTONEAPI_TOKEN
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## Development Workflow

### Code Style

We use ESLint and Prettier for code formatting:

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

### Building

```bash
npm run build
```

The compiled output will be in the `dist/` directory.

### Testing Locally

To test your changes with Claude Desktop:

1. Build the project: `npm run build`
2. Update your Claude Desktop config to point to your local build
3. Restart Claude Desktop
4. Test the tools

## Adding a New Tool

1. **Create Tool File**
   ```
   src/tools/<platform>/<tool_name>.ts
   ```

2. **Define Input Schema with Zod**
   ```typescript
   import { z } from "zod";

   export const MyToolInput = z.object({
     param1: z.string().min(1).describe("Description"),
     param2: z.number().default(1).describe("Description"),
   });
   ```

3. **Implement Tool Function**
   ```typescript
   export async function myTool(input: z.infer<typeof MyToolInput>) {
     const token = encodeURIComponent(requireToken());
     // ... implementation
     return await getJson(`/api/path?token=${token}&...`);
   }
   ```

4. **Register Tool in src/index.ts**
   ```typescript
   server.registerTool(
     "my_tool",
     {
       description: "Tool description",
       inputSchema: MyToolInput.shape,
     },
     async (input) => {
       try {
         const data = await myTool(input);
         return {
           content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
         };
       } catch (e: any) {
         const m = toMcpErrorPayload(e);
         return {
           isError: true,
           content: [
             {
               type: "text",
               text: `ERROR[${m.code}] (upstream=${m.upstreamCode ?? "N/A"}): ${m.message}`,
             },
           ],
         };
       }
     }
   );
   ```

5. **Update README.md** with tool documentation

## Pull Request Process

1. **Create a Branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make Your Changes**
   - Follow the code style
   - Add/update tests if applicable
   - Update documentation

3. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `chore:` - Maintenance tasks
   - `refactor:` - Code refactoring
   - `test:` - Test changes

4. **Push and Create PR**
   ```bash
   git push origin feature/my-feature
   ```
   Then create a Pull Request on GitHub.

## Code Guidelines

### TypeScript

- Use strict TypeScript mode
- Prefer `const` over `let`
- Use type inference where possible
- Avoid `any` (use `unknown` if needed)

### Error Handling

- Always use the error handling pattern from `src/common/errors.ts`
- Map upstream error codes properly
- Provide actionable error messages

### Security

- Never log tokens in plaintext
- Always use `maskToken()` for logging
- Use `toSafeUrlForLog()` for URL logging
- Validate all user inputs with Zod

### Design Principles

1. **Raw JSON by design** - Return original upstream responses
2. **Minimal transformation** - Don't parse or restructure data
3. **Transparent errors** - Clear error codes and messages
4. **Security first** - Never expose sensitive data

## Questions?

If you have questions, please open an issue on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

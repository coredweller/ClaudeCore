# Node/TypeScript MCP Server -- Implementation Patterns

## Tool Implementation

### Tool Naming

Use snake_case for tool names (e.g., "search_users", "create_project", "get_channel_info") with clear, action-oriented names.

**Avoid Naming Conflicts**: Include the service context to prevent overlaps:
- Use "slack_send_message" instead of just "send_message"
- Use "github_create_issue" instead of just "create_issue"
- Use "asana_list_tasks" instead of just "list_tasks"

### Tool Structure

Tools are registered using the `registerTool` method with the following requirements:
- Use Zod schemas for runtime input validation and type safety
- The `description` field must be explicitly provided - JSDoc comments are NOT automatically extracted
- Explicitly provide `title`, `description`, `inputSchema`, and `annotations`
- The `inputSchema` must be a Zod schema object (not a JSON schema)
- Type all parameters and return values explicitly

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "example-mcp",
  version: "1.0.0"
});

// Zod schema for input validation
const UserSearchInputSchema = z.object({
  query: z.string()
    .min(2, "Query must be at least 2 characters")
    .max(200, "Query must not exceed 200 characters")
    .describe("Search string to match against names/emails"),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum results to return"),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination"),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable")
}).strict();

type UserSearchInput = z.infer<typeof UserSearchInputSchema>;

server.registerTool(
  "example_search_users",
  {
    title: "Search Example Users",
    description: `Search for users in the Example system by name, email, or team.

This tool searches across all user profiles in the Example platform, supporting partial matches and various search filters. It does NOT create or modify users, only searches existing ones.

Args:
  - query (string): Search string to match against names/emails
  - limit (number): Maximum results to return, between 1-100 (default: 20)
  - offset (number): Number of results to skip for pagination (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format: Structured data with total, count, offset, users array, has_more, next_offset

Examples:
  - "Find all marketing team members" -> params with query="team:marketing"
  - "Search for John's account" -> params with query="john"

Error Handling:
  - Returns "Error: Rate limit exceeded" if too many requests (429 status)
  - Returns "No users found matching '<query>'" if search returns empty`,
    inputSchema: UserSearchInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: UserSearchInput) => {
    try {
      const data = await makeApiRequest<any>(
        "users/search", "GET", undefined,
        { q: params.query, limit: params.limit, offset: params.offset }
      );

      const users = data.users || [];
      const total = data.total || 0;

      if (!users.length) {
        return {
          content: [{ type: "text", text: `No users found matching '${params.query}'` }]
        };
      }

      const output = {
        total,
        count: users.length,
        offset: params.offset,
        users: users.map((user: any) => ({
          id: user.id, name: user.name, email: user.email,
          ...(user.team ? { team: user.team } : {}),
          active: user.active ?? true
        })),
        has_more: total > params.offset + users.length,
        ...(total > params.offset + users.length ? {
          next_offset: params.offset + users.length
        } : {})
      };

      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [`# User Search Results: '${params.query}'`, "",
          `Found ${total} users (showing ${users.length})`, ""];
        for (const user of users) {
          lines.push(`## ${user.name} (${user.id})`);
          lines.push(`- **Email**: ${user.email}`);
          if (user.team) lines.push(`- **Team**: ${user.team}`);
          lines.push("");
        }
        textContent = lines.join("\n");
      } else {
        textContent = JSON.stringify(output, null, 2);
      }

      return {
        content: [{ type: "text", text: textContent }],
        structuredContent: output
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);
```

## Zod Schemas for Input Validation

```typescript
import { z } from "zod";

// Basic schema with validation
const CreateUserSchema = z.object({
  name: z.string()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  email: z.string()
    .email("Invalid email format"),
  age: z.number()
    .int("Age must be a whole number")
    .min(0, "Age cannot be negative")
    .max(150, "Age cannot be greater than 150")
}).strict();

// Enums
enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

const SearchSchema = z.object({
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format")
});

// Optional fields with defaults
const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20)
    .describe("Maximum results to return"),
  offset: z.number().int().min(0).default(0)
    .describe("Number of results to skip")
});
```

## Response Format Options

Support multiple output formats for flexibility:

```typescript
enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

const inputSchema = z.object({
  query: z.string(),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable")
});
```

**Markdown format**: Use headers, lists, formatting. Convert timestamps to human-readable format. Show display names with IDs in parentheses. Omit verbose metadata.

**JSON format**: Return complete, structured data suitable for programmatic processing. Include all available fields and metadata. Use consistent field names and types.

## Pagination Implementation

```typescript
const ListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0)
});

async function listItems(params: z.infer<typeof ListSchema>) {
  const data = await apiRequest(params.limit, params.offset);
  const response = {
    total: data.total,
    count: data.items.length,
    offset: params.offset,
    items: data.items,
    has_more: data.total > params.offset + data.items.length,
    next_offset: data.total > params.offset + data.items.length
      ? params.offset + data.items.length : undefined
  };
  return JSON.stringify(response, null, 2);
}
```

## Character Limits and Truncation

Add a CHARACTER_LIMIT constant to prevent overwhelming responses:

```typescript
export const CHARACTER_LIMIT = 25000;

async function searchTool(params: SearchInput) {
  let result = generateResponse(data);
  if (result.length > CHARACTER_LIMIT) {
    const truncatedData = data.slice(0, Math.max(1, data.length / 2));
    response.data = truncatedData;
    response.truncated = true;
    response.truncation_message =
      `Response truncated from ${data.length} to ${truncatedData.length} items. ` +
      `Use 'offset' parameter or add filters to see more results.`;
    result = JSON.stringify(response, null, 2);
  }
  return result;
}
```

## Error Handling

Provide clear, actionable error messages:

```typescript
import axios, { AxiosError } from "axios";

function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      switch (error.response.status) {
        case 404: return "Error: Resource not found. Please check the ID is correct.";
        case 403: return "Error: Permission denied. You don't have access to this resource.";
        case 429: return "Error: Rate limit exceeded. Please wait before making more requests.";
        default: return `Error: API request failed with status ${error.response.status}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. Please try again.";
    }
  }
  return `Error: Unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
}
```

## Shared Utilities

Extract common functionality into reusable functions:

```typescript
async function makeApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  data?: any,
  params?: any
): Promise<T> {
  const response = await axios({
    method,
    url: `${API_BASE_URL}/${endpoint}`,
    data, params,
    timeout: 30000,
    headers: { "Content-Type": "application/json", "Accept": "application/json" }
  });
  return response.data;
}
```

## TypeScript Best Practices

1. **Use Strict TypeScript**: Enable strict mode in tsconfig.json
2. **Define Interfaces**: Create clear interface definitions for all data structures
3. **Avoid `any`**: Use proper types or `unknown` instead of `any`
4. **Zod for Runtime Validation**: Use Zod schemas to validate external data
5. **Type Guards**: Create type guard functions for complex type checking
6. **Error Handling**: Always use try-catch with proper error type checking
7. **Null Safety**: Use optional chaining (`?.`) and nullish coalescing (`??`)

```typescript
interface UserResponse {
  id: string;
  name: string;
  email: string;
  team?: string;
  active: boolean;
}

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  team: z.string().optional(),
  active: z.boolean()
});

type User = z.infer<typeof UserSchema>;

async function getUser(id: string): Promise<User> {
  const data = await apiCall(`/users/${id}`);
  return UserSchema.parse(data);  // Runtime validation
}
```

## Code Composability

Your implementation MUST prioritize composability and code reuse:

1. **Extract Common Functionality**: Create reusable helpers for operations used across multiple tools. Build shared API clients. Centralize error handling logic.
2. **Avoid Duplication**: NEVER copy-paste similar code between tools. If similar logic appears twice, extract it into a function. Common operations like pagination, filtering, and formatting should be shared.

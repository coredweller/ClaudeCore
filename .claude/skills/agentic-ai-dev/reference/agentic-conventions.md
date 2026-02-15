# Agentic AI Conventions & Rules

## Package Layout

```
src/<service_name>/
├── agents/
│   ├── graphs/          # StateGraph definitions (build_*_agent functions)
│   ├── nodes/           # Node functions (verb_node pattern)
│   ├── tools/           # @tool definitions
│   └── state.py         # TypedDict state schemas
├── rag/
│   ├── chains/          # RAG chain compositions
│   ├── indexing/        # Document loaders, splitters, indexing
│   └── retrieval/       # Retrievers, rerankers
├── memory/
│   ├── checkpointing.py # PostgresSaver setup
│   └── semantic.py      # Vector store long-term memory
├── guardrails/
│   ├── input.py         # Input validation pipeline
│   └── output.py        # Output validation pipeline
├── llm/
│   └── providers.py     # LLM factory, multi-provider router
├── core/
│   ├── config.py        # pydantic-settings configuration
│   ├── logging.py       # structlog setup
│   └── exceptions.py    # Exception hierarchy
├── observability/
│   ├── metrics.py       # Prometheus metrics
│   └── tracing.py       # LangSmith tracing setup
├── models/
│   └── schemas.py       # Pydantic request/response models
├── api/
│   ├── routes/
│   │   ├── agent.py     # POST /invoke, POST /stream
│   │   └── health.py    # GET /health
│   └── middleware/
│       └── request_context.py  # Correlation ID via contextvars
├── main.py              # FastAPI app with lifespan
└── py.typed             # PEP 561 marker
```

## LangGraph Rules

1. **Always use `TypedDict` for state** — never `dict[str, Any]`
2. **Always use `Annotated[list[BaseMessage], add_messages]`** for message lists — enables proper message merging
3. **Always include `iteration_count: int`** in state — check in routing function to prevent infinite loops
4. **Prefer `Command(goto=...)` pattern** for routing between nodes — cleaner than conditional edges for complex flows
5. **Always set `recursion_limit`** in config (default: 25) — safety net for runaway graphs
6. **Use `PostgresSaver` in production** — `MemorySaver` is for tests only; it's not persistent
7. **Always pass `thread_id` in config** — `{"configurable": {"thread_id": "..."}}`; required for checkpointing

## FastAPI Integration Rules

1. **All endpoints are `async def`** — never block the event loop
2. **Use `Depends()` for agent graph injection** — configure in lifespan, inject via dependency
3. **Use `StreamingResponse` with `text/event-stream`** — for streaming agent responses
4. **Include `/api/v1/health`** — ping LLM providers, DB, vector store
5. **Propagate `thread_id`** from request to graph config — enables conversation continuity

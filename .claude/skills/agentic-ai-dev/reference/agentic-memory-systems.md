# Agentic AI Memory Systems

7-layer memory hierarchy for AI agents. Layers 1-3 are practical and should be implemented in most production agents. Layers 4-7 are advanced research patterns.

## Memory Layer Overview

| Layer | Name | Persistence | Implementation | Priority |
|-------|------|-------------|----------------|----------|
| 1 | Short-term (Checkpointing) | Per-thread | LangGraph `PostgresSaver` | P0 |
| 2 | Long-term Semantic | Cross-thread | Vector store (pgvector/Chroma/Pinecone) | P1 |
| 3 | Episodic | Cross-session | Timestamped event log + vector search | P1 |
| 4 | Temporal Graph | Cross-session | Neo4j with temporal properties | P2 |
| 5 | Procedural | Cross-session | Learned tool usage patterns | P2 |
| 6 | Emotional | Per-user | Sentiment tracking over time | P3 |
| 7 | Reflective | Cross-session | Self-evaluation summaries | P3 |

## Layer 1: Short-term Memory (Checkpointing)

LangGraph checkpointing provides automatic conversation persistence per thread.

**File:** `src/<service>/memory/checkpointing.py`

```python
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from ..core.config import settings
from ..core.logging import get_logger

logger = get_logger(__name__)


async def create_checkpointer(*, use_memory: bool = False):
    """Create a checkpointer for LangGraph state persistence.

    Args:
        use_memory: If True, use in-memory checkpointer (testing only).

    Returns:
        Configured checkpointer instance.
    """
    if use_memory:
        logger.info("using_memory_checkpointer", warning="FOR TESTING ONLY")
        return MemorySaver()

    checkpointer = AsyncPostgresSaver.from_conn_string(settings.checkpoint_db_uri)
    await checkpointer.setup()
    logger.info("postgres_checkpointer_ready")
    return checkpointer
```

### Usage in Graph

```python
# Build graph with checkpointer
graph = build_react_agent(provider_factory, checkpointer=checkpointer)

# Invoke with thread_id — state persists across calls
config = {"configurable": {"thread_id": "user-123-conv-456"}}

# First turn
result1 = await graph.ainvoke({"messages": [HumanMessage(content="Hello")]}, config=config)

# Second turn — agent remembers the first turn
result2 = await graph.ainvoke({"messages": [HumanMessage(content="What did I just say?")]}, config=config)
```

## Layer 2: Long-term Semantic Memory

Vector store for cross-thread knowledge that persists beyond individual conversations.

**File:** `src/<service>/memory/semantic.py`

```python
from __future__ import annotations

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore

from ..core.logging import get_logger

logger = get_logger(__name__)


class SemanticMemory:
    """Long-term semantic memory using vector store.

    Stores and retrieves knowledge that should persist across conversations:
    - User preferences
    - Learned facts
    - Important decisions
    - Domain-specific knowledge
    """

    def __init__(self, vector_store: VectorStore, embeddings: Embeddings) -> None:
        self._store = vector_store
        self._embeddings = embeddings

    async def remember(self, content: str, metadata: dict | None = None) -> str:
        """Store a memory in the vector store.

        Args:
            content: The text to remember.
            metadata: Additional metadata (user_id, category, timestamp).

        Returns:
            Document ID.
        """
        doc = Document(page_content=content, metadata=metadata or {})
        ids = await self._store.aadd_documents([doc])
        logger.info("memory_stored", doc_id=ids[0], content_length=len(content))
        return ids[0]

    async def recall(self, query: str, k: int = 5, filter_metadata: dict | None = None) -> list[Document]:
        """Retrieve relevant memories.

        Args:
            query: Search query.
            k: Number of results to return.
            filter_metadata: Metadata filter (e.g., {"user_id": "123"}).

        Returns:
            List of relevant memory documents.
        """
        if filter_metadata:
            docs = await self._store.asimilarity_search(query, k=k, filter=filter_metadata)
        else:
            docs = await self._store.asimilarity_search(query, k=k)

        logger.info("memory_recalled", query=query[:100], result_count=len(docs))
        return docs

    async def forget(self, doc_id: str) -> None:
        """Remove a specific memory."""
        await self._store.adelete([doc_id])
        logger.info("memory_forgotten", doc_id=doc_id)
```

### Integration with Agent

```python
async def agent_node_with_memory(state: AgentState) -> dict:
    """Agent node that consults long-term memory."""
    query = state["messages"][-1].content

    # Recall relevant memories
    memories = await semantic_memory.recall(query, k=3, filter_metadata={"user_id": state.get("user_id")})
    memory_context = "\n".join(f"- {m.page_content}" for m in memories)

    # Include memories in prompt
    messages = [
        SystemMessage(content=f"Relevant memories:\n{memory_context}"),
        *state["messages"],
    ]

    response = await llm.ainvoke(messages)

    # Optionally store important information from this conversation
    if should_remember(response.content):
        await semantic_memory.remember(response.content, metadata={"user_id": state.get("user_id")})

    return {"messages": [response], "iteration_count": state["iteration_count"] + 1}
```

## Layer 3: Episodic Memory

Temporal event log for recalling past interactions with time context.

```python
from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass


@dataclass
class Episode:
    """A single episode in the agent's memory."""

    timestamp: datetime
    user_id: str
    action: str
    outcome: str
    metadata: dict


class EpisodicMemory:
    """Time-aware memory for recalling past interactions.

    Stores episodes with timestamps, enabling queries like:
    - "What did we discuss last Tuesday?"
    - "What actions have I taken on this project?"
    """

    def __init__(self, vector_store, embeddings):
        self._store = vector_store
        self._embeddings = embeddings

    async def record_episode(self, user_id: str, action: str, outcome: str, metadata: dict | None = None) -> str:
        """Record a new episode."""
        episode = Episode(
            timestamp=datetime.now(timezone.utc),
            user_id=user_id,
            action=action,
            outcome=outcome,
            metadata=metadata or {},
        )
        content = f"[{episode.timestamp.isoformat()}] Action: {action} | Outcome: {outcome}"
        doc = Document(
            page_content=content,
            metadata={
                "user_id": user_id,
                "timestamp": episode.timestamp.isoformat(),
                "action": action,
                **(metadata or {}),
            },
        )
        ids = await self._store.aadd_documents([doc])
        return ids[0]

    async def recall_episodes(
        self,
        query: str,
        user_id: str,
        k: int = 5,
        time_range: tuple[datetime, datetime] | None = None,
    ) -> list[Document]:
        """Recall episodes matching a query, optionally filtered by time range."""
        filter_meta = {"user_id": user_id}
        docs = await self._store.asimilarity_search(query, k=k, filter=filter_meta)

        if time_range:
            start, end = time_range
            docs = [
                d for d in docs
                if start.isoformat() <= d.metadata.get("timestamp", "") <= end.isoformat()
            ]

        return docs
```

## Memory Trimming and Summarization

When conversation history grows too long, trim and summarize to stay within token budgets.

```python
from langchain_core.messages import BaseMessage, SystemMessage, trim_messages


def trim_conversation(messages: list[BaseMessage], max_tokens: int = 4000) -> list[BaseMessage]:
    """Trim conversation history to fit within token budget.

    Strategy: Keep system message + last N messages that fit.
    """
    return trim_messages(
        messages,
        max_tokens=max_tokens,
        strategy="last",
        token_counter=len,  # Replace with actual tokenizer
        include_system=True,
        allow_partial=False,
    )


async def summarize_conversation(messages: list[BaseMessage], llm) -> str:
    """Summarize a long conversation into a concise context block."""
    summary = await llm.ainvoke([
        SystemMessage(content="Summarize this conversation concisely. Include key decisions, facts, and user preferences."),
        *messages,
    ])
    return summary.content


async def trim_or_summarize(
    messages: list[BaseMessage],
    llm,
    max_tokens: int = 4000,
    summarize_threshold: int = 8000,
) -> list[BaseMessage]:
    """If messages exceed threshold, summarize old ones; otherwise trim."""
    # Rough token estimate
    total_chars = sum(len(m.content) for m in messages if hasattr(m, 'content'))
    estimated_tokens = total_chars // 4

    if estimated_tokens <= max_tokens:
        return messages

    if estimated_tokens > summarize_threshold:
        # Summarize older messages, keep recent
        split = len(messages) // 2
        summary = await summarize_conversation(messages[:split], llm)
        return [SystemMessage(content=f"Previous conversation summary:\n{summary}"), *messages[split:]]

    return trim_conversation(messages, max_tokens)
```

## Advanced Layers (4-7) — Research Patterns

### Layer 4: Temporal Graph Memory

```python
# Concept: Store entities and relationships with temporal properties in Neo4j
# Use case: "What was the project status two weeks ago?"
# Implementation: Neo4j + temporal queries on relationship timestamps
```

### Layer 5: Procedural Memory

```python
# Concept: Learn and remember successful tool usage patterns
# Use case: "Last time I searched for X, using filters A and B worked best"
# Implementation: Store (query, tool_sequence, success_score) tuples, retrieve similar patterns
```

### Layer 6: Emotional Memory

```python
# Concept: Track user sentiment and adjust tone
# Use case: Detect frustration and proactively simplify responses
# Implementation: Sentiment analysis on user messages, store trend per user
```

### Layer 7: Reflective Memory

```python
# Concept: Agent evaluates its own performance and stores lessons
# Use case: "My response to similar queries was rated poorly; adjust approach"
# Implementation: Post-interaction self-evaluation, store as procedural improvements
```

## Memory Selection Guide

| Use Case | Recommended Layers | Complexity |
|----------|-------------------|------------|
| Simple chatbot | 1 (Checkpointing) | Low |
| Customer support | 1 + 2 (Semantic) | Medium |
| Personal assistant | 1 + 2 + 3 (Episodic) | Medium |
| Enterprise knowledge | 1 + 2 + 4 (Graph) | High |
| Learning agent | 1 + 2 + 5 (Procedural) | High |

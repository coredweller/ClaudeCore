# MCP Server Evaluation -- Criteria and Question Design

## Overview

This document provides guidance on creating comprehensive evaluations for MCP servers. Evaluations test whether LLMs can effectively use your MCP server to answer realistic, complex questions using only the tools provided.

### Evaluation Requirements
- Create 10 human-readable questions
- Questions must be READ-ONLY, INDEPENDENT, NON-DESTRUCTIVE
- Each question requires multiple tool calls (potentially dozens)
- Answers must be single, verifiable values
- Answers must be STABLE (won't change over time)

### Output Format
```xml
<evaluation>
   <qa_pair>
      <question>Your question here</question>
      <answer>Single verifiable answer</answer>
   </qa_pair>
</evaluation>
```

---

## Purpose of Evaluations

The measure of quality of an MCP server is NOT how well or comprehensively the server implements tools, but how well these implementations (input/output schemas, docstrings/descriptions, functionality) enable LLMs with no other context and access ONLY to the MCP servers to answer realistic and difficult questions.

## Question Guidelines

### Core Requirements

1. **Questions MUST be independent** -- should NOT depend on answers to other questions
2. **Questions MUST require ONLY NON-DESTRUCTIVE AND IDEMPOTENT tool use**
3. **Questions must be REALISTIC, CLEAR, CONCISE, and COMPLEX** -- require multiple tools or steps

### Complexity and Depth

4. **Require deep exploration** -- multi-hop questions requiring sequential tool calls
5. **May require extensive paging** -- querying old data (1-2 years) to find niche information
6. **Require deep understanding** -- may use True/False or multiple-choice formats requiring evidence
7. **Must not be solvable with straightforward keyword search** -- use synonyms, related concepts, or paraphrases

### Tool Testing

8. **Stress-test tool return values** -- large JSON objects, multiple data modalities (IDs, timestamps, URLs, file names)
9. **Reflect real human use cases** -- information retrieval tasks humans would care about
10. **May require dozens of tool calls** -- challenges LLMs with limited context
11. **Include ambiguous questions** -- force difficult decisions while still having a single verifiable answer

### Stability

12. **Answers MUST NOT CHANGE** -- avoid dynamic state (reaction counts, member counts, open issue counts)
13. **DO NOT let the MCP server RESTRICT the kinds of questions** -- create challenging questions even if some may not be solvable

## Answer Guidelines

### Verification
- Answers must be VERIFIABLE via direct string comparison
- Specify output format in the question: "Use YYYY/MM/DD.", "Respond True or False."
- Answer should be a single value: user ID, channel name, timestamp, boolean, email, URL, numerical quantity, multiple choice

### Readability
- Prefer HUMAN-READABLE formats (names, dates, URLs) over opaque IDs
- The vast majority of answers should be human-readable

### Stability
- Base questions on "closed" concepts (ended conversations, completed projects, launched features)
- Use fixed time windows to insulate from non-stationary answers

### Diversity
- Answers should span diverse modalities: user names, channel IDs, message strings, timestamps, emails, booleans
- Answers must NOT be complex structures (lists, objects) unless straightforwardly verifiable by string comparison

## Evaluation Process

### Step 1: Documentation Inspection
Read the target API documentation. Parallelize as much as possible.

### Step 2: Tool Inspection
List available MCP server tools. Understand schemas, descriptions. Do NOT call tools yet.

### Step 3: Developing Understanding
Iterate steps 1-2. Do NOT read the MCP server implementation code itself.

### Step 4: Read-Only Content Inspection
USE the MCP server tools with READ-ONLY operations to identify specific content for realistic questions. Make INCREMENTAL, SMALL, TARGETED tool calls. Use `limit` parameter (<10). Use pagination.

### Step 5: Task Generation
Create 10 human-readable questions following all guidelines above.

## Evaluation Examples

### Good Questions

**Multi-hop (GitHub MCP):**
```xml
<qa_pair>
   <question>Find the repository archived in Q3 2023 that had previously been the most forked in the org. What was the primary programming language?</question>
   <answer>Python</answer>
</qa_pair>
```
Good: requires multiple searches, examining details, stable historical data.

**Context without keyword matching (Project Management MCP):**
```xml
<qa_pair>
   <question>Locate the initiative focused on improving customer onboarding completed in late 2023. The project lead created a retrospective. What was the lead's role title?</question>
   <answer>Product Manager</answer>
</qa_pair>
```
Good: no specific project name, requires finding and cross-referencing data.

**Complex aggregation (Issue Tracker MCP):**
```xml
<qa_pair>
   <question>Among critical bugs reported in January 2024, which assignee resolved the highest percentage within 48 hours? Provide their username.</question>
   <answer>alex_eng</answer>
</qa_pair>
```
Good: filtering, grouping, calculating rates, understanding timestamps.

### Poor Questions

- **Answer changes over time**: "How many open issues?" -- dynamic state
- **Too easy**: Searching for an exact title -- straightforward keyword search
- **Ambiguous answer format**: "List all repositories with Python" -- list ordering varies

## Verification Process

After creating evaluations:
1. Examine the XML file
2. Load each task and solve it yourself using the MCP server tools (in parallel)
3. Flag any operations requiring WRITE or DESTRUCTIVE operations
4. Replace incorrect answers
5. Remove any qa_pairs requiring destructive operations

## Tips

1. Think hard and plan ahead before generating tasks
2. Parallelize where opportunity arises
3. Focus on realistic use cases
4. Create challenging questions that test limits
5. Ensure stability by using historical data
6. Verify answers by solving questions yourself
7. Iterate and refine

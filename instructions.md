---
title: AI Instructions
tags:
  - meta
  - instructions
  - ai
aliases:
  - Instructions
  - AI Guidelines
---

# AI Instructions — MDC Project

These rules apply to every prompt and response in this project.

---

## 1. Plan Before Implementing

- Before writing any code, read relevant docs from [[docs/_index_]] first
- Verify understanding by referencing the specific doc and section
- Propose a plan before executing — get confirmation
- For complex changes, check [[implementation-blueprint]] and [[system-design]] first

## 2. Use Obsidian Documentation

- All project docs live in `docs/` — use [[wiki links]] to reference them
- Before making changes, check [[prd]] for requirements and [[definition-of-done]] for quality gates
- When updating code, keep docs in sync — update the relevant markdown file
- Use the graph in Obsidian to find related docs before starting work

## 3. Formatting & Quality Standards

- Proper spacing: single blank line between sections, no trailing whitespace
- Clean alignment: vertical align table columns, code blocks, and lists
- No typos or grammatical errors — proofread before responding
- Use consistent naming conventions matching the existing codebase
- No debug logs (`console.log`, commented code) in production code
- TypeScript strict mode — no `any` without justification

## 4. Senior-Level Engineering Mindset

- Think about edge cases, failure modes, and security implications first
- Design for maintainability — not just "make it work"
- Prefer simple, readable solutions over clever ones
- Consider RBAC, RLS, audit trails, and data integrity at every step
- Performance matters — server-side pagination, indexed queries, debounced inputs
- Every mutation must write an audit log entry
- Pagination must be consistent across all pages: centered Prev/Next buttons with ChevronLeft/ChevronRight icons, "Page X of Y" counter, disabled state at 0.4 opacity, borderTop on the container, and sticky table headers (position: sticky, top: 0, zIndex: 1)

## 5. Security Is Non-Negotiable

- Never expose service role keys, API secrets, or tokens in client code
- All file uploads via signed URLs with MIME + size validation
- RLS enforced on every database table — no exceptions
- Serial corrections require `dc_admin` role + mandatory reason + immutable audit trail
- No SQL injection — use parameterized queries via Supabase client
- Rate limiting on import and analytics endpoints

## 6. Response Format

- Start with which docs were consulted (e.g. "Checked [[prd]] §5 and [[system-design]] §3")
- Present the plan first, then implement
- End with verification steps (typecheck, build, test)
- Use markdown throughout — the output is rendered in Obsidian too

---

**Related:** [[docs/_index_]], [[prd]], [[definition-of-done]], [[system-design]]

# 00 Agent Operating Model

## Purpose

This document defines the default operating model for agents working in AIDN.

The goal is to keep changes small, verifiable, and aligned with executable architecture instead of relying on assumptions.

## Before Changing Files

- read the smallest relevant set of files for the task
- identify every surface that can be affected: code, CLI, policies, contracts, fixtures, docs, ADR, and CI
- verify the current behavior in code, policy, schema, or test output before editing
- prefer the smallest reversible change that addresses the task
- record any uncertain assumption before using it as a basis for a change

## During Implementation

- keep edits focused on the task category you identified
- update code, docs, policies, contracts, and fixtures together when a public surface changes
- prefer explicit behavior over implicit behavior
- do not expand scope just because adjacent files are easy to touch

## When Uncertain

- stop and inspect the relevant policy, schema, or gate instead of guessing
- document what is uncertain and why it matters
- prefer a follow-up change over inventing behavior that is not yet verified
- if the evidence is incomplete, treat the task as unfinished

## Reporting Format

When you report back, include:

- what changed
- what was verified
- what remains uncertain or skipped
- which gates passed or failed
- whether an ADR update is required

Do not mark the task done until the evidence is sufficient.

import { describe, expect, it } from 'vitest';
import { assertTransition } from './workflow-engine.service';

// Phase 22 Section 26: formal decision (Option C) on the three
// declared-but-unreachable transitions Phase 20 found. This test encodes
// the decision itself, not just current behavior — if it starts failing,
// either the reserved transitions were silently wired to a real endpoint
// (update this test and the doc comment on VALID_TRANSITIONS to match) or
// someone accidentally narrowed the table (a real regression).
describe('WorkflowInstance state machine — reserved transitions (Phase 22 decision)', () => {
  it('keeps RETRYING structurally valid at the instance level, even though no live code path sets it', () => {
    expect(() => { assertTransition('FAILED', 'RETRYING'); }).not.toThrow();
    expect(() => { assertTransition('RETRYING', 'RUNNING'); }).not.toThrow();
    expect(() => { assertTransition('RETRYING', 'FAILED'); }).not.toThrow();
  });

  it('keeps PENDING->CANCELLED structurally valid, even though no cancel-a-pending-run endpoint exists', () => {
    expect(() => { assertTransition('PENDING', 'CANCELLED'); }).not.toThrow();
  });

  it('keeps FAILED->CANCELLED structurally valid, even though no cancel-a-failed-run endpoint exists', () => {
    expect(() => { assertTransition('FAILED', 'CANCELLED'); }).not.toThrow();
  });

  it('AWAITING_APPROVAL->CANCELLED remains the one reachable CANCELLED path (via rejectInstance)', () => {
    expect(() => { assertTransition('AWAITING_APPROVAL', 'CANCELLED'); }).not.toThrow();
  });
});

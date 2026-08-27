import { describe, expect, it } from 'vitest';
import { assertTransition } from './workflow-engine.service';
import { AppError } from '../../common/errors/app-error';

// Phase 15 Section 13: "Do not allow arbitrary state transitions."
describe('WorkflowInstance state machine (assertTransition)', () => {
  it('allows the full happy path: PENDING -> RUNNING -> COMPLETED', () => {
    expect(() => { assertTransition('PENDING', 'RUNNING'); }).not.toThrow();
    expect(() => { assertTransition('RUNNING', 'COMPLETED'); }).not.toThrow();
  });

  it('allows RUNNING -> FAILED -> RETRYING -> RUNNING (the documented recovery path)', () => {
    expect(() => { assertTransition('RUNNING', 'FAILED'); }).not.toThrow();
    expect(() => { assertTransition('FAILED', 'RETRYING'); }).not.toThrow();
    expect(() => { assertTransition('RETRYING', 'RUNNING'); }).not.toThrow();
  });

  it('allows RUNNING -> AWAITING_APPROVAL -> RUNNING (the human-in-the-loop gate)', () => {
    expect(() => { assertTransition('RUNNING', 'AWAITING_APPROVAL'); }).not.toThrow();
    expect(() => { assertTransition('AWAITING_APPROVAL', 'RUNNING'); }).not.toThrow();
  });

  it('rejects a terminal COMPLETED instance from transitioning anywhere', () => {
    expect(() => { assertTransition('COMPLETED', 'RUNNING'); }).toThrow(AppError);
    expect(() => { assertTransition('COMPLETED', 'FAILED'); }).toThrow(AppError);
  });

  it('rejects a terminal CANCELLED instance from transitioning anywhere', () => {
    expect(() => { assertTransition('CANCELLED', 'RUNNING'); }).toThrow(AppError);
  });

  it('rejects skipping straight from PENDING to COMPLETED', () => {
    expect(() => { assertTransition('PENDING', 'COMPLETED'); }).toThrow(AppError);
  });

  it('rejects FAILED transitioning directly back to RUNNING without going through RETRYING', () => {
    expect(() => { assertTransition('FAILED', 'RUNNING'); }).toThrow(AppError);
  });

  it('allows a no-op transition (same state to itself) — used between sequential steps', () => {
    expect(() => { assertTransition('RUNNING', 'RUNNING'); }).not.toThrow();
  });

  it('rejects AWAITING_APPROVAL transitioning directly to COMPLETED, skipping the resume step', () => {
    expect(() => { assertTransition('AWAITING_APPROVAL', 'COMPLETED'); }).toThrow(AppError);
  });
});

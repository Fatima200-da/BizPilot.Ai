/**
 * The contract every workflow step handler implements. A handler receives
 * the accumulated context (WorkflowInstance.input plus every prior step's
 * output, keyed by stepKey) and returns its own output, which is merged in
 * for the next step. Handlers are pure with respect to the engine — they
 * never touch WorkflowInstance/WorkflowStepRun rows directly, so the engine
 * remains the single place that enforces the state machine (Phase 15
 * Section 13) and idempotency (Section 14).
 */
export interface StepContext {
  workspaceId: string;
  workflowInstanceId: string;
  businessProfileId: string | null;
  triggeredByUserId: string | null;
  /** WorkflowInstance.input merged with every completed step's output so far, keyed by stepKey. */
  accumulated: Record<string, unknown>;
}

export interface StepResult {
  output: unknown;
  /** True if this step's completion should pause the workflow for human approval (Phase 15 Section 13). */
  requiresApproval?: boolean;
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

export interface StepDefinition {
  key: string;
  order: number;
  handler: StepHandler;
}

const REGISTRY = new Map<string, StepDefinition[]>();

export function registerWorkflowSteps(definitionKey: string, steps: StepDefinition[]): void {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  REGISTRY.set(definitionKey, sorted);
}

export function getWorkflowSteps(definitionKey: string): StepDefinition[] {
  const steps = REGISTRY.get(definitionKey);
  if (!steps) {
    throw new Error(`No step handlers registered for workflow definition "${definitionKey}"`);
  }
  return steps;
}

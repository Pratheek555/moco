// Typed engine errors. `code` is stable for the UI; `message` is for humans.
export type EngineErrorCode =
  | "invalid_id" // an id that would be unsafe as a folder name
  | "not_found"
  | "busy" // a job is already running for this series
  | "stage_blocked" // upstream stages are not complete
  | "not_awaiting_approval"
  | "gate_mismatch" // approve() hash differs from the current artifact
  | "modified_externally" // a project file changed outside the engine
  | "validation_failed" // AI could not produce valid output within the attempt cap
  | "cap_reached" // max AI calls per episode reached
  | "rate_limited" // the user's AI plan limit was hit
  | "ai_unavailable"
  | "cancelled";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EngineError";
  }
}

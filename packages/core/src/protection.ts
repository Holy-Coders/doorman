/** Shared database state. Leases bound admitted work, not a provider's billing. */
export type EvaluationLease = {
  id: string;
  expiresAt: number;
  epoch: number;
  probe: boolean;
  cost?: number;
};
export type EvaluationControl = {
  version: number;
  windowStart: number;
  used: number;
  failures: number;
  openUntil: number;
  epoch: number;
  leases: EvaluationLease[];
};
export interface ProtectionStorage {
  consumeQuota(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<boolean>;
  getControl(key: string): Promise<EvaluationControl | undefined>;
  compareControl(
    key: string,
    expectedVersion: number,
    next: EvaluationControl,
    expiresAt: number,
  ): Promise<boolean>;
  cleanupProtection(now: number, limit: number): Promise<void>;
}

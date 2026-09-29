export type WebCheckStep = {
  action:
    | "fill"
    | "click"
    | "press"
    | "expect_text"
    | "expect_value"
    | "expect_visible";
  selector: string;
  value?: string;
};

export interface WebVerification {
  id: string;
  workContextId: string;
  runId: string;
  path: string;
  checkedAt: string;
  status: "passed" | "failed";
  assertions: number;
  steps: Array<
    WebCheckStep & { status: "passed" | "failed" | "skipped"; error?: string }
  >;
  errors: string[];
  files: Record<string, string>;
  stale?: boolean;
}

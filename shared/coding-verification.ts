export type WebCheckStep =
  | { action: "reload"; selector?: never; value?: never; property?: never }
  | {
      action: "expect_checked";
      selector: string;
      value?: "true" | "false";
      property?: never;
    }
  | {
      action: "expect_style";
      selector: string;
      property: string;
      value: string;
    }
  | {
      action:
        | "fill"
        | "click"
        | "press"
        | "expect_text"
        | "expect_value"
        | "expect_visible"
        | "expect_hidden";
      selector: string;
      value?: string;
      property?: never;
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

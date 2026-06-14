export type ChecklistItem = {
  id: string;
  label: string;
  p0?: boolean;
};

export type ChecklistGate = {
  id: string;
  title: string;
  p0?: boolean;
  items: ChecklistItem[];
};

export const checklistGates: ChecklistGate[] = [
  {
    id: "gate0",
    title: "Gate 0 - Scope and Org Isolation",
    p0: true,
    items: [
      { id: "g0_infra_isolated", label: "MDC-only infrastructure is isolated", p0: true },
      { id: "g0_tenant_boundary", label: "No IDS cross-tenant path exists", p0: true },
      { id: "g0_data_classification", label: "Data classification is documented" },
      { id: "g0_secrets_public_only", label: "No private secrets exposed in VITE env", p0: true },
      { id: "g0_role_model", label: "Roles locked: dc_admin, dc_operator, dc_viewer", p0: true },
    ],
  },
  {
    id: "gate1",
    title: "Gate 1 - Discovery and Requirements",
    items: [
      { id: "g1_problem_outcomes", label: "Problem statement and outcomes are approved" },
      { id: "g1_scope_lock", label: "In-scope and out-of-scope are approved" },
      { id: "g1_user_flows", label: "User flows mapped for core operations" },
      { id: "g1_edge_cases", label: "Edge cases documented" },
      { id: "g1_slo_metrics", label: "SLO targets and success metrics defined" },
    ],
  },
  {
    id: "gate2",
    title: "Gate 2 - Architecture and Design",
    items: [
      { id: "g2_arch_diagram", label: "Architecture diagram is current" },
      { id: "g2_domain_model", label: "Domain model reviewed" },
      { id: "g2_api_contract", label: "API contracts and error model defined" },
      { id: "g2_adr", label: "ADRs created for major decisions" },
      { id: "g2_perf_plan", label: "Performance strategy defined" },
    ],
  },
  {
    id: "gate3",
    title: "Gate 3 - Security and Compliance",
    p0: true,
    items: [
      { id: "g3_rls_all_tables", label: "RLS enabled on all inventory tables", p0: true },
      { id: "g3_role_tests", label: "Role access tests are passing", p0: true },
      { id: "g3_upload_validation", label: "Upload file validation and signed URL rules are enforced", p0: true },
      { id: "g3_immutable_audit", label: "Immutable audit log validated", p0: true },
      { id: "g3_correction_trace", label: "Correction requires reason and actor traceability", p0: true },
    ],
  },
  {
    id: "gate4",
    title: "Gate 4 - Delivery and Build Quality",
    items: [
      { id: "g4_backlog_refined", label: "Backlog has clear acceptance criteria" },
      { id: "g4_migration_rollback", label: "Migration plan includes rollback" },
      { id: "g4_static_checks", label: "Typecheck/lint/build are green" },
      { id: "g4_tests", label: "Unit and integration tests cover changed logic" },
      { id: "g4_observability", label: "Observability added to critical flows" },
    ],
  },
  {
    id: "gate5",
    title: "Gate 5 - Verification and UAT",
    items: [
      { id: "g5_test_plan", label: "Test plan includes positive/negative/edge cases" },
      { id: "g5_data_validation", label: "Data correctness validated for imports/exports/analytics" },
      { id: "g5_uat_executed", label: "UAT scripts executed by DC users" },
      { id: "g5_uat_signoff", label: "UAT sign-off captured" },
    ],
  },
  {
    id: "gate6",
    title: "Gate 6 - Release and Post-Deploy",
    p0: true,
    items: [
      { id: "g6_release_notes", label: "Release notes prepared" },
      { id: "g6_rollback_validated", label: "Rollback runbook validated", p0: true },
      { id: "g6_backup_restore", label: "Backup and restore check completed", p0: true },
      { id: "g6_prod_smoke", label: "Production smoke tests passed", p0: true },
      { id: "g6_hypercare_owner", label: "Hypercare owner assigned" },
    ],
  },
];

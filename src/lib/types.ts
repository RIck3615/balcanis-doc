export type AppRole = "CHF" | "GBR" | "COL" | "TRT" | "CTL" | "ADM";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  agent_code: string | null;
  roles: AppRole[];
  office_code: string | null;
  certified_programs: string[];
  hourly_rate: number | null;
  timezone: string;
  active: boolean;
  available: boolean;
  must_change_password: boolean;
  avatar_path: string | null;
  email_pref?: "tous" | "quotidien" | "aucun";
}

export interface AgentPayment {
  agent_id: string;
  method: string;
  frequency: string;
  details: string;
  pending: boolean;
  updated_at: string;
}

export interface StaffEntry {
  id: string;
  full_name: string;
  agent_code: string | null;
  roles: AppRole[];
  office_code: string | null;
  certified_programs: string[];
  active: boolean;
  available: boolean;
  avatar_path: string | null;
}

export interface Program {
  code: string;
  family: string;
  name: string;
  authority: string;
  opened_on: string | null;
  closed_on: string | null;
}

export interface Client {
  id: string;
  client_code: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  country_iso: string | null;
  office_code: string;
}

export interface Dossier {
  id: string;
  number: string;
  base_number: string;
  office_code: string;
  program_code: string;
  client_id: string;
  status: number;
  status_changed_at: string;
  collector_id: string | null;
  processor_id: string | null;
  controller_id: string | null;
  opened_at: string;
  return_count: number;
  submission_number: string | null;
  submitted_at: string | null;
  decision: string | null;
  closed_at: string | null;
}

export interface DossierWithClient extends Dossier {
  clients: Pick<Client, "client_code" | "first_name" | "last_name"> | null;
}

export interface Member {
  id: string;
  dossier_id: string;
  person_code: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  accompanying: boolean;
}

export interface DocumentRow {
  id: string;
  dossier_id: string;
  person_code: string;
  category_code: string;
  type_code: string;
  version: number;
  file_name: string;
  storage_path: string;
  is_current: boolean;
  validation_status: string;
  uploaded_by: string | null;
  uploaded_at: string;
  expires_on: string | null;
}

export interface DocumentType {
  code: string;
  label: string;
  category_code: string;
  form_number?: string | null;
  official_url?: string | null;
  expiry_required?: boolean;
}

export interface ExpiringDocument {
  document_id: string;
  dossier_id: string;
  dossier_number: string;
  dossier_status: number;
  office_code: string;
  person_code: string;
  person_name: string;
  type_code: string;
  type_label: string;
  file_name: string;
  expires_on: string;
  days_left: number;
  collector_id: string | null;
  processor_id: string | null;
}

export interface DossierForm {
  person_code: string;
  type_code: string;
  form_number: string;
  label: string;
  official_url: string | null;
  document_id: string | null;
  file_name: string | null;
  version: number | null;
  uploaded_at: string | null;
}

export interface DocumentCategory {
  code: string;
  folder: string;
  label: string;
}

export interface ChecklistItem {
  id: number;
  level: "auto" | "controle";
  program_code: string | null;
  label: string;
  sort: number;
}

export interface Review {
  id: string;
  level: string;
  reviewer_id: string;
  result: "accepte" | "renvoye";
  return_code: string | null;
  reason_codes: string[];
  comment: string | null;
  created_at: string;
}

export interface TimeSession {
  id: string;
  dossier_id: string;
  agent_id: string;
  status_at_start: number;
  billable: boolean;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  corrected: boolean;
  validated: boolean;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_code: string | null;
  action: string;
  object_type: string;
  reason: string | null;
}

export interface StatusTransition {
  from_status: number;
  to_status: number;
  roles: AppRole[];
  reason_required: boolean;
}

export interface NotificationRow {
  id: number;
  dossier_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface AuthorityRequest {
  id: string;
  dossier_id: string;
  kind: string;
  title: string;
  details: string | null;
  received_on: string;
  due_on: string;
  assignee_role: "COL" | "TRT";
  status: "a_faire" | "prete" | "repondue" | "annulee";
  ready_note: string | null;
  ready_at: string | null;
  sent_on: string | null;
  cancel_reason: string | null;
  created_at: string;
}

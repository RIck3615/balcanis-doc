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
  email: string;
  agent_code: string | null;
  roles: AppRole[];
  office_code: string | null;
  certified_programs: string[];
  active: boolean;
  available: boolean;
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

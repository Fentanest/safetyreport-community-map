export function planUpdate(fact: {
  contributor_id: string;
  dataset_key: string;
  source_report_key: string;
  source_agency_code: string | null;
  agency_name: string | null;
  agency_current_name: string | null;
  agency_key: string | null;
  manager_name: string | null;
  manager_key: string | null;
  agency_registry_version: string | null;
}): Promise<{
  next: { agency_key: string | null; agency_current_name: string | null; manager_key: string | null };
  changed: boolean;
  reason: string;
  version: string;
}>;

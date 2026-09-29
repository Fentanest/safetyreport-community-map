/**
 * 경찰 구분 for the agency/manager table (R09). Conservative on purpose: an agency is 'police' only when its
 * name is a police organisation, 'non_police' only when it is a confirmed registry institution or clearly a
 * local government / public corporation name, and 'unknown' otherwise — an unknown agency is never counted as
 * non-police. The source agency code is not published (consent scope), so the display name is the evidence.
 */
export type AgencyType = 'police' | 'non_police' | 'unknown';

const POLICE = /경찰(청|서)|지구대|파출소|치안센터|경찰대학|경찰교육원|경찰인재개발원|경찰수사연수원/;
const NON_POLICE = /(특별시|광역시|특별자치시|특별자치도|도|시|군|구)(청)?$|(시청|구청|군청|도청|공사|공단|사업소|관리소|주민센터|행정복지센터)$/;

export function agencyTypeOf(agencyKey: string | null, name: string | null): AgencyType {
  const text = (name ?? '').trim();
  if (!text) return 'unknown';
  if (POLICE.test(text)) return 'police';
  if ((agencyKey ?? '').startsWith('inst:') || NON_POLICE.test(text)) return 'non_police';
  return 'unknown';
}

export interface Posting {
  locations?: Array<{raw:string|null;country:string|null;region:string|null;city:string|null}>;
  remote?: boolean | null;
  url: string;
  title: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  postedAt: string | null;
  validThrough: string | null;
}
export interface Snapshot { jobs: Posting[]; complete: boolean; hash: string }
export interface Source {
  company: string; company_url: string; official_url: string | null; career_url: string | null;
  provider: string | null; endpoint: string | null; evidence: Record<string, unknown>;
  last_success: Date | null;
}

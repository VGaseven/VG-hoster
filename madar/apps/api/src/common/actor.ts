export interface Actor {
  id: string;
  orgId: string;
  role: 'employee' | 'admin';
  siteId: string | null;
  tz: string;
}

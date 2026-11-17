// Common infrastructure format: each provider (DigitalOcean, Heroku, Azure, Grafana…) translates its own API
// into resources, alerts and deploys. The deck only READS: no adapter restarts, scales or changes anything.

export type InfraProviderId = 'digitalocean' | 'heroku' | 'azure' | 'grafana' | 'demo';
export type ResourceStatus = 'ok' | 'warn' | 'down' | 'unknown';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface InfraMetrics { cpu?: number | undefined; memory?: number | undefined; disk?: number | undefined } // 0–100

export interface InfraResource {
  /** Unique across providers: "<provider>:<native id>". */
  id: string;
  provider: InfraProviderId;
  kind: string;            // droplet, app, dyno-formation, sql-database…
  name: string;
  status: ResourceStatus;
  statusText?: string | undefined;
  metrics?: InfraMetrics | undefined;
  region?: string | undefined;
  url?: string | undefined;
}

export interface InfraAlert {
  /** Stable while the alert lasts (groups repeats). */
  fingerprint: string;
  provider: InfraProviderId;
  resourceId?: string | undefined;
  resourceName?: string | undefined;
  title: string;
  severity: AlertSeverity;
  startedAt: string;       // ISO
  url?: string | undefined;
}

export interface InfraDeploy {
  key: string;             // unique: "<provider>:<resource>:<version>"
  provider: InfraProviderId;
  resourceId: string;
  resourceName: string;
  version?: string | undefined;
  status: 'succeeded' | 'failed' | 'in_progress';
  at: string;              // ISO
  description?: string | undefined;
  url?: string | undefined;
}

export interface InfraSnapshot {
  resources: InfraResource[]; alerts: InfraAlert[]; deploys: InfraDeploy[];
  /** Partial read: parts the token cannot reach (e.g. no droplet scope). The rest goes on as usual. */
  warnings?: string[] | undefined;
}

export interface InfraProvider {
  id: InfraProviderId;
  label: string;
  /** Reads the current state. `now` makes it testable (and lets the demo build history). */
  poll(now: number): Promise<InfraSnapshot>;
}

export const emptySnapshot = (): InfraSnapshot => ({ resources: [], alerts: [], deploys: [] });
export const pct = (x: number) => Math.max(0, Math.min(100, Math.round(x * 10) / 10));

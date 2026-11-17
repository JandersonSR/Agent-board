// Formato comum da infraestrutura: cada provedor (DigitalOcean, Heroku, Azure, Grafana…) traduz a própria API
// para recursos, alertas e deploys. O painel só LÊ: nenhum adaptador reinicia, escala ou muda nada.

export type InfraProviderId = 'digitalocean' | 'heroku' | 'azure' | 'grafana' | 'demo';
export type ResourceStatus = 'ok' | 'warn' | 'down' | 'unknown';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface InfraMetrics { cpu?: number | undefined; memory?: number | undefined; disk?: number | undefined } // 0–100

export interface InfraResource {
  /** Único entre provedores: "<provedor>:<id nativo>". */
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
  /** Estável enquanto o alerta durar (agrupa repetições). */
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
  key: string;             // único: "<provedor>:<recurso>:<versão>"
  provider: InfraProviderId;
  resourceId: string;
  resourceName: string;
  version?: string | undefined;
  status: 'succeeded' | 'failed' | 'in_progress';
  at: string;              // ISO
  description?: string | undefined;
  url?: string | undefined;
}

export interface InfraSnapshot { resources: InfraResource[]; alerts: InfraAlert[]; deploys: InfraDeploy[] }

export interface InfraProvider {
  id: InfraProviderId;
  label: string;
  /** Lê o estado atual. `now` permite testar (e o demo gerar histórico). */
  poll(now: number): Promise<InfraSnapshot>;
}

export const emptySnapshot = (): InfraSnapshot => ({ resources: [], alerts: [], deploys: [] });
export const pct = (x: number) => Math.max(0, Math.min(100, Math.round(x * 10) / 10));

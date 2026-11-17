// Deploy date from the GitHub Project fields.
// A date field whose name matches DEPLOY_DATE_FIELD (default: "deploy"); otherwise it tries
// a text/single-select option with a written date (YYYY-MM-DD, DD/MM/YYYY or DD/MM).

export interface ProjectFieldValue { field: string; date?: string | undefined; text?: string | undefined }

const pad = (n: number) => String(n).padStart(2, '0');

/** Extracts YYYY-MM-DD from a text ("Deploy 20/11", "2026-11-20", "PROD 20/11/2026"). */
export function parseLooseDate(text: string, now = new Date()): string | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!br) return undefined;
  const d = Number(br[1]), m = Number(br[2]);
  if (d < 1 || d > 31 || m < 1 || m > 12) return undefined;
  let y = br[3] ? Number(br[3]) : now.getUTCFullYear();
  if (y < 100) y += 2000;
  // No year and the date passed more than 6 months ago: it is next year's.
  if (!br[3] && Date.UTC(y, m - 1, d) < now.getTime() - 183 * 86_400_000) y += 1;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function deployDateFrom(values: ProjectFieldValue[], fieldPattern: RegExp, now = new Date()): string | undefined {
  const matching = values.filter(v => fieldPattern.test(v.field));
  const dated = matching.find(v => v.date);
  if (dated?.date) return dated.date.slice(0, 10);
  for (const v of matching) {
    const d = v.text ? parseLooseDate(v.text, now) : undefined;
    if (d) return d;
  }
  return undefined;
}

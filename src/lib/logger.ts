/**
 * Structured, stage-tagged console logging (PRD §6.8).
 * Stages: [query] [resolve] [icp] [insert] [state] [run] [http]
 */
type Stage =
  | 'run'
  | 'query'
  | 'resolve'
  | 'linkedin'
  | 'icp'
  | 'insert'
  | 'state'
  | 'http'
  | 'validate';

function line(level: string, stage: Stage, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const base = `${ts} ${level} [${stage}] ${msg}`;
  if (extra !== undefined) {
    console.log(base, typeof extra === 'string' ? extra : JSON.stringify(extra));
  } else {
    console.log(base);
  }
}

export const log = {
  info: (stage: Stage, msg: string, extra?: unknown) => line('INFO ', stage, msg, extra),
  warn: (stage: Stage, msg: string, extra?: unknown) => line('WARN ', stage, msg, extra),
  error: (stage: Stage, msg: string, extra?: unknown) => line('ERROR', stage, msg, extra),
};

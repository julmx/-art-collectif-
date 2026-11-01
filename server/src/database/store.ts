import { DatabaseSync } from 'node:sqlite';
import { SIZES, WIDTH, HEIGHT, paintBrush, applyCells, brushMask, type Cell } from '../../../shared/raster';
import type { DrawCommand, DrawResult } from '../../../shared/protocol';
import { PALETTE } from '../../../shared/palette';

type EventRow = { seq: number; participant_id: string; command_json: string; created_at: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validate(input: unknown): { command?: DrawCommand; code?: string; opId: string } {
  const v = input as Record<string, unknown> | null;
  const opId = typeof v?.opId === 'string' && uuid.test(v.opId) ? v.opId : '';
  if (!v || typeof v !== 'object' || Array.isArray(v) || !opId || typeof v.strokeId !== 'string' || !uuid.test(v.strokeId) || Object.keys(v).sort().join(',') !== 'colorId,final,opId,partIndex,points,size,strokeId,tool' || !Number.isSafeInteger(v.partIndex) || (v.partIndex as number) < 0 || typeof v.final !== 'boolean' || (v.tool !== 'pixel' && v.tool !== 'brush') || !Array.isArray(v.points) || v.points.length > 64 || (!v.points.length && !v.final) || Buffer.byteLength(JSON.stringify(v)) > 16384) return { opId, code:'INVALID_MESSAGE' };
  if (typeof v.colorId !== 'number' || typeof v.size !== 'number' || v.points.some(p => !Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number')) return {opId,code:'INVALID_MESSAGE'};
  return {opId,command: {opId,strokeId:v.strokeId as string,partIndex:v.partIndex as number,final:v.final,tool:v.tool,colorId:v.colorId as number,size:v.size as number,points:v.points as DrawCommand['points']}};
}

/** One synchronous SQLite writer owns sequence assignment and state changes. */
export class Store {
  readonly db: DatabaseSync;
  grid: Uint8Array = new Uint8Array(WIDTH * HEIGHT);
  seq = 0;
  healthy = true;
  private batching = false;
  lastChanges: Cell[] | null = null;
  constructor(path: string, deferRebuild=false) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const schemaVersion=Number((this.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
    if(schemaVersion>1) throw new Error('Database schema is newer than this application');
    if ((this.db.prepare('PRAGMA foreign_keys').get() as {foreign_keys:number}).foreign_keys !== 1) throw new Error('SQLite foreign keys unavailable');
    if ((this.db.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode !== 'wal' || (this.db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous !== 2) throw new Error('SQLite durability settings unavailable');
    this.db.exec('BEGIN IMMEDIATE');
    try {
    this.db.exec(`CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL CHECK(status IN ('draft','open','paused','closed')), palette_json TEXT NOT NULL, moderation_revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draw_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL, participant_id TEXT NOT NULL REFERENCES participants(id), stroke_id TEXT NOT NULL, part_index INTEGER NOT NULL CHECK(part_index>=0), final INTEGER NOT NULL CHECK(final IN (0,1)), tool TEXT NOT NULL CHECK(tool IN ('pixel','brush')), color_id INTEGER NOT NULL CHECK(color_id BETWEEN 1 AND 24), size INTEGER NOT NULL CHECK(size IN (1,3,5,9,15,21)), points_json TEXT NOT NULL, command_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(participant_id,op_id), UNIQUE(participant_id,stroke_id,part_index));
      CREATE INDEX IF NOT EXISTS draw_stroke ON draw_events(participant_id,stroke_id);
      CREATE TABLE IF NOT EXISTS terms_history (id INTEGER PRIMARY KEY, terms TEXT NOT NULL, effective_after_seq INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS moderation_actions (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, participant_id TEXT NOT NULL REFERENCES participants(id), stroke_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('hide','restore')), reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS moderation_stroke ON moderation_actions(participant_id,stroke_id,revision);
      CREATE TRIGGER IF NOT EXISTS draw_events_no_update BEFORE UPDATE ON draw_events BEGIN SELECT RAISE(ABORT,'draw_events is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS draw_events_no_delete BEFORE DELETE ON draw_events BEGIN SELECT RAISE(ABORT,'draw_events is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS moderation_no_update BEFORE UPDATE ON moderation_actions BEGIN SELECT RAISE(ABORT,'moderation_actions is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS moderation_no_delete BEFORE DELETE ON moderation_actions BEGIN SELECT RAISE(ABORT,'moderation_actions is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS terms_no_update BEFORE UPDATE ON terms_history BEGIN SELECT RAISE(ABORT,'terms_history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS terms_no_delete BEFORE DELETE ON terms_history BEGIN SELECT RAISE(ABORT,'terms_history is append-only'); END;`);
    const columns = new Set((this.db.prepare('PRAGMA table_info(project)').all() as {name:string}[]).map(c=>c.name));
    for (const [name,type] of Object.entries({base_image_path:'TEXT',base_image_checksum:'TEXT',title:"TEXT NOT NULL DEFAULT 'Art Collectif'",description:"TEXT NOT NULL DEFAULT ''",participation_terms:"TEXT NOT NULL DEFAULT ''",started_at:'TEXT',closed_at:'TEXT',width:'INTEGER NOT NULL DEFAULT 720 CHECK(width=720)',height:'INTEGER NOT NULL DEFAULT 480 CHECK(height=480)',event_format_version:"TEXT NOT NULL DEFAULT '1'",raster_version:"TEXT NOT NULL DEFAULT '1'"})) if (!columns.has(name)) this.db.exec(`ALTER TABLE project ADD COLUMN ${name} ${type}`);
    this.db.prepare('INSERT OR IGNORE INTO project(id,status,palette_json) VALUES(1,?,?)').run('draft',JSON.stringify(PALETTE));
    this.db.exec('PRAGMA user_version=1');
    this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
    if (deferRebuild) this.seq=Number((this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM draw_events').get() as {seq:number}).seq);
    else this.rebuild();
  }
  hidden(participantId:string,strokeId:string,revision:number): boolean {
    const row = this.db.prepare('SELECT action FROM moderation_actions WHERE participant_id=? AND stroke_id=? AND revision<=? ORDER BY revision DESC LIMIT 1').get(participantId,strokeId,revision) as {action:string}|undefined;
    return row?.action === 'hide';
  }
  revision():number { return (this.db.prepare('SELECT moderation_revision FROM project WHERE id=1').get() as {moderation_revision:number}).moderation_revision; }
  replay(target:number, mode:'raw'|'moderated', revision:number, snapshot?:{seq:number;grid:Uint8Array}): Uint8Array {
    const grid = snapshot ? snapshot.grid.slice() : new Uint8Array(WIDTH * HEIGHT), hidden = new Set<string>();
    if (mode === 'moderated') {
      const decisions=this.db.prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision').all(revision) as {participant_id:string;stroke_id:string;action:string}[];
      for (const d of decisions) { const key=JSON.stringify([d.participant_id,d.stroke_id]); if (d.action==='hide') hidden.add(key); else hidden.delete(key); }
    }
    for (const row of this.db.prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events WHERE seq>? AND seq<=? ORDER BY seq').iterate(snapshot?.seq ?? 0,target) as IterableIterator<EventRow>) {
      const c=JSON.parse(row.command_json) as DrawCommand;
      if (!hidden.has(JSON.stringify([row.participant_id,c.strokeId]))) applyCells(grid,paintBrush(c.points,c.size,c.colorId));
    }
    return grid;
  }
  rebuild() { this.seq = Number((this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM draw_events').get() as {seq:number}).seq); this.grid=this.replay(this.seq,'moderated',this.revision()); }
  moderate(participantId:string,strokeId:string,action:'hide'|'restore',reason:string): number {
    if (!reason.trim() || reason.length>1000 || !['hide','restore'].includes(action) || !this.db.prepare('SELECT 1 FROM draw_events WHERE participant_id=? AND stroke_id=?').get(participantId,strokeId)) throw new Error('INVALID_MODERATION');
    this.db.exec('BEGIN IMMEDIATE'); let revision:number;
    try {
      revision=this.revision()+1;
      this.db.prepare('INSERT INTO moderation_actions(revision,participant_id,stroke_id,action,reason,created_at) VALUES(?,?,?,?,?,?)').run(revision,participantId,strokeId,action,reason,new Date().toISOString());
      this.db.prepare('UPDATE project SET moderation_revision=? WHERE id=1').run(revision);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this.healthy=false;
    this.rebuild(); this.healthy=true; return revision;
  }
  submit(participantId: string, input: unknown): DrawResult {
    const parsed = validate(input); if (!parsed.command) return {opId:parsed.opId,accepted:false,code:parsed.code!};
    const c = parsed.command, canonical = JSON.stringify(c);
    const duplicate = this.db.prepare('SELECT seq, command_json FROM draw_events WHERE participant_id=? AND op_id=?').get(participantId,c.opId) as {seq:number;command_json:string}|undefined;
    if (duplicate) return duplicate.command_json === canonical ? {opId:c.opId,accepted:true,seq:duplicate.seq,duplicate:true} : {opId:c.opId,accepted:false,code:'OP_ID_CONFLICT'};
    const reject = (code:string): DrawResult => ({opId:c.opId,accepted:false,code});
    if (!this.healthy) return reject('STORAGE_UNAVAILABLE');
    if ((this.db.prepare('SELECT status FROM project WHERE id=1').get() as {status:string}).status !== 'open') return reject('PROJECT_NOT_OPEN');
    if (!Number.isInteger(c.colorId) || c.colorId<1 || c.colorId>24) return reject('INVALID_COLOR');
    if (!Number.isInteger(c.size) || !SIZES.includes(c.size as typeof SIZES[number]) || (c.tool==='pixel' && c.size!==1)) return reject('INVALID_SIZE');
    if (c.points.some(([x,y])=>!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=WIDTH||y<0||y>=HEIGHT)) return reject('INVALID_COORDINATES');
    // Bound worst-case raster work before committing. Long inputs must be split.
    const maskSize = brushMask(c.size).length;
    let work = c.points.length ? maskSize : 0;
    for (let i=1;i<c.points.length;i++) work += (1 + Math.max(Math.abs(c.points[i][0]-c.points[i-1][0]),Math.abs(c.points[i][1]-c.points[i-1][1]))) * maskSize;
    if (work > 400_000) return reject('COST_LIMIT_EXCEEDED');
    const prior = this.db.prepare('SELECT part_index,final,tool,color_id,size,points_json FROM draw_events WHERE participant_id=? AND stroke_id=? ORDER BY part_index DESC LIMIT 1').get(participantId,c.strokeId) as {part_index:number;final:number;tool:string;color_id:number;size:number;points_json:string}|undefined;
    if (!prior && (c.partIndex !== 0 || c.points.length === 0)) return reject('PART_OUT_OF_ORDER');
    if (prior) {
      if (prior.final) return reject('STROKE_CLOSED');
      if (c.partIndex !== prior.part_index + 1) return reject('PART_OUT_OF_ORDER');
      if (prior.tool !== c.tool || prior.color_id !== c.colorId || prior.size !== c.size) return reject('INVALID_MESSAGE');
      if (c.points.length) { const points = JSON.parse(prior.points_json) as number[][], end = points.at(-1)!; if (end[0] !== c.points[0][0] || end[1] !== c.points[0][1]) return reject('CONTINUITY_ERROR'); }
    }
    let seq: number;
    try {
      if (!this.batching) this.db.exec('BEGIN IMMEDIATE');
      const last = this.db.prepare('SELECT created_at FROM draw_events ORDER BY seq DESC LIMIT 1').get() as {created_at:string}|undefined;
      const now = new Date().toISOString(), created = last && last.created_at > now ? last.created_at : now;
      const result = this.db.prepare('INSERT INTO draw_events(op_id,participant_id,stroke_id,part_index,final,tool,color_id,size,points_json,command_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.opId,participantId,c.strokeId,c.partIndex,Number(c.final),c.tool,c.colorId,c.size,JSON.stringify(c.points),canonical,created);
      seq = Number(result.lastInsertRowid); if (!this.batching) this.db.exec('COMMIT');
    } catch (error) { if (this.batching) throw error; try { this.db.exec('ROLLBACK'); } catch {} return reject('STORAGE_UNAVAILABLE'); }
    // Never report a storage rejection after a successful commit. If reconstruction
    // also fails, propagate the error so the service stops serving stale state.
    this.lastChanges=null;
    try { const cells=this.hidden(participantId,c.strokeId,this.revision()) ? [] : paintBrush(c.points,c.size,c.colorId); applyCells(this.grid,cells); this.lastChanges=cells; this.seq = seq; } catch { this.healthy=false; this.rebuild(); this.healthy=true; }
    return {opId:c.opId,accepted:true,seq,duplicate:false};
  }
  submitBatch(items: {participantId:string;input:unknown}[]): {result:DrawResult;changes:Cell[]|null}[] {
    if (!items.length) return [];
    this.db.exec('BEGIN IMMEDIATE'); this.batching=true;
    try {
      const results=items.map(item=>{const result=this.submit(item.participantId,item.input);return {result,changes:result.accepted&&!result.duplicate?this.lastChanges:null};});
      this.db.exec('COMMIT'); this.batching=false; return results;
    } catch {
      this.healthy=false; this.batching=false;
      try { this.db.exec('ROLLBACK'); } catch { throw new Error('Unable to roll back failed draw batch'); }
      this.rebuild(); this.healthy=true;
      return items.map(item=>({result:{opId:typeof (item.input as {opId?:unknown})?.opId==='string'?(item.input as {opId:string}).opId:'',accepted:false as const,code:'STORAGE_UNAVAILABLE'},changes:null}));
    }
  }
  close() { this.db.close(); }
}

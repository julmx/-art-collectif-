import { io, type Socket } from 'socket.io-client';
import { HEIGHT, WIDTH, applyCells, paintBrush } from '../../../shared/raster';
import type { DrawCommand, DrawResult } from '../../../shared/protocol';

type GridData = ArrayBuffer | ArrayBufferView | ArrayLike<number>;
type State = { grid: GridData; seq: number; moderationRevision: number; status: string; palette:string[]; preserveLocalStroke?: boolean };
type Update = { fromSeq?: number; seq: number; moderationRevision: number; changes: [number,number][] };
type Pending = { command: DrawCommand; seq?: number; sent: boolean; attempts: number; sendId: number; retryAt?: number; preview:boolean };

const MAX_RETRIES = 6;
const BASE_RETRY_DELAY_MS = 1000;

function decodeGrid(grid: unknown): Uint8Array<ArrayBuffer> | null {
  if (grid instanceof Uint8Array) return Uint8Array.from(grid);
  if (grid instanceof ArrayBuffer) return new Uint8Array(grid.slice(0));
  if (ArrayBuffer.isView(grid)) return Uint8Array.from(new Uint8Array(grid.buffer, grid.byteOffset, grid.byteLength));
  if (Array.isArray(grid)) return Uint8Array.from(grid);
  return null;
}

/** The authoritative grid is never mutated by optimistic rendering. */
export class CollaborationClient {
  private socket?: Socket;
  private confirmed = new Uint8Array(WIDTH * HEIGHT);
  private pending: Pending[] = [];
  private seq = 0;
  private revision = 0;
  private ready = false;
  private connected = false;
  private banned = false;
  private status = 'draft';
  private palette: string[] = [];
  private undoing = false;
  constructor(
    private changed: (available: boolean, status: string, palette:string[], reset:boolean) => void,
    private rejected?: (command: DrawCommand, code: string) => void,
  ) {}
  async connect() {
    const response = await fetch('/api/session',{method:'POST',credentials:'same-origin'});
    if (!response.ok) throw new Error('Session indisponible');
    const socket = this.socket = io({autoConnect:false});
    let retry: ReturnType<typeof setTimeout> | undefined;
    const retryManually=()=>{if(!retry)retry=setTimeout(()=>{retry=undefined;if(!socket.connected)socket.connect();},3000);};
    socket.on('connect',()=>{ if(retry)clearTimeout(retry);retry=undefined;this.connected=true; this.ready=false; this.emit(); });
    socket.on('connect_error',()=>{if(!socket.active)retryManually();});
    socket.on('disconnect',(reason:string)=>{ this.connected=false; this.ready=false; for (const p of this.pending) p.sent=false; this.emit(); if(reason==='io server disconnect')retryManually(); });
    socket.on('canvas:state',(state:State)=>this.install(state));
    socket.on('canvas:reset',(state:State)=>{
      if (state.preserveLocalStroke) {
        this.install(state,false);
      } else {
        for (const p of this.pending) p.preview=false;
        this.install(state,true);
      }
    });
    socket.on('project:updated',()=>window.dispatchEvent(new Event('project:updated')));
    socket.on('project:status',(message:{status:string})=>{ this.status=message.status; this.emit(); });
    socket.on('participant:restriction',(message:{banned:boolean})=>{this.banned=message.banned;if(this.banned)this.pending=[];this.emit(true);});
    socket.on('draw:applied',(update:Update)=>this.apply(update));
    socket.connect();
  }
  submit(command: DrawCommand) { if (!this.connected || !this.ready || this.status !== 'open' || this.banned || this.pending.length >= 256) return false; this.pending.push({command,sent:false,attempts:0,sendId:0,preview:true}); this.emit(); this.flush(); return true; }
  canUndo() { return !this.undoing && this.pending.length === 0; }
  async undo():Promise<'ok'|'empty'|'rate-limited'|'error'> {
    if (!this.connected || !this.ready || this.status !== 'open' || this.banned || !this.canUndo()) return 'error';
    this.undoing=true; this.emit();
    try {
      const result = await this.socket!.timeout(120000).emitWithAck('draw:undo');
      if (result?.ok) return 'ok';
      if (result?.code === 'EMPTY') return 'empty';
      if (result?.code === 'RATE_LIMITED') return 'rate-limited';
      return 'error';
    }
    catch { return 'error'; }
    finally { this.undoing=false; this.emit(); }
  }
  private install(state:State, reset=false) {
    const grid = decodeGrid(state.grid);
    if (!grid || grid.length !== WIDTH * HEIGHT || !Number.isSafeInteger(state.seq)) { this.socket?.disconnect(); return; }
    this.confirmed = grid; this.seq=state.seq; this.revision=state.moderationRevision; this.status=state.status; this.palette=state.palette; this.ready=true;
    // A full state replaces all acknowledged previews, including commits lost before recovery.
    this.pending=this.pending.filter(p=>p.seq === undefined);
    for (const p of this.pending) p.sent=false;
    this.emit(reset); this.flush();
  }
  private apply(update:Update) {
    if (!this.ready) return;
    const fromSeq = update.fromSeq ?? update.seq;
    if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(update.seq) || fromSeq > update.seq) {
      this.ready=false; this.emit(); this.socket?.emit('canvas:resync'); return;
    }
    if (update.seq <= this.seq && update.moderationRevision === this.revision) return;
    if (fromSeq !== this.seq+1 || update.moderationRevision !== this.revision) { this.ready=false; this.emit(); this.socket?.emit('canvas:resync'); return; }
    for (const [index,color] of update.changes) { if (!Number.isInteger(index) || index<0 || index>=this.confirmed.length || !Number.isInteger(color) || color<0 || color>24) { this.ready=false; this.emit(); this.socket?.emit('canvas:resync'); return; } this.confirmed[index]=color; }
    this.seq=update.seq; this.pending=this.pending.filter(p=>p.seq === undefined || p.seq>this.seq); this.emit();
  }
  private flush() {
    if (!this.ready || !this.connected) return;
    const p=this.pending.find(item=>item.seq === undefined);
    if (!p || p.sent || (p.retryAt !== undefined && performance.now() < p.retryAt)) return;
    p.sent=true;
    const sendId = ++p.sendId;
    this.socket!.timeout(5000).emit('draw:submit',p.command,(error:Error|null,result?:DrawResult)=>{
      if (!this.pending.includes(p) || p.sendId !== sendId) return;
      if (error || !result || (!result.accepted && (result.code === 'STORAGE_UNAVAILABLE' || result.code === 'RATE_LIMITED'))) {
        const code = error ? 'ACK_TIMEOUT' : (result && !result.accepted ? result.code : 'ACK_TIMEOUT');
        p.sent=false;
        p.attempts += 1;
        if (p.attempts >= MAX_RETRIES) {
          this.pending=this.pending.filter(item=>item.command.strokeId!==p.command.strokeId || item.seq!==undefined);
          this.rejected?.(p.command,code);
          this.emit();
          this.flush();
          return;
        }
        const delayMs = BASE_RETRY_DELAY_MS * (2 ** (p.attempts - 1));
        p.retryAt=performance.now()+delayMs;
        const resume = () => {
          const remaining = p.retryAt! - performance.now();
          if (remaining > 0) setTimeout(resume, remaining);
          else this.flush();
        };
        setTimeout(resume,delayMs);
        return;
      }
      if (result.accepted) { p.seq=result.seq; if (p.seq<=this.seq) this.pending=this.pending.filter(item=>item!==p); }
      else {
        this.pending=this.pending.filter(item=>item.command.strokeId!==p.command.strokeId || item.seq!==undefined);
        this.rejected?.(p.command,result.code);
      }
      this.emit(); this.flush();
    });
  }
  displayGrid() {
    const display=this.confirmed.slice();
    for (const {command:c,preview} of this.pending) if (preview) applyCells(display,paintBrush(c.points,c.size,c.colorId));
    return display;
  }
  private emit(reset=false) {
    this.changed(this.ready && this.connected && this.status==='open'&&!this.banned&&!this.undoing,this.connected ? (this.banned?'banned':this.status) : 'disconnected',this.palette,reset);
  }
}

import { io, type Socket } from 'socket.io-client';
import { HEIGHT, WIDTH, applyCells, paintBrush } from '../../../shared/raster';
import type { DrawCommand, DrawResult } from '../../../shared/protocol';

type State = { grid: number[]; seq: number; moderationRevision: number; status: string; palette:string[] };
type Update = { seq: number; moderationRevision: number; changes: [number,number][] };
type Pending = { command: DrawCommand; seq?: number; sent: boolean; preview:boolean };

/** The authoritative grid is never mutated by optimistic rendering. */
export class CollaborationClient {
  private socket?: Socket;
  private confirmed = new Uint8Array(WIDTH * HEIGHT);
  private pending: Pending[] = [];
  private seq = 0;
  private revision = 0;
  private ready = false;
  private connected = false;
  private status = 'draft';
  private palette: string[] = [];
  constructor(private changed: (grid: Uint8Array, available: boolean, status: string, palette:string[], reset:boolean) => void) {}
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
    socket.on('canvas:reset',(state:State)=>{ for (const p of this.pending) p.preview=false; this.install(state,true); });
    socket.on('project:updated',()=>window.dispatchEvent(new Event('project:updated')));
    socket.on('project:status',(message:{status:string})=>{ this.status=message.status; this.emit(); });
    socket.on('draw:applied',(update:Update)=>this.apply(update));
    socket.connect();
  }
  submit(command: DrawCommand) { if (!this.connected || !this.ready || this.status !== 'open' || this.pending.length >= 256) return false; this.pending.push({command,sent:false,preview:true}); this.emit(); this.flush(); return true; }
  private install(state:State, reset=false) {
    if (state.grid.length !== WIDTH * HEIGHT || !Number.isSafeInteger(state.seq)) { this.socket?.disconnect(); return; }
    this.confirmed = Uint8Array.from(state.grid); this.seq=state.seq; this.revision=state.moderationRevision; this.status=state.status; this.palette=state.palette; this.ready=true;
    this.pending=this.pending.filter(p=>p.seq === undefined || p.seq > this.seq);
    for (const p of this.pending) p.sent=false;
    this.emit(reset); this.flush();
  }
  private apply(update:Update) {
    if (!this.ready) return;
    if (update.seq <= this.seq && update.moderationRevision === this.revision) return;
    if (update.seq !== this.seq+1 || update.moderationRevision !== this.revision) { this.ready=false; this.emit(); this.socket?.emit('canvas:resync'); return; }
    for (const [index,color] of update.changes) { if (!Number.isInteger(index) || index<0 || index>=this.confirmed.length || !Number.isInteger(color) || color<0 || color>24) { this.ready=false; this.socket?.emit('canvas:resync'); return; } this.confirmed[index]=color; }
    this.seq=update.seq; this.pending=this.pending.filter(p=>p.seq === undefined || p.seq>this.seq); this.emit();
  }
  private flush() {
    if (!this.ready || !this.connected) return;
    const p=this.pending.find(item=>item.seq === undefined);
    if (!p || p.sent) return;
    p.sent=true;
    this.socket!.timeout(5000).emit('draw:submit',p.command,(error:Error|null,result:DrawResult)=>{
      if (!this.pending.includes(p)) return;
      if (error) { p.sent=false; if (this.connected) setTimeout(()=>this.flush(),1000); return; }
      if (result.accepted) { p.seq=result.seq; if (p.seq<=this.seq) this.pending=this.pending.filter(item=>item!==p); }
      else if (result.code === 'STORAGE_UNAVAILABLE' || result.code === 'RATE_LIMITED') { p.sent=false; setTimeout(()=>this.flush(),1000); return; }
      else this.pending=this.pending.filter(item=>item!==p);
      this.emit(); this.flush();
    });
  }
  private emit(reset=false) {
    const display=this.confirmed.slice();
    for (const {command:c,preview} of this.pending) if (preview) applyCells(display,paintBrush(c.points,c.size,c.colorId));
    this.changed(display,this.ready && this.connected && this.status==='open',this.connected ? this.status : 'disconnected',this.palette,reset);
  }
}

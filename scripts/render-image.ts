import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp, {type Sharp} from 'sharp';
import {WIDTH,HEIGHT} from '../shared/raster';
import {Store} from '../server/src/database/store';
import {Snapshots} from '../server/src/renderer/snapshots';
type Request={database:string;output:string;snapshotDirectory:string;target:number;revision:number;mode:'raw'|'moderated';scale:number;palette:string[];baseImagePath:string|null;overlay:boolean};
const parts:Buffer[]=[];for await(const part of process.stdin)parts.push(Buffer.from(part));const request=JSON.parse(Buffer.concat(parts).toString('utf8')) as Request;
if(!Number.isSafeInteger(request.target)||request.target<0||!Number.isSafeInteger(request.revision)||request.revision<0||!['raw','moderated'].includes(request.mode)||!Number.isInteger(request.scale)||request.scale<1||request.scale>8||!Array.isArray(request.palette)||request.palette.length!==24)throw new Error('Invalid render request');
const store=new Store(resolve(request.database),true);
try{
 const snapshots=new Snapshots(store,resolve(request.snapshotDirectory));const cached=request.mode==='moderated'?await snapshots.latest(request.target,request.revision):null;const grid=store.replay(request.target,request.mode,request.revision,cached??undefined),pixels=Buffer.alloc(WIDTH*HEIGHT*4);
 for(let i=0;i<grid.length;i++)if(grid[i]){const c=request.palette[grid[i]-1];pixels[i*4]=parseInt(c.slice(1,3),16);pixels[i*4+1]=parseInt(c.slice(3,5),16);pixels[i*4+2]=parseInt(c.slice(5,7),16);pixels[i*4+3]=255;}
 let image:Sharp;
 if(request.overlay)image=sharp(pixels,{raw:{width:WIDTH,height:HEIGHT,channels:4}});else {if(!request.baseImagePath)throw new Error('Base absent');image=sharp(await readFile(request.baseImagePath)).composite([{input:pixels,raw:{width:WIDTH,height:HEIGHT,channels:4}}]);}
 const native=await image.png().toBuffer(),output=request.scale===1?native:await sharp(native).resize(WIDTH*request.scale,HEIGHT*request.scale,{kernel:'nearest'}).png().toBuffer();await writeFile(resolve(request.output),output,{mode:0o600});
}finally{store.close();}

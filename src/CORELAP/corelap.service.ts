// src/CORELAP/corelap.service.ts
import { Injectable } from '@nestjs/common';
import { CreateCorelapDto } from './dto/corelap.dto';

type Weights = { A:number; E:number; I:number; O:number; U:number; X:number; blank:number };
type Letter = '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';
const TIER_ORDER: Letter[] = ['A','E','I','O','U'];

type DeptNode = { idx:number; name:string; fixed:boolean };
type Cell = { x:number; y:number; idx:number; name:string };
type Step = { step:number; name:string; idx:number; x:number; y:number; pr:number; tier:Letter|'none'; tcr:number };

const CENTER_PULL = 0.04;   // ไบอัสเล็กๆเข้าหาศูนย์กลาง (กันไปกองมุม)
const EDGE_PADDING = 0.02;  // ไบอัสเล็กๆเว้นขอบ
const JITTER = 1e-6;        // แตกเสมอคะแนนเท่ากัน

@Injectable()
export class CorelapService {
  private w(letter: string, W: Weights) {
    const raw = (letter || '').toUpperCase() as Letter;
    const key = (raw === '' ? 'blank' : raw) as keyof Weights;
    return (W[key] ?? 0) as number;
  }

  // ใช้ Msym = W + W^T เพื่อให้ TCR/PR เป็นสองทาง
  private numericMatrixSym(letters: string[][], W: Weights): number[][] {
    const n = letters.length;
    const M = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        const lij = (letters?.[i]?.[j] ?? '').toString();
        const lji = (letters?.[j]?.[i] ?? '').toString();
        M[i][j] = this.w(lij,W) + this.w(lji,W);
      }
      M[i][i] = 0;
    }
    return M;
  }

  private tcr(i:number, Msym:number[][]){
    let s = 0; for (let j=0;j<Msym.length;j++) s += Msym[i][j]; return s;
  }

  // ค่าน้ำหนักฝั่งเดียว (ใช้ตอนนับด้าน/มุม) = max(letter_ij, letter_ji) แบบที่คุยกัน
  private weightPair(i:number, j:number, letters:string[][], W:Weights){
    const lij = (letters?.[i]?.[j] ?? '').toString().toUpperCase() as keyof Weights | '';
    const lji = (letters?.[j]?.[i] ?? '').toString().toUpperCase() as keyof Weights | '';
    const wij = lij === '' ? (W.blank ?? 0) : (W[lij] ?? 0);
    const wji = lji === '' ? (W.blank ?? 0) : (W[lji] ?? 0);
    return Math.max(wij, wji);
  }

  // คำนวณ PR ของการวางแผนก i ที่ cell (x,y) จากเพื่อนบ้าน 8 ทิศ
  private placementPR(
    i:number, x:number, y:number,
    owner:number[][], letters:string[][], W:Weights,
    gridW:number, gridH:number,
    targetX:number, targetY:number
  ){
    let pr = 0;
    let touching = false;

    // 4 ด้าน: factor 1.0
    const sides = [
      {dx:  1, dy:  0}, {dx: -1, dy:  0},
      {dx:  0, dy:  1}, {dx:  0, dy: -1},
    ];
    for (const s of sides){
      const nx = x + s.dx, ny = y + s.dy;
      if (nx>=0 && ny>=0 && nx<gridW && ny<gridH && owner[ny][nx] >= 0){
        touching = true;
        const j = owner[ny][nx];
        pr += 1.0 * this.weightPair(i, j, letters, W);
      }
    }

    // 4 มุม: factor 0.5
    const corners = [
      {dx:  1, dy:  1}, {dx:  1, dy: -1},
      {dx: -1, dy:  1}, {dx: -1, dy: -1},
    ];
    for (const c of corners){
      const nx = x + c.dx, ny = y + c.dy;
      if (nx>=0 && ny>=0 && nx<gridW && ny<gridH && owner[ny][nx] >= 0){
        touching = true;
        const j = owner[ny][nx];
        pr += 0.5 * this.weightPair(i, j, letters, W);
      }
    }

    if (!touching) return { pr: -Infinity, score: -Infinity }; // ต้องแตะอย่างน้อย 1 จุด

    // ไบอัสเล็กๆกันไปกองมุม/ขอบ และช่วยแตกคะแนน
    const centerGain = -(Math.abs(x - targetX) + Math.abs(y - targetY)); // ใกล้ศูนย์กลางดีกว่า
    const pad = Math.min(x, y, gridW - 1 - x, gridH - 1 - y);           // เว้นขอบเล็กน้อย
    const score = pr + CENTER_PULL * centerGain + EDGE_PADDING * pad + JITTER*Math.random();

    return { pr, score };
  }

  // เลือกคิวถัดไป: Tier-first (A>E>I>O>U) กับชุดที่วางแล้ว, tie-break ด้วย TCR
  private pickNextByTier(
    letters:string[][], placed:Set<number>, tcrs:number[], nodes:DeptNode[]
  ): { idx:number; tier:Letter|'none' } {
    const placedSet = placed;
    const unplaced = nodes.map(n=>n.idx).filter(i => !placedSet.has(i));
    if (unplaced.length===0) return { idx:-1, tier:'none' };

    for (const tier of TIER_ORDER){
      const bucket:number[] = [];
      for (const i of unplaced){
        let ok = false;
        placedSet.forEach(j=>{
          const lij = (letters[i]?.[j] ?? '').toUpperCase();
          const lji = (letters[j]?.[i] ?? '').toUpperCase();
          if (lij === tier || lji === tier) ok = true;
        });
        if (ok) bucket.push(i);
      }
      if (bucket.length){
        let best = bucket[0];
        for (const i of bucket) if (tcrs[i] > tcrs[best]) best = i;
        return { idx: best, tier };
      }
    }

    // ไม่มี tier กับของที่วางแล้ว → เอา TCR สูงสุดที่ยังไม่วาง
    let best = unplaced[0];
    for (const i of unplaced) if (tcrs[i] > tcrs[best]) best = i;
    return { idx: best, tier: 'none' };
  }

  generate(dto: CreateCorelapDto, opts: { cellSizeMeters:number }) {
    const W: Weights = {
      A: dto.closenessWeights?.A ?? 10,
      E: dto.closenessWeights?.E ?? 8,
      I: dto.closenessWeights?.I ?? 6,
      O: dto.closenessWeights?.O ?? 4,
      U: dto.closenessWeights?.U ?? 2,
      X: dto.closenessWeights?.X ?? 0,
      blank: dto.closenessWeights?.blank ?? 0,
    };

    const gridW = dto.gridWidth;
    const gridH = dto.gridHeight;

    // รายชื่อแผนกแบบ “แค่ 1 บล็อกต่อแผนก” ไม่สน area
    const nodes: DeptNode[] = (dto.departments || []).map((d, i) => ({
      idx: i, name: d.name, fixed: !!d.fixed
    }));

    // owner = ดัชนีแผนกที่ยึด cell นั้น (-1 = ว่าง)
    const owner = Array.from({ length: gridH }, () => Array(gridW).fill(-1));

    const letters = dto.closenessMatrix as string[][];
    const Msym = this.numericMatrixSym(letters, W);
    const tcrs = nodes.map(n => this.tcr(n.idx, Msym));

    // 1) วาง seed ตรงกลางสุดที่ว่าง (ไม่สน PR เพราะยังไม่มีใครให้แตะ)
    let seedIdx = nodes[0]?.idx ?? 0, maxTCR = -Infinity;
    for (const n of nodes) {
      if (tcrs[n.idx] > maxTCR) { maxTCR = tcrs[n.idx]; seedIdx = n.idx; }
    }
    const targetX = Math.floor(gridW/2), targetY = Math.floor(gridH/2);
    let sx = targetX, sy = targetY;
    // หา cell ว่างที่ใกล้ center สุด
    if (owner[sy][sx] !== -1) {
      const coords: Array<{x:number;y:number;d:number}> = [];
      for (let y=0;y<gridH;y++) for (let x=0;x<gridW;x++)
        coords.push({ x, y, d: Math.abs(x-targetX)+Math.abs(y-targetY) });
      coords.sort((a,b)=>a.d-b.d);
      for (const c of coords){ if (owner[c.y][c.x] === -1){ sx=c.x; sy=c.y; break; } }
    }
    owner[sy][sx] = seedIdx;
    const placed = new Set<number>([seedIdx]);

    const placements: Cell[] = [{ x:sx, y:sy, idx:seedIdx, name:nodes[seedIdx].name }];
    const steps: Step[] = [{
      step: 1, name: nodes[seedIdx].name, idx: seedIdx, x:sx, y:sy, pr: 0, tier: 'none', tcr: tcrs[seedIdx]
    }];
    let stepNo = 1;

    // 2) วางทีละแผนกที่เหลือ: เลือกตาม tier → หา cell ว่างที่ PR สูงสุด
    while (placed.size < nodes.length) {
      const pick = this.pickNextByTier(letters, placed, tcrs, nodes);
      const i = pick.idx;
      if (i === -1) break;

      // สแกนทุก cell ว่าง: ประเมิน PR + ไบอัสเล็กๆ
      let best = { pr: -Infinity, score: -Infinity, x: -1, y: -1 };
      const cx = Math.floor(gridW/2), cy = Math.floor(gridH/2);
      for (let y=0;y<gridH;y++){
        for (let x=0;x<gridW;x++){
          if (owner[y][x] !== -1) continue;
          const r = this.placementPR(i, x, y, owner, letters, W, gridW, gridH, cx, cy);
          if (r.score > best.score) best = { pr: r.pr, score: r.score, x, y };
        }
      }

      // ถ้าไม่มี cell ที่แตะใครเลย (กริดว่างส่วนที่เหลือ) ให้เอา cell ว่างที่ใกล้ center สุด
      if (!isFinite(best.score)) {
        const coords: Array<{x:number;y:number;d:number}> = [];
        for (let y=0;y<gridH;y++) for (let x=0;x<gridW;x++)
          if (owner[y][x] === -1) coords.push({ x, y, d: Math.abs(x-cx)+Math.abs(y-cy) });
        coords.sort((a,b)=>a.d-b.d);
        if (coords.length) { best = { pr: 0, score: 0, x: coords[0].x, y: coords[0].y }; }
      }

      if (best.x === -1) break; // ไม่เหลือที่ว่าง

      owner[best.y][best.x] = i;
      placed.add(i);
      placements.push({ x: best.x, y: best.y, idx: i, name: nodes[i].name });
      steps.push({
        step: ++stepNo,
        name: nodes[i].name,
        idx: i,
        x: best.x, y: best.y,
        pr: isFinite(best.pr) ? best.pr : 0,
        tier: pick.tier,
        tcr: tcrs[i],
      });
    }

    // สรุปคะแนน PR รวม (นับเฉพาะเพื่อนบ้าน 8 ทิศของคู่วางจริง)
    let totalPR = 0;
    const dirs = [
      {dx:  1, dy:  0, w: 1.0}, {dx: -1, dy:  0, w: 1.0},
      {dx:  0, dy:  1, w: 1.0}, {dx:  0, dy: -1, w: 1.0},
      {dx:  1, dy:  1, w: 0.5}, {dx:  1, dy: -1, w: 0.5},
      {dx: -1, dy:  1, w: 0.5}, {dx: -1, dy: -1, w: 0.5},
    ];
    for (const c of placements){
      for (const d of dirs){
        const nx = c.x + d.dx, ny = c.y + d.dy;
        if (nx>=0 && ny>=0 && nx<gridW && ny<gridH && owner[ny][nx] >= 0){
          const j = owner[ny][nx];
          totalPR += d.w * this.weightPair(c.idx, j, letters, W);
        }
      }
    }
    // นับซ้ำสองทิศอยู่แล้ว ไม่จำเป็นต้องหารสองถ้าไม่ต้องการ

    return {
      grid: { width: gridW, height: gridH, cellSizeMeters: opts.cellSizeMeters },
      mode: 'CRAFT-like (unit blocks)',
      tcr: nodes.map(n => ({ name: n.name, tcr: tcrs[n.idx] })),
      seed: nodes[seedIdx].name,
      order: steps.map(s => s.name), // ชื่อเรียงตามลำดับวาง
      steps,                          // รายละเอียดต่อสเต็ป
      score: { totalPR },
      // ส่งตำแหน่งบล็อกเดียวต่อแผนก (width/height = 1)
      placements: placements.map(p => ({ name: p.name, x: p.x, y: p.y, width:1, height:1 })),
      ownerGrid: owner, // (ถ้าจะ debug/แสดงผลบน FE)
    };
  }
}

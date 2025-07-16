// src/CRAFT/craft-brute-force.ts
type Department = {
  name: string;
  width: number;
  height: number;
};
type Position = { x: number; y: number };

// สร้าง permutations
function permute<T>(arr: T[]): T[][] {
  if (arr.length === 0) return [[]];
  return arr.flatMap((item, i) =>
    permute(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [item, ...p]),
  );
}

// คำนวณ total cost ของ arrangement
function calcCost(
  layout: (Department & Position)[],
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
): number {
  let total = 0;
  for (let i = 0; i < layout.length; i++) {
    for (let j = 0; j < layout.length; j++) {
      if (i !== j) {
        const depA = layout[i];
        const depB = layout[j];
        const flow = flowMatrix[i][j];
        let dist: number;
        if (metric === 'euclidean') {
          dist = Math.sqrt(
            Math.pow(depA.x - depB.x, 2) + Math.pow(depA.y - depB.y, 2),
          );
        } else {
          dist = Math.abs(depA.x - depB.x) + Math.abs(depA.y - depB.y);
        }
        total += dist * flow;
      }
    }
  }
  return total;
}

export function bruteForceLayout(
  departments: Department[],
  gridSize: number,
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
) {
  // กำหนดตำแหน่งเป็นตาราง เช่น [0,0],[1,0],[2,0],... ทีละจุด (แนว row-major)
  const possiblePositions: Position[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      possiblePositions.push({ x, y });
    }
  }

  // ตำแหน่งต้องพอกับจำนวนแผนก (เอาแค่ n อันแรก)
  const N = departments.length;
  const allPositionPermutes = permute(possiblePositions).slice(0, factorial(N)); // จำกัดแค่ n! ชุดแรก

  let minCost = Infinity;
  let bestLayout: (Department & Position)[] = [];

  for (const posSet of allPositionPermutes) {
    const candidate = departments.map((d, i) => ({
      ...d,
      x: posSet[i].x,
      y: posSet[i].y,
    }));
    const cost = calcCost(candidate, flowMatrix, metric);
    if (cost < minCost) {
      minCost = cost;
      bestLayout = candidate;
    }
  }

  return {
    assignment: bestLayout,
    totalCost: minCost,
  };
}

// Util: Factorial
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

type Department = {
  name: string;
  width: number;
  height: number;
};
type Position = { x: number; y: number };

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

// Greedy Swap Optimization
export function greedySwapLayout(
  departments: Department[],
  gridSize: number,
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
  maxIter: number = 1000,
) {
  // Initial layout: วางเรียงกันใน grid
  const layout: (Department & Position)[] = [];
  let cx = 0,
    cy = 0;
  for (const d of departments) {
    layout.push({ ...d, x: cx, y: cy });
    cx += d.width;
    if (cx + d.width > gridSize) {
      cx = 0;
      cy++;
    }
  }

  let bestLayout = [...layout];
  let bestCost = calcCost(bestLayout, flowMatrix, metric);

  // ลองสลับตำแหน่งสองอัน แล้วดู cost
  for (let iter = 0; iter < maxIter; iter++) {
    // clone
    const newLayout = bestLayout.map((d) => ({ ...d }));
    // สุ่มเลือก index 2 อันมา swap
    const i = Math.floor(Math.random() * newLayout.length);
    const j = Math.floor(Math.random() * newLayout.length);
    if (i === j) continue;
    // swap position
    [newLayout[i].x, newLayout[j].x] = [newLayout[j].x, newLayout[i].x];
    [newLayout[i].y, newLayout[j].y] = [newLayout[j].y, newLayout[i].y];

    const newCost = calcCost(newLayout, flowMatrix, metric);
    if (newCost < bestCost) {
      bestCost = newCost;
      bestLayout = newLayout;
    }
  }

  return {
    assignment: bestLayout,
    totalCost: bestCost,
  };
}

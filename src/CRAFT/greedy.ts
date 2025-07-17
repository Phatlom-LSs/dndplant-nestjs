type Department = { name: string; width: number; height: number; };
type Position = { x: number; y: number; };

// Pack แบบ row-major (เรียงใน grid ซ้าย-ขวา-ลงล่าง)
function packDepartmentsRowMajor(order: Department[], gridSize: number): (Department & Position)[] {
  const out: (Department & Position)[] = [];
  let cx = 0, cy = 0, rowHeight = 0;
  for (const dep of order) {
    if (cx + dep.width > gridSize) {
      cx = 0;
      cy += rowHeight;
      rowHeight = 0;
    }
    out.push({ ...dep, x: cx, y: cy });
    cx += dep.width;
    if (dep.height > rowHeight) rowHeight = dep.height;
  }
  return out;
}

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
        const flow = flowMatrix[i][j]; // <--- cost จริงจาก matrix
        const dist = metric === "euclidean"
          ? Math.sqrt(Math.pow(depA.x - depB.x, 2) + Math.pow(depA.y - depB.y, 2))
          : Math.abs(depA.x - depB.x) + Math.abs(depA.y - depB.y);
        total += dist * flow;
      }
    }
  }
  return total;
}

// Greedy/Random Swap
export function greedySwapLayout(
  departments: Department[],
  gridSize: number,
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
  maxIter = 1000,
) {
  let order = [...departments];
  let bestLayout = packDepartmentsRowMajor(order, gridSize);
  let bestCost = calcCost(bestLayout, flowMatrix, metric);

  for (let iter = 0; iter < maxIter; iter++) {
    // สลับสองตัวใน order
    const i = Math.floor(Math.random() * order.length);
    const j = Math.floor(Math.random() * order.length);
    if (i === j) continue;
    const newOrder = [...order];
    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
    const newLayout = packDepartmentsRowMajor(newOrder, gridSize);
    const newCost = calcCost(newLayout, flowMatrix, metric);

    // DEBUG: ดูว่ามันดีขึ้นจริงมั้ย
    // console.log(`iter ${iter}: cost=${newCost} best=${bestCost} order=${newOrder.map(d=>d.name)}`)

    if (newCost < bestCost) {
      order = newOrder;
      bestLayout = newLayout;
      bestCost = newCost;
      // log หรือหยุดเลยถ้าอยากได้แค่อันที่ดีกว่าเดิม
      // break;
    }
  }
  return {
    assignment: bestLayout,
    totalCost: bestCost,
  };
}

type Department = {
  name: string;
  width: number;
  height: number;
};
type Position = { x: number; y: number };

function packDepartmentsRowMajor(
  depts: Department[],
  gridSize: number,
): (Department & Position)[] {
  let x = 0,
    y = 0,
    rowHeight = 0;
  const out: (Department & Position)[] = [];
  for (const d of depts) {
    if (x + d.width > gridSize) {
      // ขึ้นแถวใหม่
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    out.push({ ...d, x, y });
    x += d.width;
    rowHeight = Math.max(rowHeight, d.height);
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

export function greedySwapLayout(
  departments: Department[],
  gridSize: number,
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
  maxIter: number = 1000,
) {
  // เริ่มต้นแบบ row-major
  let order = [...departments];
  let bestLayout = packDepartmentsRowMajor(order, gridSize);
  let bestCost = calcCost(bestLayout, flowMatrix, metric);

  for (let iter = 0; iter < maxIter; iter++) {
    // สุ่มสลับลำดับสองแผนก
    const i = Math.floor(Math.random() * order.length);
    let j = Math.floor(Math.random() * order.length);
    while (j === i) j = Math.floor(Math.random() * order.length);
    // swap order
    const newOrder = [...order];
    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
    // วางใหม่
    const newLayout = packDepartmentsRowMajor(newOrder, gridSize);
    const newCost = calcCost(newLayout, flowMatrix, metric);
    if (newCost < bestCost) {
      order = newOrder;
      bestLayout = newLayout;
      bestCost = newCost;
    }
  }

  return {
    assignment: bestLayout,
    totalCost: bestCost,
  };
}

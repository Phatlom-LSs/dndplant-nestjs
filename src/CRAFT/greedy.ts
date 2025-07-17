type Department = {
  name: string;
  width: number;
  height: number;
};
type Position = { x: number; y: number };

// คำนวณ cost ของ layout ปัจจุบัน
export function calcCost(
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

// วางทีละแผนกจากซ้ายไปขวา เต็มแถวแล้วขึ้นแถวใหม่
export function greedyLayout(
  departments: Department[],
  gridSize: number,
  flowMatrix: number[][],
  metric: 'manhattan' | 'euclidean',
) {
  let x = 0,
    y = 0,
    rowHeight = 0;
  const layout: (Department & Position)[] = [];

  for (const d of departments) {
    if (x + d.width > gridSize) {
      // ขึ้นบรรทัดใหม่
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    layout.push({ ...d, x, y });
    x += d.width;
    if (d.height > rowHeight) rowHeight = d.height;
  }

  const totalCost = calcCost(layout, flowMatrix, metric);

  return {
    assignment: layout,
    totalCost,
  };
}

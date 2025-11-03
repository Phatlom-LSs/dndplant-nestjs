export type ClosenessLetter = '' | 'A' | 'E' | 'I' | 'O' | 'U' | 'X';
export type SweepMode = 'row' | 'snake' | 'col' | 'col-snake';

export class GenerateAldepDto {
  projectId!: string;
  name?: string;

  gridWidth!: number;
  gridHeight!: number;
  cellSizeMeters?: number;

  departments!: Array<{ name: string; area: number; fixed?: boolean }>;

  closenessMatrix!: string[][];
  closenessWeights?: {
    A?: number;
    E?: number;
    I?: number;
    O?: number;
    U?: number;
    X?: number;
    blank?: number;
  };

  lowerBound?: ClosenessLetter;
  stripWidth?: SweepMode;
  seeds?: number;
  randomSeed?: number;

  allowSplitting?: boolean;
  maxFragmentsPerDept?: number;
}

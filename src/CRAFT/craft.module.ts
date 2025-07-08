import { Module } from '@nestjs/common';
import { CraftAlgoService } from './craft.service';
import { layoutController } from './craft.controller';

@Module({
  providers: [CraftAlgoService],
  exports: [CraftAlgoService],
  controllers: [layoutController],
})
export class craftAlgoModule {}

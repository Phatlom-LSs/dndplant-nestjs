import { Module } from '@nestjs/common';
import { craftAlgoService } from './craft.service';
import { layoutController } from './craft.controller';

@Module({
  providers: [craftAlgoService],
  exports: [craftAlgoService],
  controllers: [layoutController],
})
export class craftAlgoModule {}

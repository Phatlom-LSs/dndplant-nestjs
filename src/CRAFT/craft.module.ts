import { Module } from '@nestjs/common';
import { CraftAlgoService } from './craft.service';
import { layoutController } from './craft.controller';
import { DatabaseService } from 'src/database/database.service';

@Module({
  providers: [CraftAlgoService, DatabaseService],
  exports: [CraftAlgoService],
  controllers: [layoutController],
})
export class craftAlgoModule {}

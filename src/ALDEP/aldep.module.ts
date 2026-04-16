import { Module } from '@nestjs/common';
import { AldepController } from './aldep.controller';
import { AldepService } from './aldep.service';
import { DatabaseService } from 'src/database/database.service';

@Module({
  controllers: [AldepController],
  providers: [AldepService, DatabaseService],
  exports: [AldepService],
})
export class AldepModule {}

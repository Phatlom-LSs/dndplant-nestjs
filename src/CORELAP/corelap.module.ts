import { Module } from '@nestjs/common';
import { CorelapController } from './corelap.controller';
import { CorelapService } from './corelap.service';

@Module({
  controllers: [CorelapController],
  providers: [CorelapService],
  exports: [CorelapService],
})
export class CorelapModule {}

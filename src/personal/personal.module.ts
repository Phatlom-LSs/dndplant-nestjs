import { Module } from '@nestjs/common';
import { PersonalService } from './personal.service';
import { PersonalController } from './personal.controller';
import { JwtStrategy } from 'src/auth/jwt.strategy';

@Module({
  controllers: [PersonalController],
  providers: [PersonalService, JwtStrategy],
})
export class PersonalModule {}
